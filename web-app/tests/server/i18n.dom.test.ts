// The screen translator (lib/i18n/screenTranslator.ts) on a real DOM (jsdom): every English text of the page that the phrase book knows is put in the chosen language,
// also what the page adds or changes later, with the page's own English kept so English (or another language) can be put back. Texts with values are read as patterns.
// Run: npx tsx --import ./src/server/lib/node-hooks/register.ts --test tests/server/i18n.dom.test.ts
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { JSDOM } from "jsdom";

import type { Language } from "@shared/i18n/languages";
import { clearPhraseBooksForTests, phraseAny, setPhraseBook } from "@shared/i18n/phrases";
import { createScreenTranslator } from "../../src/lib/i18n/screenTranslator";

const HI = {
  "Cash flow": "नकद प्रवाह",
  "Mark as done": "पूरा हुआ चिह्नित करें",
  "Search": "खोजें",
  "{0} of {1} rooms in service": "{1} में से {0} कमरे चालू",
  "Nobody new in {0}": "{0} में कोई नया नहीं",
  "{0} days": "{0} दिन",
  "Save": "सहेजें",
};
const FR = { "Cash flow": "Flux de trésorerie", "{0} of {1} rooms in service": "{0} chambres sur {1} en service", "Save": "Enregistrer" };
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function page(html: string): { doc: Document; set: (l: Language | null) => void; translator: ReturnType<typeof createScreenTranslator> } {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
  let lang: Language | null = null;
  const translator = createScreenTranslator(dom.window.document, () => lang);
  return { doc: dom.window.document, set: (l) => { lang = l; translator.refresh(); }, translator };
}

afterEach(() => clearPhraseBooksForTests());

describe("phraseAny: a text drawn without tr()", () => {
  test("the exact text, then the book's {0} texts as patterns; the spaces around stay; no translation gives null", () => {
    setPhraseBook("hi", HI);
    assert.equal(phraseAny("Cash flow", "hi"), "नकद प्रवाह");
    assert.equal(phraseAny("  Cash   flow \n", "hi"), "  नकद प्रवाह \n");
    assert.equal(phraseAny("1 of 4 rooms in service", "hi"), "4 में से 1 कमरे चालू");
    assert.equal(phraseAny("Nobody new in Nov 2026", "hi"), "Nov 2026 में कोई नया नहीं");
    assert.equal(phraseAny("30 days", "hi"), "30 दिन");
    assert.equal(phraseAny("Something no book holds", "hi"), null);
    assert.equal(phraseAny("Cash flow", "en"), null);
    assert.equal(phraseAny("Cash flow", "fr"), null, "a language whose book is not in gives nothing");
  });
  test("a pattern with little fixed text never rewrites the middle of a sentence", () => {
    setPhraseBook("hi", { "{0} open {1}": "{0} खुले {1}", "{0} and {1}": "{0} और {1}", "Every room at a glance. Tap a room.": "हर कमरा एक नज़र में।" });
    assert.equal(phraseAny("Click a room to check a guest in, open their account, or change its state.", "hi"), null);
    assert.equal(phraseAny("Errors and refusals", "hi"), null);
  });
  test("a number and words are translated from the words: 7 rooms, 2 persons, 1 night, and the same words in another capital", () => {
    setPhraseBook("hi", { Rooms: "कमरे", Persons: "व्यक्ति", Night: "रात", entries: "प्रविष्टियाँ", Room: "कमरा" });
    assert.equal(phraseAny("7 rooms", "hi"), "7 कमरे");
    assert.equal(phraseAny("2 persons", "hi"), "2 व्यक्ति");
    assert.equal(phraseAny("1 night", "hi"), "1 रात");
    assert.equal(phraseAny("10 entries", "hi"), "10 प्रविष्टियाँ");
    assert.equal(phraseAny("Room 102", "hi"), "कमरा 102");
    assert.equal(phraseAny("rooms", "hi"), "कमरे");
    assert.equal(phraseAny("7 gadgets", "hi"), null);
  });
  test("a text the page mixed from pieces: the English runs the book knows are translated, the rest stays", () => {
    setPhraseBook("hi", { entries: "प्रविष्टियाँ", Rooms: "कमरे" });
    assert.equal(phraseAny("आज 10 entries", "hi"), "आज 10 प्रविष्टियाँ");
    assert.equal(phraseAny("आज 10 widgets", "hi"), null);
  });
  test("a text that is only values is never read as a pattern", () => {
    setPhraseBook("hi", { "{0}": "x", "{0} {1}": "y", "{0} ·": "z" });
    assert.equal(phraseAny("anything at all", "hi"), null);
  });
  test("the most specific pattern wins", () => {
    setPhraseBook("hi", { "{0} rooms": "A {0}", "{0} of {1} rooms": "B {0} {1}" });
    assert.equal(phraseAny("1 of 4 rooms", "hi"), "B 1 4");
  });
});

describe("the screen translator on a page", () => {
  test("text, text with values and text attributes are translated; numbers and unknown text are left alone", () => {
    setPhraseBook("hi", HI);
    const { doc, set } = page(`<h2>Cash flow</h2><p id="v">1 of 4 rooms in service</p><p id="n">₹1,200.00</p><p id="u">A guest note nobody translated</p><input placeholder="Search" value="Save"><button title="Save" aria-label="Mark as done">Save</button>`);
    set("hi");
    assert.equal(doc.querySelector("h2")!.textContent, "नकद प्रवाह");
    assert.equal(doc.getElementById("v")!.textContent, "4 में से 1 कमरे चालू");
    assert.equal(doc.getElementById("n")!.textContent, "₹1,200.00");
    assert.equal(doc.getElementById("u")!.textContent, "A guest note nobody translated");
    const input = doc.querySelector("input")!;
    assert.equal(input.getAttribute("placeholder"), "खोजें");
    assert.equal(input.getAttribute("value"), "Save", "an input's value is the person's, never translated");
    const button = doc.querySelector("button")!;
    assert.deepEqual([button.textContent, button.getAttribute("title"), button.getAttribute("aria-label")], ["सहेजें", "सहेजें", "पूरा हुआ चिह्नित करें"]);
  });

  test("English is put back, and another language is translated from the English (not from the first translation)", () => {
    setPhraseBook("hi", HI);
    setPhraseBook("fr", FR);
    const { doc, set } = page(`<h2>Cash flow</h2><p>1 of 4 rooms in service</p><input placeholder="Search">`);
    set("hi");
    assert.equal(doc.querySelector("h2")!.textContent, "नकद प्रवाह");
    set("fr");
    assert.equal(doc.querySelector("h2")!.textContent, "Flux de trésorerie");
    assert.equal(doc.querySelector("p")!.textContent, "1 chambres sur 4 en service");
    assert.equal(doc.querySelector("input")!.getAttribute("placeholder"), "Search", "French has no text for it: back to English");
    set(null);
    assert.equal(doc.querySelector("h2")!.textContent, "Cash flow");
    assert.equal(doc.querySelector("p")!.textContent, "1 of 4 rooms in service");
  });

  test("what the page adds or changes later is translated too; a translation the page did not touch is not translated twice", async () => {
    setPhraseBook("hi", HI);
    const { doc, set, translator } = page(`<div id="root"><p id="a">Save</p></div>`);
    translator.start();
    set("hi");
    await tick();
    const root = doc.getElementById("root")!;
    const added = doc.createElement("p");
    added.textContent = "Cash flow";
    root.appendChild(added);
    await tick();
    assert.equal(added.textContent, "नकद प्रवाह");
    // the page writes new English into a node it owns (a counter, a status): it is translated again
    const a = doc.getElementById("a")!.firstChild as Text;
    assert.equal(a.data, "सहेजें");
    a.data = "Mark as done";
    await tick();
    assert.equal(a.data, "पूरा हुआ चिह्नित करें");
    // a text added with its translation-looking content is not changed
    const hindi = doc.createElement("p");
    hindi.textContent = "सहेजें";
    root.appendChild(hindi);
    await tick();
    assert.equal(hindi.textContent, "सहेजें");
    translator.stop();
    assert.equal(added.textContent, "Cash flow", "stop puts English back");
  });

  test("script, style, textarea, code, translate=\"no\", notranslate and editable text are left alone", () => {
    setPhraseBook("hi", HI);
    const { doc, set } = page(`<textarea>Save</textarea><code>Save</code><pre>Save</pre><div translate="no"><span>Save</span></div><div class="notranslate"><b>Save</b></div><div contenteditable="true">Save</div><p id="ok">Save</p>`);
    set("hi");
    assert.equal(doc.getElementById("ok")!.textContent, "सहेजें");
    for (const sel of ["textarea", "code", "pre", "[translate=no] span", ".notranslate b", "[contenteditable]"]) assert.equal(doc.querySelector(sel)!.textContent, "Save", sel);
  });

  test("a language whose book has not arrived (null) leaves the page in English", () => {
    setPhraseBook("hi", HI);
    const { doc, set } = page(`<h2>Cash flow</h2>`);
    set(null);
    assert.equal(doc.querySelector("h2")!.textContent, "Cash flow");
  });
});
