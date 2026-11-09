// The uuidv7() shim for a PostgreSQL older than 18 (db/scripts/pg-setup.ts UUIDV7_SHIM_SQL; Supabase runs 17 today): made here in a throwaway schema on the real instance, it must give valid version-7
// ids that sort by time, so a table on Supabase keeps the same ordering it has on PostgreSQL 18.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { UUIDV7_SHIM_SQL } from "../../../common/db/scripts/pg-setup";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { connectOwner, lockTestDatabase, tag } from "./helpers/realDb";

let owner: DbClient;
let release: (() => Promise<void>) | undefined;
const schema = `shim_${tag()}`;

before(async () => {
  release = await lockTestDatabase();
  owner = await connectOwner();
  await owner.query(`CREATE SCHEMA ${schema}`);
  // the shim is written for `public`; here it goes to a schema of its own so the real server's built-in function is never touched
  await owner.query(UUIDV7_SHIM_SQL.replace("public.uuidv7()", `${schema}.uuidv7()`));
});
after(async () => {
  await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await owner.end();
  await release?.();
});

describe("the uuidv7() shim", () => {
  test("every id is a version 7 id of the standard variant", async () => {
    const ids = (await owner.query(`SELECT ${schema}.uuidv7()::text AS id FROM generate_series(1, 50)`)).rows.map((r) => String(r.id));
    for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, id);
    assert.equal(new Set(ids).size, ids.length, "no two ids alike");
  });

  test("the first 48 bits are the clock in milliseconds, so ids made later sort later", async () => {
    const before = Date.now();
    const a = String((await owner.query(`SELECT ${schema}.uuidv7()::text AS id`)).rows[0].id);
    await new Promise((r) => setTimeout(r, 5));
    const b = String((await owner.query(`SELECT ${schema}.uuidv7()::text AS id`)).rows[0].id);
    const ms = (id: string): number => parseInt(id.replace(/-/g, "").slice(0, 12), 16);
    assert.ok(ms(a) >= before - 1000 && ms(a) <= Date.now() + 1000, "the clock part is now");
    assert.ok(b > a, "a later id sorts after an earlier one");
    assert.ok(ms(b) >= ms(a));
  });

  test("it works as a column default", async () => {
    await owner.query(`CREATE TABLE ${schema}.t (id uuid PRIMARY KEY DEFAULT ${schema}.uuidv7(), n int)`);
    await owner.query(`INSERT INTO ${schema}.t (n) SELECT g FROM generate_series(1, 20) g`);
    const order = (await owner.query(`SELECT n FROM ${schema}.t ORDER BY id`)).rows.map((r) => Number(r.n));
    assert.equal(order.length, 20);
    assert.equal(new Set(order).size, 20);
  });
});
