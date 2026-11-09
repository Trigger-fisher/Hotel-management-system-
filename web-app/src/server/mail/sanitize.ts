import "server-only";
import { randomUUID } from "node:crypto";
import type { IOptions } from "sanitize-html";

// THE email HTML sanitiser (Conversations, decision 66): the one place sanitize-html is loaded. An opened email is shown only after this, on the server; the screen shows the
// result in a sandboxed frame without scripts as a second fence. Rules (an allow-list: what is not named is gone):
//  - no script, style, form, frame, object, media or document-level element, with its content; no event handler (no on* attribute is allowed); no class or id;
//  - links only http(s), mailto and tel, opened in a new tab without the opener; style only a small list of properties, never url(), expression(), @import or a backslash;
//  - pictures: an inline picture of this email (cid:) is shown as a data: URI within a budget (each at most 1 MB, PNG/JPEG/GIF, 2 MB in all; past it the picture is left
//    out and counted); a remote picture (http/https) is held back and counted until the person presses "Show images" (it would tell the sender the mail was read);
//    a 1x1 picture (a tracking pixel) is always left out; a data: picture the email brought itself is never shown;
//  - quoted history (Gmail, Apple Mail, Outlook, Yahoo) is wrapped in <div data-hms-quote="1"> so the screen can fold it.

export const INLINE_ITEM_MAX = 1024 * 1024;
export const INLINE_TOTAL_MAX = 2 * 1024 * 1024;
/** Sanitised HTML larger than this is not sent: the screen says "Too large to open here". */
export const HTML_OUT_MAX = 1.5 * 1024 * 1024;

export interface SanitisedMail {
  html: string;
  remoteImages: number;
  droppedInline: number;
  hasQuoted: boolean;
}

const SAFE_VALUE = /^(?!.*(url\s*\(|expression|@import|\\|javascript:|behavior|-moz-binding)).*$/i;
const STYLE_PROPS = [
  "color", "background-color", "font-size", "font-weight", "font-style", "font-family", "text-align", "text-decoration", "text-transform", "line-height", "letter-spacing",
  "white-space", "word-break", "word-wrap", "overflow-wrap", "vertical-align", "width", "max-width", "min-width", "height", "max-height", "margin", "margin-top", "margin-right",
  "margin-bottom", "margin-left", "padding", "padding-top", "padding-right", "padding-bottom", "padding-left", "border", "border-top", "border-right", "border-bottom", "border-left",
  "border-color", "border-style", "border-width", "border-radius", "border-collapse", "border-spacing", "display", "table-layout", "list-style-type",
];

const ALLOWED_TAGS = [
  "a", "abbr", "address", "article", "b", "big", "blockquote", "br", "caption", "center", "cite", "code", "col", "colgroup", "dd", "del", "div", "dl", "dt", "em", "font",
  "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "i", "img", "ins", "kbd", "li", "mark", "ol", "p", "pre", "q", "s", "section", "small", "span", "strike",
  "strong", "sub", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "tt", "u", "ul", "wbr",
];
const DROPPED_WITH_CONTENT = [
  "script", "style", "title", "head", "template", "noscript", "iframe", "frame", "frameset", "object", "embed", "applet", "form", "input", "button", "select", "option", "textarea",
  "svg", "math", "base", "meta", "link", "audio", "video", "source", "track", "canvas", "picture", "dialog", "portal",
];
const INLINE_TYPES = /^data:image\/(png|jpeg|gif);base64,/i;

/** The quoted-history markers of Outlook ("appendonsend", "divRplyFwdMsg"): the marker and every element after it are history. */
const OUTLOOK_MARKER = /<div\b[^>]*\bid\s*=\s*["']?(appendonsend|divRplyFwdMsg)\b[^>]*>/i;

const isPixel = (attribs: Record<string, string>): boolean => {
  const dim = (v: string | undefined): number | null => (v === undefined ? null : Number.parseFloat(v));
  const style = (attribs.style ?? "").toLowerCase();
  const sw = /(?:^|;)\s*width\s*:\s*([\d.]+)px/.exec(style)?.[1];
  const sh = /(?:^|;)\s*height\s*:\s*([\d.]+)px/.exec(style)?.[1];
  const w = dim(attribs.width) ?? dim(sw);
  const h = dim(attribs.height) ?? dim(sh);
  return (w !== null && w <= 1 && h !== null && h <= 1) || /display\s*:\s*none/.test(style);
};

/**
 * The email's HTML, safe to show. `inline` maps a Content-ID (without brackets) to its picture as a data: URI (made by the caller from the parsed attachments).
 * The caller refuses to send an answer whose html is over HTML_OUT_MAX.
 */
export async function sanitiseMailHtml(html: string, options: { showImages: boolean; inline: ReadonlyMap<string, string> }): Promise<SanitisedMail> {
  const sanitize = (await import("sanitize-html")).default;
  let remoteImages = 0;
  let droppedInline = 0;
  let inlineTotal = 0;
  let hasQuoted = false;

  // Outlook's history has no container: everything from the marker on is wrapped (the open tag here, closed at the end of the document). The wrapper carries a one-time
  // value only this call knows, so an email cannot mark parts of itself as "quoted" (hidden behind the toggle) by writing data-hms-quote on its own.
  const nonce = randomUUID();
  let source = html;
  const marker = OUTLOOK_MARKER.exec(source);
  if (marker) {
    hasQuoted = true;
    const at = marker.index;
    const end = source.search(/<\/body\s*>/i);
    source = end > at ? `${source.slice(0, at)}<div data-hms-quote="${nonce}">${source.slice(at, end)}</div>${source.slice(end)}` : `${source.slice(0, at)}<div data-hms-quote="${nonce}">${source.slice(at)}</div>`;
  }

  const quoteOf = (attribs: Record<string, string>): boolean => {
    const cls = ` ${(attribs.class ?? "").toLowerCase()} `;
    return attribs["data-hms-quote"] === nonce || cls.includes(" gmail_quote ") || cls.includes(" yahoo_quoted ") || cls.includes(" protonmail_quote ");
  };

  const opts: IOptions = {
    allowedTags: ALLOWED_TAGS,
    disallowedTagsMode: "discard",
    nonTextTags: DROPPED_WITH_CONTENT,
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "title", "width", "height"],
      div: ["data-hms-quote"],
      td: ["colspan", "rowspan", "width", "height", "valign", "bgcolor"],
      th: ["colspan", "rowspan", "width", "height", "valign", "bgcolor", "scope"],
      table: ["width", "cellpadding", "cellspacing", "border", "bgcolor"],
      col: ["span", "width"],
      colgroup: ["span", "width"],
      font: ["color", "size", "face"],
      ol: ["start", "type"],
      "*": ["style", "align", "dir", "lang"],
    },
    allowedStyles: { "*": Object.fromEntries(STYLE_PROPS.map((p) => [p, [SAFE_VALUE]])) },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https", "data"] },
    allowedSchemesAppliedToAttributes: ["href", "src", "cite"],
    allowProtocolRelative: false,
    parseStyleAttributes: true,
    enforceHtmlBoundary: false,
    transformTags: {
      a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer nofollow" } }),
      blockquote: (tagName, attribs) => {
        if ((attribs.type ?? "").toLowerCase() === "cite") {
          hasQuoted = true;
          return { tagName: "div", attribs: { ...attribs, "data-hms-quote": "1" } };
        }
        return { tagName, attribs };
      },
      div: (tagName, attribs) => {
        const { ["data-hms-quote"]: _drop, ...rest } = attribs;
        void _drop;
        if (quoteOf(attribs)) {
          hasQuoted = true;
          return { tagName, attribs: { ...rest, "data-hms-quote": "1" } };
        }
        return { tagName, attribs: rest };
      },
      img: (tagName, attribs) => {
        const src = (attribs.src ?? "").trim();
        const { src: _old, ...rest } = attribs;
        void _old;
        if (isPixel(attribs)) return { tagName, attribs: rest };
        if (/^cid:/i.test(src)) {
          const uri = options.inline.get(src.slice(4).replace(/^<|>$/g, ""));
          if (!uri || !INLINE_TYPES.test(uri) || uri.length > INLINE_ITEM_MAX * 1.37 || inlineTotal + uri.length > INLINE_TOTAL_MAX) {
            droppedInline += 1;
            return { tagName, attribs: rest };
          }
          inlineTotal += uri.length;
          return { tagName, attribs: { ...rest, src: uri } };
        }
        if (/^https?:\/\//i.test(src)) {
          if (!options.showImages) {
            remoteImages += 1;
            return { tagName, attribs: rest };
          }
          return { tagName, attribs: { ...rest, src } };
        }
        // a data: picture the email brought itself, or anything else: never shown
        return { tagName, attribs: rest };
      },
    },
    // a picture without a source (held back, left out, a pixel) is removed, not shown empty
    exclusiveFilter: (frame) => frame.tag === "img" && !frame.attribs.src,
  };
  const out = sanitize(source, opts);
  return { html: out, remoteImages, droppedInline, hasQuoted };
}
