import "server-only";
import type { AddressObject, ParsedMail } from "mailparser";

// THE MIME module (Conversations, decision 66): the one place mailparser is loaded (on first use). It makes the short preview a list entry keeps (from the first 32 KB of a
// message, never stored whole), reads a whole message when someone opens it (shown, never stored), and splits the quoted history off a plain-text reply.

export const PREVIEW_MAX = 200;

/** Reads a whole message (mailparser, loaded on first use). Everything that parses mail goes through here, so the package ships with the email functions only. */
export const parse = async (source: Buffer, options: Record<string, unknown>): Promise<ParsedMail> => {
  // turbopackIgnore: not bundled or traced into every server function; next.config.ts adds mailparser (and what it needs) to the email functions only (MAIL_FUNCTIONS)
  const { simpleParser } = await import(/* turbopackIgnore: true */ "mailparser");
  return simpleParser(source, options);
};

/** Plain text from simple HTML (the preview only: the screen shows the sanitised HTML itself). */
export function htmlToPlain(html: string): string {
  return html
    .replace(/<(script|style|head|title)[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

const QUOTE_START = /^(on\s.{1,200}\swrote:|-{2,}\s*original message\s*-{2,}|_{5,}|from:\s.+@.+|sent from my .{1,40})$/i;

/** The text without its quoted history: "On ... wrote:", ">" lines, "-----Original Message-----" and what follows them. */
export function splitQuotedText(text: string): { main: string; quoted: string } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let cut = lines.length;
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim();
    // a two-line "On ..., X\n wrote:" (Gmail wraps the attribution line)
    const joined = i + 1 < lines.length ? `${t} ${lines[i + 1].trim()}` : t;
    if (QUOTE_START.test(t) || /^on\s.{1,200}\swrote:$/i.test(joined) || (t.startsWith(">") && lines.slice(i).every((l) => l.trim() === "" || l.trim().startsWith(">")))) {
      cut = i;
      break;
    }
  }
  const main = lines.slice(0, cut).join("\n").replace(/\s+$/, "");
  const quoted = lines.slice(cut).join("\n").trim();
  return { main, quoted };
}

/** The short preview of a message: its text (or its HTML as text), the quoted history cut off, white space collapsed, at most 200 characters. */
export async function previewOf(partial: Buffer): Promise<string> {
  if (partial.byteLength === 0) return "";
  let text = "";
  try {
    const m = await parse(partial, { skipImageLinks: true, skipTextToHtml: true, maxHtmlLengthToParse: 200_000 });
    text = m.text && m.text.trim() !== "" ? m.text : typeof m.html === "string" ? htmlToPlain(m.html) : "";
  } catch {
    // a cut-off or broken message: no preview
    text = "";
  }
  const main = splitQuotedText(text).main;
  return Array.from(main.replace(/\s+/g, " ").trim()).slice(0, PREVIEW_MAX).join("");
}

export interface ParsedAttachment {
  name: string;
  size: number;
  type: string;
  /** The Content-ID without the brackets (an inline picture), or null. */
  cid: string | null;
  related: boolean;
  content: Buffer;
}

export interface ParsedMessage {
  subject: string;
  from: string | null;
  replyTo: string | null;
  to: string[];
  cc: string[];
  date: Date | null;
  html: string | null;
  text: string;
  attachments: ParsedAttachment[];
  /** X-HMS-Kind (lower case) and X-HMS-Bill: mail HMS made itself. */
  hmsKind: string | null;
  hmsBill: boolean;
  /** The body carries a header block of other HMS mail (a bounce or a forward with the original attached): X-HMS-Kind other than "conversation" below the top header. */
  hmsEmbedded: boolean;
}

/** Parts that are whole messages or header blocks of another message: never listed or served (they can hold mail HMS sent). */
export const EMBEDDED_MESSAGE_TYPES: ReadonlySet<string> = new Set(["message/rfc822", "message/global", "text/rfc822-headers", "message/global-headers", "message/delivery-status", "message/global-delivery-status"]);

/** An X-HMS-Kind header line (other than "conversation") anywhere below the message's own header: an attached or quoted copy of mail HMS made. */
export function hasEmbeddedHmsKind(source: Buffer): boolean {
  const text = source.toString("latin1");
  const split = /\r?\n\r?\n/.exec(text);
  const body = split ? text.slice(split.index + split[0].length) : "";
  return /^[ \t>]*X-HMS-Kind:[ \t]*(?!conversation\b)\S/im.test(body);
}

const addresses = (v: AddressObject | AddressObject[] | undefined): string[] =>
  (Array.isArray(v) ? v : v ? [v] : []).flatMap((a) => a.value.map((x) => (x.address ?? "").trim().toLowerCase())).filter((x) => x.includes("@"));

/** A whole message as the reader shows it (inline pictures stay as cid: links; the sanitiser decides which to show). */
export async function parseFull(source: Buffer): Promise<ParsedMessage> {
  const m = await parse(source, { skipImageLinks: true, skipTextToHtml: true, maxHtmlLengthToParse: 2_000_000 });
  const header = (name: string): string | null => {
    const v = m.headers.get(name);
    return typeof v === "string" ? v.trim() : null;
  };
  return {
    subject: (m.subject ?? "").replace(/[\r\n]+/g, " ").trim(),
    from: addresses(m.from)[0] ?? null,
    replyTo: addresses(m.replyTo)[0] ?? null,
    to: addresses(m.to),
    cc: addresses(m.cc),
    date: m.date ?? null,
    html: typeof m.html === "string" ? m.html : null,
    text: m.text ?? (typeof m.html === "string" ? htmlToPlain(m.html) : ""),
    attachments: m.attachments.map((a) => ({ name: a.filename ?? "", size: a.size, type: (a.contentType ?? "application/octet-stream").toLowerCase(), cid: a.cid ?? (a.contentId ? a.contentId.replace(/^<|>$/g, "") : null), related: a.related === true, content: a.content })),
    hmsKind: header("x-hms-kind")?.toLowerCase() ?? null,
    hmsBill: header("x-hms-bill") === "1",
    hmsEmbedded: hasEmbeddedHmsKind(source),
  };
}
