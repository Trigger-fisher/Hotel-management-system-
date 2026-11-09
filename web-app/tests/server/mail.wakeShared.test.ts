// The "a mail was queued" signal must reach the worker even when the worker and the route that queues the mail are separate bundles of the server (Next.js gives each its own copy of a module
// variable). The listeners are kept on globalThis, so every copy of the module sees the same ones (src/server/services/auth/mailWake.ts).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { mailWake } from "../../src/server/services/auth/mailWake";

describe("the mail wake is shared by every bundle", () => {
  test("the listeners are on globalThis; a touch reaches a listener that subscribed in another copy of the module", () => {
    let woke = 0;
    const off = mailWake.subscribe(() => void (woke += 1));
    const shared = (globalThis as unknown as Record<symbol, Set<() => void>>)[Symbol.for("hms.mailWake.listeners")];
    assert.ok(shared instanceof Set && shared.size >= 1, "the set is on globalThis");
    // another bundle's copy of the module reads the same set: calling what it holds is what its touch() does
    for (const l of [...shared]) l();
    assert.equal(woke, 1);
    mailWake.touch();
    assert.equal(woke, 2);
    off();
    mailWake.touch();
    assert.equal(woke, 2, "an unsubscribed listener is not called");
  });

  test("a nudge wakes the queue at most once a minute (signed-in requests nudge it, so a mail to retry never waits for the daily cron)", () => {
    let woke = 0;
    const off = mailWake.subscribe(() => void (woke += 1));
    (globalThis as unknown as Record<symbol, number>)[Symbol.for("hms.mailWake.lastNudge")] = 0;
    mailWake.nudge();
    mailWake.nudge();
    mailWake.nudge();
    assert.equal(woke, 1, "three requests in the same minute: one wake");
    (globalThis as unknown as Record<symbol, number>)[Symbol.for("hms.mailWake.lastNudge")] = Date.now() - 61_000;
    mailWake.nudge();
    assert.equal(woke, 2, "a minute later: the next request wakes it again");
    off();
  });

  test("a listener that throws never reaches the request that queued the mail", () => {
    const off = mailWake.subscribe(() => { throw new Error("boom"); });
    assert.doesNotThrow(() => mailWake.touch());
    off();
  });
});
