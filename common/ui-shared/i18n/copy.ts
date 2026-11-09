// The one pattern for the screen words of a module: the English `...Copy` object stays as it is, and a Hindi and a Gujarati object of the SAME shape
// sit beside it. TypeScript refuses a missing or an extra key. A screen asks for its words with useCopy(copyByLanguage) (web-app/src/lib/i18n), never with
// an `if (language === ...)`.
import { DEFAULT_LANGUAGE, toLanguage, type Language } from './languages';

/** The English object's shape with every literal text widened to string (functions keep their parameters and return string), so Hindi can be a different text. */
export type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => Widen<R>
    : T extends object
      ? { [K in keyof T]: Widen<T[K]> }
      : T;

/** The words of one module in the languages that have them. Every language but English may be missing: the screen then shows English. */
export interface CopyByLanguage<T> {
  readonly en: T;
  readonly hi?: Widen<T>;
  readonly gu?: Widen<T>;
  readonly fr?: Widen<T>;
  readonly de?: Widen<T>;
}

/**
 * Add a language to a module (three lines):
 *   1. beside `export const xCopy = {...} as const;` write `const xCopyHi: Widen<typeof xCopy> = {...}` and `xCopyGu` (same keys, no more, no fewer);
 *   2. `export const xCopyByLanguage = copyByLanguage(xCopy, xCopyHi, xCopyGu);`
 *   3. in the screen: `const xCopy = useCopy(xCopyByLanguage);` (replacing the import of the English object).
 */
export function copyByLanguage<T>(en: T, hi?: Widen<T>, gu?: Widen<T>, fr?: Widen<T>, de?: Widen<T>): CopyByLanguage<T> {
  return { en, hi, gu, fr, de };
}

/** The words for a language: the module's own Hindi or Gujarati when it has them, English otherwise (also for an unknown language value). */
export function pickCopy<T>(words: CopyByLanguage<T>, language: Language | string | null | undefined): T {
  const lang = toLanguage(language);
  if (lang === DEFAULT_LANGUAGE) return words.en;
  return ((words[lang] as T | undefined) ?? words.en) as T;
}
