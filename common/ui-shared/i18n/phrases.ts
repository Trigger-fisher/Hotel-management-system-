// The phrase books of the whole app (MJ, 3 Nov 2026: "when I change the language it changes the entire app, not only the header").
// The screens of the staff dashboards keep their English text where it is and ask tr('English text') for it; the Hindi and Gujarati book maps the
// English text to its translation. A text that is not in the book shows in English, so a missing phrase never breaks a screen.
// Pure TypeScript, no React. The books themselves sit in phrases/<language>/ and are loaded only for the language that is chosen.
import { DEFAULT_LANGUAGE, toLanguage, type Language } from './languages';

/** English text (trimmed, one space between words) to its translation. */
export type PhraseBook = Readonly<Record<string, string>>;

const books = new Map<Language, PhraseBook>();
/** The texts with {0} values of a book, compiled once into patterns (see phraseAny); dropped when the book changes. */
const templateCache = new Map<Language, Template[]>();

/** The key a text is looked up by: spaces and line breaks inside it collapsed, none at the ends. */
export function phraseKey(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Put a language's book in place (the loader calls this once; a second call merges, later wins). */
export function setPhraseBook(language: Language, book: PhraseBook): void {
  if (language === DEFAULT_LANGUAGE) return;
  books.set(language, { ...(books.get(language) ?? {}), ...book });
  templateCache.delete(language);
}

export function hasPhraseBook(language: Language): boolean {
  return books.has(language);
}

/** For tests: forget every book. */
export function clearPhraseBooksForTests(): void {
  books.clear();
  templateCache.clear();
}

/** The text in the language; the spaces around it stay as they were. English, an unknown language and a missing phrase give the text itself. */
export function phrase(text: string, language: Language | string | null | undefined): string {
  const lang = toLanguage(language);
  if (lang === DEFAULT_LANGUAGE) return text;
  const found = books.get(lang)?.[phraseKey(text)];
  if (found === undefined) return text;
  const lead = /^\s*/.exec(text)?.[0] ?? '';
  const tail = /\s*$/.exec(text)?.[0] ?? '';
  return lead + found + tail;
}

/**
 * A phrase with values: `phraseWith('Room {0} of {1}', [3, 10], 'hi')`. The English template is the key; each {n} is replaced by the n-th value in the
 * language's template, so the translation may put the values in another order.
 */
export function phraseWith(template: string, values: readonly (string | number)[], language: Language | string | null | undefined): string {
  return phrase(template, language).replace(/\{(\d+)\}/g, (m, i: string) => (Number(i) < values.length ? String(values[Number(i)]) : m));
}

interface Template {
  re: RegExp;
  to: string;
  /** Which placeholder number each capture group of `re` holds, in the order the English text writes them. */
  order: number[];
  /** How many letters of the English text are fixed (the longer, the more specific the pattern). */
  fixed: number;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every book text with {0} values as a pattern: "{0} of {1} rooms in service" matches "1 of 4 rooms in service". The most specific pattern is tried first. */
function templatesOf(language: Language): Template[] {
  const cached = templateCache.get(language);
  if (cached) return cached;
  const out: Template[] = [];
  for (const [key, to] of Object.entries(books.get(language) ?? {})) {
    if (!/\{\d+\}/.test(key)) continue;
    const parts = key.split(/(\{\d+\})/);
    const fixed = parts.filter((p) => !/^\{\d+\}$/.test(p)).join('').replace(/\s+/g, '').length;
    // a pattern with little fixed text ({0} and {1}, {0} open {1}) would match the middle of any sentence and half-translate it: only patterns with real words of their own
    if (key.replace(/\{\d+\}/g, '').replace(/[^A-Za-z]/g, '').length < 6) continue;
    const order: number[] = [];
    const source = parts.map((p) => (/^\{\d+\}$/.test(p) ? (order.push(Number(p.slice(1, -1))), '([\\s\\S]+?)') : escapeRe(p))).join('');
    out.push({ re: new RegExp(`^${source}$`), to, order, fixed });
  }
  out.sort((a, b) => b.fixed - a.fixed);
  templateCache.set(language, out);
  return out;
}

/**
 * The translation of a text a screen drew WITHOUT asking tr() for it (a text of a shared copy object, a text with values already filled in): the exact text first, then
 * the book's texts with {0} values read as patterns. null = this language has nothing for it (the caller leaves the text as it is). The spaces around the text stay.
 */
export function phraseAny(text: string, language: Language | string | null | undefined): string | null {
  const lang = toLanguage(language);
  if (lang === DEFAULT_LANGUAGE) return null;
  const key = phraseKey(text);
  if (key === '') return null;
  const lead = /^\s*/.exec(text)?.[0] ?? '';
  const tail = /\s*$/.exec(text)?.[0] ?? '';
  const whole = translateWhole(key, lang);
  if (whole !== null) return lead + whole + tail;
  // a text the page mixed from pieces ("आज 10 entries"): translate each run of English words in it that the book knows, leave the rest as it is
  if (/[^\u0000-\u024f\u2000-\u206f\u20a0-\u20cf]/.test(key)) {
    let changed = false;
    const mixed = key.replace(/[A-Za-z][A-Za-z0-9'’&/ .,-]*[A-Za-z0-9]|\d[\d,.]*\s+[A-Za-z][A-Za-z ]*[A-Za-z]/g, (run) => {
      const t = translateWhole(run.trim(), lang);
      if (t === null) return run;
      changed = true;
      return t;
    });
    if (changed) return lead + mixed + tail;
  }
  return null;
}

/** One text as a whole: exact, then a {0} pattern, then "<number> <words>" and "<words> <number>" ("7 rooms"), then the same words in another capital ("rooms" for "Rooms"). */
function translateWhole(key: string, lang: Language): string | null {
  const book = books.get(lang);
  const exact = book?.[key];
  if (exact !== undefined) return exact;
  for (const t of templatesOf(lang)) {
    const m = t.re.exec(key);
    if (!m) continue;
    const values = new Map<number, string>();
    t.order.forEach((n, i) => values.set(n, m[i + 1] ?? ''));
    return t.to.replace(/\{(\d+)\}/g, (all, i: string) => values.get(Number(i)) ?? all);
  }
  // "<number> <words>" and "<words> <number>": the book's own pattern with the number alone in it ("{0} days", "Room {0}"), else the words as they are in the book
  const front = /^([+-]?\d[\d,.]*%?)\s+(\S.*)$/.exec(key);
  if (front) {
    const own = book?.[`{0} ${front[2]}`];
    if (own !== undefined && !/\{[1-9]/.test(own)) return own.replace(/\{0\}/g, front[1]);
    const rest = translateWords(front[2], lang);
    if (rest !== null) return `${front[1]} ${rest}`;
  }
  const back = /^(\S.*?)\s+([+-]?\d[\d,.]*%?)$/.exec(key);
  if (back) {
    const own = book?.[`${back[1]} {0}`];
    if (own !== undefined && !/\{[1-9]/.test(own)) return own.replace(/\{0\}/g, back[2]);
    const rest = translateWords(back[1], lang);
    if (rest !== null) return `${rest} ${back[2]}`;
  }
  return translateWords(key, lang);
}

/** The words as the book has them, also when only the capital differs ("rooms" / "Rooms", "ROOMS"): the answer keeps the first letter's case where the script has one. */
function translateWords(words: string, lang: Language): string | null {
  const book = books.get(lang);
  if (!book) return null;
  const hit = book[words];
  if (hit !== undefined) return hit;
  const cap = words.charAt(0).toUpperCase() + words.slice(1);
  const low = words.charAt(0).toLowerCase() + words.slice(1);
  const found = book[cap] ?? book[low] ?? book[words.toLowerCase()];
  if (found === undefined) return null;
  return /^[a-z]/.test(words) && /^[A-Z]/.test(found) ? found.charAt(0).toLowerCase() + found.slice(1) : found;
}
