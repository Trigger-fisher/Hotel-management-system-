import "server-only";

// THE look of every email (redesign 5 Nov 2026). One table-based layout, 600 px wide, CSS inline (mail programs drop <style> or parts of it), single column:
//   gold rule / the logo or the sender's name / one heading / short paragraphs / a details table / ONE primary button (its address again as text) / notes /
//   footer (the sender's contact, why the mail came, the unsubscribe link of campaign mail only).
// The plain-text part is made from the SAME pieces (renderMailText), so both parts always say the same thing.
// Every text that came from a person is HTML-escaped here, and a link is only ever an http(s) address.
// Dark mode: programs that honour `prefers-color-scheme` (Apple Mail, Outlook.com, iOS) get the dark colours from the one <style> block; the light ones inline are
// the fallback, chosen so a program that inverts the page (Gmail app, Outlook) keeps them readable.

export const MAIL_THEME = {
  graphite: "#1C1C21",
  gold: "#C9A227",
  goldInk: "#7A5E0E",
  ink: "#1C1C21",
  text: "#34343B",
  muted: "#5E5E66",
  line: "#E6E4DF",
  tint: "#F7F6F3",
  codeTint: "#FBF7EA",
  codeLine: "#E8DBA8",
  page: "#F3F2EF",
  white: "#FFFFFF",
} as const;

/** The dark values, by the class that carries them. */
const DARK = {
  page: "#121214",
  card: "#1C1C21",
  line: "#34343B",
  ink: "#F2F2F3",
  text: "#D9D9DE",
  muted: "#A9A9B2",
  tint: "#26262C",
  codeTint: "#2A2618",
  codeLine: "#5A4A1A",
  button: "#C9A227",
  buttonText: "#1C1C21",
  link: "#E3C766",
} as const;

/** Who the mail is from, as its header and footer show it. */
export interface MailBrand {
  /** The hotel's name, or the platform's. */
  name: string;
  /** A PUBLIC https address of the logo; anything else is not shown (the name stands alone, as real text). */
  logoUrl?: string | null;
  /** The logo for dark backgrounds, shown by mail programs in dark mode (https only). */
  logoDarkUrl?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

/** The product (MJ, 5 Nov 2026): the sender of system mail (codes, resets, invitations, onboarding), and the small "Sent with" line under a hotel's mail. */
export const PRODUCT_NAME = "Easy Hotel Solutions";
export const PLATFORM_BRAND: MailBrand = { name: PRODUCT_NAME };

/** The platform's brand with its logo, served by the app itself (public/brand). Only an https address shows the picture; otherwise the name is written out. */
export function platformBrand(publicUrl?: string | null): MailBrand {
  const base = (publicUrl ?? "").trim().replace(/\/+$/, "");
  if (!base.startsWith("https://")) return PLATFORM_BRAND;
  return { ...PLATFORM_BRAND, logoUrl: `${base}/brand/mail-logo-day.png`, logoDarkUrl: `${base}/brand/mail-logo-night.png` };
}

export type MailBlock =
  /** A paragraph. */
  | { kind: "text"; text: string }
  /** A one-time code, large and spaced. */
  | { kind: "code"; text: string }
  /** A person's own words (a guest's message, a notice, the day's summary): kept line by line, in a tinted box. */
  | { kind: "quote"; text: string }
  /** A report the system wrote (the day's summary): kept line by line in a tinted box, plain in the text part. */
  | { kind: "box"; text: string }
  /** Short numbered steps ("what happens next"). */
  | { kind: "steps"; items: string[] }
  /** A small, quieter line ("If this was not you ..."). */
  | { kind: "note"; text: string };

export interface MailDetail {
  label: string;
  value: string;
  /** The one figure that matters (an amount): a little larger. */
  strong?: boolean;
}

export interface MailLayout {
  brand: MailBrand;
  /** The line a mail program shows next to the subject in the list (hidden in the mail itself). */
  preheader?: string;
  heading?: string;
  greeting?: string;
  blocks: MailBlock[];
  details?: MailDetail[];
  /** The one primary action. Its address is repeated as text under it (a button that does not open still leaves a way). */
  button?: { label: string; url: string } | null;
  /** Blocks after the button (how long a link works, what to do if it was not you). */
  after?: MailBlock[];
  /** Why the person gets this mail (footer, small). */
  why?: string;
  /** Campaign mail: why the person gets it, and the unsubscribe link. */
  unsubscribe?: { why: string; url: string | null } | null;
  /** A hotel's mail: a small "Sent with Easy Hotel Solutions" line at the very bottom. */
  sentWith?: boolean;
  /** The language of the words (a campaign the hotel wrote in Hindi or Gujarati); default English. */
  lang?: string;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Text as HTML: every character that could start markup or end an attribute is replaced. */
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPES[c] as string);

/** An address a mail may link to: http(s) only, no spaces or quotes; anything else (javascript:, data:, a typo) is null and no link is made. */
export function safeUrl(url: string | null | undefined): string | null {
  const v = (url ?? "").trim();
  if (v === "" || v.length > 2000 || /[\s"'<>\\]/.test(v)) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** A logo is only shown from a public https address (a mail program cannot reach localhost, and http is blocked by most). */
const logoOf = (url: string | null | undefined): string | null => {
  const u = safeUrl(url);
  return u && u.startsWith("https://") ? u : null;
};

/** The language of a text by its script: Devanagari is Hindi, Gujarati is Gujarati, anything else English. */
export function langOf(text: string): string {
  if (/[઀-૿]/.test(text)) return "gu";
  if (/[ऀ-ॿ]/.test(text)) return "hi";
  return "en";
}

/** Text with its line breaks kept (escaped first). */
const lines = (s: string): string => escapeHtml(s).replace(/\r?\n/g, "<br>");

const FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans','Noto Sans Devanagari','Noto Sans Gujarati','Nirmala UI',sans-serif";
const MONO = "font-family:ui-monospace,SFMono-Regular,Consolas,Menlo,monospace";
const T = MAIL_THEME;
const TABLE = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';

function block(b: MailBlock): string {
  switch (b.kind) {
    case "text":
      return `<p class="hms-text" style="margin:0 0 16px;${FONT};font-size:16px;line-height:26px;color:${T.text};">${lines(b.text)}</p>`;
    case "note":
      return `<p class="hms-muted" style="margin:0 0 12px;${FONT};font-size:14px;line-height:22px;color:${T.muted};">${lines(b.text)}</p>`;
    case "code":
      return `<table ${TABLE} style="margin:4px 0 24px;"><tr><td class="hms-code" style="background:${T.codeTint};border:1px solid ${T.codeLine};border-radius:8px;padding:16px 24px;${MONO};font-size:32px;line-height:38px;font-weight:700;letter-spacing:8px;color:${T.ink};">${escapeHtml(b.text)}</td></tr></table>`;
    case "box":
    case "quote":
      return `<table ${TABLE} width="100%" style="margin:0 0 20px;"><tr><td class="hms-tint" style="background:${T.tint};border-left:3px solid ${T.gold};border-radius:0 6px 6px 0;padding:14px 16px;${FONT};font-size:15px;line-height:24px;color:${T.text};">${lines(b.text)}</td></tr></table>`;
    case "steps":
      return `<table ${TABLE} width="100%" style="margin:0 0 20px;">${b.items
        .map(
          (item, i) =>
            `<tr><td valign="top" class="hms-muted" style="width:28px;padding:0 0 10px;${FONT};font-size:15px;line-height:24px;font-weight:700;color:${T.goldInk};">${i + 1}.</td><td class="hms-text" style="padding:0 0 10px;${FONT};font-size:15px;line-height:24px;color:${T.text};">${lines(item)}</td></tr>`,
        )
        .join("")}</table>`;
  }
}

function detailsTable(rows: readonly MailDetail[]): string {
  const body = rows
    .map((r, i) => {
      const top = i > 0 ? `border-top:1px solid ${T.line};` : "";
      const size = r.strong ? "font-size:18px;line-height:24px;font-weight:700;" : "font-size:15px;line-height:22px;font-weight:600;";
      return `<tr><td class="hms-muted hms-line" valign="top" style="padding:12px 16px;${top}${FONT};font-size:14px;line-height:22px;color:${T.muted};width:40%;">${escapeHtml(r.label)}</td><td class="hms-ink hms-line" valign="top" style="padding:12px 16px;${top}${FONT};${size}color:${T.ink};font-variant-numeric:tabular-nums;word-break:break-word;">${lines(r.value)}</td></tr>`;
    })
    .join("");
  return `<table ${TABLE} width="100%" class="hms-box" style="margin:0 0 24px;border:1px solid ${T.line};border-radius:8px;border-collapse:separate;">${body}</table>`;
}

function button(label: string, url: string): string {
  // a "bulletproof" button: a table cell with the colour (Outlook ignores a link's background), the link fills it; 48 px tall
  return `<table ${TABLE} class="hms-btnwrap" style="margin:4px 0 12px;"><tr><td align="center" bgcolor="${T.graphite}" class="hms-btncell" style="background:${T.graphite};border-radius:8px;-webkit-print-color-adjust:exact;print-color-adjust:exact;"><a class="hms-btn" href="${escapeHtml(url)}" target="_blank" rel="noopener" style="display:inline-block;padding:14px 28px;${FONT};font-size:16px;line-height:20px;font-weight:600;color:${T.white};text-decoration:none;border-radius:8px;">${escapeHtml(label)}</a></td></tr></table>`;
}

const linkAsText = (url: string): string =>
  `<p class="hms-muted" style="margin:0 0 20px;${FONT};font-size:13px;line-height:20px;color:${T.muted};word-break:break-all;">Or copy this address into your browser: ${escapeHtml(url)}</p>`;

function header(brand: MailBrand): string {
  const name = escapeHtml(brand.name);
  const day = logoOf(brand.logoUrl);
  const night = logoOf(brand.logoDarkUrl);
  if (day) {
    const img = (src: string, cls: string, style: string) => `<img class="${cls}" src="${escapeHtml(src)}" alt="${name}" width="200" style="display:block;width:200px;max-width:200px;height:auto;border:0;outline:none;text-decoration:none;${style}">`;
    return night ? `${img(day, "hms-logo-day", "")}<!--[if !mso]><!-->${img(night, "hms-logo-night", "display:none;max-height:0;overflow:hidden;")}<!--<![endif]-->` : img(day, "hms-logo-day", "");
  }
  if (brand.name === PRODUCT_NAME) {
    return `<span class="hms-ink" style="${FONT};font-size:22px;line-height:28px;font-weight:700;color:${T.ink};">Easy</span> <span class="hms-gold" style="${FONT};font-size:22px;line-height:28px;font-weight:700;color:${T.goldInk};">Hotel Solutions</span>`;
  }
  return `<span class="hms-ink" style="${FONT};font-size:20px;line-height:28px;font-weight:700;color:${T.ink};">${name}</span>`;
}

const contactOf = (brand: MailBrand): string[] => [brand.address, brand.phone, brand.email].map((x) => (x ?? "").trim()).filter((x) => x !== "");

function footer(m: MailLayout): string {
  const small = (text: string, margin = "0 0 6px") => `<p class="hms-muted" style="margin:${margin};${FONT};font-size:12px;line-height:18px;color:${T.muted};">${text}</p>`;
  const contact = contactOf(m.brand);
  const parts: string[] = [`<p class="hms-muted" style="margin:0 0 4px;${FONT};font-size:13px;line-height:20px;font-weight:700;color:${T.muted};">${escapeHtml(m.brand.name)}</p>`];
  if (contact.length > 0) parts.push(small(contact.map(escapeHtml).join(" &middot; ")));
  if (m.why) parts.push(small(escapeHtml(m.why), "10px 0 0"));
  if (m.unsubscribe) {
    const url = safeUrl(m.unsubscribe.url);
    parts.push(small(`${escapeHtml(m.unsubscribe.why)}${url ? ` <a class="hms-link" href="${escapeHtml(url)}" target="_blank" rel="noopener" style="color:${T.goldInk};text-decoration:underline;">Unsubscribe</a>` : ""}`, "10px 0 0"));
  }
  if (m.sentWith) parts.push(small(`Sent with ${escapeHtml(PRODUCT_NAME)}`, "12px 0 0"));
  return parts.join("");
}

const STYLE = [
  ":root{color-scheme:light dark;supported-color-schemes:light dark;}",
  "body{margin:0;padding:0;}",
  "a[x-apple-data-detectors]{color:inherit !important;text-decoration:none !important;}",
  `.hms-logo-night{display:none !important;}`,
  "@media (prefers-color-scheme: dark){",
  `.hms-page{background:${DARK.page} !important;}.hms-card{background:${DARK.card} !important;border-color:${DARK.line} !important;border-top-color:${T.gold} !important;}.hms-ink{color:${DARK.ink} !important;}.hms-text{color:${DARK.text} !important;}.hms-muted{color:${DARK.muted} !important;}.hms-gold{color:${DARK.link} !important;}`,
  `.hms-tint{background:${DARK.tint} !important;color:${DARK.text} !important;}.hms-code{background:${DARK.codeTint} !important;border-color:${DARK.codeLine} !important;color:${DARK.ink} !important;}.hms-box,.hms-line,.hms-rule{border-color:${DARK.line} !important;}`,
  `.hms-btncell{background:${DARK.button} !important;}.hms-btn{color:${DARK.buttonText} !important;}.hms-link{color:${DARK.link} !important;}`,
  ".hms-logo-day{display:none !important;}.hms-logo-night{display:block !important;max-height:none !important;overflow:visible !important;}",
  "}",
  "@media only screen and (max-width:620px){.hms-wrap{width:100% !important;}.hms-pad{padding-left:20px !important;padding-right:20px !important;}.hms-btnwrap{width:100% !important;}.hms-btn{display:block !important;text-align:center !important;}}",
].join("\n");

/** One HTML email in the shared layout. Every text is escaped; a button or a link is made only for an http(s) address. */
export function renderMailHtml(m: MailLayout): string {
  const url = m.button ? safeUrl(m.button.url) : null;
  const content = [
    m.heading ? `<h1 class="hms-ink" style="margin:0 0 20px;${FONT};font-size:24px;line-height:32px;font-weight:700;color:${T.ink};">${escapeHtml(m.heading)}</h1>` : "",
    m.greeting ? block({ kind: "text", text: m.greeting }) : "",
    ...m.blocks.map(block),
    m.details && m.details.length > 0 ? detailsTable(m.details) : "",
    m.button && url ? button(m.button.label, url) + linkAsText(url) : "",
    ...(m.after ?? []).map(block),
  ].join("");
  // the preheader is followed by blank characters, so the list never shows the start of the mail after it
  const preheader = m.preheader
    ? `<div style="display:none;max-height:0;max-width:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${T.page};opacity:0;">${escapeHtml(m.preheader)}${"&#847;&zwnj;&nbsp;".repeat(60)}</div>`
    : "";
  const lang = /^[a-z]{2}$/.test(m.lang ?? "") ? (m.lang as string) : "en";
  return [
    "<!DOCTYPE html>",
    `<html lang="${lang}" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta http-equiv="X-UA-Compatible" content="IE=edge">',
    '<meta name="x-apple-disable-message-reformatting">',
    '<meta name="format-detection" content="telephone=no,address=no,email=no,date=no">',
    '<meta name="color-scheme" content="light dark">',
    '<meta name="supported-color-schemes" content="light dark">',
    `<title>${escapeHtml(m.heading ?? m.brand.name)}</title>`,
    "<!--[if mso]><style>table,td,p,h1,a,span{font-family:Arial,sans-serif !important;}</style><![endif]-->",
    `<style>\n${STYLE}\n</style>`,
    "</head>",
    `<body class="hms-page" style="margin:0;padding:0;background:${T.page};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">`,
    preheader,
    `<table ${TABLE} width="100%" class="hms-page" style="background:${T.page};"><tr><td align="center" style="padding:24px 12px;">`,
    `<table ${TABLE} width="600" class="hms-wrap" style="width:600px;max-width:600px;">`,
    `<tr><td class="hms-card" bgcolor="${T.white}" style="background:${T.white};border:1px solid ${T.line};border-top:4px solid ${T.gold};border-radius:12px;">`,
    `<table ${TABLE} width="100%">`,
    `<tr><td class="hms-pad hms-rule" style="padding:24px 32px 20px;border-bottom:1px solid ${T.line};">${header(m.brand)}</td></tr>`,
    `<tr><td class="hms-pad" style="padding:28px 32px 16px;">${content}</td></tr>`,
    "</table>",
    "</td></tr>",
    `<tr><td class="hms-pad" style="padding:20px 32px 8px;" align="left">${footer(m)}</td></tr>`,
    "</table>",
    "</td></tr></table>",
    "</body>",
    "</html>",
  ].join("\n");
}

/** The plain-text part, from the same pieces: it reads well on its own (a program that shows no HTML shows this). */
export function renderMailText(m: MailLayout): string {
  const out: string[] = [];
  const para = (s: string) => out.push(s, "");
  if (m.greeting) para(m.greeting);
  const textOf = (b: MailBlock): void => {
    if (b.kind === "code") para(`    ${b.text}`);
    else if (b.kind === "steps") para(b.items.map((x, i) => `${i + 1}. ${x}`).join("\n"));
    else if (b.kind === "quote") para(b.text.split(/\r?\n/).map((x) => `> ${x}`).join("\n"));
    else para(b.text);
  };
  m.blocks.forEach(textOf);
  if (m.details && m.details.length > 0) para(m.details.map((d) => `${d.label}: ${d.value}`).join("\n"));
  const url = m.button ? safeUrl(m.button.url) : null;
  if (m.button && url) para(`${m.button.label}:\n${url}`);
  (m.after ?? []).forEach(textOf);
  out.push("--", m.brand.name);
  const contact = contactOf(m.brand);
  if (contact.length > 0) out.push(contact.join(" | "));
  if (m.why) out.push("", m.why);
  if (m.unsubscribe) {
    const u = safeUrl(m.unsubscribe.url);
    out.push("", m.unsubscribe.why, ...(u ? [`To stop these emails, open: ${u}`] : []));
  }
  if (m.sentWith) out.push("", `Sent with ${PRODUCT_NAME}`);
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

/** A brand reader that remembers each answer for a minute (also "none"); a failure is "none" and is asked again next time. */
export function cachedBrandOf(load: (hotelId: string) => Promise<MailBrand | null>, ttlMs = 60_000, now: () => number = Date.now): (hotelId: string) => Promise<MailBrand | null> {
  const cache = new Map<string, { at: number; brand: MailBrand | null }>();
  return async (hotelId) => {
    const hit = cache.get(hotelId);
    if (hit && now() - hit.at < ttlMs) return hit.brand;
    let brand: MailBrand | null;
    try {
      brand = await load(hotelId);
    } catch {
      return null;
    }
    cache.set(hotelId, { at: now(), brand });
    return brand;
  };
}
