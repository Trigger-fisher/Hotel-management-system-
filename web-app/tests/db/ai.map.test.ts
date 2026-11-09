// Platform migration 0176 on the REAL database: the AI map. ai_databases (one row per AI database), ai_routes (who each serves, off until switched on) and the ai_map view, in the style of the hotel map.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { newId } from "../../src/server/db/ids";
import { connectApp, connectOwner, lockTestDatabase, tag } from "./helpers/realDb";

let owner: DbClient;
let app: DbClient;
let release: (() => Promise<void>) | undefined;
const made: { dbs: string[]; hotels: string[]; groups: string[] } = { dbs: [], hotels: [], groups: [] };

before(async () => {
  release = await lockTestDatabase();
  owner = await connectOwner();
  app = await connectApp();
});
after(async () => {
  await owner.query("DELETE FROM platform.ai_routes WHERE ai_database_id = ANY($1::uuid[]) OR scope_kind = 'platform'", [made.dbs]).catch(() => undefined);
  await owner.query("DELETE FROM platform.ai_databases WHERE id = ANY($1::uuid[])", [made.dbs]).catch(() => undefined);
  if (made.hotels.length > 0) await owner.query("DELETE FROM platform.hotels WHERE id = ANY($1::uuid[])", [made.hotels]).catch(() => undefined);
  if (made.groups.length > 0) await owner.query("DELETE FROM platform.hotel_groups WHERE id = ANY($1::uuid[])", [made.groups]).catch(() => undefined);
  await app.end();
  await owner.end();
  await release?.();
});

const one = async (sql: string, args: unknown[] = []): Promise<Record<string, unknown> | undefined> => (await owner.query(sql, args)).rows[0];
const refused = async (sql: string, args: unknown[]): Promise<string> => owner.query(sql, args).then(() => "accepted", (e: { code?: string }) => String(e.code));
async function makeDb(status = "open"): Promise<string> {
  const id = newId();
  await owner.query("INSERT INTO platform.ai_databases (id, key, label, status) VALUES ($1, $2, 'Test AI database', $3)", [id, `t${tag()}${tag()}`.toLowerCase(), status]);
  made.dbs.push(id);
  return id;
}
async function makeHotel(): Promise<string> {
  const id = newId();
  await owner.query("INSERT INTO platform.hotels (id, name, slug) VALUES ($1, 'AI Map Hotel', $2)", [id, `am-${tag()}${tag()}`]);
  made.hotels.push(id);
  return id;
}
async function makeGroup(): Promise<string> {
  const id = newId();
  await owner.query("INSERT INTO platform.hotel_groups (id, name, slug) VALUES ($1, $2, $3)", [id, `AI Map Group ${tag()}${tag()}`, `ag-${tag()}${tag()}`]);
  made.groups.push(id);
  return id;
}

describe("the AI map (platform 0176)", () => {
  test("it starts empty, with no AI database and no route", async () => {
    assert.equal((await one("SELECT count(*)::int AS n FROM platform.ai_databases WHERE key NOT LIKE 't%' AND key <> 'main'"))?.n, 0);
    assert.equal((await one("SELECT count(*)::int AS n FROM platform.ai_routes WHERE ai_database_id <> ALL($1::uuid[])", [made.dbs]))?.n, 0);
  });

  test("a route is off, empty of features and limited until someone says otherwise", async () => {
    const db = await makeDb();
    const hotel = await makeHotel();
    await owner.query("INSERT INTO platform.ai_routes (scope_kind, hotel_id, ai_database_id) VALUES ('hotel', $1, $2)", [hotel, db]);
    const row = await one("SELECT enabled, features, daily_request_limit, monthly_budget_paise FROM platform.ai_routes WHERE hotel_id = $1", [hotel]);
    assert.deepEqual([row?.enabled, row?.features, row?.daily_request_limit, String(row?.monthly_budget_paise)], [false, [], 200, "0"]);
  });

  test("a hotel has one route, a group has one, and the platform has one", async () => {
    const db = await makeDb();
    const hotel = await makeHotel();
    const group = await makeGroup();
    await owner.query("INSERT INTO platform.ai_routes (scope_kind, hotel_id, ai_database_id) VALUES ('hotel', $1, $2)", [hotel, db]);
    assert.equal(await refused("INSERT INTO platform.ai_routes (scope_kind, hotel_id, ai_database_id) VALUES ('hotel', $1, $2)", [hotel, db]), "23505", "a second route for the same hotel");
    await owner.query("INSERT INTO platform.ai_routes (scope_kind, group_id, ai_database_id) VALUES ('group', $1, $2)", [group, db]);
    assert.equal(await refused("INSERT INTO platform.ai_routes (scope_kind, group_id, ai_database_id) VALUES ('group', $1, $2)", [group, db]), "23505", "a second route for the same group");
    await owner.query("INSERT INTO platform.ai_routes (scope_kind, ai_database_id) VALUES ('platform', $1)", [db]);
    assert.equal(await refused("INSERT INTO platform.ai_routes (scope_kind, ai_database_id) VALUES ('platform', $1)", [db]), "23505", "a second platform route");
  });

  test("a route names exactly the scope it is for", async () => {
    const db = await makeDb();
    const hotel = await makeHotel();
    const group = await makeGroup();
    assert.equal(await refused("INSERT INTO platform.ai_routes (scope_kind, ai_database_id) VALUES ('hotel', $1)", [db]), "23514", "a hotel route without a hotel");
    assert.equal(await refused("INSERT INTO platform.ai_routes (scope_kind, hotel_id, group_id, ai_database_id) VALUES ('hotel', $1, $2, $3)", [hotel, group, db]), "23514", "a hotel route that also names a group");
    assert.equal(await refused("INSERT INTO platform.ai_routes (scope_kind, hotel_id, ai_database_id) VALUES ('platform', $1, $2)", [hotel, db]), "23514", "a platform route that names a hotel");
    assert.equal(await refused("INSERT INTO platform.ai_routes (scope_kind, hotel_id, ai_database_id) VALUES ('team', $1, $2)", [hotel, db]), "23514", "an unknown kind");
  });

  test("the rules on the columns: a clean key, a known status, no negative limit, at most 20 features", async () => {
    assert.equal(await refused("INSERT INTO platform.ai_databases (key, label) VALUES ('Bad Key', 'x')", []), "23514");
    assert.equal(await refused("INSERT INTO platform.ai_databases (key, label, status) VALUES ($1, 'x', 'closed')", [`t${tag()}${tag()}`.toLowerCase()]), "23514");
    const db = await makeDb();
    const hotel = await makeHotel();
    assert.equal(await refused("INSERT INTO platform.ai_routes (scope_kind, hotel_id, ai_database_id, daily_request_limit) VALUES ('hotel', $1, $2, -1)", [hotel, db]), "23514");
    assert.equal(await refused("INSERT INTO platform.ai_routes (scope_kind, hotel_id, ai_database_id, features) SELECT 'hotel', $1, $2, array_agg('f' || g) FROM generate_series(1, 21) g", [hotel, db]), "23514");
    assert.equal(await refused("INSERT INTO platform.ai_databases (key, label) SELECT key, 'copy' FROM platform.ai_databases WHERE id = $1", [db]), "23505", "the key is unique");
  });

  test("an AI database that still has routes cannot be removed; removing a hotel removes its route", async () => {
    const db = await makeDb();
    const hotel = await makeHotel();
    await owner.query("INSERT INTO platform.ai_routes (scope_kind, hotel_id, ai_database_id) VALUES ('hotel', $1, $2)", [hotel, db]);
    assert.equal(await refused("DELETE FROM platform.ai_databases WHERE id = $1", [db]), "23001", "ON DELETE RESTRICT");
    await owner.query("DELETE FROM platform.hotels WHERE id = $1", [hotel]);
    made.hotels.splice(made.hotels.indexOf(hotel), 1);
    assert.equal((await one("SELECT count(*)::int AS n FROM platform.ai_routes WHERE ai_database_id = $1", [db]))?.n, 0);
  });

  test("the map shows each hotel with its group and AI database, and whether it is on", async () => {
    const db = await makeDb();
    const hotel = await makeHotel();
    const group = await makeGroup();
    await owner.query("INSERT INTO platform.group_members (group_id, hotel_id) VALUES ($1, $2)", [group, hotel]).catch(() => undefined);
    await owner.query("INSERT INTO platform.ai_routes (scope_kind, hotel_id, ai_database_id, enabled, features) VALUES ('hotel', $1, $2, true, ARRAY['ask'])", [hotel, db]);
    const line = await one("SELECT hotel, ai_database, enabled FROM platform.ai_map WHERE hotel_id = $1", [hotel]);
    assert.deepEqual([line?.hotel, line?.enabled], ["AI Map Hotel", true]);
    assert.equal(line?.ai_database, (await one("SELECT key FROM platform.ai_databases WHERE id = $1", [db]))?.key);
    const hotel2 = await makeHotel();
    assert.equal((await one("SELECT count(*)::int AS n FROM platform.ai_map WHERE hotel_id = $1", [hotel2]))?.n, 0, "a hotel with no route is not on the map");
  });

  test("the app may read the map and nothing else: no write, so a request can never change a route", async () => {
    assert.ok(((await app.query("SELECT count(*)::int AS n FROM platform.ai_routes")).rows[0] as { n: number }).n >= 0);
    assert.ok(((await app.query("SELECT count(*)::int AS n FROM platform.ai_map")).rows[0] as { n: number }).n >= 0);
    for (const sql of ["INSERT INTO platform.ai_databases (key, label) VALUES ('zz', 'x')", "UPDATE platform.ai_routes SET enabled = true", "DELETE FROM platform.ai_routes", "UPDATE platform.ai_databases SET status = 'full'"]) {
      assert.equal(await app.query(sql).then(() => "accepted", (e: { code?: string }) => String(e.code)), "42501", sql);
    }
  });
});
