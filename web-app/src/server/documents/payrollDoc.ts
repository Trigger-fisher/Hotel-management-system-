import "server-only";
import type { DocBlock, PayrollDoc } from "@shared/dashboards/payrollPay";
import { band, BOTTOM, clean, COLOR, CONTENT_WIDTH, type Doc, facts, heightOf, type Issuer, letterhead, measuredWidths, PAGE, put, room, signatures, startDocument, table } from "./kit";
import type { RenderedDocument } from "./renderer";

// Every payroll document is a PayrollDoc (ui-shared): a header, a title and blocks (heading, paragraph, label/value pairs, table, total, signatures).
// The screens print the same blocks, and the services build them (salary slip, payment register, period and monthly reports, vouchers, letters, statements,
// logs), so one renderer draws them all. Letters (file name joining-letter-* / experience-letter-*) take the formal business-letter layout.
// Spec: docs/specs/documents.md.

export interface PayrollDocInput {
  doc: PayrollDoc;
  /** Base of the file name (the renderer adds ".pdf"). */
  filename: string;
  /** Label / value lines in the title block (number, date); default: the subtitle on its own. */
  meta?: readonly (readonly [string, string])[];
}

type Table = Extract<DocBlock, { kind: "table" }>;
type Kv = Extract<DocBlock, { kind: "kv" }>;

const LETTERS: Record<string, string> = { "joining-letter-": "JL", "experience-letter-": "EL" };
/** "JL/2026/1A2B3C4D" for a letter: its kind, the year and the record's short id from the file name. */
export function letterReference(filename: string, now = new Date()): string | null {
  const prefix = Object.keys(LETTERS).find((p) => filename.startsWith(p));
  if (!prefix) return null;
  const id = filename.slice(prefix.length).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return `${LETTERS[prefix]}/${new Date(now.getTime() + 330 * 60_000).getUTCFullYear()}/${id || "1"}`;
}

function drawTable(doc: Doc, y: number, block: Table, x?: number, width?: number): number {
  let at = y;
  if (block.title) at = band(doc, room(doc, at, 60), block.title, "", false);
  const rows = block.footer ? [...block.rows, block.footer] : block.rows;
  const size = block.columns.length > 8 ? 7.5 : 8.5;
  const base = block.columns.map((c) => ({ label: c.header, width: 1, align: c.align }));
  const widths = measuredWidths(doc, base, rows, size, width ?? CONTENT_WIDTH);
  const columns = base.map((c, i) => ({ ...c, width: widths[i] }));
  return table(doc, at, columns, rows, { boldLast: block.footer !== undefined, size, x, width }) + 4;
}

/** Earnings and deductions side by side (the salary slip), each half the page, when both fit on this page; otherwise one under the other. */
function drawPair(doc: Doc, y: number, a: Table, b: Table): number {
  const gap = 14;
  const half = (CONTENT_WIDTH - gap) / 2;
  const need = (t: Table): number => 40 + (t.rows.length + (t.footer ? 1 : 0)) * 16;
  const at = room(doc, y, Math.max(need(a), need(b)));
  if (at + Math.max(need(a), need(b)) > BOTTOM) return drawTable(doc, drawTable(doc, at, a), b);
  put(doc, a.title ?? "", PAGE.margin, at, half, { size: 9.5, bold: true, spacing: 0.3 });
  put(doc, b.title ?? "", PAGE.margin + half + gap, at, half, { size: 9.5, bold: true, spacing: 0.3 });
  const left = drawTable(doc, at + 15, { ...a, title: undefined }, PAGE.margin, half);
  const right = drawTable(doc, at + 15, { ...b, title: undefined }, PAGE.margin + half + gap, half);
  return Math.max(left, right);
}

function drawTotal(doc: Doc, y: number, block: Extract<DocBlock, { kind: "total" }>): number {
  let at = room(doc, y, block.words ? 48 : 30);
  doc.rect(PAGE.margin, at, CONTENT_WIDTH, 24).fill(COLOR.band);
  doc.moveTo(PAGE.margin, at).lineTo(PAGE.margin + CONTENT_WIDTH, at).lineWidth(0.8).strokeColor(COLOR.rule).stroke();
  doc.moveTo(PAGE.margin, at + 24).lineTo(PAGE.margin + CONTENT_WIDTH, at + 24).lineWidth(0.8).strokeColor(COLOR.rule).stroke();
  put(doc, block.label, PAGE.margin + 8, at + 6.5, CONTENT_WIDTH * 0.6, { size: 10.5, bold: true });
  put(doc, block.value, PAGE.margin + CONTENT_WIDTH * 0.6, at + 6.5, CONTENT_WIDTH * 0.4 - 8, { size: 10.5, bold: true, align: "right" });
  at += 30;
  if (block.words) at += put(doc, `Amount in words: ${block.words}`, PAGE.margin, at, CONTENT_WIDTH, { size: 8.5, bold: true }) + 6;
  return at;
}

function drawBlocks(doc: Doc, y: number, blocks: readonly DocBlock[]): number {
  let at = y;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const next = blocks[i + 1];
    switch (block.kind) {
      case "heading":
        at = room(doc, at + 2, 34);
        at += put(doc, block.text, PAGE.margin, at, CONTENT_WIDTH, { size: 10.5, bold: true }) + 6;
        break;
      case "para":
        at = room(doc, at, heightOf(doc, block.text, CONTENT_WIDTH, { size: 9.5 }) + 4);
        at += put(doc, block.text, PAGE.margin, at, CONTENT_WIDTH, { size: 9.5 }) + 5;
        break;
      case "kv":
        if (block.title) at = band(doc, room(doc, at, 60), block.title);
        at = facts(doc, at, block.items.map((it) => [it.label, it.value] as const)) + 6;
        break;
      case "table":
        if (block.title === "Earnings" && next?.kind === "table" && next.title === "Deductions") {
          at = drawPair(doc, at, block, next);
          i += 1;
        } else at = drawTable(doc, at, block);
        break;
      case "total":
        at = drawTotal(doc, at, block);
        break;
      case "signatures":
        at = signatures(
          doc,
          at + 10,
          block.items.map((s) => [clean(s.name, 80), clean(s.role, 120)].filter(Boolean).join("\n")),
        );
        break;
    }
  }
  return at;
}

/** The formal letter: reference and date on one line, the addressee, the title, the subject, the body at reading size, the signatory under "For <company>". */
function drawLetter(doc: Doc, y: number, d: PayrollDoc, reference: string | null): number {
  const blocks = [...d.blocks];
  const first = blocks[0]?.kind === "kv" && !blocks[0].title ? (blocks.shift() as Kv) : null;
  const date = first?.items.find((it) => it.label === "Date")?.value ?? "";
  const to = first?.items.filter((it) => it.label !== "Date").map((it) => it.value).filter(Boolean) ?? [];
  let at = y;
  if (reference) put(doc, `Ref. ${reference}`, PAGE.margin, at, CONTENT_WIDTH / 2, { size: 9.5 });
  if (date) put(doc, `Date: ${date}`, PAGE.margin + CONTENT_WIDTH / 2, at, CONTENT_WIDTH / 2, { size: 9.5, align: "right" });
  if (reference || date) at += 24;
  if (to.length > 0) {
    at += put(doc, "To", PAGE.margin, at, CONTENT_WIDTH * 0.6, { size: 9.5 });
    for (const line of to) at += put(doc, line, PAGE.margin, at, CONTENT_WIDTH * 0.6, { size: 9.5, bold: line === to[0] });
    at += 14;
  }
  at += put(doc, d.title.toUpperCase(), PAGE.margin, at, CONTENT_WIDTH, { size: 11, bold: true, align: "center", spacing: 1.2 }) + 2;
  if (d.subtitle) at += put(doc, d.subtitle, PAGE.margin, at, CONTENT_WIDTH, { size: 9.5, align: "center", color: COLOR.muted }) + 2;
  at += 10;
  let afterSignature = false;
  for (const block of blocks) {
    switch (block.kind) {
      case "heading":
        at = room(doc, at + (afterSignature ? 10 : 0), 34);
        if (afterSignature) {
          doc.moveTo(PAGE.margin, at - 6).lineTo(PAGE.margin + CONTENT_WIDTH, at - 6).dash(2, { space: 2 }).lineWidth(0.5).strokeColor(COLOR.line).stroke().undash();
          at += 6;
        }
        at += put(doc, afterSignature ? block.text : `Subject: ${block.text}`, PAGE.margin, at, CONTENT_WIDTH, { size: 10, bold: true }) + 8;
        break;
      case "para":
        at = room(doc, at, heightOf(doc, block.text, CONTENT_WIDTH, { size: 10, lineGap: 3.5 }) + 4);
        at += put(doc, block.text, PAGE.margin, at, CONTENT_WIDTH, { size: 10, lineGap: 3.5 }) + 7;
        break;
      case "signatures": {
        const s = block.items[0];
        if (!afterSignature) {
          at = room(doc, at + 6, 84);
          at += put(doc, "Yours faithfully,", PAGE.margin, at, CONTENT_WIDTH / 2, { size: 10 }) + 2;
          at += put(doc, `For ${d.companyName}`, PAGE.margin, at, CONTENT_WIDTH / 2, { size: 10, bold: true }) + 34;
          doc.moveTo(PAGE.margin, at).lineTo(PAGE.margin + 170, at).lineWidth(0.6).strokeColor(COLOR.rule).stroke();
          at += 4;
          if (s?.name) at += put(doc, s.name, PAGE.margin, at, CONTENT_WIDTH / 2, { size: 10, bold: true });
          if (s?.role) at += put(doc, s.role, PAGE.margin, at, CONTENT_WIDTH / 2, { size: 9, color: COLOR.muted });
          at += 10;
          afterSignature = true;
        } else {
          at = signatures(doc, at, block.items.map((x) => [clean(x.name, 80), clean(x.role, 120)].filter(Boolean).join("\n")));
        }
        break;
      }
      default:
        at = drawBlocks(doc, at, [block]);
    }
  }
  return at;
}

/** The services join the address, "Phone ..." and "GSTIN ..." into one line with " · ": the letterhead puts each on its own line again. */
export function issuerOf(d: Pick<PayrollDoc, "companyName" | "companyLine">): Issuer {
  const parts = d.companyLine.split(" · ").map((p) => p.trim()).filter(Boolean);
  const pick = (prefix: string): string | null => parts.find((p) => p.startsWith(prefix))?.slice(prefix.length).trim() || null;
  return { name: d.companyName, address: parts.filter((p) => !p.startsWith("Phone ") && !p.startsWith("GSTIN ")).join(", "), phone: pick("Phone "), gstin: pick("GSTIN ") };
}

export async function renderPayrollDoc(input: PayrollDocInput): Promise<RenderedDocument> {
  const d = input.doc;
  const reference = letterReference(input.filename);
  const { doc, finish } = await startDocument({ title: `${d.title}${d.subtitle ? ` - ${d.subtitle}` : ""}`, computerGenerated: reference === null });
  if (reference !== null) {
    const y = letterhead(doc, issuerOf(d));
    drawLetter(doc, y, d, reference);
  } else {
    const meta = input.meta ?? (d.subtitle ? [["", d.subtitle] as const] : []);
    const y = letterhead(doc, issuerOf(d), { title: d.title, meta });
    drawBlocks(doc, y, d.blocks);
  }
  const out = await finish();
  return { ...out, filename: `${input.filename.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "document"}.pdf` };
}
