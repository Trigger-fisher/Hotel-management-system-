// platform.gst_registry on the REAL PostgreSQL instance (hms_test only): migration 0174 (the provider's extra fields; "manual" refused; the three saved records filled from their own answer),
// the lookup's save and re-check through the real ports, and that the app's role writes this table only the way the lookup does (no DELETE).
// Run with: npm run test:db
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { pgPorts } from "../../src/server/compose/gst";
import type { GstProviderRecord } from "../../src/server/services/gst/gstService";
import { dbDir } from "./helpers/hotels";
import { connectApp, connectOwner, lockTestDatabase, sqlStateOf, tag } from "./helpers/realDb";

const MIGRATION = readFileSync(path.join(dbDir, "migrations", "platform", "0174_gst_registry_provider_fields.sql"), "utf8");
const gstin = (): string => `24${Array.from({ length: 5 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("")}1234F1Z5`;
const ANSWER = {
  gstin: "24AABPF6331N1ZU", legal_name: "KISHOR MADHVDAS FICHDIYA", trade_name: "HOTEL PALLAV", status: "Active", state_code: "24", block_status: "Unblocked", state_jurisdiction: "Rajkot - Ward 5",
  address_details: { street: "KALAWAD ROAD", locality: "RAJKOT", building_name: "NR. KKV HALL,", building_number: "12", floor: "2", landmark: "Near KKV Hall", district: null, city: null, state: "Gujarat", pincode: "360005" },
};

let release: (() => Promise<void>) | undefined;
let owner: DbClient;
let app: DbClient;
const made: string[] = [];

before(async () => {
  release = await lockTestDatabase();
  owner = await connectOwner();
  app = await connectApp();
});

after(async () => {
  for (const g of made) await owner.query("DELETE FROM platform.gst_registry WHERE gstin = $1", [g]);
  await app?.end();
  await owner?.end();
  await release?.();
});

const record = (over: Partial<GstProviderRecord> = {}): GstProviderRecord => ({
  legalName: `Sample ${tag()}`, tradeName: null, status: "active", taxpayerType: "Regular", constitution: null, registeredOn: "2017-07-01", cancelledOn: null, address: "12 Market Road", city: "Pune", district: null, state: "Maharashtra",
  pincode: "411001", natureOfBusiness: [], blockStatus: "Unblocked", stateJurisdiction: "Pune - Ward 1", street: "Market Road", locality: "Camp", buildingName: null, buildingNumber: "12", floor: "1", landmark: null, raw: { legal_name: "x" }, ...over,
});

describe("platform.gst_registry after migration 0174", () => {
  test("the eight provider fields exist; 'manual' as a source is refused; a pattern-less word is kept as the service gave it", async () => {
    const cols = (await owner.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'platform' AND table_name = 'gst_registry'")).rows.map((r) => String(r.column_name));
    for (const c of ["block_status", "state_jurisdiction", "street", "locality", "building_name", "building_number", "floor", "landmark"]) assert.ok(cols.includes(c), c);
    const g = gstin();
    made.push(g);
    assert.equal(await sqlStateOf(owner.query("INSERT INTO platform.gst_registry (gstin, source, fetched_at, refresh_after) VALUES ($1, 'manual', now(), now())", [g])), "23514", "source 'manual' is refused");
    assert.equal(await sqlStateOf(owner.query("INSERT INTO platform.gst_registry (gstin, source, block_status, fetched_at, refresh_after) VALUES ($1, 'gstinapi', repeat('x', 61), now(), now())", [g])), "23514", "a block status over 60 characters is refused");
  });

  test("the backfill of the migration fills the new columns of a saved record from its own answer (raw) and leaves a record without them NULL", async () => {
    const [a, b] = [gstin(), gstin()];
    made.push(a, b);
    await owner.query("INSERT INTO platform.gst_registry (gstin, source, raw, fetched_at, refresh_after) VALUES ($1, 'gstinapi', $2::jsonb, now(), now() + interval '1 day')", [a, JSON.stringify(ANSWER)]);
    await owner.query("INSERT INTO platform.gst_registry (gstin, source, raw, fetched_at, refresh_after) VALUES ($1, 'gstinapi', '{\"legal_name\": \"NO PARTS\", \"address_details\": \"text\"}'::jsonb, now(), now() + interval '1 day')", [b]);
    // the backfill statement of the migration file, run again on these two rows (the migration itself ran when the database was set up)
    const update = MIGRATION.slice(MIGRATION.indexOf("UPDATE platform.gst_registry")).replace("WHERE raw IS NOT NULL", `WHERE gstin IN ('${a}', '${b}') AND raw IS NOT NULL`);
    await owner.query(update);
    const row = (await owner.query("SELECT block_status, state_jurisdiction, street, locality, building_name, building_number, floor, landmark FROM platform.gst_registry WHERE gstin = $1", [a])).rows[0];
    assert.deepEqual({ ...row }, { block_status: "Unblocked", state_jurisdiction: "Rajkot - Ward 5", street: "KALAWAD ROAD", locality: "RAJKOT", building_name: "NR. KKV HALL,", building_number: "12", floor: "2", landmark: "Near KKV Hall" });
    const none = (await owner.query("SELECT block_status, street, landmark FROM platform.gst_registry WHERE gstin = $1", [b])).rows[0];
    assert.deepEqual({ ...none }, { block_status: null, street: null, landmark: null });
  });
});

describe("the lookup's real ports", () => {
  const run = async (text: string, params: unknown[]): Promise<Record<string, unknown>[]> => (await app.query(text, params)).rows as Record<string, unknown>[];
  const ports = pgPorts(run);

  test("a save keeps every field, a re-check replaces them with the newest answer and keeps the count; an answer is read back with the new fields", async () => {
    const g = gstin();
    made.push(g);
    const at = new Date("2026-11-03T10:00:00Z");
    const first = await ports.save(g, record({ street: "Old Street" }), "gstinapi", at, new Date(at.getTime() + 365 * 86_400_000));
    assert.deepEqual([first.street, first.blockStatus, first.buildingNumber, first.stateJurisdiction], ["Old Street", "Unblocked", "12", "Pune - Ward 1"]);
    const again = await ports.save(g, record({ street: "New Street", blockStatus: "Blocked", landmark: "Gate 2" }), "gstinapi", at, new Date(at.getTime() + 365 * 86_400_000));
    assert.deepEqual([again.street, again.blockStatus, again.landmark], ["New Street", "Blocked", "Gate 2"]);
    const read = await ports.get(g);
    assert.deepEqual([read?.street, read?.landmark, read?.floor], ["New Street", "Gate 2", "1"]);
    assert.equal(Number((await owner.query("SELECT times_used FROM platform.gst_registry WHERE gstin = $1", [g])).rows[0].times_used), 2, "one use for each save");
  });

  test("the app's role cannot delete a GST record, and nothing it saves can be the source 'manual'", async () => {
    const g = gstin();
    made.push(g);
    await ports.save(g, record(), "gstinapi", new Date(), new Date(Date.now() + 86_400_000));
    assert.equal(await sqlStateOf(app.query("DELETE FROM platform.gst_registry WHERE gstin = $1", [g])), "42501");
    await assert.rejects(ports.save(g, record(), "manual", new Date(), new Date(Date.now() + 86_400_000)));
  });
});
