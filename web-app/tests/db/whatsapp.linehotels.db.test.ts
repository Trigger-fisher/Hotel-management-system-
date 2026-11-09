// Hotels on the shared WhatsApp number on the REAL PostgreSQL, throwaway hms_test only: attach, one current row per hotel, a code unique among current rows, detach keeps history and frees the code and place.
// Run with: npm run test:db
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { createPgLineHotelsStore } from "../../src/server/repos/postgres/whatsappLineHotels";
import { sealToken } from "../../src/server/whatsapp/seal";
import { createTestHotel, removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectOwner, lockTestDatabase } from "./helpers/realDb";

const SEAL = randomBytes(32);
const T0 = new Date("2026-11-04T10:00:00Z");
let release: (() => Promise<void>) | undefined;
let owner: DbClient;
let database: Database;
let a: CreatedHotel;
let b: CreatedHotel;
let shared = "";

const clear = async (): Promise<void> => {
  for (const t of ["whatsapp_line_hotels", "whatsapp_lines"]) await owner.query(`DELETE FROM platform.${t}`);
};
before(async () => {
  release = await lockTestDatabase();
  owner = await connectOwner();
  await clear();
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 4 });
  a = await createTestHotel(owner, "Line Hotels A");
  b = await createTestHotel(owner, "Line Hotels B");
  shared = String((await owner.query("INSERT INTO platform.whatsapp_lines (kind, phone_number_id, waba_id, status, token_secret) VALUES ('shared', '1055550077777', '2055550009999', 'test', $1) RETURNING id", [sealToken(SEAL, "tok", "1055550077777")])).rows[0].id);
});
after(async () => {
  await database?.close();
  if (owner) {
    await clear().catch(() => undefined);
    await removeAllTestHotels(owner).catch(() => undefined);
  }
  await owner?.end();
  await release?.();
});

describe("hotels on the shared number, on PostgreSQL", () => {
  test("attach, list and available; the same hotel twice and a code in use are told apart; a hotel that does not exist is refused", async () => {
    const store = createPgLineHotelsStore(database.pool);
    assert.equal(await store.lineKind(shared), "shared");
    assert.equal(await store.lineKind("00000000-0000-4000-8000-0000000000ee"), null);
    assert.deepEqual((await store.hotelInfo(a.id))?.name, "Line Hotels A");
    assert.ok((await store.available(shared)).some((h) => h.hotelId === a.id), "listed as available first");
    assert.equal(await store.attach(shared, a.id, "linea", T0), "ok");
    assert.equal(await store.attach(shared, a.id, "other", T0), "already");
    assert.equal(await store.attach(shared, b.id, "linea", T0), "code_taken");
    assert.equal(await store.attach(shared, "00000000-0000-4000-8000-0000000000ff", "zzz", T0), "no_hotel");
    assert.equal(await store.attach(shared, b.id, "lineb", T0), "ok");
    assert.deepEqual((await store.list(shared)).map((h) => [h.hotelName, h.hotelCode]), [["Line Hotels A", "linea"], ["Line Hotels B", "lineb"]]);
    assert.ok(!(await store.available(shared)).some((h) => h.hotelId === a.id || h.hotelId === b.id), "no longer available");
  });

  test("a code is changed or cleared but not to one in use; detach keeps the row (history), frees the code and the place, and a hotel can come back", async () => {
    const store = createPgLineHotelsStore(database.pool);
    assert.equal(await store.setCode(shared, a.id, "lineb"), "code_taken");
    assert.equal(await store.setCode(shared, a.id, "alpha"), "ok");
    assert.equal(await store.setCode(shared, a.id, null), "ok");
    assert.equal(await store.setCode("00000000-0000-4000-8000-0000000000ee", a.id, "x3x"), "not_attached");
    assert.equal(await store.detach(shared, b.id, T0), true);
    assert.equal(await store.detach(shared, b.id, T0), false);
    const history = (await owner.query("SELECT valid_to FROM platform.whatsapp_line_hotels WHERE line_id = $1 AND hotel_id = $2", [shared, b.id])).rows;
    assert.deepEqual([history.length, history[0].valid_to !== null], [1, true], "the row is kept, closed");
    assert.equal(await store.attach(shared, a.id === b.id ? a.id : a.id, "lineb", T0), "already", "hotel A is still attached");
    assert.equal(await store.setCode(shared, a.id, "lineb"), "ok", "B's old code is free");
    assert.equal(await store.attach(shared, b.id, "fresh", T0), "ok", "B can come back with a new row");
    assert.equal((await owner.query("SELECT 1 FROM platform.whatsapp_line_hotels WHERE line_id = $1 AND hotel_id = $2", [shared, b.id])).rows.length, 2, "two rows of B: old closed, new current");
  });
});
