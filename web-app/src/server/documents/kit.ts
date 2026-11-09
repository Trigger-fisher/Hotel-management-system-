import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import path from "node:path";
import type PDFDocument from "pdfkit";
import { amountInWords, formatDateTime, formatINR } from "@shared/dashboards/format";
import { AppError } from "../errors";

// The shared layout kit of the printable documents (MJ #22, Backend Review/07-PDF-DECISION.md; redesigned 5 Nov 2026): A4, Inter for Latin, digits and the rupee
// sign, Noto Sans Gujarati / Devanagari for names in those scripts. White letterhead with the document's title block, one thin gold rule as the only colour,
// graphite rules and text, so a black-and-white print loses nothing. Text is DATA: pdfkit never interprets markup, control characters are dropped, nothing
// is fetched or written to disk.

export const PAGE = { width: 595.28, height: 841.89, margin: 36 } as const;
export const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;
export const MAX_PAGES = 200;
/** Lowest y a block may reach before a new page (the footer sits below it). */
export const BOTTOM = PAGE.height - PAGE.margin - 20;
export const COLOR = {
  ink: "#1C1C21",
  muted: "#55555E",
  // rules that must survive a black-and-white print
  rule: "#1C1C21",
  // light rules between rows
  line: "#C9C9CF",
  band: "#F2F2F3",
  gold: "#C9A227",
  goldInk: "#7A5E0E",
} as const;

export type Doc = InstanceType<typeof PDFDocument>;

// pdfkit (1.9 MB, about 80 to 160 ms to load) is loaded the first time a document is started, not when a route file is: the import above is type-only and erased.
let pdfkit: Promise<typeof PDFDocument> | undefined;
const pdfkitOf = (): Promise<typeof PDFDocument> => (pdfkit ??= import("pdfkit").then((m) => m.default));

/** Every text drawn, in order: the tests compare it with the preview's figures (the fonts are subset, so the PDF itself cannot be read back as text). */
const drawn = new WeakMap<Doc, string[]>();

/** The moment the render in progress must be done by (set by the renderer): drawing is synchronous, so the kit checks it itself. */
export const renderDeadline = new AsyncLocalStorage<number>();
const checkDeadline = (): void => {
  const at = renderDeadline.getStore();
  if (at !== undefined && Date.now() > at) throw new AppError("SERVER_ERROR", "The document took too long to make");
};

/** Longest text a single field may print (an address, a note): the rest is cut, so a hostile 10,000-character note cannot stall a render. */
const FIELD_MAX = 600;

const FONT_DIR = path.join(process.cwd(), "src", "server", "documents", "fonts");
const FILES = {
  latin: "Inter-Regular.ttf",
  latinBold: "Inter-Bold.ttf",
  gujarati: "NotoSansGujarati-Regular.ttf",
  gujaratiBold: "NotoSansGujarati-Bold.ttf",
  devanagari: "NotoSansDevanagari-Regular.ttf",
  devanagariBold: "NotoSansDevanagari-Bold.ttf",
} as const;
type FontKey = keyof typeof FILES;
const cache = new Map<FontKey, Buffer>();
const fontBytes = (key: FontKey): Buffer => {
  let b = cache.get(key);
  if (!b) cache.set(key, (b = readFileSync(path.join(FONT_DIR, FILES[key]))));
  return b;
};

/** Control characters (except new line and tab) and lone surrogates are dropped; a note is cut at `max` characters. */
export function clean(text: string | null | undefined, max = 10_000): string {
  const t = (text ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩]/g, "");
  return Array.from(t).slice(0, max).join("");
}

type Script = "latin" | "gujarati" | "devanagari";
const scriptOf = (ch: string): Script | null => {
  const c = ch.codePointAt(0)!;
  if (c >= 0x0a80 && c <= 0x0aff) return "gujarati";
  if (c >= 0x0900 && c <= 0x097f) return "devanagari";
  return null;
};

/** Splits a string into runs: Indic runs take their own font, everything else (spaces, digits, punctuation between Indic words included) stays with the neighbour. */
function runs(text: string): { script: Script; text: string }[] {
  const out: { script: Script; text: string }[] = [];
  let current: Script = "latin";
  for (const ch of Array.from(text)) {
    const s: Script = scriptOf(ch) ?? (/\s|[.,;:()\-\d]/.test(ch) && out.length > 0 ? current : "latin");
    if (out.length > 0 && out[out.length - 1].script === s) out[out.length - 1].text += ch;
    else out.push({ script: s, text: ch });
    current = s;
  }
  return out;
}

interface TextStyle {
  size?: number;
  bold?: boolean;
  color?: string;
  align?: "left" | "right" | "center";
  /** Letter spacing in points (titles and small labels). */
  spacing?: number;
  /** Extra space between wrapped lines (default 1.5). */
  lineGap?: number;
}

/** Draws text in a box of `width`, switching font per script; returns the height used. */
export function put(doc: Doc, raw: string | null | undefined, x: number, y: number, width: number, style: TextStyle = {}): number {
  checkDeadline();
  const text = clean(raw, FIELD_MAX);
  const size = style.size ?? 9;
  drawn.get(doc)?.push(text);
  doc.fontSize(size).fillColor(style.color ?? COLOR.ink);
  const parts = runs(text);
  const options = { width, align: style.align ?? "left", lineGap: style.lineGap ?? 1.5, characterSpacing: style.spacing ?? 0, ...numeric(text) } as const;
  if (parts.length <= 1) {
    doc.font(fontName(parts[0]?.script ?? "latin", style.bold)).text(text, x, y, options);
  } else {
    parts.forEach((p, i) => {
      doc.font(fontName(p.script, style.bold));
      if (i === 0) doc.text(p.text, x, y, { ...options, continued: i < parts.length - 1 });
      else doc.text(p.text, { ...options, continued: i < parts.length - 1 });
    });
  }
  return doc.y - y;
}

const fontName = (script: Script, bold?: boolean): string => `${script}${bold ? "Bold" : ""}`;

/**
 * Only a cell that is an AMOUNT or a COUNT takes Inter's tabular figures (tnum), so right-aligned money lines up digit under digit: a number with a rupee sign, a comma
 * or a decimal point (optionally signed, or a percent), or a short whole number (a count, up to 6 digits, optionally "× 10"). Dates, phone numbers, GSTINs, codes and any
 * mixed text stay proportional. Measured the same way in heightOf and widthOfText.
 */
const AMOUNT = /^[-−+]?\s*(?:[₹]\s*)?\d[\d,]*(?:\.\d+)?\s*%?$/;
const COUNT = /^(?:×\s*)?\d{1,6}$/;
const numeric = (text: string): { features: ["tnum"] } | Record<string, never> => {
  const t = text.trim();
  return COUNT.test(t) || (AMOUNT.test(t) && /[₹,.]/.test(t)) ? { features: ["tnum"] } : {};
};

/** The height `put` would use, so a row can be sized before it is drawn (and a page break placed). */
export function heightOf(doc: Doc, raw: string | null | undefined, width: number, style: TextStyle = {}): number {
  checkDeadline();
  const text = clean(raw, FIELD_MAX);
  const size = style.size ?? 9;
  doc.fontSize(size);
  let total = 0;
  for (const line of text.split("\n")) {
    const parts = runs(line);
    doc.font(fontName(parts[0]?.script ?? "latin", style.bold));
    total += doc.heightOfString(line === "" ? " " : line, { width, lineGap: style.lineGap ?? 1.5, characterSpacing: style.spacing ?? 0, ...numeric(line) });
  }
  return total;
}

/** The Easy Hotel Solutions mark (the building of public/brand/mark-day.svg), drawn as vectors in the brand's flat colours; `h` is its height. */
export function brandMark(doc: Doc, x: number, y: number, h: number): void {
  const s = h / 430;
  doc.save();
  doc.translate(x - 180 * s, y - 230 * s).scale(s);
  doc.polygon([465, 245], [650, 370], [650, 410], [600, 410], [600, 400], [465, 305]).fill(COLOR.gold);
  doc.polygon([600, 400], [650, 400], [650, 560], [600, 560]).fill(COLOR.gold);
  doc.polygon([330, 335], [465, 245], [465, 560], [405, 560], [405, 395], [330, 415]).fill(COLOR.ink);
  doc.polygon([260, 490], [390, 400], [390, 565], [260, 590]).fill("#3A3A42");
  doc.polygon([505, 425], [565, 460], [565, 560], [505, 560]).fill(COLOR.ink);
  doc.path("M190,648 C330,585 540,560 690,595 C545,575 340,600 190,648 Z").fill("#3A3A42");
  doc.restore();
}

interface DocumentInfo {
  title: string;
  /** The "computer-generated" line in the footer: on for invoices, receipts, statements and registers; off for signed letters. Default on. */
  computerGenerated?: boolean;
}

/** A fresh document with the fonts registered; `finish` ends it and collects the bytes. */
export async function startDocument(info: DocumentInfo): Promise<{ doc: Doc; finish: () => Promise<{ bytes: Uint8Array; pages: number; text: string[] }> }> {
  const PDFDocument = await pdfkitOf();
  const doc = new PDFDocument({ size: "A4", margin: PAGE.margin, bufferPages: true, compress: true, info: { Title: clean(info.title, 200), Producer: "Easy Hotel Solutions", Creator: "Easy Hotel Solutions" } });
  (Object.keys(FILES) as FontKey[]).forEach((k) => doc.registerFont(k, fontBytes(k)));
  const text: string[] = [];
  drawn.set(doc, text);
  const generated = formatDateTime(new Date().toISOString());
  const chunks: Buffer[] = [];
  const done = new Promise<void>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve());
    doc.on("error", reject);
  });
  return {
    doc,
    finish: async () => {
      const pages = doc.bufferedPageRange().count;
      if (pages > MAX_PAGES) {
        doc.end();
        await done.catch(() => undefined);
        throw new AppError("SERVER_ERROR", `The document is over ${MAX_PAGES} pages`);
      }
      const brand = "Easy Hotel Solutions";
      const brandW = widthOfText(doc, brand, 6.5);
      for (let i = 0; i < pages; i++) {
        doc.switchToPage(i);
        // the footer sits inside the bottom margin: write without letting pdfkit start a new page
        const bottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        const top = PAGE.height - 34;
        doc.moveTo(PAGE.margin, top).lineTo(PAGE.width - PAGE.margin, top).lineWidth(0.5).strokeColor(COLOR.line).stroke();
        const name = clean(info.title, 200);
        const short = Array.from(name).length > 70 ? `${Array.from(name).slice(0, 69).join("")}…` : name;
        if (info.computerGenerated !== false) put(doc, "This is a computer-generated document.", PAGE.margin, top + 6, CONTENT_WIDTH * 0.7, { size: 7, color: COLOR.muted });
        put(doc, `${short}  ·  Generated ${generated}`, PAGE.margin, info.computerGenerated === false ? top + 6 : top + 17, CONTENT_WIDTH * 0.75, { size: 7, color: COLOR.muted });
        put(doc, `Page ${i + 1} of ${pages}`, PAGE.margin, top + 6, CONTENT_WIDTH, { size: 7, bold: true, color: COLOR.ink, align: "right" });
        const bx = PAGE.width - PAGE.margin - brandW;
        brandMark(doc, bx - 10, top + 17.5, 7);
        put(doc, brand, bx, top + 18, brandW + 1, { size: 6.5, color: COLOR.muted });
        doc.page.margins.bottom = bottom;
      }
      doc.end();
      await done;
      const bytes = new Uint8Array(Buffer.concat(chunks));
      return { bytes, pages, text };
    },
  };
}

export interface Issuer {
  name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
  /** Further plain lines under the contact line (a state, a registration). */
  extra?: readonly string[];
  /** The issuer's own logo (PNG or JPEG bytes), drawn left of the name when given. */
  logo?: Uint8Array | null;
}

export interface TitleBlock {
  title: string;
  /** A small line under the title ("Original for recipient"). */
  copy?: string;
  /** Label / value lines under the title (number, date). Empty values are left out. */
  meta?: readonly (readonly [string, string | null | undefined])[];
}

/**
 * The letterhead: the issuer on the left (logo when it has one, name, address, contact, GSTIN), the document's title block on the right, one thin gold
 * rule under both. White paper, graphite text. Returns the y below it.
 */
export function letterhead(doc: Doc, h: Issuer, title?: TitleBlock, y = PAGE.margin): number {
  // the title block is as wide as its title on one line (within half the page), never narrower than 200 pt
  const titleText = title ? title.title.toUpperCase() : "";
  const rightW = title ? Math.min(CONTENT_WIDTH * 0.52, Math.max(200, widthOfText(doc, titleText, 14, true) + Array.from(titleText).length + 4)) : 0;
  let leftX = PAGE.margin;
  let logoH = 0;
  if (h.logo && h.logo.length > 0) {
    try {
      doc.image(Buffer.from(h.logo), PAGE.margin, y, { fit: [64, 46] });
      leftX += 74;
      logoH = 46;
    } catch {
      // a logo pdfkit cannot read is left out; the document still prints
    }
  }
  const leftW = PAGE.margin + CONTENT_WIDTH - rightW - leftX - (title ? 16 : 0);
  let at = y;
  at += put(doc, h.name, leftX, at, leftW, { size: 15, bold: true }) + 2;
  if (h.address) at += put(doc, h.address, leftX, at, leftW, { size: 8.5, color: COLOR.muted });
  const contact = [h.phone ? `Phone ${h.phone}` : "", h.email ? `Email ${h.email}` : ""].filter(Boolean).join("   ·   ");
  if (contact) at += put(doc, contact, leftX, at, leftW, { size: 8.5, color: COLOR.muted });
  if (h.gstin) at += put(doc, `GSTIN ${h.gstin}`, leftX, at, leftW, { size: 8.5, bold: true });
  for (const line of h.extra ?? []) if (line) at += put(doc, line, leftX, at, leftW, { size: 8.5, color: COLOR.muted });
  let right = y;
  if (title) {
    const rx = PAGE.margin + CONTENT_WIDTH - rightW;
    right += put(doc, titleText, rx, right, rightW, { size: 14, bold: true, align: "right", spacing: 1 }) + 1;
    if (title.copy) right += put(doc, title.copy.toUpperCase(), rx, right, rightW, { size: 6.5, color: COLOR.goldInk, align: "right", spacing: 0.8, bold: true }) + 2;
    right += 3;
    for (const [label, value] of (title.meta ?? []).filter(([, v]) => v !== null && v !== undefined && v !== "")) {
      const vx = label ? rx + 84 : rx;
      const lh = Math.max(label ? heightOf(doc, label, 78, { size: 7.5 }) : 0, heightOf(doc, value, rx + rightW - vx, { size: 8.5, bold: true }));
      if (label) put(doc, label, rx, right + 0.8, 78, { size: 7.5, color: COLOR.muted });
      put(doc, value, vx, right, rx + rightW - vx, { size: 8.5, bold: true, align: "right" });
      right += lh + 1;
    }
  }
  const below = Math.max(at, right, y + logoH) + 8;
  doc.moveTo(PAGE.margin, below).lineTo(PAGE.margin + CONTENT_WIDTH, below).lineWidth(1.2).strokeColor(COLOR.gold).stroke();
  return below + 9;
}

/** A section heading: the title in bold graphite with a graphite rule under it; a muted note on the right (a GSTIN, a date). */
export function band(doc: Doc, y: number, left: string, right = "", underline = true): number {
  // a heading is never left alone at the foot of a page: it moves on with what follows it
  const at = room(doc, y, 56);
  put(doc, left, PAGE.margin, at, right ? CONTENT_WIDTH * 0.6 : CONTENT_WIDTH, { size: 9.5, bold: true, spacing: 0.3 });
  if (right) put(doc, right, PAGE.margin + CONTENT_WIDTH * 0.4, at + 1, CONTENT_WIDTH * 0.6, { size: 8, align: "right", color: COLOR.muted });
  // a table brings its own top rule
  if (!underline) return at + 15;
  doc.moveTo(PAGE.margin, at + 14).lineTo(PAGE.margin + CONTENT_WIDTH, at + 14).lineWidth(0.7).strokeColor(COLOR.rule).stroke();
  return at + 18;
}

/** Start a new page when fewer than `needed` points are left. */
export function room(doc: Doc, y: number, needed: number): number {
  if (y + needed <= BOTTOM) return y;
  doc.addPage();
  return PAGE.margin;
}

/** The width a line of text takes at `size` (measured in the Latin font; Indic runs are close enough for sizing a column). */
export function widthOfText(doc: Doc, raw: string | null | undefined, size: number, bold = false): number {
  const text = clean(raw, FIELD_MAX);
  doc.font(fontName("latin", bold)).fontSize(size);
  return Math.max(...text.split("\n").map((line) => doc.widthOfString(line || " ", numeric(line))));
}

type Pairs = readonly (readonly [string, string | null | undefined])[];
const present = (pairs: Pairs): (readonly [string, string])[] => pairs.filter((p): p is readonly [string, string] => p[1] !== null && p[1] !== undefined && p[1] !== "");

/** Label / value pairs in two columns. The label column is as wide as the longest label (up to 120 pt), so a label never wraps mid-word. */
export function facts(doc: Doc, y: number, pairs: Pairs): number {
  const half = CONTENT_WIDTH / 2;
  let at = y;
  const shown = present(pairs);
  const labelW = Math.min(120, Math.max(70, ...shown.map(([l]) => widthOfText(doc, l, 8) + 8)));
  const valueW = half - labelW - 12;
  for (let i = 0; i < shown.length; i += 2) {
    const cells = shown.slice(i, i + 2);
    const heights = cells.map(([l, v]) => Math.max(heightOf(doc, l, labelW, { size: 8 }), heightOf(doc, v, valueW, { size: 9 })));
    at = room(doc, at, Math.max(...heights) + 4);
    cells.forEach(([label, value], j) => {
      const x = PAGE.margin + j * half;
      put(doc, label, x, at + 0.8, labelW, { size: 8, color: COLOR.muted });
      put(doc, value, x + labelW + 2, at, valueW, { size: 9 });
    });
    at += Math.max(...heights) + 4;
  }
  return at;
}

export interface Panel {
  title: string;
  rows: Pairs;
}

/** Boxes side by side (bill to, stay, employee): a small spaced title and label / value rows, each box as tall as the tallest. */
export function panels(doc: Doc, y: number, list: readonly Panel[]): number {
  const gap = 10;
  const w = (CONTENT_WIDTH - gap * (list.length - 1)) / list.length;
  const pad = 7;
  const measure = list.map((p) => {
    const rows = present(p.rows);
    const labelW = Math.min(84, Math.max(52, ...rows.map(([l]) => widthOfText(doc, l, 7.5) + 6)));
    const valueW = w - pad * 2 - labelW;
    const heights = rows.map(([l, v]) => Math.max(heightOf(doc, l, labelW, { size: 7.5 }), heightOf(doc, v, valueW, { size: 8.5 })) + 1.5);
    return { rows, labelW, valueW, heights, h: pad + 14 + heights.reduce((a, b) => a + b, 0) + pad - 2 };
  });
  const height = Math.max(...measure.map((m) => m.h));
  const at = room(doc, y, height + 6);
  list.forEach((p, i) => {
    const x = PAGE.margin + i * (w + gap);
    const m = measure[i];
    doc.rect(x, at, w, height).lineWidth(0.6).strokeColor(COLOR.line).stroke();
    put(doc, p.title.toUpperCase(), x + pad, at + pad, w - pad * 2, { size: 6.5, bold: true, color: COLOR.muted, spacing: 0.8 });
    let ry = at + pad + 14;
    m.rows.forEach(([label, value], j) => {
      put(doc, label, x + pad, ry + 0.6, m.labelW, { size: 7.5, color: COLOR.muted });
      put(doc, value, x + pad + m.labelW, ry, m.valueW, { size: 8.5 });
      ry += m.heights[j];
    });
  });
  return at + height + 8;
}

export interface Column {
  label: string;
  width: number;
  align?: "left" | "right" | "center";
}

/**
 * Column widths measured from the content: a right-aligned (money, count) column is as wide as its widest cell or header and never wraps; the text columns
 * share what is left in proportion to their longest cell (a long note wraps). Returns relative widths for `table`.
 */
export function measuredWidths(doc: Doc, columns: readonly Column[], rows: readonly (readonly string[])[], size = 8.5, total = CONTENT_WIDTH): number[] {
  const need = columns.map((c, i) => Math.max(widthOfText(doc, c.label, 7.5, true) + 2, ...rows.map((r) => widthOfText(doc, r[i] ?? "", size, true))) + 10);
  const fixed = columns.map((c, i) => c.align === "right" || need[i] <= 48);
  const fixedTotal = need.reduce((a, n, i) => a + (fixed[i] ? n : 0), 0);
  const flex = columns.map((_, i) => !fixed[i]);
  const flexNeed = need.reduce((a, n, i) => a + (flex[i] ? n : 0), 0);
  const left = total - fixedTotal;
  if (flexNeed === 0) return need.map((n) => n + (left > 0 ? left / columns.length : 0));
  // the text columns get what is left; a column never gets less than 48 pt (then everything scales down together)
  return columns.map((_, i) => (fixed[i] ? need[i] : Math.max(48, (need[i] / flexNeed) * left)));
}

interface TableOptions {
  boldLast?: boolean;
  size?: number;
  /** Left edge and width (default: the full content width), for two tables side by side. */
  x?: number;
  width?: number;
}

/**
 * A table: a light grey header row between graphite rules (repeated on every page), light rules between rows, long cells wrap, a row never splits across
 * pages. A bold last row (a footer total) sits under a graphite rule. `rows` are already formatted text.
 */
export function table(doc: Doc, y: number, columns: readonly Column[], rows: readonly (readonly string[])[], options: TableOptions = {}): number {
  const size = options.size ?? 8.5;
  const x0 = options.x ?? PAGE.margin;
  const tw = options.width ?? CONTENT_WIDTH;
  const total = columns.reduce((a, c) => a + c.width, 0);
  const widths = columns.map((c) => (c.width * tw) / total);
  const xs = widths.map((_, i) => x0 + widths.slice(0, i).reduce((a, b) => a + b, 0));
  const headerH = Math.max(...columns.map((c, i) => heightOf(doc, c.label, widths[i] - 8, { size: 7.5, bold: true }))) + 8;
  const rule = (at: number, weight: number, color: string): void => void doc.moveTo(x0, at).lineTo(x0 + tw, at).lineWidth(weight).strokeColor(color).stroke();
  const header = (at: number): number => {
    doc.rect(x0, at, tw, headerH).fill(COLOR.band);
    rule(at, 0.8, COLOR.rule);
    columns.forEach((c, i) => put(doc, c.label, xs[i] + 4, at + 4.3, widths[i] - 8, { size: 7.5, bold: true, align: c.align }));
    rule(at + headerH, 0.5, COLOR.rule);
    return at + headerH + 1;
  };
  let at = header(room(doc, y, 60));
  rows.forEach((row, r) => {
    const bold = options.boldLast === true && r === rows.length - 1;
    const h = Math.max(...row.map((cell, i) => heightOf(doc, cell, widths[i] - 8, { size, bold })));
    if (at + h + 6 > BOTTOM) {
      doc.addPage();
      at = header(PAGE.margin);
    }
    const rowH = h + 4;
    if (bold) {
      doc.rect(x0, at, tw, rowH).fill(COLOR.band);
      rule(at, 0.8, COLOR.rule);
    }
    row.forEach((cell, i) => put(doc, cell, xs[i] + 4, at + 2.2, widths[i] - 8, { size, bold, align: columns[i].align }));
    at += rowH;
    rule(at, bold ? 0.8 : 0.4, bold ? COLOR.rule : COLOR.line);
  });
  return at + 4;
}

/**
 * Right-aligned label / amount lines on the right half of the page; a strong line (a total) is bold on light grey under a graphite rule. Each line is as tall as its
 * label wraps, so a long label never runs into the next line.
 */
export function totals(doc: Doc, y: number, lines: readonly { label: string; paise: number; strong?: boolean }[]): number {
  const boxX = PAGE.margin + CONTENT_WIDTH * 0.44;
  const boxW = PAGE.margin + CONTENT_WIDTH - boxX;
  const amountW = 96;
  const labelW = boxW - amountW - 14;
  const heights = lines.map((l) => Math.max(heightOf(doc, l.label, labelW, { size: l.strong ? 10 : 8.5, bold: l.strong }), 11) + (l.strong ? 8 : 3));
  let at = room(doc, y, heights.reduce((a, b) => a + b, 0) + 6);
  lines.forEach((l, i) => {
    const h = heights[i];
    if (l.strong) {
      doc.rect(boxX, at, boxW, h).fill(COLOR.band);
      doc.moveTo(boxX, at).lineTo(boxX + boxW, at).lineWidth(0.8).strokeColor(COLOR.rule).stroke();
    }
    const ty = at + (l.strong ? 4 : 2);
    put(doc, l.label, boxX + 4, ty, labelW, { size: l.strong ? 10 : 8.5, bold: l.strong, align: "right", color: l.strong ? COLOR.ink : COLOR.muted });
    put(doc, formatINR(l.paise), boxX + boxW - amountW - 6, ty, amountW, { size: l.strong ? 10 : 8.5, bold: l.strong, align: "right" });
    at += h;
    if (l.strong) doc.moveTo(boxX, at).lineTo(boxX + boxW, at).lineWidth(0.8).strokeColor(COLOR.rule).stroke();
  });
  return at + 4;
}

/** "Amount in words: Rupees ... Only", from the same words the screen shows (the preview carries them). */
export function inWords(doc: Doc, y: number, words: string | null | undefined, paise?: number): number {
  const text = words && words !== "" ? words : paise !== undefined ? amountInWords(paise) : "";
  if (text === "") return y;
  const at = room(doc, y, 24);
  const h = put(doc, `Amount in words: ${text}`, PAGE.margin, at, CONTENT_WIDTH, { size: 8.5, bold: true });
  return at + h + 4;
}

/** Small print under a document (declaration, terms): a muted title and its lines. */
export function smallPrint(doc: Doc, y: number, title: string, lines: readonly string[], width = CONTENT_WIDTH * 0.6): number {
  const shown = lines.filter(Boolean);
  if (shown.length === 0) return y;
  const body = shown.join("\n");
  let at = room(doc, y, heightOf(doc, body, width, { size: 7.5 }) + 14);
  at += put(doc, title, PAGE.margin, at, width, { size: 7.5, bold: true }) + 1;
  at += put(doc, body, PAGE.margin, at, width, { size: 7.5, color: COLOR.muted });
  return at + 4;
}

/** The number of pages so far (a block that moved to a new page tells its neighbour to start at the top too). */
export const pageCount = (doc: Doc): number => doc.bufferedPageRange().count;

/** Signature lines at the foot of a block, the label (and the name under it) centred under each line. */
export function signatures(doc: Doc, y: number, labels: readonly string[]): number {
  // one signature takes the right half, where a reader looks for it
  const slots = Math.max(2, labels.length);
  const w = CONTENT_WIDTH / slots;
  const tallest = Math.max(...labels.map((l) => heightOf(doc, l, w - 30, { size: 8 })));
  const at = room(doc, y + 14, tallest + 2);
  labels.forEach((label, i) => {
    const x = PAGE.margin + (i + slots - labels.length) * w + 10;
    doc.moveTo(x, at).lineTo(x + w - 30, at).lineWidth(0.6).strokeColor(COLOR.rule).stroke();
    put(doc, label, x, at + 4, w - 30, { size: 8, color: COLOR.muted, align: "center" });
  });
  return at + tallest + 10;
}

const ACRONYMS: Record<string, string> = { upi: "UPI", neft: "NEFT", rtgs: "RTGS", imps: "IMPS" };
/** A mode of payment as words ("Cash", "UPI", "Card"); the stored text otherwise, its first letter raised. */
export function paymentMode(m: string | null | undefined): string {
  if (!m) return "";
  return ACRONYMS[m.trim().toLowerCase()] ?? m.charAt(0).toUpperCase() + m.slice(1);
}

export { formatINR };
