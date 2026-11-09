// The Central tabs' writes on the REAL PostgreSQL instance (hms_test only), through the real service and unit, on a hotel that already has data (migration 0175): create, edit, delete and
// restore of a guest profile, a company profile, a GST record and a login; a deleted profile leaves the hotel's own copy, its link and its bills exactly as they were and drops out of
// matching and the duplicates list; a deleted GST record is fetched fresh by the next lookup; a login is made through the account side and closed, never removed; the app role has no DELETE.
// Run with: npm run test:db
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createSharedPool, type SharedPool } from "../../src/db/pool";
import { buildCentralConsole } from "../../src/server/compose/centralConsole";
import { pgPorts } from "../../src/server/compose/gst";
import { createPgCentralConsoleUnit } from "../../src/server/repos/postgres/centralConsole";
import { createPgCentralProfilesUnit } from "../../src/server/repos/postgres/centralProfiles";
import type { GstProviderRecord } from "../../src/server/services/gst/gstService";
import { makeSession } from "../server/helpers/session";
import { createTestHotel, insertRow, removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectApp, connectOwner, lockTestDatabase, sqlStateOf, tag } from "./helpers/realDb";

const HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaGhhc2g";
const META = { ip: "127.0.0.1", traceId: "trace-central-write-db", userAgent: "test" };
const digits = (n: number): string => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
const letters = (n: number): string => Array.from({ length: n }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("");

let release: (() => Promise<void>) | undefined;
let owner: DbClient;
let pool: SharedPool;
let hotel: CreatedHotel;
let rootId = "";
let root = makeSession();
let svc: ReturnType<typeof buildCentralConsole>;
const invites: string[] = [];

const fingerprint = async (): Promise<string> => {
  const parts: string[] = [];
  for (const t of ["customers", "bill_master_bills"]) parts.push(String((await owner.query(`SELECT coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '') AS m FROM "${hotel.schema}".${t} x`)).rows[0].m));
  parts.push(String((await owner.query("SELECT coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '') AS m FROM platform.guest_hotels x WHERE hotel_id = $1", [hotel.id])).rows[0].m));
  return createHash("sha256").update(parts.join("|")).digest("hex");
};

before(async () => {
  release = await lockTestDatabase();
  owner = await connectOwner();
  pool = createSharedPool({ databaseUrl: appUrl(), max: 4 });
  hotel = await createTestHotel(owner, "Central Write");
  rootId = randomUUID();
  const role = String((await owner.query("SELECT id FROM platform.roles WHERE key = 'admin' AND hotel_id IS NULL")).rows[0].id);
  await owner.query("SELECT platform.create_person(jsonb_build_object('id', $1::uuid, 'username', $2::text, 'display_name', 'Root Person', 'password_hash', $3::text, 'role_id', $4::uuid, 'account_role', 'super_admin')) AS id", [rootId, `root${tag()}${tag()}`, HASH, role]);
  root = makeSession({ userId: rootId, hotelId: "", accountRole: "super_admin", roleKey: "super_admin", roleLevel: 4, client: "web" });
  const gstPorts = pgPorts(async (text, params) => (await owner.query(text, params as unknown[])).rows as Record<string, unknown>[]);
  svc = buildCentralConsole(
    createPgCentralConsoleUnit(pool),
    {
      credentials: () => ({ issueInvite: async (id: string) => (invites.push(id), { queued: true }), adminResetPassword: async () => ({ queued: true }), changeEmail: async () => ({ ok: true as const }) }) as never,
      gst: {
        lookup: async (_s, gstin) => {
          const r: GstProviderRecord = { legalName: "WRITE TEST LTD", tradeName: null, status: "active", taxpayerType: null, constitution: null, registeredOn: null, cancelledOn: null, address: null, city: null, district: null, state: "Gujarat", pincode: null, natureOfBusiness: [], blockStatus: null, stateJurisdiction: null, street: null, locality: null, buildingName: null, buildingNumber: null, floor: null, landmark: null, raw: { legal_name: "WRITE TEST LTD" } };
          const now = new Date();
          await gstPorts.save(gstin, r, "gstinapi", now, new Date(now.getTime() + 86_400_000));
          return { message: "ok", from: "provider", entry: { gstin }, check: { ok: true } };
        },
      },
    },
  );
});

after(async () => {
  await pool?.end();
  if (owner) await removeAllTestHotels(owner).catch(() => undefined);
  await owner?.end();
  await release?.();
});

describe("guest profile on a hotel that already has data", () => {
  test("delete hides the profile and drops it from matching and duplicates; the hotel's copy, its link and its bills are byte for byte as they were; restore brings it back", async () => {
    const mobile = `+919${digits(9)}`;
    const name = `Write ${tag()}${tag()}`;
    const g = await svc.createGuest(root, { name, mobile, email: `w.${tag()}@example.com`, city: "Surat" }, META);
    const custId = String((await insertRow(owner, hotel.schema, "customers", { name, mobile: mobile.slice(3), is_active: true })).id);
    await insertRow(owner, hotel.schema, "bill_master_bills", { mobile_number: mobile.slice(3), company_id: null });
    await owner.query("INSERT INTO platform.guest_hotels (hotel_id, customer_id, guest_id) VALUES ($1, $2, $3)", [hotel.id, custId, g.id]);
    const before = await fingerprint();
    const unit = createPgCentralProfilesUnit(pool);
    assert.equal((await unit.run((r) => r.guests.byMobile(mobile)))?.id, g.id);

    await svc.updateGuest(root, g.id, { city: "Rajkot" }, META);
    assert.equal(await fingerprint(), before, "editing the profile never touches the hotel's copy");
    await assert.rejects(svc.deleteGuest(root, g.id, { confirmName: "wrong" }, META));
    await svc.deleteGuest(root, g.id, { confirmName: name, reason: "Entered twice" }, META);
    assert.equal(await fingerprint(), before, "deleting the profile never touches the hotel's copy, its link or its bills");
    assert.equal(await unit.run((r) => r.guests.byMobile(mobile)), null, "not matched while deleted");
    assert.equal(await unit.run((r) => r.guests.ofRecord(hotel.id, custId)), null, "the hotel behaves as unlinked meanwhile");
    assert.equal(((await svc.list(root, "guests", { search: name, page: 1, pageSize: 25 })) as { total: number }).total, 0);
    assert.equal(((await svc.list(root, "guests", { search: name, deleted: true, page: 1, pageSize: 25 })) as { total: number }).total, 1);
    const row = (await owner.query("SELECT deleted_at, deleted_by, deleted_reason FROM platform.guests WHERE id = $1", [g.id])).rows[0];
    assert.deepEqual([row.deleted_at !== null, String(row.deleted_by), row.deleted_reason], [true, rootId, "Entered twice"]);
    // two live profiles with one mobile show as a duplicate; a deleted one does not
    const twin = String((await owner.query("INSERT INTO platform.guests (display_name, mobile) VALUES ('Twin', $1) RETURNING id", [mobile])).rows[0].id);
    const dup = await unit.run((r) => r.review.duplicates("guest"));
    assert.ok(!dup.some((d) => d.ids.includes(g.id) || d.ids.includes(twin)), "a deleted profile is not a duplicate of the live one");
    await svc.restoreGuest(root, g.id, META);
    assert.equal((await unit.run((r) => r.guests.byMobile(mobile)))?.id, g.id, "matched again");
    assert.equal(await fingerprint(), before);
    const dup2 = await unit.run((r) => r.review.duplicates("guest"));
    assert.ok(dup2.some((d) => d.ids.includes(g.id) && d.ids.includes(twin)), "back in the duplicates list");
    assert.equal(await sqlStateOf(owner.query("UPDATE platform.guests SET user_id = $2, deleted_at = now() WHERE id = $1", [g.id, rootId])), "23514", "a deleted profile cannot hold a login (table rule)");
    const app = await connectApp();
    try {
      assert.equal(await sqlStateOf(app.query("DELETE FROM platform.guests WHERE id = $1", [g.id])), "42501");
    } finally {
      await app.end();
    }
  });

  test("a company profile with a sign-in cannot be deleted; the audit lines hold field names, never values", async () => {
    const name = `Co ${tag()}${tag()}`;
    const c = await svc.createCompany(root, { name, gstin: `24${letters(5)}${digits(4)}F1Z5`, email: `c.${tag()}@example.com` }, META);
    await owner.query("UPDATE platform.companies SET user_id = $2 WHERE id = $1", [c.id, rootId]);
    await assert.rejects(svc.deleteCompany(root, c.id, { confirmName: name }, META), (e: { code?: string }) => e.code === "CONFLICT");
    await owner.query("UPDATE platform.companies SET user_id = NULL WHERE id = $1", [c.id]);
    await svc.deleteCompany(root, c.id, { confirmName: name }, META);
    const rows = (await owner.query("SELECT action, after FROM platform.audit_log WHERE entity_id = $1 AND action LIKE 'central_%' ORDER BY at", [c.id])).rows;
    assert.deepEqual(rows.map((r) => r.action), ["central_created", "central_deleted"]);
    assert.ok(!JSON.stringify(rows).includes("example.com"), "no value in the audit lines");
  });
});

describe("GST record and login", () => {
  test("delete hides the record so the next lookup fetches it fresh and brings the same row back; the app role still has no DELETE", async () => {
    const g = `24${letters(5)}${digits(4)}F1Z5`;
    const rec = await svc.createGst(root, g, META);
    await svc.deleteGst(root, rec.id, { confirmName: g }, META);
    const ports = pgPorts(async (text, params) => (await owner.query(text, params as unknown[])).rows as Record<string, unknown>[]);
    assert.equal(await ports.get(g), null, "a deleted record is not an answer: the lookup would ask the provider");
    const again = await svc.createGst(root, g, META);
    assert.equal(again.id, rec.id, "the same row comes back, not a second one");
    assert.equal(again.deletedAt, null);
    await owner.query("DELETE FROM platform.gst_registry WHERE gstin = $1", [g]);
  });

  test("a login is made through the account side (invited, invitation issued, no usable password) and closed, never removed, with its sign-ins ended", async () => {
    const username = `w${tag()}${tag()}`.slice(0, 12);
    const made = await svc.createLogin(root, { username, displayName: "Write Person", email: `${username}@example.com`, mobile: `98${digits(8)}`, roleType: "platform_admin" }, META);
    assert.equal(invites.at(-1), made.id);
    const row = (await owner.query("SELECT status, password_hash FROM platform.logins WHERE id = $1", [made.id])).rows[0];
    assert.equal(row.status, "invited");
    assert.ok(!JSON.stringify(made).includes(String(row.password_hash)), "the hash is not in the answer");
    await owner.query("INSERT INTO platform.sessions (user_id, client, token_hash, issued_at, last_seen_at, expires_at) VALUES ($1, 'web', $2, now(), now(), now() + interval '1 hour')", [made.id, createHash("sha256").update(randomUUID()).digest("hex")]);
    await assert.rejects(svc.deleteLogin(root, rootId, { confirmName: "x" }, META));
    await svc.deleteLogin(root, made.id, { confirmName: username }, META);
    const after = (await owner.query("SELECT deleted_at FROM platform.logins WHERE id = $1", [made.id])).rows[0];
    assert.ok(after.deleted_at !== null, "closed, not removed");
    assert.equal(Number((await owner.query("SELECT count(*) AS n FROM platform.sessions WHERE user_id = $1 AND revoked_at IS NULL", [made.id])).rows[0].n), 0, "every sign-in ended");
  });
});
