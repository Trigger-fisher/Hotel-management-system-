// A session inside an Enter-hotel visit gets a READ ONLY database transaction (BACKEND.md 14.7): the database itself refuses a write, whatever the route
// wrapper did. On the REAL PostgreSQL instance (hms_test) through the real withHotel and the same Unit the services use.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { createPgUnit } from "../../src/server/repos/postgres/unit";
import { appUrl, connectOwner, lockTestDatabase, sqlStateOf } from "./helpers/realDb";
import { createTestHotel, removeAllTestHotels } from "./helpers/hotels";

let releaseTestLock: (() => Promise<void>) | undefined;
let owner: DbClient;
let database: Database;
let hotel: CreatedHotel;

before(async () => {
  releaseTestLock = await lockTestDatabase();
  owner = await connectOwner();
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 4 });
  hotel = await createTestHotel(owner, "Visited Hotel");
});

after(async () => {
  await database?.close();
  if (owner) await removeAllTestHotels(owner).catch(() => undefined);
  await owner?.end();
  await releaseTestLock?.();
});

const INSERT = "INSERT INTO app_settings (key, value) VALUES ($1, 'x')";

describe("a visit's database transaction is READ ONLY", () => {
  test("reads work; any write is refused by PostgreSQL (25006) and leaves nothing; a normal session still writes", async () => {
    const visit = { hotelId: hotel.id, readOnly: true };
    const rows = await database.withHotel(visit, (tx) => tx.query("SELECT COUNT(*) AS n FROM business_units"));
    assert.ok(Number(rows.rows[0].n) >= 1, "a read works");
    for (const sql of [INSERT, "UPDATE business_units SET name = name", "DELETE FROM app_settings"]) {
      const state = await sqlStateOf(database.withHotel(visit, (tx) => tx.query(sql, sql === INSERT ? ["visit.key"] : [])));
      assert.equal(state, "25006", sql);
    }
    assert.equal(Number((await owner.query(`SELECT COUNT(*) AS n FROM "${hotel.schema}".app_settings WHERE key = 'visit.key'`)).rows[0].n), 0);
    await database.withHotel({ hotelId: hotel.id }, (tx) => tx.query(INSERT, ["normal.key"]));
    assert.equal(Number((await owner.query(`SELECT COUNT(*) AS n FROM "${hotel.schema}".app_settings WHERE key = 'normal.key'`)).rows[0].n), 1);
  });

  test("the Unit the services use turns a VIEW visit into a read only transaction; a FULL visit (platform 0135) writes", async () => {
    const unit = createPgUnit(database.withHotel, (tx) => tx);
    const base = { hotelId: hotel.id, userId: "00000000-0000-4000-8000-000000000001" };
    const visit = { id: "v", hotelId: hotel.id, hotelName: "Visited Hotel", expiresAt: new Date(Date.now() + 60_000), access: "view" as const, by: "platform_admin" as const };
    assert.equal(await sqlStateOf(unit.run({ ...base, visit }, (tx) => tx.query(INSERT, ["unit.visit"]))), "25006");
    await unit.run(base, (tx) => tx.query(INSERT, ["unit.normal"]));
    await unit.run({ ...base, visit: { ...visit, access: "full" as const, by: "super_admin" as const } }, (tx) => tx.query(INSERT, ["unit.full"]));
    assert.equal(Number((await owner.query(`SELECT COUNT(*) AS n FROM "${hotel.schema}".app_settings WHERE key LIKE 'unit.%'`)).rows[0].n), 2);
  });
});
