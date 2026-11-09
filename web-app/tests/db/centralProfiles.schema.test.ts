// Platform migrations 0131 (users.photo_file) and 0132 (the one common guest and company profile) on the REAL PostgreSQL instance, as the app's own login (hms_app):
// the photo repository, the CHECKs, the links (one profile per hotel record) and what the app may and may not do (a profile is never deleted). hms_test only.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createSharedPool, type SharedPool } from "../../src/db/pool";
import type { AdminPlatformUnit } from "../../src/server/repos/adminPlatform";
import { createPgAdminPlatformUnit } from "../../src/server/repos/postgres/adminPlatform";
import { createPgCentralProfilesUnit } from "../../src/server/repos/postgres/centralProfiles";
import { removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectApp, connectOwner, constraintOf, lockTestDatabase, sqlStateOf, tag } from "./helpers/realDb";

let releaseTestLock: (() => Promise<void>) | undefined;
let owner: DbClient;
let app: DbClient;
let pool: SharedPool;
let unit: AdminPlatformUnit;
const HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaGhhc2g";
const roleId = async (key: string): Promise<string> => String((await owner.query("SELECT id FROM platform.roles WHERE key = $1 AND hotel_id IS NULL", [key])).rows[0].id);
const user = async (accountRole = "guest_user"): Promise<string> => {
  const id = randomUUID();
  await owner.query("SELECT platform.create_person(jsonb_build_object('id', $1::uuid, 'username', $2::text, 'display_name', 'Test Person', 'password_hash', $3::text, 'role_id', $4::uuid, 'account_role', $5::text)) AS id", [id, `u${tag()}${tag()}`, HASH, await roleId("viewer"), accountRole]);
  return id;
};
const hotel = async (): Promise<string> => String((await owner.query("INSERT INTO platform.hotels (name, slug) VALUES ($1, $2) RETURNING id", [`Central ${tag()}`, `c-${tag()}${tag()}`])).rows[0].id);

before(async () => {
  releaseTestLock = await lockTestDatabase();
  owner = await connectOwner();
  app = await connectApp();
  pool = createSharedPool({ databaseUrl: appUrl(), max: 4 });
  unit = createPgAdminPlatformUnit(pool);
});

after(async () => {
  await pool?.end();
  await app?.end();
  if (owner) await removeAllTestHotels(owner).catch(() => undefined);
  await owner?.end();
  await releaseTestLock?.();
});

describe("profile photo (0131)", () => {
  test("the repository keeps only the file name and answers the one it replaced; the CHECK refuses anything that is not a stored WebP name", async () => {
    const id = await user();
    assert.equal(await unit.run((r) => r.photo.get(id)), null);
    assert.equal(await unit.run((r) => r.photo.set(id, "photo-0123456789abcdef01234567.webp")), null);
    assert.equal(await unit.run((r) => r.photo.get(id)), "photo-0123456789abcdef01234567.webp");
    assert.equal(await unit.run((r) => r.photo.set(id, null)), "photo-0123456789abcdef01234567.webp");
    assert.equal(await unit.run((r) => r.photo.get(id)), null);
    assert.equal(await sqlStateOf(app.query("UPDATE platform.logins SET photo_file = '../x.webp' WHERE id = $1", [id])), "23514");
    assert.equal(await sqlStateOf(app.query("UPDATE platform.logins SET photo_file = 'photo.png' WHERE id = $1", [id])), "23514");
  });
});

describe("central profiles repository (repos/postgres/centralProfiles.ts)", () => {
  test("create, find by login and by hotel record (through a merge), update only what is given, a link is never replaced", async () => {
    const central = createPgCentralProfilesUnit(pool);
    assert.equal(await central.run((r) => r.ready()), true);
    const h = await hotel();
    const login = await user();
    const record = randomUUID();
    const made = await central.run(async (r) => {
      const g = await r.guests.create({ displayName: "Amit Joshi", mobile: "+919825041236", email: "amit@example.test", address: null, city: "Rajkot", userId: login });
      assert.equal(await r.guests.link(h, record, g.id), true);
      assert.equal(await r.guests.link(h, record, g.id), false, "a record keeps its link");
      return g;
    });
    assert.equal((await central.run((r) => r.guests.byUser(login)))?.id, made.id);
    const changed = await central.run((r) => r.guests.update(made.id, { city: "Ahmedabad" }));
    assert.deepEqual([changed?.displayName, changed?.city, changed?.email], ["Amit Joshi", "Ahmedabad", "amit@example.test"]);
    // a merge: the record's link still points at the old profile, and reads land on the kept one
    const kept = await central.run((r) => r.guests.create({ displayName: "Amit J", mobile: null, email: null, address: null, city: null, userId: null }));
    await owner.query("UPDATE platform.guests SET merged_into = $1, merged_at = now() WHERE id = $2", [kept.id, made.id]);
    assert.equal((await central.run((r) => r.guests.ofRecord(h, record)))?.id, kept.id);
    assert.equal(await central.run((r) => r.guests.update(made.id, { city: "X" })), null, "a merged profile is not changed");
    const co = await central.run(async (r) => {
      const c = await r.companies.create({ name: "TCS", mainContactName: "Deepa", gstin: "24AAACT2727Q1ZW", email: null, mobile: null, landline: null, address: null, pincode: null, country: "India", contacts: [{ name: "Deepa", role: "Travel", email: "d@tcs.test", mobile: "9876543210" }], userId: null });
      await r.companies.link(h, record, c.id);
      return c;
    });
    const read = await central.run((r) => r.companies.ofRecord(h, record));
    assert.deepEqual([read?.id, read?.contacts.length, read?.contacts[0]?.role], [co.id, 1, "Travel"]);
    const upd = await central.run((r) => r.companies.update(co.id, { contacts: [], landline: "0281 2450000" }));
    assert.deepEqual([upd?.contacts.length, upd?.landline, upd?.gstin], [0, "0281 2450000", "24AAACT2727Q1ZW"]);
  });

  test("change history (review M1(a)): a row of platform.audit_log (scope hotel) per change; the last one with the hotel's name; append-only", async () => {
    const central = createPgCentralProfilesUnit(pool);
    const h = await hotel();
    const secondHotel = await hotel();
    const staff = await user("hotel_admin");
    const g = await central.run((r) => r.guests.create({ displayName: "Amit Joshi", mobile: null, email: null, address: null, city: null, userId: null }));
    assert.equal(await central.run((r) => r.history.last("guest", g.id)), null);
    const base = { kind: "guest" as const, profileId: g.id, hotelId: h, byUserId: staff, byName: "Hari Admin", via: "desk" as const, traceId: "trace-history-1" };
    await central.run((r) => r.history.record({ ...base, fields: [], at: new Date("2026-10-18T04:00:00Z") }));
    await central.run((r) => r.history.record({ ...base, fields: ["email", "city"], at: new Date("2026-10-18T05:00:00Z") }));
    const last = await central.run((r) => r.history.last("guest", g.id));
    const name = String((await owner.query("SELECT name FROM platform.hotels WHERE id = $1", [h])).rows[0].name);
    assert.deepEqual(last, { at: new Date("2026-10-18T05:00:00Z"), hotelName: name, by: "Hari Admin", via: "desk", fields: ["email", "city"] });
    assert.equal(await central.run((r) => r.history.last("company", g.id)), null, "a company's history is its own");
    // M1(b)/(c): the number of hotels sharing a profile, and a masked GSTIN change kept with the row
    assert.equal(await central.run((r) => r.guests.hotelCount(g.id)), 0);
    await central.run((r) => r.guests.link(h, randomUUID(), g.id));
    await central.run((r) => r.guests.link(secondHotel, randomUUID(), g.id));
    assert.equal(await central.run((r) => r.guests.hotelCount(g.id)), 2);
    const co = await central.run((r) => r.companies.create({ name: "TCS", mainContactName: null, gstin: null, email: null, mobile: null, landline: null, address: null, pincode: null, country: null, contacts: [], userId: null }));
    await central.run((r) => r.history.record({ kind: "company", profileId: co.id, hotelId: h, byUserId: staff, byName: "Hari Admin", via: "desk", fields: ["gstin"], gstin: { from: "XXXX Q1ZW", to: "XXXX Q1ZX" }, at: new Date("2026-10-18T06:00:00Z"), traceId: "trace-history-2" }));
    assert.deepEqual((await central.run((r) => r.history.last("company", co.id)))?.gstin, { from: "XXXX Q1ZW", to: "XXXX Q1ZX" });
    const rows = await owner.query("SELECT action, entity, scope FROM platform.audit_log WHERE entity_id = $1 ORDER BY at", [g.id]);
    assert.deepEqual(rows.rows.map((x) => [x.action, x.entity, x.scope]), [["profile_created", "guest_profile", "hotel"], ["profile_updated", "guest_profile", "hotel"]]);
    assert.notEqual(await sqlStateOf(app.query("UPDATE platform.audit_log SET actor_name = 'x' WHERE entity_id = $1", [g.id])), null, "the history cannot be rewritten");
  });
});

describe("central profiles (0132)", () => {
  test("a guest and a company profile: shapes checked, one login per live profile, never deleted by the app", async () => {
    const login = await user();
    const g = String((await app.query("INSERT INTO platform.guests (display_name, mobile, email, user_id) VALUES ('Amit Joshi', '+919825041236', 'amit@example.test', $1) RETURNING id", [login])).rows[0].id);
    assert.equal(await constraintOf(app.query("INSERT INTO platform.guests (display_name, user_id) VALUES ('Second', $1)", [login])), "guests_user_key");
    assert.equal(await sqlStateOf(app.query("INSERT INTO platform.guests (display_name, mobile) VALUES ('Bad mobile', '98250 41236')")), "23514");
    assert.equal(await sqlStateOf(app.query("INSERT INTO platform.guests (display_name, email) VALUES ('Upper', 'Amit@Example.test')")), "23514");
    assert.equal(await sqlStateOf(app.query("INSERT INTO platform.guests (display_name) VALUES ('   ')")), "23514");
    assert.equal(await sqlStateOf(app.query("DELETE FROM platform.guests WHERE id = $1", [g])), "42501", "a profile is never deleted by the app");
    const c = String((await app.query("INSERT INTO platform.companies (name, gstin, contacts) VALUES ('Tata Consultancy Services', '24AAACT2727Q1ZW', '[]') RETURNING id")).rows[0].id);
    assert.equal(await sqlStateOf(app.query("INSERT INTO platform.companies (name, gstin) VALUES ('Lower', '24aaact2727q1zw')")), "23514");
    assert.equal(await sqlStateOf(app.query("INSERT INTO platform.companies (name, contacts) VALUES ('Not a list', '{}')")), "23514");
    assert.equal(await sqlStateOf(app.query("DELETE FROM platform.companies WHERE id = $1", [c])), "42501");
  });

  test("a merge is a pair (merged_into with merged_at), never into itself; the merged row frees its login for the kept one", async () => {
    const login = await user();
    const a = String((await app.query("INSERT INTO platform.guests (display_name, user_id) VALUES ('Keep', NULL) RETURNING id")).rows[0].id);
    const b = String((await app.query("INSERT INTO platform.guests (display_name, user_id) VALUES ('Goes', $1) RETURNING id", [login])).rows[0].id);
    assert.equal(await constraintOf(app.query("UPDATE platform.guests SET merged_into = $1 WHERE id = $2", [a, b])), "guests_merge_pair");
    assert.equal(await constraintOf(app.query("UPDATE platform.guests SET merged_into = id, merged_at = now() WHERE id = $1", [a])), "guests_not_merged_into_self");
    await app.query("UPDATE platform.guests SET merged_into = $1, merged_at = now() WHERE id = $2", [a, b]);
    await app.query("UPDATE platform.guests SET user_id = $1 WHERE id = $2", [login, a]);
    assert.equal(String((await app.query("SELECT user_id FROM platform.guests WHERE id = $1", [a])).rows[0].user_id), login, "the kept row takes the login while the merged one still names it");
  });

  test("the link: one profile per hotel record; a hotel that goes takes its links; a linked profile cannot be removed; kept-apart pairs are stored once", async () => {
    const h = await hotel();
    const customer = randomUUID();
    const g1 = String((await app.query("INSERT INTO platform.guests (display_name) VALUES ('One') RETURNING id")).rows[0].id);
    const g2 = String((await app.query("INSERT INTO platform.guests (display_name) VALUES ('Two') RETURNING id")).rows[0].id);
    await app.query("INSERT INTO platform.guest_hotels (hotel_id, customer_id, guest_id) VALUES ($1, $2, $3)", [h, customer, g1]);
    assert.equal(await sqlStateOf(app.query("INSERT INTO platform.guest_hotels (hotel_id, customer_id, guest_id) VALUES ($1, $2, $3)", [h, customer, g2])), "23505");
    await app.query("UPDATE platform.guest_hotels SET guest_id = $3 WHERE hotel_id = $1 AND customer_id = $2", [h, customer, g2]);
    assert.equal(await sqlStateOf(owner.query("DELETE FROM platform.guests WHERE id = $1", [g2])), "23001", "a linked profile cannot be removed (ON DELETE RESTRICT)");
    const company = String((await app.query("INSERT INTO platform.companies (name) VALUES ('Linked Co') RETURNING id")).rows[0].id);
    await app.query("INSERT INTO platform.company_hotels (hotel_id, company_profile_id, company_id) VALUES ($1, $2, $3)", [h, randomUUID(), company]);
    const [lo, hi] = [g1, g2].sort();
    await app.query("INSERT INTO platform.profile_kept_apart (kind, left_id, right_id) VALUES ('guest', $1, $2)", [lo, hi]);
    assert.equal(await constraintOf(app.query("INSERT INTO platform.profile_kept_apart (kind, left_id, right_id) VALUES ('guest', $1, $2)", [hi, lo])), "profile_kept_apart_order");
    await app.query("DELETE FROM platform.profile_kept_apart WHERE kind = 'guest' AND left_id = $1 AND right_id = $2", [lo, hi]);
    await owner.query("DELETE FROM platform.hotels WHERE id = $1", [h]);
    assert.equal(Number((await app.query("SELECT count(*) AS n FROM platform.guest_hotels WHERE hotel_id = $1", [h])).rows[0].n), 0);
    assert.equal(Number((await app.query("SELECT count(*) AS n FROM platform.company_hotels WHERE hotel_id = $1", [h])).rows[0].n), 0);
  });
});
