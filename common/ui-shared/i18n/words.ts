// draft translation, to be checked by a native speaker (Hindi and Gujarati below)
// The words of the language switch itself. The language NAMES are never translated (languages.ts): each is written in its own script.
import { copyByLanguage, type Widen } from './copy';

export const languageSwitchCopy = {
  label: 'Language',
  /** Accessible name of the group of choices. */
  group: 'Choose the language of the screens',
} as const;

const languageSwitchCopyHi: Widen<typeof languageSwitchCopy> = {
  label: 'भाषा',
  group: 'स्क्रीन की भाषा चुनें',
};

const languageSwitchCopyGu: Widen<typeof languageSwitchCopy> = {
  label: 'ભાષા',
  group: 'સ્ક્રીનની ભાષા પસંદ કરો',
};

const languageSwitchCopyFr: Widen<typeof languageSwitchCopy> = {
  label: 'Langue',
  group: "Choisir la langue de l'affichage",
};

const languageSwitchCopyDe: Widen<typeof languageSwitchCopy> = {
  label: 'Sprache',
  group: 'Sprache der Anzeige wählen',
};

export const languageSwitchCopyByLanguage = copyByLanguage(languageSwitchCopy, languageSwitchCopyHi, languageSwitchCopyGu, languageSwitchCopyFr, languageSwitchCopyDe);
