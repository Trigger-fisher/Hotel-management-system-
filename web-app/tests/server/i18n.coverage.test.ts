// "Is the whole site translated?" (MJ, 4 Nov 2026). The screens draw many texts without asking tr(): the strings of the shared copy objects, text inside JSX, text
// attributes. The screen translator (src/lib/i18n/screenTranslator.ts) translates every one of them that a phrase book holds, so this test reads the SOURCE of the staff
// and portal screens (scripts/visibleTexts.ts), lists every English text a person can see, and fails when a book of any language lacks one.
// A text that a module translates itself (copyByLanguage / useCopy) or that reads the same in every language is exempt. When a screen gets a new text, add it to the books
// (common/ui-shared/i18n/phrases/<language>/) or this test says which one is missing and in which file.
// Run: npx tsx --import ./src/server/lib/node-hooks/register.ts --test tests/server/i18n.coverage.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { LANGUAGES } from "@shared/i18n/languages";
import { translatedModules } from "@shared/i18n/registry";
import hi from "@shared/i18n/phrases/hi";
import gu from "@shared/i18n/phrases/gu";
import fr from "@shared/i18n/phrases/fr";
import de from "@shared/i18n/phrases/de";
import { scanVisibleTexts } from "../../scripts/visibleTexts";

const leaves = (v: unknown, out: string[] = []): string[] => {
  if (typeof v === "string") out.push(v.replace(/\s+/g, " ").trim());
  else if (Array.isArray(v)) v.forEach((x) => leaves(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => leaves(x, out));
  return out;
};

/** Texts that read the same in every language (a code format, an example, a brand) or are not words a person reads. Reviewed by hand: add here only with a reason. */
const SAME_EVERYWHERE = new Set<string>([]);

const books = { hi, gu, fr, de } as const;

describe("every English text a person can see on the staff and portal screens is in every phrase book", () => {
  const all = scanVisibleTexts();
  const own = new Set(translatedModules.flatMap((m) => leaves(m.words.en)));
  const wanted = all.filter((t) => !own.has(t.text) && !SAME_EVERYWHERE.has(t.text));

  test("the scan itself works: it finds thousands of texts in the shared copy objects and the screens", () => {
    assert.ok(all.length > 3000, `found ${all.length} texts`);
    assert.ok(all.some((t) => t.kind === "copy") && all.some((t) => t.kind === "jsx"), "all kinds are found");
  });

  for (const lang of LANGUAGES.filter((l) => l !== "en")) {
    test(`${lang}: no text is missing`, () => {
      const book = books[lang as keyof typeof books] as Record<string, string>;
      // (the Gujarati book leaves out a text that the Hindi book keeps as it is in English: a brand, a code, "WhatsApp")
      const missing = wanted.filter((t) => !(t.text in book) && !(lang === "gu" && (hi as Record<string, string>)[t.text] === t.text)).map((t) => `${t.files[0]}: ${t.text.slice(0, 90)}`);
      assert.deepEqual(missing.slice(0, 40), [], `${missing.length} texts are missing from the ${lang} book (first 40 shown)`);
    });
  }
});
