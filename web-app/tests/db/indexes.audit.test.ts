// Data audit on the REAL PostgreSQL instance (hms_test): every foreign key of the platform schema and of a freshly built hotel schema has an index that starts
// with the key's columns (so deleting or joining a parent never scans the child), and the app role carries the query limits.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createTestHotel, removeAllTestHotels } from "./helpers/hotels";
import { connectOwner, lockTestDatabase } from "./helpers/realDb";

let releaseTestLock: (() => Promise<void>) | undefined;
let owner: DbClient;
let hotel: CreatedHotel;

before(async () => {
  releaseTestLock = await lockTestDatabase();
  owner = await connectOwner();
  hotel = await createTestHotel(owner, "Index Audit Hotel");
});

after(async () => {
  if (owner) await removeAllTestHotels(owner).catch(() => undefined);
  await owner?.end();
  await releaseTestLock?.();
});

describe("indexes and limits", () => {
  test("no foreign key, in the platform schema or in a hotel schema, lacks an index that starts with its columns", async () => {
    const r = await owner.query(
      `SELECT n.nspname AS schema, c.conrelid::regclass::text AS tbl, c.conname
         FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.contype = 'f' AND n.nspname IN ('platform', $1)
          AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indisvalid AND (i.indkey::int2[])[0:cardinality(c.conkey)-1] = c.conkey)
        ORDER BY 1, 2, 3`,
      [hotel.schema],
    );
    assert.deepEqual(r.rows.map((x) => `${String(x.tbl)}.${String(x.conname)}`), []);
  });

  test("the app's database role has a statement, an idle-transaction and a lock time limit", async () => {
    const r = await owner.query("SELECT rolconfig FROM pg_roles WHERE rolname = 'hms_app'");
    const config = (r.rows[0]?.rolconfig as string[] | null) ?? [];
    for (const key of ["statement_timeout", "idle_in_transaction_session_timeout", "lock_timeout"]) assert.ok(config.some((c) => c.startsWith(`${key}=`)), key);
  });
});
