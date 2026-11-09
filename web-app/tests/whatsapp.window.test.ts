// Unit tests for windowOf (ui-shared/dashboards/whatsapp.ts, decision 66): WhatsApp's 24-hour window from the guest's last message, shared by the mock and the future
// Meta adapter. Open while less than 24 hours have passed, "closing soon" in its last 2 hours, closed after; never open when the guest never wrote.
// Run with `node --test tests/*.test.ts` (Node's built-in runner; Node strips the TypeScript types).
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { describe, test } from "node:test";

type NextResolve = (specifier: string, context?: unknown) => unknown;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: unknown, next: NextResolve): unknown }): void;
};
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const { windowOf } = await import("../../common/ui-shared/dashboards/whatsapp");

const MIN = 60_000;
const HOUR = 60 * MIN;
const last = Date.parse("2026-10-24T06:00:00.000Z");

describe("windowOf", () => {
  test("open, with the hours left, right after the guest wrote", () => {
    const w = windowOf(new Date(last).toISOString(), last + HOUR);
    assert.deepEqual(w, { open: true, closesAt: "2026-10-25T06:00:00.000Z", minutesLeft: 23 * 60, closingSoon: false });
  });

  test("closing soon only below 2 hours: exactly 2 hours left is not yet, 119 minutes is", () => {
    assert.equal(windowOf(new Date(last), last + 22 * HOUR).closingSoon, false);
    const soon = windowOf(new Date(last), last + 22 * HOUR + MIN);
    assert.deepEqual([soon.open, soon.minutesLeft, soon.closingSoon], [true, 119, true]);
    const lastMinute = windowOf(new Date(last), last + 24 * HOUR - 30_000);
    assert.deepEqual([lastMinute.open, lastMinute.minutesLeft, lastMinute.closingSoon], [true, 0, true]);
  });

  test("closed at 24 hours and after, with the time it closed", () => {
    assert.deepEqual(windowOf(new Date(last), last + 24 * HOUR), { open: false, closesAt: "2026-10-25T06:00:00.000Z", minutesLeft: 0, closingSoon: false });
    assert.equal(windowOf(new Date(last).toISOString(), new Date(last + 3 * 24 * HOUR)).open, false);
  });

  test("never open when the guest never wrote (or the time cannot be read)", () => {
    for (const v of [null, undefined, "", "not a date"]) assert.deepEqual(windowOf(v, last), { open: false, closesAt: null, minutesLeft: null, closingSoon: false }, String(v));
  });
});
