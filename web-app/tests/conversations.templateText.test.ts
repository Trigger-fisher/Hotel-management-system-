// Unit tests for the template picker's pure helpers (src/dashboards/groups/conversations/templateText.ts): the filled message, its pieces, and a template's language.
// Run with `node --test tests/conversations.templateText.test.ts` (Node's built-in runner; Node strips the TypeScript types).
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { describe, test } from "node:test";

type NextResolve = (specifier: string, context?: unknown) => unknown;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: unknown, next: NextResolve): unknown }): void;
};
const shared = new URL("../../common/ui-shared/", import.meta.url);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@shared/")) return next(new URL(`${specifier.slice("@shared/".length)}.ts`, shared).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const { fillTemplate, insertBlank, langOf, renumberBlanks, templateParts } = await import("../src/dashboards/groups/conversations/templateText.ts");

const TEXT = "Welcome to {{1}}, {{2}}! Your room {{3}} is ready.";
const LABELS = ["Hotel name", "Guest name", "Room"];

describe("the filled message", () => {
  test("values go into their blanks; an empty blank shows its label in brackets, never {{n}}", () => {
    assert.equal(fillTemplate(TEXT, ["Hotel Sunrise", "Asha Rao", "204"]), "Welcome to Hotel Sunrise, Asha Rao! Your room 204 is ready.");
    assert.equal(fillTemplate(TEXT, ["Hotel Sunrise", " ", ""], LABELS), "Welcome to Hotel Sunrise, [Guest name]! Your room [Room] is ready.");
    assert.equal(fillTemplate("Hi {{1}}", []), "Hi {{1}}");
  });
});

describe("the message in pieces", () => {
  test("plain text, filled blanks and empty blanks come out in order, with nothing lost", () => {
    assert.deepEqual(templateParts(TEXT, ["Hotel Sunrise", "", "204"], LABELS), [
      { text: "Welcome to ", kind: "plain" },
      { text: "Hotel Sunrise", kind: "filled" },
      { text: ", ", kind: "plain" },
      { text: "[Guest name]", kind: "missing" },
      { text: "! Your room ", kind: "plain" },
      { text: "204", kind: "filled" },
      { text: " is ready.", kind: "plain" },
    ]);
    assert.deepEqual(templateParts("No blanks here.", []), [{ text: "No blanks here.", kind: "plain" }]);
    assert.deepEqual(templateParts("{{1}}", [], []), [{ text: "{{1}}", kind: "missing" }]);
    assert.equal(templateParts(TEXT, ["A", "B", "C"]).map((p) => p.text).join(""), fillTemplate(TEXT, ["A", "B", "C"]));
  });
});

describe("a template's language", () => {
  test("en_US and en are English; the code is lower-cased", () => {
    assert.equal(langOf({ language: "en_US" }), "en");
    assert.equal(langOf({ language: "HI" }), "hi");
    assert.equal(langOf({ language: "gu" }), "gu");
    assert.equal(langOf({ language: "hinglish" }), "hinglish");
  });
});

describe("blanks numbered for the hotel (5 Nov 2026)", () => {
  test("renumbering follows the order of appearance and keeps each blank's name and sample", () => {
    const r = renumberBlanks("Hello {{2}}, room {{5}} at {{2}}.", [{ index: 2, name: "guest_name", example: "Riya" }, { index: 5, name: "room", example: "204" }, { index: 9, name: "gone", example: "x" }]);
    assert.equal(r.body, "Hello {{1}}, room {{2}} at {{1}}.");
    assert.deepEqual(r.blanks, [{ index: 1, name: "guest_name", example: "Riya" }, { index: 2, name: "room", example: "204" }]);
  });

  test("a blank put in the middle takes its place in the numbering; the cursor lands after it", () => {
    const start = { body: "Hello {{1}}, your room is ready.", blanks: [{ index: 1, name: "guest_name", example: "Riya" }] };
    const at = start.body.indexOf(" is ready");
    const r = insertBlank(start.body, at, start.blanks, "room", "204");
    assert.equal(r.body, "Hello {{1}}, your room {{2}} is ready.");
    assert.equal(r.body.slice(0, r.cursor), "Hello {{1}}, your room {{2}}");
    const first = insertBlank(r.body, "Hello".length, r.blanks, "hotel_name", "Kesar Bagh");
    assert.equal(first.body, "Hello {{1}} {{2}}, your room {{3}} is ready.");
    assert.deepEqual(first.blanks.map((b) => b.name), ["hotel_name", "guest_name", "room"]);
    assert.equal(insertBlank("", 0, [], "guest_name", "Riya").body, "{{1}}");
  });
});
