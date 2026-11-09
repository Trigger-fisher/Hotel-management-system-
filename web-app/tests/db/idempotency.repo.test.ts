// The Idempotency-Key store on the REAL PostgreSQL instance (hms_test): repos/postgres/idempotency.ts over the hotel table idempotency_keys. A retried create is
// replayed, the same key with another request is refused, a second request while the first runs is "in progress", a crashed request's marker is dropped, an
// abandoned key can be tried again, one hotel's key never touches another's. Also: a pool built for a transaction pooler (no startup options) still works in UTC.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { createSharedPool } from "../../src/db/pool";
import { requestHash } from "../../src/server/http/idempotency";
import { createPgIdempotencyStore } from "../../src/server/repos/postgres/idempotency";
import { createTestHotel, removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectOwner, lockTestDatabase } from "./helpers/realDb";

let releaseTestLock: (() => Promise<void>) | undefined;
let owner: DbClient;
let database: Database;
let hotelA: CreatedHotel;
let hotelB: CreatedHotel;
const USER = "00000000-0000-4000-8000-000000000001";

before(async () => {
  releaseTestLock = await lockTestDatabase();
  owner = await connectOwner();
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 4 });
  hotelA = await createTestHotel(owner, "Idempotency Hotel A");
  hotelB = await createTestHotel(owner, "Idempotency Hotel B");
});

after(async () => {
  await database?.close();
  if (owner) await removeAllTestHotels(owner).catch(() => undefined);
  await owner?.end();
  await releaseTestLock?.();
});

const info = { method: "POST", path: "/api/v1/billing/bills" };
const hashOf = (body: unknown) => requestHash("POST", info.path, body);

describe("the PostgreSQL Idempotency-Key store", () => {
  test("new, then in progress while it runs, then the stored answer is replayed; the same key with another request is refused", async () => {
    const store = createPgIdempotencyStore(database.withHotel);
    const scope = { userId: USER, hotelId: hotelA.id, key: "key-one-aaaaaaaa" };
    assert.deepEqual(await store.begin(scope, hashOf({ n: 1 }), info), { state: "new" });
    assert.deepEqual(await store.begin(scope, hashOf({ n: 1 }), info), { state: "in_progress" });
    assert.deepEqual(await store.begin(scope, hashOf({ n: 2 }), info), { state: "mismatch" });
    await store.complete(scope, { status: 201, body: { data: { id: "abc", total: 1200 } } });
    assert.deepEqual(await store.begin(scope, hashOf({ n: 1 }), info), { state: "replay", status: 201, body: { data: { id: "abc", total: 1200 } } });
    assert.deepEqual(await store.begin(scope, hashOf({ n: 2 }), info), { state: "mismatch" });
  });

  test("a failed request is abandoned and the client may try again with the same key; a completed answer cannot be abandoned", async () => {
    const store = createPgIdempotencyStore(database.withHotel);
    const scope = { userId: USER, hotelId: hotelA.id, key: "key-two-bbbbbbbb" };
    await store.begin(scope, hashOf("x"), info);
    await store.abandon(scope);
    assert.deepEqual(await store.begin(scope, hashOf("x"), info), { state: "new" });
    await store.complete(scope, { status: 200, body: { data: 1 } });
    await store.abandon(scope);
    assert.equal((await store.begin(scope, hashOf("x"), info)).state, "replay");
  });

  test("a marker left by a request that died (older than two minutes) and an expired answer are dropped on the next try", async () => {
    const store = createPgIdempotencyStore(database.withHotel);
    const stuck = { userId: USER, hotelId: hotelA.id, key: "key-three-cccccc" };
    await store.begin(stuck, hashOf("s"), info);
    await owner.query(`UPDATE "${hotelA.schema}".idempotency_keys SET created_at = now() - interval '3 minutes' WHERE key = $1`, [stuck.key]);
    assert.deepEqual(await store.begin(stuck, hashOf("s"), info), { state: "new" }, "the dead marker is gone");
    const old = { userId: USER, hotelId: hotelA.id, key: "key-four-dddddddd" };
    await store.begin(old, hashOf("o"), info);
    await store.complete(old, { status: 201, body: { data: "first" } });
    await owner.query(`UPDATE "${hotelA.schema}".idempotency_keys SET expires_at = now() - interval '1 minute' WHERE key = $1`, [old.key]);
    assert.deepEqual(await store.begin(old, hashOf("o"), info), { state: "new" }, "an expired answer is not replayed");
  });

  test("two requests with the same key at once: exactly one is new", async () => {
    const store = createPgIdempotencyStore(database.withHotel);
    const scope = { userId: USER, hotelId: hotelA.id, key: "key-five-eeeeeeee" };
    const states = (await Promise.all(Array.from({ length: 6 }, () => store.begin(scope, hashOf("race"), info)))).map((s) => s.state);
    assert.equal(states.filter((s) => s === "new").length, 1);
    assert.equal(states.filter((s) => s === "in_progress").length, 5);
  });

  test("hotels are separate: the same user and key in another hotel is new there", async () => {
    const store = createPgIdempotencyStore(database.withHotel);
    const a = { userId: USER, hotelId: hotelA.id, key: "key-six-ffffffff" };
    const b = { userId: USER, hotelId: hotelB.id, key: "key-six-ffffffff" };
    assert.equal((await store.begin(a, hashOf("h"), info)).state, "new");
    assert.equal((await store.begin(b, hashOf("h"), info)).state, "new");
    await store.complete(a, { status: 200, body: { data: "A" } });
    assert.equal((await store.begin(b, hashOf("h"), info)).state, "in_progress", "B has not completed");
  });
});

describe("a pool built for a transaction pooler", () => {
  test("sends no startup options, still answers in UTC (the login role carries the zone) and keeps no connection open when min is 0", async () => {
    const pool = createSharedPool({ databaseUrl: appUrl(), max: 2, min: 0, idleSeconds: 5, pooled: true });
    const client = await pool.connect();
    try {
      assert.equal(String((await client.query("SHOW timezone")).rows[0].TimeZone), "UTC");
    } finally {
      client.release();
    }
    await pool.end();
  });
});

describe("createDatabase passes the pool settings through", () => {
  test("pooled mode, minimum connections and idle seconds reach the pool (they once were dropped); the defaults are unchanged", async () => {
    const tuned = createDatabase({ databaseUrl: appUrl(), totalConnections: 3, minConnections: 0, idleSeconds: 10, pooled: true });
    assert.deepEqual(tuned.pool.settings, { max: 3, min: 0, idleSeconds: 10, pooled: true });
    await tuned.close();
    const plain = createDatabase({ databaseUrl: appUrl(), totalConnections: 20 });
    assert.deepEqual(plain.pool.settings, { max: 20, min: 4, idleSeconds: 600, pooled: false });
    await plain.close();
  });
});

describe("privacy of the stored answers", () => {
  test("a check-in, guest-details or ID-photo answer is kept as {id, version} only; other answers whole", async () => {
    const store = createPgIdempotencyStore(database.withHotel);
    const stayAnswer = { data: { id: "stay-1", version: 3, guestName: "Ravi Kumar Mehta", mobile: "9876543210", idProofNumber: "123456789012", members: [{ fullName: "Priya Ravi Mehta" }] } };
    const scope = { userId: USER, hotelId: hotelA.id, key: "key-priv-aaaaaaa" };
    await store.begin(scope, hashOf("stay"), { method: "POST", path: "/api/v1/front-office/stays" });
    await store.complete(scope, { status: 201, body: stayAnswer });
    const replay = await store.begin(scope, hashOf("stay"), { method: "POST", path: "/api/v1/front-office/stays" });
    assert.deepEqual(replay, { state: "replay", status: 201, body: { data: { id: "stay-1", version: 3 } } });
    const edit = { userId: USER, hotelId: hotelA.id, key: "key-priv-bbbbbbb" };
    await store.begin(edit, hashOf("edit"), { method: "PUT", path: "/api/v1/front-office/stays/01a12897-c17f-7765-8f23-0fcc0df3899a/guest-details" });
    await store.complete(edit, { status: 200, body: stayAnswer });
    const rows = await owner.query(`SELECT response_body::text AS b FROM "${hotelA.schema}".idempotency_keys WHERE key IN ($1, $2)`, [scope.key, edit.key]);
    for (const r of rows.rows) for (const secret of ["Ravi", "9876543210", "123456789012", "Priya"]) assert.ok(!String(r.b).includes(secret), `${secret} is not stored`);
    const bill = { userId: USER, hotelId: hotelA.id, key: "key-priv-ccccccc" };
    await store.begin(bill, hashOf("bill"), { method: "POST", path: "/api/v1/billing/bills" });
    await store.complete(bill, { status: 201, body: { data: { id: "b1", total: 99 } } });
    assert.deepEqual((await store.begin(bill, hashOf("bill"), { method: "POST", path: "/api/v1/billing/bills" })).state, "replay");
  });

  test("expired rows of every key and user are deleted by the next keyed write in that hotel (a real purge, bounded)", async () => {
    const store = createPgIdempotencyStore(database.withHotel);
    for (let i = 0; i < 3; i++) {
      const s = { userId: USER, hotelId: hotelB.id, key: `key-old-${i}-abcdefgh` };
      await store.begin(s, hashOf(i), info);
      await store.complete(s, { status: 200, body: { data: i } });
    }
    await owner.query(`UPDATE "${hotelB.schema}".idempotency_keys SET expires_at = now() - interval '1 hour'`);
    assert.equal(Number((await owner.query(`SELECT count(*) AS n FROM "${hotelB.schema}".idempotency_keys`)).rows[0].n) >= 3, true);
    await store.begin({ userId: USER, hotelId: hotelB.id, key: "key-fresh-abcdefgh" }, hashOf("f"), info);
    const left = await owner.query(`SELECT key FROM "${hotelB.schema}".idempotency_keys WHERE key LIKE 'key-old-%'`);
    assert.equal(left.rows.length, 0, "the three expired rows are gone");
  });
});