import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createShardRouter, shardUrlName } from "../../src/db/shardRouter";
import type { VerifiedSession, WithHotel } from "../../src/db/withHotel";

const session = (hotelId: string): VerifiedSession => ({ hotelId }) as VerifiedSession;
const named = (name: string, log: string[]): WithHotel => (async (_s: VerifiedSession, work: (tx: never) => Promise<unknown>) => { log.push(name); return work(undefined as never); }) as unknown as WithHotel;

describe("the shard router", () => {
  test("a hotel on main, an unmapped hotel and a shard without a database all use the main database", async () => {
    const log: string[] = [];
    const map: Record<string, string> = { a: "main", c: "far" };
    const router = createShardRouter({ main: named("main", log), lookup: async (id) => map[id] ?? null, forShard: () => null });
    for (const id of ["a", "b", "c"]) await router(session(id), async () => 1);
    assert.deepEqual(log, ["main", "main", "main"]);
  });

  test("a hotel on another shard uses that shard's database, and the map is read once per minute", async () => {
    const log: string[] = [];
    let reads = 0;
    let t = 0;
    const router = createShardRouter({ main: named("main", log), lookup: async () => { reads++; return "eu-1"; }, forShard: (k) => (k === "eu-1" ? named("eu-1", log) : null), now: () => t });
    await router(session("h"), async () => 1);
    await router(session("h"), async () => 1);
    assert.equal(reads, 1);
    t = 61_000;
    await router(session("h"), async () => 1);
    assert.equal(reads, 2);
    assert.deepEqual(log, ["eu-1", "eu-1", "eu-1"]);
  });

  test("when the map cannot be read the main database answers", async () => {
    const log: string[] = [];
    const router = createShardRouter({ main: named("main", log), lookup: async () => { throw new Error("down"); }, forShard: () => named("x", log) });
    assert.equal(await router(session("h"), async () => 7), 7);
    assert.deepEqual(log, ["main"]);
  });

  test("the variable of a shard key", () => {
    assert.equal(shardUrlName("eu-1"), "DATABASE_URL_SHARD_EU_1");
  });
});
