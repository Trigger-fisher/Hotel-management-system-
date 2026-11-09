// deferIdle (src/lib/idle.ts): the side work of the first second runs when the browser is idle, or after the given time at the latest, and can be cancelled.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { deferIdle } from "../src/lib/idle.ts";

const g = globalThis as { window?: unknown };
afterEach(() => {
  delete g.window;
});

test("with requestIdleCallback: one idle request with the time as its timeout; cancel goes through cancelIdleCallback", () => {
  const calls: { fn: () => void; opts: unknown }[] = [];
  const cancelled: number[] = [];
  g.window = {
    requestIdleCallback: (fn: () => void, opts: unknown) => {
      calls.push({ fn, opts });
      return 7;
    },
    cancelIdleCallback: (h: number) => cancelled.push(h),
  };
  let ran = 0;
  const cancel = deferIdle(() => (ran += 1), 1500);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].opts, { timeout: 1500 });
  assert.equal(ran, 0);
  calls[0].fn();
  assert.equal(ran, 1);
  cancel();
  assert.deepEqual(cancelled, [7]);
});

test("without requestIdleCallback (Safari): a plain timer of the given time, cleared by cancel", async () => {
  g.window = {};
  let ran = 0;
  const cancel = deferIdle(() => (ran += 1), 10);
  cancel();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(ran, 0, "cancelled before it ran");
  deferIdle(() => (ran += 1), 5);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(ran, 1);
});
