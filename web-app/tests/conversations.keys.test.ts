// Unit tests for the Conversations list's pure helpers (src/dashboards/groups/conversations/listKeys.ts, decision 66): the listbox keyboard (Up, Down, Home, End,
// Enter), the live announcement after a poll (the name only, never the message), the avatar's letters and the row's time.
// Run with `node --test tests/*.test.ts` (Node's built-in runner; Node strips the TypeScript types).
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { describe, test } from "node:test";

// The app writes extensionless relative imports and the @shared alias (bundler style); plain Node needs the path and the extension.
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

const { initialsOf, listKeyStep, newInboundAnnouncements, whenLabel } = await import("../src/dashboards/groups/conversations/listKeys.ts");

describe("the list's keyboard", () => {
  test("Up and Down move one row and stop at the ends; Home and End jump; Enter and Space open the focused row", () => {
    assert.deepEqual(listKeyStep(0, 5, "ArrowDown"), { active: 1, open: false });
    assert.deepEqual(listKeyStep(4, 5, "ArrowDown"), { active: 4, open: false });
    assert.deepEqual(listKeyStep(2, 5, "ArrowUp"), { active: 1, open: false });
    assert.deepEqual(listKeyStep(0, 5, "ArrowUp"), { active: 0, open: false });
    assert.deepEqual(listKeyStep(3, 5, "Home"), { active: 0, open: false });
    assert.deepEqual(listKeyStep(1, 5, "End"), { active: 4, open: false });
    assert.deepEqual(listKeyStep(2, 5, "Enter"), { active: 2, open: true });
    assert.deepEqual(listKeyStep(2, 5, " "), { active: 2, open: true });
  });

  test("other keys are not the list's, an empty list does nothing, and a focus out of range comes back inside", () => {
    assert.equal(listKeyStep(1, 5, "a"), null);
    assert.equal(listKeyStep(1, 5, "Tab"), null);
    assert.equal(listKeyStep(0, 0, "ArrowDown"), null);
    assert.deepEqual(listKeyStep(-1, 3, "ArrowDown"), { active: 1, open: false });
    assert.deepEqual(listKeyStep(9, 3, "Enter"), { active: 2, open: true });
  });
});

describe("the live announcement", () => {
  const row = (id: string, name: string, unread: number, lastAt: string, lastDirection: "in" | "out" = "in") => ({ id, name, unread, lastAt, lastDirection });

  test("names who wrote and how many messages came, never what they said", () => {
    const before = [row("a", "Asha Rao", 1, "2026-10-24T09:00:00Z"), row("b", "Ravi Shah", 0, "2026-10-24T08:00:00Z", "out")];
    const after = [row("a", "Asha Rao", 3, "2026-10-24T09:10:00Z"), row("b", "Ravi Shah", 1, "2026-10-24T09:05:00Z"), row("c", "+91 98765 01234", 1, "2026-10-24T09:06:00Z")];
    assert.deepEqual(newInboundAnnouncements(before, after), ["2 new messages from Asha Rao", "1 new message from Ravi Shah", "1 new message from +91 98765 01234"]);
  });

  test("nothing new, a read conversation, or the hotel's own reply says nothing", () => {
    const before = [row("a", "Asha Rao", 2, "2026-10-24T09:00:00Z")];
    assert.deepEqual(newInboundAnnouncements(before, before), []);
    assert.deepEqual(newInboundAnnouncements(before, [row("a", "Asha Rao", 0, "2026-10-24T09:00:00Z")]), []);
    assert.deepEqual(newInboundAnnouncements(before, [row("a", "Asha Rao", 2, "2026-10-24T09:30:00Z", "out")]), []);
    // a newer message the team already read elsewhere still counts once
    assert.deepEqual(newInboundAnnouncements([row("a", "Asha Rao", 0, "2026-10-24T09:00:00Z")], [row("a", "Asha Rao", 0, "2026-10-24T09:30:00Z")]), ["1 new message from Asha Rao"]);
  });
});

describe("the row's letters and time", () => {
  test("two letters of the name, '#' for a number", () => {
    assert.equal(initialsOf("Asha Rao"), "AR");
    assert.equal(initialsOf("Google Business Profile"), "GB");
    assert.equal(initialsOf("Meera"), "ME");
    assert.equal(initialsOf("+91 98765 01234"), "#");
  });

  test("the clock for today, the weekday within the week, else the date (IST)", () => {
    const now = Date.parse("2026-10-24T10:00:00Z"); // 3:30 pm IST, Saturday
    assert.equal(whenLabel("2026-10-24T04:00:00Z", now), "9:30 am");
    assert.equal(whenLabel("2026-10-22T04:00:00Z", now), "Thu");
    assert.equal(whenLabel("2026-10-01T04:00:00Z", now), "01 Oct 2026");
  });
});
