// The phrase books of the whole app (MJ, 3 Nov 2026: "when I change the language it changes the entire app"): the lookup, the two books, and that every text
// a screen asks for with tr('...') or trf('...') has its Hindi and Gujarati.
// Run: npx tsx --import ./src/server/lib/node-hooks/register.ts --test tests/server/i18n.phrases.test.ts
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";

import { clearPhraseBooksForTests, phrase, phraseKey, phraseWith, setPhraseBook } from "@shared/i18n/phrases";
import hi from "@shared/i18n/phrases/hi";
import gu from "@shared/i18n/phrases/gu";
import fr from "@shared/i18n/phrases/fr";
import de from "@shared/i18n/phrases/de";
import frCore from "@shared/i18n/phrases/fr/core";
import deCore from "@shared/i18n/phrases/de/core";

// Texts that read the same in every language: times, ports, brand names, examples of an address, a keyboard key, a code format.
const SAME_EVERYWHERE = new Set([
  "","11:00 AM", "12:00 PM", "143 (STARTTLS)", "993 (SSL/TLS)", "<", ">", "Cr", "Dr", "Ctrl", "Ctrl K", "Esc", "FY 0000-00", "Facebook", "Instagram",
  "HMS", "HTTPS", "ID", "KB)", "PM", "e.g. 24AAACC1206D1ZM", "e.g. CP", "email@example.com", "https://maps.app.goo.gl/...", "imap.example.com",
  "mail.example.com", "mail@yourdomain.in", "name@example.com", "name@gmail.com", "smtp.example.com", "smtp.gmail.com", "www.thehotel.in",
  "{{gm_phone}}", "{{reference}}", "·", "WhatsApp", "SMS", "GST", "GST (CGST + SGST)", "GSTIN", "Google:", "SES:", "Google Business Profile",
]);

const SRC = join(__dirname, "..", "..", "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** Every text written as the only argument (the template, for trf) of tr('...') and trf('...', ...) in the app's source. */
function askedTexts(): Map<string, string> {
  const found = new Map<string, string>();
  const re = /\btrf?\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
  for (const file of walk(SRC)) {
    if (file.includes(join("lib", "i18n"))) continue; // the mechanism itself: its comments show examples
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(re)) {
      const raw = m[1];
      let text: string;
      try {
        text = raw[0] === '"' ? (JSON.parse(raw) as string) : (JSON.parse(`"${raw.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"')}"`) as string);
      } catch {
        continue;
      }
      found.set(phraseKey(text), file.slice(SRC.length + 1));
    }
  }
  return found;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort().join(",");

afterEach(() => clearPhraseBooksForTests());

describe("the lookup", () => {
  test("English, an unknown language and a missing phrase give the text itself", () => {
    setPhraseBook("hi", { Save: "सहेजें" });
    assert.equal(phrase("Save", "en"), "Save");
    assert.equal(phrase("Save", "fr"), "Save");
    assert.equal(phrase("Cancel", "hi"), "Cancel");
    assert.equal(phrase("Save", "hi"), "सहेजें");
  });

  test("spaces inside the text do not matter, and the spaces around it stay", () => {
    setPhraseBook("gu", { "Check in": "ચેક-ઇન" });
    assert.equal(phrase("  Check\n   in ", "gu"), "  ચેક-ઇન ");
  });

  test("values go where the translation puts them", () => {
    setPhraseBook("hi", { "Room {0} of {1}": "{1} में से कमरा {0}" });
    assert.equal(phraseWith("Room {0} of {1}", [3, 10], "hi"), "10 में से कमरा 3");
    assert.equal(phraseWith("Room {0} of {1}", [3, 10], "en"), "Room 3 of 10");
    assert.equal(phraseWith("Hello {0} {2}", ["a"], "en"), "Hello a {2}", "a value that was not passed stays as written");
  });
});

describe("the two books", () => {
  test("no translation is empty, and the values {0} {1} are the same as in the English text", () => {
    for (const [name, book] of [["hi", hi], ["gu", gu]] as const) {
      for (const [en, tr] of Object.entries(book)) {
        assert.ok(tr.trim().length > 0, `${name}: ${en}`);
        assert.equal(placeholders(tr), placeholders(en), `${name}: values of "${en}"`);
        assert.equal(phraseKey(en), en, `${name}: the key is written trimmed, one space between words: "${en}"`);
      }
    }
  });

  test("Gujarati has every text Hindi has, except the ones that stay as they are in English", () => {
    for (const [en, tr] of Object.entries(hi)) if (!(en in gu)) assert.equal(tr, en, `Gujarati is missing: ${en}`);
    // (a text that is the same as the English in Hindi is left out of Gujarati too)
    for (const en of Object.keys(gu)) assert.ok(en in hi, `Hindi is missing: ${en}`);
  });

  test("a Hindi text is Hindi (Devanagari) and a Gujarati text is Gujarati, unless it is the same as the English", () => {
    const lacks = (script: RegExp, book: Record<string, string>) =>
      Object.entries(book).filter(([en, tr]) => tr !== en && !script.test(tr)).map(([en]) => en);
    assert.deepEqual(lacks(/[ऀ-ॿ]/, hi), []);
    assert.deepEqual(lacks(/[઀-૿]/, gu), []);
  });
});

describe("the French and German books (every text of the Hindi book)", () => {
  test("every text in them is a text of the Hindi book, not empty, with the same {0} values and a trimmed key", () => {
    for (const [name, book] of [["fr", fr], ["de", de]] as const) {
      assert.ok(Object.keys(book).length >= 3000, `${name}: the book has ${Object.keys(book).length} texts`);
      for (const [en, text] of Object.entries(book)) {
        assert.ok(en in hi, `${name}: "${en}" is not a text of the screens' books`);
        assert.ok(text.trim().length > 0, `${name}: ${en}`);
        assert.equal(placeholders(text), placeholders(en), `${name}: values of "${en}"`);
        assert.equal(phraseKey(en), en, `${name}: the key is written trimmed: "${en}"`);
      }
    }
  });
  test("both books hold exactly the texts the Hindi book holds", () => {
    assert.deepEqual(Object.keys(fr).sort(), Object.keys(hi).sort());
    assert.deepEqual(Object.keys(de).sort(), Object.keys(hi).sort());
  });
  test("a text left in English must be one that reads the same (the 300 hand-checked ones), and few of the rest are", () => {
    const SAME = new Set(["Email", "Hotel", "Hotels", "Instruction", "Mobile", "Name", "Status", "Total", "Date", "Action", "Actions", "Mode", "Source", "Type", "Notes", "Photos", "System", "GSTIN", "WhatsApp", "· GSTIN", "Guest GSTIN", "Bonus", "Description", "Details", "Reference", "Kind", "No", "Plan", "Rates", "Category", "Account", "Cancel", "Check-in", "Check out", "Check in", "Check-out", "S.No.", "Message", "Open", "Result", "optional", "(optional)"]);
    for (const [name, core] of [["fr", frCore], ["de", deCore]] as const) {
      const unchanged = Object.entries(core).filter(([en, text]) => text === en && !SAME.has(en) && !SAME_EVERYWHERE.has(en)).map(([en]) => en);
      assert.deepEqual(unchanged, [], `${name}: left in English`);
    }
    for (const [name, book] of [["fr", fr], ["de", de]] as const) {
      const unchanged = Object.entries(book).filter(([en, text]) => text === en).length;
      // brands, codes and words that read the same stay as they are (a few percent); more than that means a part was skipped
      assert.ok(unchanged <= Object.keys(book).length * 0.04, `${name}: ${unchanged} of ${Object.keys(book).length} texts are still English (a part was probably skipped)`);
      assert.ok(Object.values(book).every((t) => !/[\u0900-\u0dff]/.test(t)), `${name}: a text holds Indian script`);
    }
  });
  test("the lookup answers in French and German through the same function", () => {
    setPhraseBook("fr", fr);
    setPhraseBook("de", de);
    assert.equal(phrase("Save", "fr"), "Enregistrer");
    assert.equal(phrase("Save", "de"), "Speichern");
    assert.equal(phraseWith("Delete {0}?", ["la chambre 4"], "fr"), "Supprimer la chambre 4 ?");
    assert.equal(phrase("Some text that has no translation", "fr"), "Some text that has no translation");
  });
});

describe("the screens", () => {
  test("every text a screen asks for with tr() or trf() is in all four books", () => {
    const asked = askedTexts();
    assert.ok(asked.size > 1500, `found ${asked.size} texts: the scan itself is broken`);
    const missing = (book: Record<string, string>) => [...asked].filter(([text]) => !(text in book) && !SAME_EVERYWHERE.has(text)).map(([text, file]) => `${file}: ${text}`);
    assert.deepEqual(missing(hi), [], "Hindi is missing these texts");
    assert.deepEqual(missing(gu), [], "Gujarati is missing these texts");
    assert.deepEqual(missing(fr), [], "French is missing these texts");
    assert.deepEqual(missing(de), [], "German is missing these texts");
  });
});
