// GST lookup (platform 0167; MJ, 2 Nov 2026: "save the GST and company details when it is searched the first time, then reuse it"). What must hold: a GSTIN is checked for free first
// (shape, state, PAN, check character); a mistyped one never reaches the paid service; a saved record answers without the service; a new one is asked of the service ONCE, saved and
// logged, then answered from the saved record; a record a year old is asked again; a service that fails still answers with the old record; with no service set up a valid GSTIN answers
// with its state; an API key may not look up at all.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { checkGstin, gstCopy } from "@shared/dashboards/gst";
import { tokenCallVerdict } from "../../src/server/auth/apiTokens";
import { cleanRaw, gstinApiProvider, memoryGstPorts, providerFor } from "../../src/server/compose/gst";
import { createGstService, type GstProvider, type GstProviderRecord } from "../../src/server/services/gst/gstService";
import { makeSession } from "./helpers/session";

const VALID = "27AAPFU0939F1ZV";
const staff = makeSession({ userId: "00000000-0000-4000-8000-0000000000a1", accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4 });

const record = (over: Partial<GstProviderRecord> = {}): GstProviderRecord => ({
  legalName: "Sample Traders Private Limited", tradeName: "Sample Traders", status: "active", taxpayerType: "Regular", constitution: "Private Limited Company", registeredOn: "2017-07-01", cancelledOn: null,
  address: "12 Market Road, Pune", city: "Pune", district: "Pune", state: "Maharashtra", pincode: "411001", natureOfBusiness: ["Retail Business"], blockStatus: "Unblocked", stateJurisdiction: null, street: "Market Road", locality: "Camp",
  buildingName: null, buildingNumber: "12", floor: null, landmark: null, raw: { gstin: VALID }, ...over,
});

function world(o: { provider?: "ok" | "none" | "missing" | "fail"; answer?: GstProviderRecord } = {}) {
  let clock = new Date("2026-11-02T10:00:00Z");
  const ports = memoryGstPorts();
  let calls = 0;
  const provider: GstProvider | null =
    o.provider === "none"
      ? null
      : {
          id: "test-gsp",
          lookup: async () => {
            calls += 1;
            if (o.provider === "fail") throw Object.assign(new Error("timeout"), { code: "TIMEOUT" });
            if (o.provider === "missing") return { found: false as const };
            return { found: true as const, record: o.answer ?? record() };
          },
        };
  const service = createGstService({ ports, provider, now: () => clock });
  return { service, ports, calls: () => calls, advance: (days: number) => void (clock = new Date(clock.getTime() + days * 86_400_000)) };
}

describe("the free check of a GSTIN", () => {
  test("a real GSTIN: valid, its state and PAN read from the number; spaces and small letters are fine", () => {
    const c = checkGstin(" 27aapfu0939f1zv ");
    assert.deepEqual([c.ok, c.gstin, c.state, c.stateCode, c.pan], [true, VALID, "Maharashtra", "27", "AAPFU0939F"]);
    assert.equal(checkGstin("24AAACC1206D1ZM").state, "Gujarat");
  });
  test("a typing mistake in any character is caught by the check character; a short, malformed or unknown-state number is named", () => {
    assert.equal(checkGstin("27AAPFU0939F1ZX").problem, "checksum");
    assert.equal(checkGstin("27AAPFU0939F1Z").problem, "length");
    assert.equal(checkGstin("27AAPFU09391FZV").problem, "format");
    assert.equal(checkGstin("99AAPFU0939F1ZV").problem, "state");
    assert.equal(checkGstin("").problem, "empty");
  });
});

describe("the lookup", () => {
  test("the first search asks the service once and saves the company; the next ones come from the saved record", async () => {
    const w = world();
    const first = await w.service.lookup(staff, VALID);
    assert.deepEqual([first.from, first.entry?.legalName, first.entry?.state, first.entry?.pan, first.message], ["provider", "Sample Traders Private Limited", "Maharashtra", "AAPFU0939F", gstCopy.found]);
    const again = await w.service.lookup(staff, VALID);
    assert.deepEqual([again.from, again.entry?.tradeName, again.message], ["saved", "Sample Traders", gstCopy.saved]);
    assert.equal(w.calls(), 1, "the service was asked once");
    assert.equal(w.ports.calls.length, 1);
    assert.deepEqual([w.ports.calls[0]?.outcome, w.ports.calls[0]?.provider, w.ports.calls[0]?.requestedBy], ["found", "test-gsp", staff.userId]);
    assert.equal(w.ports.rows.get(VALID)?.timesUsed, 2);
  });

  test("a mistyped GSTIN never reaches the paid service", async () => {
    const w = world();
    const r = await w.service.lookup(staff, "27AAPFU0939F1ZX");
    assert.deepEqual([r.check.ok, r.entry, r.from, r.message], [false, null, "none", gstCopy.problems.checksum]);
    assert.equal(w.calls(), 0);
    assert.equal(w.ports.calls.length, 0);
  });

  test("a record a year old is asked again and replaced; a cancelled registration says so", async () => {
    const w = world({ answer: record({ status: "cancelled", cancelledOn: "2026-10-01" }) });
    await w.service.lookup(staff, VALID);
    w.advance(366);
    const later = await w.service.lookup(staff, VALID);
    assert.deepEqual([later.from, later.entry?.status, later.message], ["provider", "cancelled", gstCopy.cancelled]);
    assert.equal(w.calls(), 2);
  });

  test("the service fails: a saved record still answers; with none, a plain sentence and the failure is logged", async () => {
    const empty = world({ provider: "fail" });
    const r = await empty.service.lookup(staff, VALID);
    assert.deepEqual([r.entry, r.from, r.message], [null, "none", gstCopy.failed]);
    assert.deepEqual([empty.ports.calls[0]?.outcome, empty.ports.calls[0]?.errorCode], ["failed", "TIMEOUT"]);
  });

  test("not on the GST record: said plainly, logged, nothing saved", async () => {
    const w = world({ provider: "missing" });
    const r = await w.service.lookup(staff, VALID);
    assert.deepEqual([r.entry, r.message], [null, gstCopy.notFound]);
    assert.equal(w.ports.rows.size, 0);
    assert.equal(w.ports.calls[0]?.outcome, "not_found");
  });

  test("no service set up yet: a valid GSTIN answers with its state, and says the lookup is not on", async () => {
    const w = world({ provider: "none" });
    const r = await w.service.lookup(staff, VALID);
    assert.deepEqual([r.check.state, r.entry, r.providerReady, r.message], ["Maharashtra", null, false, gstCopy.notReady]);
  });

  test("a call log that cannot be written never hides a company already paid for", async () => {
    const w = world();
    w.ports.log = async () => {
      throw new Error("insert refused");
    };
    const r = await w.service.lookup(staff, VALID);
    assert.deepEqual([r.from, r.entry?.legalName, r.entry?.natureOfBusiness], ["provider", "Sample Traders Private Limited", ["Retail Business"]]);
    assert.equal(w.ports.rows.size, 1);
  });

  test("an API key may not look up (each call can cost money)", async () => {
    const w = world();
    await assert.rejects(w.service.lookup({ ...staff, client: "token" }, VALID));
    assert.equal(w.calls(), 0);
  });
});

describe("gstinapi.in (GST_LOOKUP_PROVIDER=gstinapi)", () => {
  // the answer's shape as the service gave it on 2 Nov 2026 (billing fields beside data)
  const ANSWER = {
    success: true, gstin: "24AAACC1206D1ZM",
    data: { gstin: "24AAACC1206D1ZM", legal_name: "CENTRAL WAREHOUSING CORPORATION", trade_name: "CENTRAL WARE HOUSING CORP.LTD.", status: "Active", taxpayer_type: "Regular", business_constitution: null, registration_date: "2017-07-01", cancellation_date: null, state_code: "24", address: "CENTRAL WAREHOUSING CORPORATION, MAHALAXMI CHAR RASTA, PALDI", city: "PALDI", address_details: { district: null, city: null, state: "Gujarat", locality: "PALDI", pincode: "380007" }, pincode: "380007", nature_of_business: null, block_status: "Unblocked" },
    billed_to: "paid", credits_remaining: 24, free_remaining: 0, response_ms: 55,
  };
  const seen: { url: string; key: string | null }[] = [];
  const fake = (status: number, body: unknown = null): typeof fetch => (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), key: new Headers(init?.headers).get("x-api-key") });
    return new Response(body === null ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  test("a found company maps to the saved fields; the key goes in x-api-key; the billing fields are not kept", async () => {
    const got = await gstinApiProvider("test-key", fake(200, ANSWER)).lookup("24AAACC1206D1ZM");
    assert.equal(got.found, true);
    if (!got.found) return;
    const r = got.record;
    assert.deepEqual([r.legalName, r.tradeName, r.status, r.registeredOn, r.city, r.state, r.pincode, r.natureOfBusiness], ["CENTRAL WAREHOUSING CORPORATION", "CENTRAL WARE HOUSING CORP.LTD.", "active", "2017-07-01", "PALDI", "Gujarat", "380007", []]);
    assert.equal("credits_remaining" in r.raw, false);
    assert.deepEqual(seen.at(-1), { url: "https://www.gstinapi.in/v1/gstin/24AAACC1206D1ZM", key: "test-key" });
  });

  test("404 is not on the GST record; a refused key, no credits and a down service are failures with a code", async () => {
    assert.deepEqual(await gstinApiProvider("k", fake(404)).lookup(VALID), { found: false });
    for (const [status, code] of [[401, "KEY_REFUSED"], [402, "NO_CREDITS"], [429, "RATE_LIMITED"], [503, "SERVICE_DOWN"]] as const) {
      await assert.rejects(gstinApiProvider("k", fake(status)).lookup(VALID), (e: { code?: string }) => e.code === code);
    }
  });

  // the answer of 3 Nov 2026 as the three saved records show it: 16 fields in data, the address in parts
  const FULL = {
    success: true, gstin: "24AABPF6331N1ZU", billed_to: "paid", credits_remaining: 23, free_remaining: 0, response_ms: 61,
    data: {
      gstin: "24AABPF6331N1ZU", legal_name: "KISHOR MADHVDAS FICHDIYA", trade_name: "HOTEL PALLAV", status: "Active", taxpayer_type: "Regular", business_constitution: null, registration_date: "2017-07-01", cancellation_date: null,
      state_code: "24", state_jurisdiction: "Rajkot - Ward 5", address: "OPP. SAINT MARRYS SCHOOL, NR. KKV HALL, KALAWAD ROAD, RAJKOT", city: "RAJKOT", pincode: "360005", nature_of_business: null, block_status: "Unblocked",
      address_details: { city: null, floor: "2", state: "Gujarat", street: "KALAWAD ROAD", pincode: "360005", district: null, landmark: "Near KKV Hall", locality: "RAJKOT", building_name: "NR. KKV HALL,", building_number: "OPP. SAINT MARRYS SCHOOL," },
    },
  };

  test("every field the service gives has its own column: the 8 added in platform 0174 are read from the answer, nothing is worked out", async () => {
    const got = await gstinApiProvider("test-key", fake(200, FULL)).lookup("24AABPF6331N1ZU");
    assert.equal(got.found, true);
    if (!got.found) return;
    const r = got.record;
    assert.deepEqual([r.blockStatus, r.stateJurisdiction, r.street, r.locality, r.buildingName, r.buildingNumber, r.floor, r.landmark], ["Unblocked", "Rajkot - Ward 5", "KALAWAD ROAD", "RAJKOT", "NR. KKV HALL,", "OPP. SAINT MARRYS SCHOOL,", "2", "Near KKV Hall"]);
    assert.deepEqual([r.city, r.district, r.state, r.pincode], ["RAJKOT", null, "Gujarat", "360005"]);
    assert.deepEqual(Object.keys(r.raw).sort(), Object.keys(FULL.data).sort(), "the saved answer holds the same 16 fields, as they came");
  });

  test("the city is the service's own: with none given it stays empty (it is never worked out from the locality)", async () => {
    const noCity = { ...FULL, data: { ...FULL.data, city: null } };
    const got = await gstinApiProvider("k", fake(200, noCity)).lookup("24AABPF6331N1ZU");
    assert.equal(got.found && got.record.city, null);
    assert.equal(got.found && got.record.locality, "RAJKOT");
  });

  test("the saved answer (raw) never holds the key, whatever the service sends back", async () => {
    const hostile = { ...FULL, data: { ...FULL.data, api_key: "test-key-123", "x-api-key": "test-key-123", note: "your key test-key-123 was used", nested: { token: "t", auth_token: "t2", list: ["test-key-123", "fine"], Authorization: "Bearer abc" } } };
    const got = await gstinApiProvider("test-key-123", fake(200, hostile)).lookup("24AABPF6331N1ZU");
    assert.equal(got.found, true);
    if (!got.found) return;
    const json = JSON.stringify(got.record.raw);
    for (const secret of ["test-key-123", "api_key", "x-api-key", "auth_token", "Authorization", "Bearer", "credits_remaining", "billed_to"]) assert.ok(!json.includes(secret), `${secret} is not kept`);
    assert.ok(json.includes("KISHOR MADHVDAS FICHDIYA") && json.includes("fine"), "the company's own fields stay");
    assert.deepEqual(cleanRaw({ a: "keep", key: "x", deep: { password: "p", ok: 1 } }, ""), { a: "keep", deep: { ok: 1 } });
  });

  test("the lookup route is closed to API keys, by its address and by the service", async () => {
    for (const level of ["read", "full"] as const) for (const scope of ["platform", "hotel", "all"] as const) assert.equal(tokenCallVerdict({ level, scope, testMode: false }, "GET", "/api/v1/gst/lookup").allowed, false, `${level} ${scope}`);
    const w = world();
    await assert.rejects(w.service.lookup({ ...staff, client: "token" }, VALID));
    assert.equal(w.calls(), 0);
  });

  test("a saved record keeps the new fields, and only the lookup service writes the table (a hotel's edit never reaches it)", async () => {
    const w = world();
    const first = await w.service.lookup(staff, VALID);
    assert.deepEqual([first.entry?.blockStatus, first.entry?.street, first.entry?.buildingNumber], ["Unblocked", "Market Road", "12"]);
    const again = await w.service.lookup(staff, VALID);
    assert.deepEqual([again.from, again.entry?.street], ["saved", "Market Road"]);
    // the only code that writes platform.gst_registry is the lookup's ports (compose/gst.ts)
    const root = path.join(process.cwd(), "src");
    const writers: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name) && /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+platform\.gst_registry/i.test(readFileSync(p, "utf8"))) writers.push(path.relative(root, p).replace(/\\/g, "/"));
      }
    };
    walk(root);
    // the lookup service saves provider data; the Central console (Super Admin) may only hide or restore a record (deleted_at), never change what the provider said\n    assert.deepEqual(writers, ["server/compose/gst.ts", "server/repos/postgres/centralConsole.ts"]);
  });

  test("chosen only with both the provider and its key", () => {
    assert.equal(providerFor({ provider: "gstinapi", key: "" }), null);
    assert.equal(providerFor({ provider: "", key: "k" }), null);
    assert.equal(providerFor({ provider: "GSTINAPI", key: "k" })?.id, "gstinapi");
  });
});
