// draft translation, to be checked by a native speaker
// Hindi and Gujarati for the top notch (notchCopy in ./notchCopy.ts): the notices and announcements that slide in from the top.
import { copyByLanguage, type Widen } from '../i18n/copy';
import { notchCopy } from './notchCopy';

const notchCopyHi: Widen<typeof notchCopy> = {
  announcement: 'घोषणा',
  notice: 'सूचना',
  important: 'ज़रूरी',
  accept: 'ठीक है',
  view: 'देखें',
  close: 'बंद करें',
  more: (n: number) => `और ${n} और`,
  region: 'नए संदेश',
};

const notchCopyGu: Widen<typeof notchCopy> = {
  announcement: 'જાહેરાત',
  notice: 'સૂચના',
  important: 'મહત્વની',
  accept: 'બરાબર',
  view: 'જુઓ',
  close: 'બંધ કરો',
  more: (n: number) => `અને ${n} વધુ`,
  region: 'નવા સંદેશા',
};

export const notchCopyByLanguage = copyByLanguage(notchCopy, notchCopyHi, notchCopyGu);
