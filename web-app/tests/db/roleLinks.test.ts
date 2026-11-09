// Platform migration 0145 on the REAL database: each role table LINKS to the shared record instead of copying it (decision 72). A guest login points to its Guest ID (platform.guests), a corporate
// login to its Company GST record (platform.companies), a hotel admin and a hotel user to their hotel, a group hotel admin to the group they administer (platform.hotel_groups.admin_user_id); and the triggers keep every link in step.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { newId } from "../../src/server/db/ids";
import { connectOwner, lockTestDatabase, tag } from "./helpers/realDb";

let owner: DbClient;
let release: (() => Promise<void>) | undefined;
const HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaGhhc2g";

before(async () => {
  release = await lockTestDatabase();
  owner = await connectOwner();
});
after(async () => {
  await owner.end();
  await release?.();
});

const roleId = async (): Promise<string> => String((await owner.query("SELECT id FROM platform.roles WHERE key = 'viewer' AND hotel_id IS NULL")).rows[0].id);

async function makeUser(accountRole: string): Promise<string> {
  const id = newId();
  await owner.query("SELECT platform.create_person(jsonb_build_object('id', $1::uuid, 'username', $2::text, 'display_name', 'Link Person', 'password_hash', $3::text, 'role_id', $4::uuid, 'account_role', $5::text, 'code_required', true)) AS id", [id, `l${tag()}${tag()}`, HASH, await roleId(), accountRole]);
  return id;
}
async function makeHotel(): Promise<string> {
  const id = newId();
  await owner.query("INSERT INTO platform.hotels (id, name, slug) VALUES ($1, 'Link Hotel', $2)", [id, `lh-${tag()}${tag()}`]);
  return id;
}
async function makeGroup(): Promise<string> {
  const id = newId();
  await owner.query("INSERT INTO platform.hotel_groups (id, name, slug) VALUES ($1, $2, $3)", [id, `Link Group ${tag()}${tag()}`, `lg-${tag()}${tag()}`]);
  return id;
}
const one = async (sql: string, args: unknown[]): Promise<Record<string, unknown> | undefined> => (await owner.query(sql, args)).rows[0];

describe("the role tables link to the shared records", () => {
  test("a guest login points to its Guest ID, and follows it when the record is moved or merged", async () => {
    const u = await makeUser("guest_user");
    assert.equal((await one("SELECT guest_id FROM platform.guest_users WHERE login_id = $1", [u]))?.guest_id, null, "no Guest ID yet");
    const g = newId();
    await owner.query("INSERT INTO platform.guests (id, display_name, user_id) VALUES ($1, 'Linked Guest', $2)", [g, u]);
    assert.equal(String((await one("SELECT guest_id FROM platform.guest_users WHERE login_id = $1", [u]))?.guest_id), g);
    // a merged record is no longer the person's Guest ID
    const keep = newId();
    await owner.query("INSERT INTO platform.guests (id, display_name) VALUES ($1, 'Kept Guest')", [keep]);
    await owner.query("UPDATE platform.guests SET merged_into = $2, merged_at = now(), user_id = NULL WHERE id = $1", [g, keep]);
    assert.equal((await one("SELECT guest_id FROM platform.guest_users WHERE login_id = $1", [u]))?.guest_id, null);
  });

  test("a corporate login points to its Company GST record", async () => {
    const u = await makeUser("corporate_user");
    const c = newId();
    await owner.query("INSERT INTO platform.companies (id, name, gstin, user_id) VALUES ($1, 'Link Company', '24ABCDE1234F1Z5', $2)", [c, u]);
    const row = await one("SELECT company_id FROM platform.corporate_users WHERE login_id = $1", [u]);
    assert.equal(String(row?.company_id), c);
    assert.equal((await one("SELECT gstin FROM platform.companies WHERE id = $1", [c]))?.gstin, "24ABCDE1234F1Z5", "the GST is read from the one shared record");
  });

  test("two hotels' guest users can link to the SAME Guest ID record (one copy, shared)", async () => {
    const a = await makeUser("guest_user");
    const shared = newId();
    await owner.query("INSERT INTO platform.guests (id, display_name) VALUES ($1, 'One Guest')", [shared]);
    // the shared record is the single copy; a guest login attaches to it through guests.user_id (one login per record) and a second record cannot take the same login
    await owner.query("UPDATE platform.guests SET user_id = $2 WHERE id = $1", [shared, a]);
    assert.equal(String((await one("SELECT guest_id FROM platform.guest_users WHERE login_id = $1", [a]))?.guest_id), shared);
    const n = (await one("SELECT count(*)::int AS n FROM platform.guests WHERE id = $1", [shared]))?.n;
    assert.equal(n, 1);
  });

  test("a hotel admin and a hotel user point to their hotel, whether it is a group member or an individual hotel", async () => {
    const member = await makeHotel();
    const alone = await makeHotel();
    const group = await makeGroup();
    await owner.query("INSERT INTO platform.group_members (group_id, hotel_id) VALUES ($1, $2)", [group, member]);
    const a1 = await makeUser("hotel_admin");
    const a2 = await makeUser("hotel_admin");
    const staff = await makeUser("hotel_user");
    await owner.query("INSERT INTO platform.user_hotels (user_id, hotel_id, is_default) VALUES ($1, $2, true)", [a1, member]);
    await owner.query("INSERT INTO platform.user_hotels (user_id, hotel_id, is_default) VALUES ($1, $2, true)", [a2, alone]);
    await owner.query("INSERT INTO platform.user_hotels (user_id, hotel_id, is_default) VALUES ($1, $2, true)", [staff, member]);
    assert.equal(String((await one("SELECT hotel_id FROM platform.hotel_admins WHERE login_id = $1", [a1]))?.hotel_id), member);
    assert.equal(String((await one("SELECT hotel_id FROM platform.hotel_admins WHERE login_id = $1", [a2]))?.hotel_id), alone);
    assert.equal(String((await one("SELECT hotel_id FROM platform.hotel_users WHERE login_id = $1", [staff]))?.hotel_id), member);
  });

  test("a Group Hotel Admin points to the group they administer, and the link follows a change of admin", async () => {
    const g1 = await makeGroup();
    const g2 = await makeGroup();
    const ga = await makeUser("group_hotel_admin");
    const other = await makeUser("group_hotel_admin");
    assert.equal((await one("SELECT group_id FROM platform.group_hotel_admins WHERE login_id = $1", [ga]))?.group_id, null, "administers nothing yet");
    await owner.query("UPDATE platform.hotel_groups SET admin_user_id = $2 WHERE id = $1", [g1, ga]);
    assert.equal(String((await one("SELECT group_id FROM platform.group_hotel_admins WHERE login_id = $1", [ga]))?.group_id), g1);
    await owner.query("UPDATE platform.hotel_groups SET admin_user_id = $2 WHERE id = $1", [g1, other]);
    assert.equal((await one("SELECT group_id FROM platform.group_hotel_admins WHERE login_id = $1", [ga]))?.group_id, null, "no longer the admin");
    assert.equal(String((await one("SELECT group_id FROM platform.group_hotel_admins WHERE login_id = $1", [other]))?.group_id), g1);
    await owner.query("UPDATE platform.hotel_groups SET admin_user_id = $2 WHERE id = $1", [g2, ga]);
    assert.equal(String((await one("SELECT group_id FROM platform.group_hotel_admins WHERE login_id = $1", [ga]))?.group_id), g2);
  });

  test("a hotel is either a member of a group or an individual hotel, and platform.hotel_kinds says which", async () => {
    const hotel = await makeHotel();
    const group = await makeGroup();
    assert.equal((await one("SELECT kind FROM platform.hotel_kinds WHERE hotel_id = $1", [hotel]))?.kind, "individual");
    await owner.query("INSERT INTO platform.group_members (group_id, hotel_id) VALUES ($1, $2)", [group, hotel]);
    const row = await one("SELECT kind, group_id FROM platform.hotel_kinds WHERE hotel_id = $1", [hotel]);
    assert.deepEqual([row?.kind, String(row?.group_id)], ["group_member", group]);
    await owner.query("DELETE FROM platform.group_members WHERE hotel_id = $1", [hotel]);
    assert.equal((await one("SELECT kind FROM platform.hotel_kinds WHERE hotel_id = $1", [hotel]))?.kind, "individual");
  });

  test("deleting the shared record only clears the link: the person stays", async () => {
    const u = await makeUser("guest_user");
    const g = newId();
    await owner.query("INSERT INTO platform.guests (id, display_name, user_id) VALUES ($1, 'Gone Guest', $2)", [g, u]);
    await owner.query("DELETE FROM platform.guests WHERE id = $1", [g]);
    const row = await one("SELECT guest_id FROM platform.guest_users WHERE login_id = $1", [u]);
    assert.ok(row, "the guest user is still there");
    assert.equal(row?.guest_id, null);
  });
});

describe("the hotel-to-shard map (migration 0146)", () => {
  test("there is a main shard and every existing hotel is placed on a shard", async () => {
    const main = await one("SELECT key, status, capacity FROM platform.shards WHERE key = 'main'", []);
    assert.deepEqual([main?.key, main?.status, main?.capacity], ["main", "open", 300]);
    const unplaced = (await one("SELECT count(*)::int AS n FROM platform.hotels h WHERE NOT EXISTS (SELECT 1 FROM platform.hotel_shards s WHERE s.hotel_id = h.id)", []))?.n;
    assert.equal(unplaced, 0);
  });

  test("a new hotel is placed by itself, once, on an open shard", async () => {
    const hotel = await makeHotel();
    const rows = (await owner.query("SELECT s.key, s.status FROM platform.hotel_shards hs JOIN platform.shards s ON s.id = hs.shard_id WHERE hs.hotel_id = $1", [hotel])).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.status, "open");
  });

  test("a second open shard takes the new hotels once the first is at its capacity", async () => {
    const key = `t${tag()}${tag()}`.toLowerCase();
    await owner.query("UPDATE platform.shards SET capacity = (SELECT count(*) FROM platform.hotel_shards hs WHERE hs.shard_id = shards.id) WHERE key = 'main'");
    await owner.query("INSERT INTO platform.shards (key, label, status, capacity) VALUES ($1, 'Test shard', 'open', 300)", [key]);
    try {
      const hotel = await makeHotel();
      assert.equal((await one("SELECT s.key FROM platform.hotel_shards hs JOIN platform.shards s ON s.id = hs.shard_id WHERE hs.hotel_id = $1", [hotel]))?.key, key, "the main shard is full, so the new shard takes it");
    } finally {
      await owner.query("UPDATE platform.hotel_shards SET shard_id = (SELECT id FROM platform.shards WHERE key = 'main') WHERE shard_id = (SELECT id FROM platform.shards WHERE key = $1)", [key]);
      await owner.query("DELETE FROM platform.shards WHERE key = $1", [key]);
      await owner.query("UPDATE platform.shards SET capacity = 300 WHERE key = 'main'");
    }
  });

  test("with several hotel databases, each fills to its capacity in turn and none goes over it", async () => {
    const [a, b] = [`t${tag()}${tag()}`.toLowerCase(), `t${tag()}${tag()}`.toLowerCase()];
    await owner.query("UPDATE platform.shards SET capacity = (SELECT count(*) FROM platform.hotel_shards hs WHERE hs.shard_id = shards.id) WHERE key = 'main'");
    await owner.query("INSERT INTO platform.shards (key, label, status, capacity) VALUES ($1, 'Test shard A', 'open', 2)", [a]);
    await owner.query("INSERT INTO platform.shards (key, label, status, capacity) VALUES ($1, 'Test shard B', 'open', 2)", [b]);
    try {
      const hotels: string[] = [];
      for (let i = 0; i < 5; i++) hotels.push(await makeHotel());
      const keyOf = async (hotel: string): Promise<unknown> => (await one("SELECT hotel_database FROM platform.hotel_map WHERE hotel_id = $1", [hotel]))?.hotel_database;
      const keys: unknown[] = [];
      for (const hotel of hotels) keys.push(await keyOf(hotel));
      assert.deepEqual(keys, [a, a, b, b, "main"], "A fills first, then B, and only then the oldest shard takes the rest");
      const used = (await owner.query("SELECT key, hotels, capacity FROM platform.shard_usage WHERE key = ANY($1)", [[a, b]])).rows;
      for (const r of used) assert.ok(Number(r.hotels) <= Number(r.capacity), String(r.key));
    } finally {
      await owner.query("UPDATE platform.hotel_shards SET shard_id = (SELECT id FROM platform.shards WHERE key = 'main') WHERE shard_id IN (SELECT id FROM platform.shards WHERE key = ANY($1))", [[a, b]]);
      await owner.query("DELETE FROM platform.shards WHERE key = ANY($1)", [[a, b]]);
      await owner.query("UPDATE platform.shards SET capacity = 300 WHERE key = 'main'");
    }
  });

  test("the hotel map shows every hotel once, with its group and its hotel database (migration 0158)", async () => {
    const real = await makeGroup();
    const inGroup = await makeHotel();
    const single = await makeHotel();
    await owner.query("INSERT INTO platform.group_members (group_id, hotel_id) VALUES ($1, $2)", [real, inGroup]);
    const row = async (hotel: string): Promise<Record<string, unknown> | undefined> => one("SELECT group_id, group_kind, hotel_database FROM platform.hotel_map WHERE hotel_id = $1", [hotel]);
    assert.deepEqual([(await row(inGroup))?.group_id, (await row(inGroup))?.group_kind, (await row(inGroup))?.hotel_database], [real, "group", "main"]);
    assert.deepEqual([(await row(single))?.group_kind, (await row(single))?.hotel_database], ["individual", "main"]);
    const total = (await one("SELECT count(*)::int AS n FROM platform.hotel_map", []))?.n;
    const distinct = (await one("SELECT count(DISTINCT hotel_id)::int AS n FROM platform.hotel_map", []))?.n;
    assert.equal(total, distinct, "one line per hotel");
  });

  test("a hotel has exactly one shard, and a shard that holds hotels cannot be deleted", async () => {
    const hotel = await makeHotel();
    await assert.rejects(owner.query("INSERT INTO platform.hotel_shards (hotel_id, shard_id) VALUES ($1, (SELECT id FROM platform.shards WHERE key = 'main'))", [hotel]), /hotel_shards_hotel_key|duplicate key/i);
    await assert.rejects(owner.query("DELETE FROM platform.shards WHERE key = 'main'"), /foreign key|violates/i);
  });

  test("the shard figures say how many hotels each shard holds and how many places are left (migration 0147)", async () => {
    const hotels = (await one("SELECT count(*)::int AS n FROM platform.hotels h WHERE EXISTS (SELECT 1 FROM platform.hotel_shards s WHERE s.hotel_id = h.id)", []))?.n as number;
    const rows = (await owner.query("SELECT key, hotels, capacity, places_left FROM platform.shard_usage ORDER BY key")).rows;
    assert.equal(rows.reduce((n, r) => n + Number(r.hotels), 0), hotels, "every placed hotel is counted once");
    for (const r of rows) assert.equal(Number(r.places_left), Math.max(Number(r.capacity) - Number(r.hotels), 0), String(r.key));
  });
});
describe("the individual hotels group (migration 0157)", () => {
  const groupOf = async (hotel: string): Promise<{ id: string; kind: string }[]> =>
    (await owner.query("SELECT g.id, g.kind FROM platform.group_members gm JOIN platform.hotel_groups g ON g.id = gm.group_id WHERE gm.hotel_id = $1", [hotel])).rows.map((r) => ({ id: String(r.id), kind: String(r.kind) }));

  test("there is exactly one individual group, and a new single hotel is under it", async () => {
    const n = (await one("SELECT count(*)::int AS n FROM platform.hotel_groups WHERE kind = 'individual' AND deleted_at IS NULL", []))?.n;
    assert.equal(n, 1);
    const hotel = await makeHotel();
    const g = await groupOf(hotel);
    assert.deepEqual(g.map((x) => x.kind), ["individual"]);
  });

  test("joining a real group takes the hotel out of the individual group, and leaving puts it back", async () => {
    const hotel = await makeHotel();
    const real = await makeGroup();
    await owner.query("INSERT INTO platform.group_members (group_id, hotel_id) VALUES ($1, $2)", [real, hotel]);
    assert.deepEqual(await groupOf(hotel), [{ id: real, kind: "group" }], "in the real group only");
    await owner.query("DELETE FROM platform.group_members WHERE hotel_id = $1", [hotel]);
    assert.deepEqual((await groupOf(hotel)).map((x) => x.kind), ["individual"], "back under the individual group");
  });

  test("every live hotel is in exactly one group", async () => {
    const bad = (await one("SELECT count(*)::int AS n FROM platform.hotels h WHERE h.deleted_at IS NULL AND (SELECT count(*) FROM platform.group_members gm WHERE gm.hotel_id = h.id) <> 1", []))?.n;
    assert.equal(bad, 0);
  });
});