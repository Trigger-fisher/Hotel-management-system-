// The screen translator (MJ, 4 Nov 2026: "the whole site in the language I chose, everywhere"). Many texts of the screens come from the shared copy objects and are written
// into the page without tr(): this watches the page and puts the chosen language's text in place of every English text it knows (the phrase book, with its {0} texts read as
// patterns). Nothing is sent anywhere: the books are HMS's own. English is kept per node, so choosing English (or another language) puts it back / translates from it.
//
//   * text nodes, and the text attributes placeholder / title / aria-label / alt / label, anywhere in the page, also what a screen adds later;
//   * left alone: script, style, textarea, code, an element with translate="no" or class "notranslate", an editable element, an input's value;
//   * a text with no letters (a number, an amount, a date's digits) is never touched.
// No framework in here (a Document and a way to ask the language), so the tests run it on jsdom.
import { phraseAny } from '@shared/i18n/phrases';
import type { Language } from '@shared/i18n/languages';

const TEXT_ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'label'] as const;
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT', 'CODE', 'PRE', 'TITLE']);
const NO_TRANSLATE = '[translate="no"], .notranslate, [contenteditable=""], [contenteditable="true"]';
const SHOW_TEXT = 4;
const ELEMENT = 1;
const TEXT = 3;

export interface ScreenTranslator {
  /** Translate the page now and keep it translated as it changes. */
  start(): void;
  /** Read the language again (it changed, or its phrase book arrived): translate, or put English back. */
  refresh(): void;
  stop(): void;
}

export function createScreenTranslator(doc: Document, language: () => Language | null): ScreenTranslator {
  /** The English of a text node we changed, and what we wrote: when the node still holds what we wrote, the page has not touched it. */
  const english = new WeakMap<Text, string>();
  const written = new WeakMap<Text, string>();
  const attrEnglish = new WeakMap<Element, Map<string, string>>();
  const attrWritten = new WeakMap<Element, Map<string, string>>();
  let observer: MutationObserver | null = null;
  let stopped = false;
  /** The language to translate into right now; null (English, nothing loaded yet, or stopped) puts English back. */
  const current = (): Language | null => (stopped ? null : language());

  const skipped = (el: Element | null): boolean => {
    if (!el) return true;
    if (SKIP_TAGS.has(el.tagName.toUpperCase())) return true;
    return el.closest(NO_TRANSLATE) !== null;
  };
  const hasWords = (s: string): boolean => /[A-Za-z]{2,}/.test(s);

  function doText(node: Text): void {
    const lang = current();
    const now = node.data;
    const mine = written.get(node);
    const untouched = mine !== undefined && now === mine;
    const base = untouched ? (english.get(node) as string) : now;
    if (!lang || !hasWords(base) || skipped(node.parentElement)) {
      if (untouched) {
        node.data = base;
        written.delete(node);
        english.delete(node);
      }
      return;
    }
    const out = phraseAny(base, lang);
    if (out === null || out === base) {
      if (untouched) {
        node.data = base;
        written.delete(node);
        english.delete(node);
      }
      return;
    }
    english.set(node, base);
    written.set(node, out);
    if (node.data !== out) node.data = out;
  }

  function doAttr(el: Element, name: string): void {
    const lang = current();
    const now = el.getAttribute(name);
    if (now === null) return;
    const wrote = attrWritten.get(el)?.get(name);
    const untouched = wrote !== undefined && now === wrote;
    const base = untouched ? (attrEnglish.get(el)?.get(name) as string) : now;
    const put = (value: string): void => {
      if (el.getAttribute(name) !== value) el.setAttribute(name, value);
    };
    const forget = (): void => {
      attrWritten.get(el)?.delete(name);
      attrEnglish.get(el)?.delete(name);
    };
    if (!lang || !hasWords(base) || skipped(el)) {
      if (untouched) {
        put(base);
        forget();
      }
      return;
    }
    const out = phraseAny(base, lang);
    if (out === null || out === base) {
      if (untouched) {
        put(base);
        forget();
      }
      return;
    }
    if (!attrEnglish.has(el)) attrEnglish.set(el, new Map());
    if (!attrWritten.has(el)) attrWritten.set(el, new Map());
    attrEnglish.get(el)?.set(name, base);
    attrWritten.get(el)?.set(name, out);
    put(out);
  }

  function walk(root: Node): void {
    if (root.nodeType === TEXT) {
      doText(root as Text);
      return;
    }
    if (root.nodeType !== ELEMENT && root.nodeType !== 9 /* document */ && root.nodeType !== 11 /* fragment */) return;
    const tree = doc.createTreeWalker(root, SHOW_TEXT);
    const texts: Text[] = [];
    for (let n = tree.nextNode(); n; n = tree.nextNode()) texts.push(n as Text);
    texts.forEach(doText);
    const elements: Element[] = [];
    if (root.nodeType === ELEMENT) elements.push(root as Element);
    const scope = root as ParentNode;
    if (typeof scope.querySelectorAll === 'function') scope.querySelectorAll(TEXT_ATTRS.map((a) => `[${a}]`).join(',')).forEach((e) => elements.push(e));
    for (const el of elements) for (const a of TEXT_ATTRS) if (el.hasAttribute(a)) doAttr(el, a);
  }

  function onMutations(list: MutationRecord[]): void {
    for (const m of list) {
      if (m.type === 'childList') m.addedNodes.forEach((n) => walk(n));
      else if (m.type === 'characterData') doText(m.target as Text);
      else if (m.type === 'attributes' && m.attributeName) doAttr(m.target as Element, m.attributeName);
    }
  }

  return {
    start() {
      stopped = false;
      const view = doc.defaultView;
      if (!observer && view && doc.body) {
        observer = new view.MutationObserver(onMutations);
        observer.observe(doc.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...TEXT_ATTRS] });
      }
      if (doc.body) walk(doc.body);
    },
    refresh() {
      if (doc.body) walk(doc.body);
    },
    stop() {
      observer?.disconnect();
      observer = null;
      // put English back everywhere, and stay out of the page from now on
      stopped = true;
      if (doc.body) walk(doc.body);
    },
  };
}
