// The schema directory (readable schemas, platform 0172): a hotel's schema read from platform.hotels, kept a few seconds, never trusted blindly (withHotel checks it again).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createSchemaDirectory } from "../../src/db/schemaDirectory";
import { AppError } from "../../src/server/errors";
import type { ClientPool, PooledClient } from "../../src/db/withHotel";
import { EventEmitter } from "node:events";

const A = "0198a3b2-7c4d-7e5f-8a9b-0c1d2e3f4a5b";

function pool(answer: () => string | null): ClientPool & { asked: unknown[][]; released: number } {
  const p = {
    asked: [] as unknown[][],
    released: 0,
    connect: async (): Promise<PooledClient> => {
      const c = new EventEmitter() as unknown as PooledClient;
      c.query = async (_text: string, params?: readonly unknown[]) => {
        p.asked.push([...(params ?? [])]);
        const v = answer();
        return { rows: v === null ? [] : [{ schema_name: v }], rowCount: v === null ? 0 : 1 };
      };
      c.release = () => void (p.released += 1);
      return c;
    },
  };
  return p;
}

describe("createSchemaDirectory", () => {
  test("reads the hotel's schema by its canonical id, and gives the connection back", async () => {
    const p = pool(() => "blue_lagoon_residency");
    const schemaOf = createSchemaDirectory(p);
    assert.equal(await schemaOf(A.replaceAll("-", "")), "blue_lagoon_residency");
    assert.deepEqual(p.asked, [[A]]);
    assert.equal(p.released, 1);
  });

  test("keeps the answer for the cache time only: a rename shows within seconds", async () => {
    let now = 1_000;
    let name = "old_name";
    const p = pool(() => name);
    const schemaOf = createSchemaDirectory(p, { ttlMs: 5_000, now: () => now });
    assert.equal(await schemaOf(A), "old_name");
    name = "new_name";
    now += 4_999;
    assert.equal(await schemaOf(A), "old_name", "still kept");
    assert.equal(p.asked.length, 1);
    now += 2;
    assert.equal(await schemaOf(A), "new_name", "asked again after the time");
    assert.equal(p.asked.length, 2);
  });

  test("an unknown or deleted hotel is not available; a bad id never reaches the database", async () => {
    const p = pool(() => null);
    const schemaOf = createSchemaDirectory(p);
    await assert.rejects(() => schemaOf(A), (e: unknown) => e instanceof AppError && e.code === "FORBIDDEN");
    await assert.rejects(() => schemaOf("not-an-id"), (e: unknown) => e instanceof AppError && e.code === "FORBIDDEN");
    assert.equal(p.asked.length, 1, "only the real id was asked");
    assert.equal(p.released, 1);
  });
});