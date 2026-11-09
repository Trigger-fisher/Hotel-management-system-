// The four WhatsApp languages (4 Nov 2026): English, Hinglish, Hindi, Gujarati. What a guest's words say about their language, what HMS says by itself in each, the label limits of WhatsApp, and how a Hinglish
// message is named and sent to Meta. Run: npx tsx --import ./src/server/lib/node-hooks/register.ts --test tests/server/whatsapp.language.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { BUTTON_TITLE_MAX, LIST_BUTTON_MAX, ROW_TITLE_MAX } from "@/server/whatsapp/interactive";
import { detectLanguage, isLanguage, LANGUAGES, metaLanguageCode, SYSTEM_TEXTS, textsFor } from "@/server/whatsapp/language";
import { checkTemplate } from "@/server/whatsapp/templates";

describe("telling a guest's language from their words", () => {
  test("a Gujarati letter is Gujarati, a Devanagari letter Hindi, Hindi words in English letters Hinglish, other English letters English; too little is unknown", () => {
    assert.equal(detectLanguage("મને રૂમ જોઈએ છે"), "gu");
    assert.equal(detectLanguage("मुझे एक कमरा चाहिए"), "hi");
    assert.equal(detectLanguage("mujhe ek room chahiye"), "hinglish");
    assert.equal(detectLanguage("kya breakfast included hai?"), "hinglish");
    assert.equal(detectLanguage("Is breakfast included in the room rate?"), "en");
    assert.equal(detectLanguage("do you have a double room"), "en", "one ordinary word is not Hinglish");
    assert.equal(detectLanguage("ok"), null);
    assert.equal(detectLanguage("🙏"), null);
    assert.equal(detectLanguage(""), null);
    assert.equal(detectLanguage(null), null);
  });

  test("the guest's own words win; otherwise the Super Admin's default is used", () => {
    assert.equal(textsFor("मुझे कमरा चाहिए", "gu").language, "hi");
    assert.equal(textsFor("ok", "gu").language, "gu");
    assert.equal(textsFor(null).language, "en");
    assert.equal(textsFor("STOP", "hinglish").t.stopped.startsWith("Ab aapko"), true);
  });
});

describe("what HMS says by itself", () => {
  test("every language has every text, none is empty, the redirect carries the number, and the labels fit WhatsApp's limits", () => {
    for (const language of LANGUAGES) {
      const t = SYSTEM_TEXTS[language];
      for (const [key, value] of Object.entries(t)) if (typeof value === "string") assert.ok(value.trim().length > 0, `${language}.${key}`);
      assert.ok(t.redirect("919825012345").includes("https://wa.me/919825012345"), language);
      assert.ok(Array.from(t.wrongButton).length <= BUTTON_TITLE_MAX, `${language} wrongButton`);
      assert.ok(Array.from(t.chooseHotel).length <= LIST_BUTTON_MAX, `${language} chooseHotel`);
      assert.ok(Array.from(t.otherHotel).length <= ROW_TITLE_MAX && Array.from(t.hotelsSection).length <= ROW_TITLE_MAX, `${language} list labels`);
      // STOP and START must still be named in the words the guest has to type
      assert.ok(t.stopped.includes("START") && t.started.includes("STOP"), `${language} keywords`);
    }
    assert.deepEqual(LANGUAGES.map((l) => isLanguage(l)), [true, true, true, true]);
    assert.equal(isLanguage("fr"), false);
  });
});

describe("Hinglish messages", () => {
  const draft = { name: "booking_confirmed", language: "hinglish", category: "utility" as const, body: "Namaste {{1}}, aapki booking {{2}} ke liye confirm ho gayi hai. Hum aapka swagat karenge.", variables: [{ index: 1, name: "guest_name", example: "Asha" }, { index: 2, name: "check_in", example: "12 Nov" }] };
  test("a message may be written in Hinglish, Hindi or Gujarati; Hinglish goes to Meta as English; an unknown language is refused", () => {
    for (const language of ["en", "hinglish", "hi", "gu"]) assert.equal(checkTemplate({ ...draft, language }).language, language);
    assert.throws(() => checkTemplate({ ...draft, language: "klingon" }));
    assert.deepEqual(["en", "hinglish", "hi", "gu"].map(metaLanguageCode), ["en", "en", "hi", "gu"]);
  });
});
