// Lifecycle: the readiness ping and the clean stop (src/server/ops/lifecycle.ts).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createShutdown, pingDatabase, type PingPool } from "../../src/server/ops/lifecycle";

const pool = (query: () => Promise<unknown>): { pool: PingPool; released: () => number } => {
  let released = 0;
  return { pool: { connect: async () => ({ query, release: () => void (released += 1) }) }, released: () => released };
};

describe("the database ping", () => {
  test("true when SELECT 1 answers, and the connection is given back", async () => {
    const p = pool(async () => ({ rows: [] }));
    assert.equal(await pingDatabase(p.pool), true);
    assert.equal(p.released(), 1);
  });
  test("false when the query fails (and the connection is still given back), when connecting fails, and when nothing answers in time", async () => {
    const failing = pool(async () => Promise.reject(new Error("boom")));
    assert.equal(await pingDatabase(failing.pool), false);
    assert.equal(failing.released(), 1);
    assert.equal(await pingDatabase({ connect: () => Promise.reject(new Error("refused")) }), false);
    assert.equal(await pingDatabase(pool(() => new Promise(() => undefined)).pool, 30), false);
  });
});

describe("the clean stop", () => {
  const run = async (close: () => Promise<void>, graceMs = 50) => {
    const events: string[] = [];
    const stop = createShutdown({ stopWork: () => void events.push("work stopped"), closeDatabase: async () => (events.push("closing"), close()), log: (m) => void events.push(m), exit: (c) => void events.push(`exit ${c}`), graceMs });
    return { events, stop };
  };
  test("stops the work, closes the pool, then exits 0; a second signal does nothing more", async () => {
    const { events, stop } = await run(async () => void events.push("closed"));
    await Promise.all([stop("SIGTERM"), stop("SIGINT")]);
    assert.deepEqual(events, ["SIGTERM received: stopping", "work stopped", "closing", "closed", "exit 0"]);
  });
  test("a pool that will not close does not hold the process: it leaves after the grace time", async () => {
    const { events, stop } = await run(() => new Promise(() => undefined), 20);
    await stop("SIGTERM");
    assert.equal(events.at(-1), "exit 0");
  });
  test("a pool that fails to close still ends in exit 0", async () => {
    const { events, stop } = await run(() => Promise.reject(new Error("x")));
    await stop("SIGTERM");
    assert.equal(events.at(-1), "exit 0");
  });
});