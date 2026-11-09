// A Super Admin merge of two possible-duplicate guest profiles on the REAL PostgreSQL instance (hms_test only), through the real service and the PostgreSQL review unit: the
// hotels' links move to the kept profile, the other stays as history, the audit row is written in the same transaction, and NOTHING in either hotel changes (customers,
// bills, stays, advances: byte-identical before and after). Run with: npm run test:db
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createSharedPool, type SharedPool } from "../../src/db/pool";
import { createPgProfileReviewUnit } from "../../src/server/repos/postgres/centralProfiles";
import { createProfileReviewService } from "../../src/server/services/platform/profileReviewService";
import { makeSession } from "../server/helpers/session";
import { createTestHotel, dbDir, insertRow, removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectOwner, lockTestDatabase, tag } from "./helpers/realDb";

const BACKFILL = readFileSync(path.join(dbDir, "scripts", "central-profiles-backfill.sql"), "utf8");
const HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaGhhc2g";
const META = { ip: "127.0.0.1", traceId: "trace-merge-db", userAgent: "test" };

let release: (() => Promise<void>) | undefined;
let owner: DbClient;
let pool: SharedPool;
let a: CreatedHotel;
let b: CreatedHotel;
let superId = "";

const fingerprint = async (h: CreatedHotel): Promise<string> => {
  const parts: string[] = [];
  for (const table of ["customers", "bill_master_bills", "bill_master_advances", "pms_stays"]) {
    const r = await owner.query(`SELECT coalesce(json_agg(t ORDER BY t.id)::text, '[]') AS j FROM "${h.schema}".${table} t`);
    parts.push(String(r.rows[0].j));
  }
  return createHash("sha256").update(parts.join("|")).digest("hex");
};

before(async () => {
  release = await lockTestDatabase();
  owner = await connectOwner();
  pool = createSharedPool({ databaseUrl: appUrl(), max: 4 });
  a = await createTestHotel(owner, "Merge A");
  b = await createTestHotel(owner, "Merge B");
  superId = randomUUID();
  const role = String((await owner.query("SELECT id FROM platform.roles WHERE key = 'admin' AND hotel_id IS NULL")).rows[0].id);
  await owner.query("SELECT platform.create_person(jsonb_build_object('id', $1::uuid, 'username', $2::text, 'display_name', 'Root Person', 'password_hash', $3::text, 'role_id', $4::uuid, 'account_role', 'super_admin')) AS id", [superId, `root${tag()}${tag()}`, HASH, role]);
});

after(async () => {
  await pool?.end();
  if (owner) await removeAllTestHotels(owner).catch(() => undefined);
  await owner?.end();
  await release?.();
});

describe("merge on the real database", () => {
  test("two hotels' records of one person: merged into one profile; the audit row is written; the hotels' customers, bills, stays and advances are untouched", async () => {
    const custA = String((await insertRow(owner, a.schema, "customers", { name: "Amit Joshi", mobile: "9825041236", is_active: true })).id);
    const custB = String((await insertRow(owner, b.schema, "customers", { name: "Amit J.", mobile: "98250 41236", is_active: true })).id);
    await insertRow(owner, a.schema, "bill_master_bills", { mobile_number: "9825041236", company_id: null });
    await owner.query(BACKFILL);
    const profileOf = async (h: CreatedHotel, id: string) => String((await owner.query("SELECT guest_id FROM platform.guest_hotels WHERE hotel_id = $1 AND customer_id = $2", [h.id, id])).rows[0].guest_id);
    const keep = await profileOf(a, custA);
    const gone = await profileOf(b, custB);
    assert.notEqual(keep, gone, "the backfill made two profiles (it never merges)");
    const beforeA = await fingerprint(a);
    const beforeB = await fingerprint(b);

    const service = createProfileReviewService({ unit: createPgProfileReviewUnit(pool), now: () => new Date() });
    const root = makeSession({ userId: superId, hotelId: "", accountRole: "super_admin", roleKey: "super_admin", roleLevel: 4, client: "web" });
    const listed = await service.duplicates(root, { kind: "guest", search: "+919825041236", page: 1, pageSize: 25 });
    assert.ok(listed.items.some((g) => g.profiles.some((p) => p.id === keep) && g.profiles.some((p) => p.id === gone)), "the pair is a possible duplicate (same mobile)");
    const res = await service.merge(root, { kind: "guest", keepId: keep, mergeIds: [gone], reason: "Same mobile, same guest at two hotels" }, META);
    assert.deepEqual([res.merged, res.relinked], [1, 1]);

    assert.equal(await profileOf(b, custB), keep, "hotel B's record now points at the kept profile");
    const goneRow = (await owner.query("SELECT merged_into, merged_by FROM platform.guests WHERE id = $1", [gone])).rows[0];
    assert.deepEqual([String(goneRow.merged_into), String(goneRow.merged_by)], [keep, superId]);
    const audit = (await owner.query("SELECT reason, result, entity_id FROM platform.audit_log WHERE action = 'profile_merged' AND trace_id = 'trace-merge-db'")).rows;
    assert.deepEqual(audit.map((r) => [r.reason, r.result, String(r.entity_id)]), [["Same mobile, same guest at two hotels", "success", keep]]);
    assert.equal(await fingerprint(a), beforeA, "hotel A: customers, bills, stays and advances are byte-identical");
    assert.equal(await fingerprint(b), beforeB, "hotel B: the same");
  });
});
