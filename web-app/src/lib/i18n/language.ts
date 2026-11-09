'use client';

// The current language of the screens, kept in one place for every screen and every user kind (MJ, 3 Nov 2026).
// Remembered in this browser (localStorage and a cookie of the same name; if both are blocked, in memory until the page closes). Needs no database:
// it is also what the sign-in page uses before anyone has signed in. <html lang> follows the choice; the text direction stays left to right.
import { useCallback, useSyncExternalStore } from 'react';
import { DEFAULT_LANGUAGE, LANGUAGE_LOCALES, LANGUAGE_STORAGE_KEY, isLanguage, type Language } from '@shared/i18n/languages';
import { pickCopy, type CopyByLanguage } from '@shared/i18n/copy';
import { phrase, phraseWith, setPhraseBook, type PhraseBook } from '@shared/i18n/phrases';
import { setDisplayLanguage } from '@shared/dashboards/format';

let memory: Language | null = null;
/** The language tr() answers in; kept so a screen with hundreds of texts does not read the browser's storage for each one. */
let current: Language | null = null;
/** True once the first client render is committed: until then tr() gives English, the same as the server drew (no hydration mismatch). */
let live = false;
const loadedBooks = new Set<Language>();
const loadingBooks = new Map<Language, Promise<void>>();
const listeners = new Set<() => void>();

const BOOK_LOADERS: Partial<Record<Language, () => Promise<{ default: PhraseBook }>>> = {
  hi: () => import('@shared/i18n/phrases/hi'),
  gu: () => import('@shared/i18n/phrases/gu'),
  fr: () => import('@shared/i18n/phrases/fr'),
  de: () => import('@shared/i18n/phrases/de'),
};

/** Fetch the phrase book of a language once (only the chosen language is ever loaded), then tell every screen to draw again. */
function ensureBook(language: Language): void {
  const load = BOOK_LOADERS[language];
  if (!load || loadedBooks.has(language) || loadingBooks.has(language)) return;
  loadingBooks.set(
    language,
    load()
      .then((m) => {
        setPhraseBook(language, m.default);
        loadedBooks.add(language);
      })
      .catch(() => {
        /* the book did not load: the screens stay in English, the next choice of the language tries again */
      })
      .finally(() => {
        loadingBooks.delete(language);
        listeners.forEach((l) => l());
      }),
  );
}

function readCookie(): string | null {
  try {
    const m = document.cookie.match(new RegExp(`(?:^|; )${LANGUAGE_STORAGE_KEY}=([^;]*)`));
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

/** The saved choice of this browser: localStorage, else the cookie, else what was chosen on this page, else English. Never throws. */
export function readLanguage(): Language {
  if (typeof window === 'undefined') return DEFAULT_LANGUAGE;
  if (memory) return memory;
  let v: string | null = null;
  try {
    v = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    v = null;
  }
  if (!isLanguage(v)) v = readCookie();
  return isLanguage(v) ? v : DEFAULT_LANGUAGE;
}

/** <html lang> follows the language. */
export function applyHtmlLang(language: Language): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = LANGUAGE_LOCALES[language];
}

/** Choose a language: applied at once everywhere, remembered in this browser. A value that is not a language is ignored. */
export function setLanguage(language: Language): void {
  if (!isLanguage(language)) return;
  memory = language;
  current = language;
  ensureBook(language);
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    /* blocked storage: the cookie and the memory keep it */
  }
  try {
    document.cookie = `${LANGUAGE_STORAGE_KEY}=${language}; Path=/; Max-Age=31536000; SameSite=Lax`;
  } catch {
    /* blocked cookies */
  }
  applyHtmlLang(language);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  live = true;
  current = readLanguage();
  ensureBook(current);
  applyHtmlLang(current);
  const onStorage = (e: StorageEvent) => {
    if (e.key === LANGUAGE_STORAGE_KEY) {
      memory = null;
      current = readLanguage();
      ensureBook(current);
      applyHtmlLang(current);
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** The current language and the way to change it. The server and the first client render say English (what the server drew), the browser's choice follows at once. */
export function useLanguage(): [Language, (language: Language) => void] {
  const language = useSyncExternalStore(subscribe, readLanguage, () => DEFAULT_LANGUAGE);
  // dates written by the shared formatters in this render follow the language (a plain value, the same for every screen in the pass)
  setDisplayLanguage(language);
  return [language, useCallback((l: Language) => setLanguage(l), [])];
}

/** The words of a module in the current language (English when the module has none in it). The one way a screen asks for its copy. */
export function useCopy<T>(words: CopyByLanguage<T>): T {
  const [language] = useLanguage();
  return pickCopy(words, language);
}

/** The language the phrase books answer in right now, or null while the screens must stay English (English chosen, first render, or the book still loading). */
export function translatedLanguage(): Language | null {
  if (!live) return null;
  const language = current ?? (current = readLanguage());
  return language !== DEFAULT_LANGUAGE && loadedBooks.has(language) ? language : null;
}

/** A text of a screen in the current language: `tr('Check in')`. The text itself when it has no translation yet. Plain function, safe in any render. */
export function tr(text: string): string {
  const language = translatedLanguage();
  return language ? phrase(text, language) : text;
}

/** For a prop that may hold plain text or markup: text is translated, markup is returned as it is. */
export function trn<T>(value: T): T {
  return (typeof value === 'string' ? tr(value) : value) as T;
}

/** A text with values in the current language: `trf('Room {0} of {1}', [room, total])`; the translation may put the values in another order. */
export function trf(template: string, values: readonly (string | number)[]): string {
  return phraseWith(template, values, translatedLanguage() ?? DEFAULT_LANGUAGE);
}

/**
 * Changes whenever the screens must draw their texts again: 'en' while English shows, the language once its phrase book is in. A page puts it in the
 * `key` of its content, so a language change redraws the whole page, also the parts that keep their own state out of the render.
 */
export function useTranslationKey(): string {
  return useSyncExternalStore(
    subscribe,
    () => {
      const language = current ?? readLanguage();
      return live && language !== DEFAULT_LANGUAGE && loadedBooks.has(language) ? language : DEFAULT_LANGUAGE;
    },
    () => DEFAULT_LANGUAGE,
  );
}

/** For tests: forget the in-memory choice and the loaded books. */
export function resetLanguageForTests(): void {
  memory = null;
  current = null;
  live = false;
  loadedBooks.clear();
}

/** For the screen translator (screenTranslator.ts): tells it when the language changes or its phrase book arrives. Returns the way to stop. */
export const onTranslationChange = subscribe;
