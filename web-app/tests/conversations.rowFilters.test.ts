// Unit tests for the filter bar's pure helpers (src/dashboards/groups/conversations/rowFilters.ts): any value inside a group, every group together, the 24-hour window, whose turn it is,
// and the operator chips of a search text.
// Run with `node --test tests/conversations.rowFilters.test.ts` (Node's built-in runner; Node strips the TypeScript types).
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

const { countChosen, matchesFilters, searchChips } = await import("../src/dashboards/groups/conversations/rowFilters.ts");

const NOW = Date.parse("2026-11-01T12:00:00Z");
const row = (over: Record<string, unknown> = {}) =>
  ({ id: "1", name: "Rahul", lastAt: "2026-11-01T09:00:00Z", lastDirection: "in", waiting: true, assignedTo: null, linked: false, unverified: false, windowMinutes: 600, ...over }) as never;

describe("the filter test", () => {
  test("no choice lets every row through, and an empty group does not filter", () => {
    assert.equal(matchesFilters(row(), {}, "me", NOW), true);
    assert.equal(matchesFilters(row(), { owner: [] }, "me", NOW), true);
  });

  test("any value inside a group is enough, every group must pass", () => {
    const mine = row({ assignedTo: { id: "me", name: "Me" } });
    assert.equal(matchesFilters(mine, { owner: ["me", "unassigned"] }, "me", NOW), true);
    assert.equal(matchesFilters(row(), { owner: ["me"] }, "me", NOW), false);
    assert.equal(matchesFilters(mine, { owner: ["me"], turn: ["guest"] }, "me", NOW), false);
    assert.equal(matchesFilters(mine, { owner: ["me"], turn: ["us"] }, "me", NOW), true);
  });

  test("owner: me, someone else, unassigned", () => {
    const other = row({ assignedTo: { id: "anita", name: "Anita" } });
    assert.equal(matchesFilters(other, { owner: ["others"] }, "me", NOW), true);
    assert.equal(matchesFilters(other, { owner: ["me"] }, "me", NOW), false);
    assert.equal(matchesFilters(row(), { owner: ["unassigned"] }, "me", NOW), true);
  });

  test("the 24-hour window: open, closing soon (under 3 hours), closed; a chat without one never matches", () => {
    assert.equal(matchesFilters(row({ windowMinutes: 600 }), { window: ["open"] }, "me", NOW), true);
    assert.equal(matchesFilters(row({ windowMinutes: 90 }), { window: ["closing"] }, "me", NOW), true);
    assert.equal(matchesFilters(row({ windowMinutes: 90 }), { window: ["open"] }, "me", NOW), false);
    assert.equal(matchesFilters(row({ windowMinutes: 0 }), { window: ["closed"] }, "me", NOW), true);
    assert.equal(matchesFilters(row({ windowMinutes: null }), { window: ["open", "closing", "closed"] }, "me", NOW), false);
  });

  test("whose turn it is, how old, and linked to a booking", () => {
    assert.equal(matchesFilters(row({ waiting: false, lastDirection: "out" }), { turn: ["guest"] }, "me", NOW), true);
    assert.equal(matchesFilters(row(), { turn: ["guest"] }, "me", NOW), false);
    assert.equal(matchesFilters(row({ lastAt: "2026-10-20T09:00:00Z" }), { when: ["older"] }, "me", NOW), true);
    assert.equal(matchesFilters(row(), { when: ["today"] }, "me", NOW), true);
    assert.equal(matchesFilters(row({ linked: true }), { link: ["linked"] }, "me", NOW), true);
    assert.equal(matchesFilters(row({ linked: true }), { link: ["unlinked"] }, "me", NOW), false);
  });

  test("countChosen adds the values of every group", () => {
    assert.equal(countChosen({ owner: ["me", "others"], turn: ["us"], window: [] }), 3);
  });
});

describe("the chips of a search text", () => {
  test("only operator words become chips, and each knows the text left without it", () => {
    assert.deepEqual(searchChips("invoice is:unread from:rahul"), [
      { token: "is:unread", rest: "invoice from:rahul" },
      { token: "from:rahul", rest: "invoice is:unread" },
    ]);
    assert.deepEqual(searchChips("just words"), []);
    assert.deepEqual(searchChips("  "), []);
  });
});
