// The ready-made WhatsApp messages (5 Nov 2026): every one, in every language, passes the same checks a hotel's own message passes before it goes to Meta.
// Run: npx tsx --import ./src/server/lib/node-hooks/register.ts --test tests/server/whatsapp.starters.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { QUICK_REPLY_STARTERS, STARTER_LANGUAGES, WHATSAPP_STARTERS, missingQuickReplies, starterByKey, starterDraft, starterSample, variableLabel } from "@shared/dashboards/whatsappStarters";
import { TEMPLATE_BODY_MAX, TEMPLATE_BUTTON_TEXT_MAX, checkTemplate, placeholdersOf } from "@/server/whatsapp/templates";

const LINKS = { directions: "https://maps.example.com/kesar-bagh", review: "https://reviews.example.com/kesar-bagh" };

describe("ready-made WhatsApp messages", () => {
  test("every message in every language passes the template checks, with its buttons", () => {
    for (const s of WHATSAPP_STARTERS) {
      for (const lang of STARTER_LANGUAGES) {
        const d = starterDraft(s, lang, LINKS);
        const checked = checkTemplate(d);
        assert.equal(checked.variables.length, s.variables.length, `${s.key} ${lang}: every blank is used`);
        assert.equal(checked.buttons?.length, s.buttons.length, `${s.key} ${lang}: buttons kept`);
        assert.ok(starterSample(s, lang).length <= TEMPLATE_BODY_MAX, `${s.key} ${lang}: filled text fits`);
        for (const b of s.buttons) assert.ok(b.text[lang].length <= TEMPLATE_BUTTON_TEXT_MAX, `${s.key} ${lang}: button words fit`);
      }
    }
  });

  test("the blanks come in the same order in every language, the hotel's name is in every message, samples fit Meta's 60 characters", () => {
    for (const s of WHATSAPP_STARTERS) {
      const order = placeholdersOf(s.body.en).join(",");
      for (const lang of STARTER_LANGUAGES) assert.equal(placeholdersOf(s.body[lang]).join(","), order, `${s.key} ${lang}`);
      assert.ok(s.variables.some((v) => v.name === "hotel_name"), `${s.key}: names the hotel`);
      for (const v of s.variables) assert.ok(v.example.length > 0 && v.example.length <= 60, `${s.key}: ${v.name}`);
    }
  });

  test("keys are unique and Meta-safe; offers are marketing with STOP, everything else is a service message", () => {
    const keys = WHATSAPP_STARTERS.map((s) => s.key);
    assert.equal(new Set(keys).size, keys.length);
    for (const s of WHATSAPP_STARTERS) {
      assert.match(s.key, /^[a-z0-9_]{1,60}$/);
      if (s.category === "marketing") for (const lang of STARTER_LANGUAGES) assert.match(s.body[lang], /\bSTOP\b/);
      else assert.equal(s.category, "utility", s.key);
    }
  });

  test("ready-made quick replies: every language complete, titles unique and short; only the ones the team lacks are offered", () => {
    for (const lang of STARTER_LANGUAGES) {
      const all = missingQuickReplies(lang, []);
      assert.equal(all.length, QUICK_REPLY_STARTERS.length);
      assert.equal(new Set(all.map((q) => q.title.toLowerCase())).size, all.length, lang);
      for (const q of all) assert.ok(q.title.length > 0 && q.title.length <= 80 && q.body.length > 0 && q.body.length <= 400, `${lang} ${q.title}`);
    }
    const left = missingQuickReplies("en", [{ title: "thank YOU " }, { title: "Something else" }]);
    assert.equal(left.length, QUICK_REPLY_STARTERS.length - 1);
    assert.equal(left.some((q) => q.title === "Thank you"), false);
  });

  test("a link button is left out until the hotel gives its link; plain names for the blanks", () => {
    const pre = starterByKey("pre_arrival");
    assert.ok(pre);
    assert.deepEqual(starterDraft(pre, "en").buttons, []);
    assert.deepEqual(starterDraft(pre, "hi", LINKS).buttons, [{ kind: "url", text: "रास्ता देखें", url: LINKS.directions }]);
    assert.equal(starterDraft(pre, "en").starterKey, "pre_arrival");
    assert.equal(variableLabel("guest_name"), "Guest name");
    assert.equal(variableLabel("Booking number"), "Booking number");
    assert.equal(variableLabel("value_3"), "Value 3");
    assert.equal(starterSample(pre, "en").startsWith("Hello Riya Mehta, we look forward to welcoming you at Kesar Bagh Residency on 12 Nov 2026."), true);
  });
});
