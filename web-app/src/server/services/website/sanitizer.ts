import "server-only";
// The allow-list cleaner for the home page's rich-text fields (Pallav Support/Site/Sanitizer::richText). The fields are edited as rich text and printed
// UNESCAPED on the public site, so each goes through this: bold, italic, lists, links and spans stay; scripts, frames, forms and the like go with
// everything inside; any other tag keeps its text and loses its tags; a link keeps only a safe address. Safe to run again on clean content.
//
// Pallav parses with libxml's HTML4 parser, so this follows its tree rules: a new block closes an open paragraph, an unclosed tag is closed at the end,
// a stray closing tag is ignored, names are lower-cased, a link address is URI-escaped on the way out. Golden: tests/server/website.content.golden.test.ts
// (real PHP). One libxml defect in Pallav is NOT ported: a character beyond U+FFFF (an emoji) is corrupted by its numeric-entity round trip; here it is kept.

const ALLOWED: Record<string, readonly string[]> = {
  p: [], br: [], strong: [], b: [], em: [], i: [], u: [], s: [], blockquote: [],
  ul: [], ol: [], li: ["class", "data-list"],
  a: ["href", "target", "rel"],
  span: ["class"],
};
const STRIP_ENTIRELY = new Set(["script", "style", "iframe", "object", "embed", "form", "input", "button", "textarea", "select", "svg", "math", "noscript", "template", "link", "meta", "base"]);
const URL_SCHEMES = new Set(["http", "https", "mailto", "tel"]);
const VOID = new Set(["br", "img", "input", "link", "meta", "base", "hr", "embed", "param", "area", "col", "frame", "basefont", "isindex"]);
/** What a new tag closes when a paragraph (or list item) is open: libxml's htmlStartClose, the part that matters for the allow-list. */
const BLOCKS = new Set(["p", "div", "ul", "ol", "dl", "table", "form", "blockquote", "pre", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "address", "center", "fieldset", "dir", "menu"]);
const RAW_TEXT = new Set(["script", "style"]);

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', nbsp: " ", copy: "©", reg: "®", trade: "™", euro: "€", pound: "£", yen: "¥", cent: "¢", sect: "§", deg: "°", plusmn: "±", middot: "·",
  laquo: "«", raquo: "»", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", bull: "•", hellip: "…", times: "×", divide: "÷", iexcl: "¡", iquest: "¿",
  para: "¶", frac12: "½", frac14: "¼", frac34: "¾", sup2: "²", sup3: "³", micro: "µ", szlig: "ß", eacute: "é", egrave: "è", agrave: "à", aacute: "á", uuml: "ü", ouml: "ö", auml: "ä",
  ntilde: "ñ", ccedil: "ç", rarr: "→", larr: "←", uarr: "↑", darr: "↓", hearts: "♥", infin: "∞", ne: "≠", le: "≤", ge: "≥", permil: "‰", dagger: "†", prime: "′",
};

interface El {
  name: string;
  attrs: [string, string][];
  children: (El | string)[];
  parent: El | null;
}

function decodeEntities(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);?/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
    }
    // libxml's HTML4 table: a name it does not know stays as written, and one without its semicolon is not an entity
    return whole.endsWith(";") && body in ENTITIES ? ENTITIES[body] : whole;
  });
}

function parse(html: string): El {
  const root: El = { name: "div", attrs: [], children: [], parent: null };
  let cur = root;
  const open = (name: string): boolean => {
    for (let e: El | null = cur; e && e !== root; e = e.parent) if (e.name === name) return true;
    return false;
  };
  const closeTo = (name: string): void => {
    while (cur !== root && cur.name !== name) cur = cur.parent!;
    if (cur !== root) cur = cur.parent!;
  };
  let i = 0;
  const n = html.length;
  const text = (t: string): void => {
    if (t === "") return;
    const last = cur.children[cur.children.length - 1];
    if (typeof last === "string") cur.children[cur.children.length - 1] = last + t;
    else cur.children.push(t);
  };
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      text(decodeEntities(html.slice(i)));
      break;
    }
    if (lt > i) text(decodeEntities(html.slice(i, lt)));
    i = lt;
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (html[i + 1] === "?" || html[i + 1] === "!") {
      const end = html.indexOf(">", i + 2);
      i = end === -1 ? n : end + 1;
      continue;
    }
    const closing = html[i + 1] === "/";
    const m = /^<\/?([A-Za-z][A-Za-z0-9:-]*)/.exec(html.slice(i, i + 80));
    if (!m) {
      text("<");
      i += 1;
      continue;
    }
    const name = m[1].toLowerCase();
    let j = i + m[0].length;
    const attrs: [string, string][] = [];
    let selfClose = false;
    // attributes
    for (;;) {
      while (j < n && /\s/.test(html[j])) j++;
      if (j >= n) break;
      if (html[j] === ">") {
        j++;
        break;
      }
      if (html[j] === "/") {
        selfClose = true;
        j++;
        continue;
      }
      const am = /^[^\s=>/]+/.exec(html.slice(j));
      if (!am) {
        j++;
        continue;
      }
      const aname = am[0].toLowerCase();
      j += am[0].length;
      while (j < n && /\s/.test(html[j])) j++;
      let value = "";
      if (html[j] === "=") {
        j++;
        while (j < n && /\s/.test(html[j])) j++;
        if (html[j] === '"' || html[j] === "'") {
          const q = html[j];
          const end = html.indexOf(q, j + 1);
          value = html.slice(j + 1, end === -1 ? n : end);
          j = end === -1 ? n : end + 1;
        } else {
          const vm = /^[^\s>]*/.exec(html.slice(j))!;
          value = vm[0];
          j += vm[0].length;
        }
      }
      if (!attrs.some(([k]) => k === aname)) attrs.push([aname, decodeEntities(value)]);
    }
    i = j;
    if (closing) {
      if (open(name)) closeTo(name);
      continue;
    }
    // a new block closes an open paragraph; a list item closes the open one
    if (BLOCKS.has(name)) while (cur !== root && cur.name === "p") cur = cur.parent!;
    if (name === "li") while (cur !== root && (cur.name === "li" || cur.name === "p")) cur = cur.parent!;
    const el: El = { name, attrs, children: [], parent: cur };
    cur.children.push(el);
    if (VOID.has(name) || selfClose && !RAW_TEXT.has(name)) continue;
    if (RAW_TEXT.has(name)) {
      const end = html.toLowerCase().indexOf(`</${name}`, i);
      el.children.push(html.slice(i, end === -1 ? n : end));
      const close = end === -1 ? -1 : html.indexOf(">", end);
      i = close === -1 ? n : close + 1;
      continue;
    }
    cur = el;
  }
  return root;
}

/** A link address is safe when it is relative or one of http, https, mailto, tel (after entities and control characters are stripped, as a browser reads it). */
function urlIsSafe(url: string): boolean {
  const clean = decodeEntities(url).replace(/[\u0000- \u007f]/g, "");
  if (clean === "") return false;
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(clean);
  return m === null ? true : URL_SCHEMES.has(m[1].toLowerCase());
}

function clean(el: El): (El | string)[] {
  const out: (El | string)[] = [];
  for (const child of el.children) {
    if (typeof child === "string") {
      out.push(child);
      continue;
    }
    if (STRIP_ENTIRELY.has(child.name)) continue;
    if (!(child.name in ALLOWED)) {
      out.push(...clean(child));
      continue;
    }
    const kept = ALLOWED[child.name];
    const attrs = child.attrs.filter(([k, v]) => kept.includes(k) && !(k === "href" && !urlIsSafe(v)));
    if (child.name === "a" && attrs.some(([k]) => k === "href") && attrs.some(([k, v]) => k === "target" && v === "_blank")) {
      const at = attrs.findIndex(([k]) => k === "rel");
      if (at === -1) attrs.push(["rel", "noopener noreferrer"]);
      else attrs[at] = ["rel", "noopener noreferrer"];
    }
    out.push({ name: child.name, attrs, children: clean(child), parent: null });
  }
  // neighbouring text from an unwrapped tag is one text
  return out.reduce<(El | string)[]>((acc, x) => {
    const last = acc[acc.length - 1];
    if (typeof x === "string" && typeof last === "string") acc[acc.length - 1] = last + x;
    else acc.push(x);
    return acc;
  }, []);
}

const escapeText = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (t: string): string => t.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** libxml's xmlURIEscapeStr for an href: everything but unreserved characters and "@/:=?;#%&,+" is %-escaped (a character as its UTF-8 bytes). */
function uriEscape(v: string): string {
  return Array.from(v)
    .map((ch) => (/[A-Za-z0-9\-_.!~*'()@/:=?;#%&,+]/.test(ch) ? ch : Array.from(new TextEncoder().encode(ch), (b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`).join("")))
    .join("");
}

function write(nodes: readonly (El | string)[]): string {
  return nodes
    .map((x) => {
      if (typeof x === "string") return escapeText(x);
      const attrs = x.attrs.map(([k, v]) => ` ${k}="${escapeAttr(x.name === "a" && k === "href" ? uriEscape(v) : v)}"`).join("");
      return VOID.has(x.name) ? `<${x.name}${attrs}>` : `<${x.name}${attrs}>${write(x.children)}</${x.name}>`;
    })
    .join("");
}

/** PHP's trim: ASCII whitespace and NUL only (a non-breaking space stays). */
const phpTrim = (s: string): string => s.replace(/^[ \t\n\r\0\x0B]+|[ \t\n\r\0\x0B]+$/g, "");

/** The HTML with everything outside the allow-list removed. Safe to print unescaped, and safe to run again on content already clean. */
export function richText(html: string | null | undefined): string {
  const t = phpTrim(html ?? "");
  if (t === "") return "";
  return phpTrim(write(clean(parse(t))));
}

/** Whether a cleaned field holds anything a reader would see (an empty editor still holds an empty paragraph, which is nothing). */
export const hasVisibleText = (cleaned: string): boolean => phpTrim(cleaned.replace(/<[^>]*>/g, "")) !== "";
