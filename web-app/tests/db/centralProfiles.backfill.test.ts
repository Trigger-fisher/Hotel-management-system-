// The backfill of the one common guest and company profile (db/scripts/central-profiles-backfill.sql) on the
// REAL PostgreSQL instance with two real hotels: every hotel record gets its own profile and link; records of the SAME portal login share one; nothing is merged (the same
// mobile in two hotels stays two profiles), the recycle bin's companies are left out, the hotels' own records are not changed, and a second run adds nothing. hms_test only.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import { createTestHotel, dbDir, removeAllTestHotels } from "./helpers/hotels";
import { connectOwner, lockTestDatabase, tag } from "./helpers/realDb";

const BACKFILL = readFileSync(path.join(dbDir, "scripts", "central-profiles-backfill.sql"), "utf8");
const HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaGhhc2g";

let releaseTestLock: (() => Promise<void>) | undefined;
let owner: DbClient;
let a: CreatedHotel;
let b: CreatedHotel;

const customer = async (h: CreatedHotel, over: { name: string; mobile: string; email?: string | null; city?: string | null }): Promise<string> => {
  const id = randomUUID();
  await owner.query(`INSERT INTO "${h.schema}".customers (id, name, mobile, email, city) VALUES ($1, $2, $3, $4, $5)`, [id, over.name, over.mobile, over.email ?? null, over.city ?? null]);
  return id;
};
const company = async (h: CreatedHotel, over: { name: string; gst?: string | null; contacts?: unknown; deleted?: boolean }): Promise<string> => {
  const id = randomUUID();
  await owner.query(`INSERT INTO "${h.schema}".company_profiles (id, name, gst_number, contacts, deleted_at) VALUES ($1, $2, $3, $4::jsonb, $5)`, [id, over.name, over.gst ?? null, JSON.stringify(over.contacts ?? []), over.deleted ? new Date() : null]);
  return id;
};
const login = async (kind: "guest_user" | "corporate_user"): Promise<string> => {
  const id = randomUUID();
  const role = String((await owner.query("SELECT id FROM platform.roles WHERE key = 'viewer' AND hotel_id IS NULL")).rows[0].id);
  await owner.query("SELECT platform.create_person(jsonb_build_object('id', $1::uuid, 'username', $2::text, 'display_name', 'Portal Person', 'password_hash', $3::text, 'role_id', $4::uuid, 'account_role', $5::text)) AS id", [id, `p${tag()}${tag()}`, HASH, role, kind]);
  return id;
};
const linkLogin = (user: string, h: CreatedHotel, kind: "guest" | "company", subject: string) =>
  owner.query("INSERT INTO platform.user_hotels (user_id, hotel_id, subject_kind, subject_id, role_id) VALUES ($1, $2, $3, $4, NULL)", [user, h.id, kind, subject]);
const guestOf = async (h: CreatedHotel, customerId: string) =>
  (await owner.query("SELECT g.* FROM platform.guest_hotels gh JOIN platform.guests g ON g.id = gh.guest_id WHERE gh.hotel_id = $1 AND gh.customer_id = $2", [h.id, customerId])).rows[0];
const companyOf = async (h: CreatedHotel, companyProfileId: string) =>
  (await owner.query("SELECT c.* FROM platform.company_hotels ch JOIN platform.companies c ON c.id = ch.company_id WHERE ch.hotel_id = $1 AND ch.company_profile_id = $2", [h.id, companyProfileId])).rows[0];
type Counts = { g: number; c: number; gl: number; cl: number };
const counts = async (): Promise<Counts> => (await owner.query("SELECT (SELECT count(*) FROM platform.guests)::int AS g, (SELECT count(*) FROM platform.companies)::int AS c, (SELECT count(*) FROM platform.guest_hotels)::int AS gl, (SELECT count(*) FROM platform.company_hotels)::int AS cl")).rows[0] as Counts;
const fingerprint = async (h: CreatedHotel): Promise<string> => {
  const rows = await owner.query(`SELECT (SELECT json_agg(c ORDER BY c.id) FROM "${h.schema}".customers c)::text AS cu, (SELECT json_agg(p ORDER BY p.id) FROM "${h.schema}".company_profiles p)::text AS co`);
  return createHash("sha256").update(String(rows.rows[0].cu) + String(rows.rows[0].co)).digest("hex");
};

before(async () => {
  releaseTestLock = await lockTestDatabase();
  owner = await connectOwner();
  a = await createTestHotel(owner, "Backfill A");
  b = await createTestHotel(owner, "Backfill B");
});

after(async () => {
  if (owner) await removeAllTestHotels(owner).catch(() => undefined);
  await owner?.end();
  await releaseTestLock?.();
});

describe("central profiles backfill", () => {
  test("one profile per record, a login's records share one, nothing merged, hotel records untouched, a second run adds nothing", async () => {
    // a guest with a login in both hotels; a different person with the SAME mobile in hotel B; a hotel-only guest with an odd mobile
    const amitA = await customer(a, { name: "  Amit Joshi ", mobile: "98250 41236", email: "Amit@Example.TEST", city: "Rajkot" });
    const amitB = await customer(b, { name: "Amit J.", mobile: "+91 98250-41236" });
    const sameMobile = await customer(b, { name: "Another Amit", mobile: "098250 41236" });
    const odd = await customer(a, { name: "Walk In", mobile: "12345" });
    const amitLogin = await login("guest_user");
    await linkLogin(amitLogin, a, "guest", amitA);
    await linkLogin(amitLogin, b, "guest", amitB);
    // companies: one with a login in both hotels, one only in A with a GSTIN also used in B, one in the recycle bin
    const tcsA = await company(a, { name: "Tata Consultancy Services", gst: " 24aaact2727q1zw ", contacts: [{ name: "Deepa Iyer", role: "Travel desk", email: "deepa@tcs.test", mobile: "9876543210" }] });
    const tcsB = await company(b, { name: "TCS", gst: "24AAACT2727Q1ZW" });
    const other = await company(b, { name: "Other Co", gst: "24AAACT2727Q1ZW" });
    const binned = await company(a, { name: "Gone Co", deleted: true });
    const tcsLogin = await login("corporate_user");
    await linkLogin(tcsLogin, a, "company", tcsA);
    await linkLogin(tcsLogin, b, "company", tcsB);
    const beforeA = await fingerprint(a);
    const beforeB = await fingerprint(b);
    const start = await counts();

    await owner.query(BACKFILL);

    const gA = await guestOf(a, amitA);
    const gB = await guestOf(b, amitB);
    assert.equal(gA.id, gB.id, "the same login's records share one profile");
    assert.equal(gA.user_id, amitLogin);
    assert.deepEqual([gA.display_name, gA.mobile, gA.email, gA.city], ["Amit Joshi", "+919825041236", "amit@example.test", "Rajkot"], "copied from the first hotel, tidied");
    const sm = await guestOf(b, sameMobile);
    assert.notEqual(sm.id, gA.id, "the same mobile alone is never merged");
    assert.equal(sm.mobile, "+919825041236");
    assert.equal(sm.user_id, null);
    const w = await guestOf(a, odd);
    assert.equal(w.mobile, null, "a mobile that cannot be read is left empty (the hotel keeps its own)");
    const cA = await companyOf(a, tcsA);
    assert.equal(cA.id, (await companyOf(b, tcsB)).id);
    assert.deepEqual([cA.name, cA.gstin, cA.main_contact_name, cA.user_id], ["Tata Consultancy Services", "24AAACT2727Q1ZW", "Deepa Iyer", tcsLogin]);
    assert.equal((cA.contacts as unknown[]).length, 1);
    assert.notEqual((await companyOf(b, other)).id, cA.id, "the same GSTIN alone is never merged");
    assert.equal(await companyOf(a, binned), undefined, "the recycle bin's companies are left out");

    const mid = await counts();
    assert.equal(mid.gl - start.gl, 4, "four guest records linked");
    assert.equal(mid.g - start.g, 3, "three guest profiles (one shared)");
    assert.equal(mid.cl - start.cl, 3);
    assert.equal(mid.c - start.c, 2);
    assert.equal(await fingerprint(a), beforeA, "hotel A's records are unchanged");
    assert.equal(await fingerprint(b), beforeB, "hotel B's records are unchanged");

    await owner.query(BACKFILL);
    assert.deepEqual(await counts(), mid, "a second run adds nothing");

    // a record added later is picked up by the next run, on its own
    const late = await customer(a, { name: "Late Guest", mobile: "9000000001" });
    await owner.query(BACKFILL);
    assert.equal((await counts()).gl, mid.gl + 1);
    assert.ok((await guestOf(a, late)).id);
  });

  test("refuses to run before migration 0132, with a plain sentence", async () => {
    await owner.query("BEGIN");
    try {
      await owner.query("ALTER TABLE platform.guests RENAME TO guests_hidden");
      await assert.rejects(owner.query(BACKFILL), /0132 is not applied yet/);
    } finally {
      await owner.query("ROLLBACK");
    }
  });
});
