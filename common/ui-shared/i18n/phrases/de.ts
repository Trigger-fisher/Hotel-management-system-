// draft translation, to be checked by a native speaker
// The de phrase book of the staff screens (German): the parts are joined here and loaded only when the language is chosen (web-app/src/lib/i18n/language.ts).
// It follows the Hindi book text for text (phrases/hi/p00..p09); `core` is the 300 most used texts, translated first and checked by hand, and wins where a text is in both.
import type { PhraseBook } from '../phrases';
import core from './de/core';
import p00 from './de/p00';
import p01 from './de/p01';
import p02 from './de/p02';
import p03 from './de/p03';
import p04 from './de/p04';
import p05 from './de/p05';
import p06 from './de/p06';
import p07 from './de/p07';
import p08 from './de/p08';
import m00 from './de/m00';
import m01 from './de/m01';
import m02 from './de/m02';
import m03 from './de/m03';
import m04 from './de/m04';
import m05 from './de/m05';
import m06 from './de/m06';
import m07 from './de/m07';
import m08 from './de/m08';
import m09 from './de/m09';

const book: PhraseBook = { ...m00, ...m01, ...m02, ...m03, ...m04, ...m05, ...m06, ...m07, ...m08, ...m09, ...p00, ...p01, ...p02, ...p03, ...p04, ...p05, ...p06, ...p07, ...p08, ...core };
export default book;
