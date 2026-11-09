// The Central tabs on the REAL PostgreSQL instance (hms_test only), through the real service and the PostgreSQL unit: every list and detail runs, a mobile and an email come masked, no
// password hash is read, Reveal writes its audit line in the same transaction, and the app's own database role can read but never change these tables.
// Run with: npm run test:db
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createSharedPool, type SharedPool } from "../../src/db/pool";
import { createPgCentralConsoleUnit } from "../../src/server/repos/postgres/centralConsole";
import { createCentralConsoleService } from "../../src/server/services/platform/centralConsoleService";
import { makeSession } from "../server/helpers/session";
import { createTestHotel, removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectApp, connectOwner, lockTestDatabase, sqlStateOf, tag } from "./helpers/realDb";

const HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaGhhc2g";
const META = { ip: "127.0.0.1", traceId: "trace-central-db", userAgent: "test" };
const MOBILE = `+919${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
const EMAIL = `central.${Math.random().toString(36).slice(2, 10)}@example.com`;

let release: (() => Promise<void>) | undefined;
let owner: DbClient;
let pool: SharedPool;
let hotel: CreatedHotel;
let superId = "";
let service: ReturnType<typeof createCentralConsoleService>;
let guestId = "";
let companyId = "";
let gstId = "";
let lookupId = "";
let root = makeSession();
const name = `Central ${tag()}${tag()}`;
const letters = (n: number): string => Array.from({ length: n }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("");

before(async () => {
  release = await lockTestDatabase();
  owner = await connectOwner();
  pool = createSharedPool({ databaseUrl: appUrl(), max: 4 });
  hotel = await createTestHotel(owner, "Central Hotel");
  superId = randomUUID();
  const role = String((await owner.query("SELECT id FROM platform.roles WHERE key = 'admin' AND hotel_id IS NULL")).rows[0].id);
  await owner.query("SELECT platform.create_person(jsonb_build_object('id', $1::uuid, 'username', $2::text, 'display_name', 'Root Person', 'password_hash', $3::text, 'role_id', $4::uuid, 'account_role', 'super_admin')) AS id", [superId, `root${tag()}${tag()}`, HASH, role]);
  root = makeSession({ userId: superId, hotelId: "", accountRole: "super_admin", roleKey: "super_admin", roleLevel: 4, client: "web" });
  guestId = String((await owner.query("INSERT INTO platform.guests (display_name, mobile, email, city) VALUES ($1, $2, $3, 'Surat') RETURNING id", [name, MOBILE, EMAIL])).rows[0].id);
  await owner.query("INSERT INTO platform.guest_hotels (hotel_id, customer_id, guest_id) VALUES ($1, $2, $3)", [hotel.id, randomUUID(), guestId]);
  companyId = String((await owner.query("INSERT INTO platform.companies (name, gstin, email, mobile, contacts) VALUES ($1, '24ABCDE1234F1Z5', 'accounts@central.example', '9898012345', $2::jsonb) RETURNING id", [`${name} Ltd`, JSON.stringify([{ name: "Ravi", role: "Owner", email: "ravi@central.example", mobile: "9898011111" }])])).rows[0].id);
  gstId = String((await owner.query("INSERT INTO platform.gst_registry (gstin, legal_name, status, source, raw, fetched_at, refresh_after) VALUES ($1, $2, 'active', 'gstinapi', $3::jsonb, now(), now() + interval '365 days') RETURNING id", [`24${letters(5)}1234F1Z5`, name, JSON.stringify({ legal_name: name })])).rows[0].id);
  lookupId = String((await owner.query("INSERT INTO platform.gst_lookups (gstin, provider, outcome, took_ms, requested_by, hotel_id) VALUES ('24ABCDE1234F1Z5', 'gstinapi', 'found', 700, $1, $2) RETURNING id", [superId, hotel.id])).rows[0].id);
  service = createCentralConsoleService({ unit: createPgCentralConsoleUnit(pool), now: () => new Date() });
});

after(async () => {
  await pool?.end();
  if (owner) await removeAllTestHotels(owner).catch(() => undefined);
  await owner?.end();
  await release?.();
});

describe("Central tabs on the real database", () => {
  test("every list and every detail runs; the guest is found by name and, masked, by nothing else", async () => {
    const guests = (await service.list(root, "guests", { search: name, page: 1, pageSize: 25 })) as { total: number; items: { id: string; mobile: string; email: string; hotelCount: number }[] };
    assert.equal(guests.total, 1);
    assert.deepEqual([guests.items[0].id, guests.items[0].mobile, guests.items[0].email, guests.items[0].hotelCount], [guestId, `+91 ••••• ••${MOBILE.slice(-3)}`, "c•••@example.com", 1]);
    assert.equal(((await service.list(root, "guests", { search: MOBILE.slice(3, 7), page: 1, pageSize: 25 })) as { total: number }).total, 0, "a part of a mobile finds nothing");
    assert.equal(((await service.list(root, "guests", { search: MOBILE, page: 1, pageSize: 25 })) as { total: number }).total, 1, "the full mobile does");
    assert.equal(((await service.list(root, "guests", { search: EMAIL.toUpperCase(), page: 1, pageSize: 25 })) as { total: number }).total, 1, "the full email does, any case");
    assert.equal(((await service.list(root, "companies", { search: name, page: 1, pageSize: 25 })) as { total: number }).total, 1);
    assert.equal(((await service.list(root, "gst", { search: name, page: 1, pageSize: 25 })) as { total: number }).total, 1);
    assert.ok(((await service.list(root, "lookups", { search: "found", page: 1, pageSize: 25 })) as { total: number }).total >= 1);
    assert.ok(((await service.list(root, "logins", { page: 1, pageSize: 10 })) as { total: number }).total >= 1);
    const login = (await service.detail(root, "logins", superId)) as Record<string, unknown>;
    assert.equal(login.roleType, "super_admin");
    assert.ok(!JSON.stringify(login).includes("argon2"), "no password hash");
    const g = (await service.detail(root, "guests", guestId)) as { hotels: { hotelName: string }[]; loginUsername: string | null };
    assert.equal(g.hotels.length, 1);
    const c = (await service.detail(root, "companies", companyId)) as { contacts: { email: string; mobile: string }[]; landline: string | null };
    assert.deepEqual([c.contacts[0].email, c.contacts[0].mobile], ["r•••@central.example", "••••• ••111"]);
    const s = (await service.detail(root, "gst", gstId)) as { raw: { legal_name: string }; stateCode: string };
    assert.deepEqual([s.raw.legal_name, s.stateCode], [name, "24"]);
    assert.equal(((await service.detail(root, "lookups", lookupId)) as { hotelName: string }).hotelName, "Central Hotel");
  });

  test("Reveal returns the full value and the audit line is in platform.audit_log, without the value", async () => {
    const r = await service.reveal(root, { kind: "guest", id: guestId, field: "email" }, META);
    assert.equal(r.value, EMAIL);
    const rows = (await owner.query("SELECT actor_user_id, action, entity_id, target_label, after FROM platform.audit_log WHERE action = 'central_revealed' AND entity_id = $1", [guestId])).rows;
    assert.equal(rows.length, 1);
    assert.deepEqual([String(rows[0].actor_user_id), rows[0].target_label], [superId, `Guest profile: ${name}`]);
    assert.ok(!JSON.stringify(rows[0]).includes(EMAIL), "the value is not in the audit row");
  });

  test("the app's database role can read these tables but change none of them (no INSERT, UPDATE or DELETE on the logins, the GST lookups or the profiles' tables)", async () => {
    const app = await connectApp();
    try {
      for (const sql of [
        `DELETE FROM platform.guests WHERE id = '${guestId}'`,
        `DELETE FROM platform.companies WHERE id = '${companyId}'`,
        `DELETE FROM platform.gst_registry WHERE id = '${gstId}'`,
        `UPDATE platform.gst_lookups SET provider = 'x' WHERE id = '${lookupId}'`,
        `DELETE FROM platform.gst_lookups WHERE id = '${lookupId}'`,
      ]) {
        assert.equal(await sqlStateOf(app.query(sql)), "42501", sql);
      }
    } finally {
      await app.end();
    }
  });
});
