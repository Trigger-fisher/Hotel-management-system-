// The languages of the screens (MJ, 3 Nov 2026: English, Hindi, Gujarati; 4 Nov 2026: French and German added, left to right like the first three). Only what people SEE and TYPE changes; stored data stays English.
// One list for every user kind (guest, company, hotel, group, platform).

export type Language = 'en' | 'hi' | 'gu' | 'fr' | 'de';

export const LANGUAGES = ['en', 'hi', 'gu', 'fr', 'de'] as const satisfies readonly Language[];

export const DEFAULT_LANGUAGE: Language = 'en';

/** Each language written in its own script: the switch shows these, never a translation. */
export const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', hi: 'हिन्दी', gu: 'ગુજરાતી', fr: 'Français', de: 'Deutsch' };

/** The value of <html lang> and the locale for dates, numbers and money (Latin digits and Indian grouping stay in every language). */
export const LANGUAGE_LOCALES: Record<Language, string> = { en: 'en-IN', hi: 'hi-IN', gu: 'gu-IN', fr: 'fr-FR', de: 'de-DE' };

/** Where the browser keeps the choice (localStorage and a cookie of the same name). */
export const LANGUAGE_STORAGE_KEY = 'hms-lang';

export function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'hi' || value === 'gu' || value === 'fr' || value === 'de';
}

/** Any stored or typed value to a valid language: an unknown value is English. */
export function toLanguage(value: unknown): Language {
  return isLanguage(value) ? value : DEFAULT_LANGUAGE;
}
