// draft translation, to be checked by a native speaker
// The fr phrase book of the staff screens (French): the parts are joined here and loaded only when the language is chosen (web-app/src/lib/i18n/language.ts).
// It follows the Hindi book text for text (phrases/hi/p00..p09); `core` is the 300 most used texts, translated first and checked by hand, and wins where a text is in both.
import type { PhraseBook } from '../phrases';
import core from './fr/core';
import p00 from './fr/p00';
import p01 from './fr/p01';
import p02 from './fr/p02';
import p03 from './fr/p03';
import p04 from './fr/p04';
import p05 from './fr/p05';
import p06 from './fr/p06';
import p07 from './fr/p07';
import p08 from './fr/p08';
import m00 from './fr/m00';
import m01 from './fr/m01';
import m02 from './fr/m02';
import m03 from './fr/m03';
import m04 from './fr/m04';
import m05 from './fr/m05';
import m06 from './fr/m06';
import m07 from './fr/m07';
import m08 from './fr/m08';
import m09 from './fr/m09';

const book: PhraseBook = { ...m00, ...m01, ...m02, ...m03, ...m04, ...m05, ...m06, ...m07, ...m08, ...m09, ...p00, ...p01, ...p02, ...p03, ...p04, ...p05, ...p06, ...p07, ...p08, ...core };
export default book;
