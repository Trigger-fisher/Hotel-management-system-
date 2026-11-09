// Central first (MJ, 3 Nov 2026), at the desk: a guest or company made in a hotel joins the ONE profile that already has its mobile or GSTIN (made at another hotel) instead of making a
// second one, and the profile is left as it is; a new mobile or GSTIN makes the profile; a database without the central tables behaves exactly as before; a hotel removing its own record
// never removes the central one. And the GST lookup's order: the hotel's own companies first.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { gstCopy } from "@shared/dashboards/gst";
import type { VerifiedSession } from "../../src/server/auth/session";
import { memoryGstPorts } from "../../src/server/compose/gst";
import { createMemoryCentralProfiles } from "../../src/server/repos/memory/centralProfiles";
import { createMemoryHotel } from "../../src/server/repos/memory/frontOffice";
import type { Person } from "../../src/server/services/cash/ports";
import { createCompanyService } from "../../src/server/services/companies/companyService";
import { createCustomerService } from "../../src/server/services/companies/customerService";
import { createGstService, type GstProvider } from "../../src/server/services/gst/gstService";
import { catalog, grant, HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";

const ADMIN = "00000000-0000-4000-8000-000000000004";
const people = new Map<string, Person>([[ADMIN, { id: ADMIN, name: "Hari Admin", roleKey: "admin", roleLevel: 3, deleted: false }]]);
const deskA: VerifiedSession = makeSession({ userId: ADMIN, client: "web", accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("companies", "full")] });
const deskB: VerifiedSession = makeSession({ userId: ADMIN, hotelId: HOTEL_B, client: "web", accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("companies", "full")] });
const noCompanies: VerifiedSession = makeSession({ userId: ADMIN, client: "web", accountRole: "hotel_user", roleKey: "viewer", roleLevel: 1, grants: [grant("bills", "view")] });
const META = { ip: "127.0.0.1", traceId: "trace-central-first" } as never;

let central = createMemoryCentralProfiles();
let hotel = createMemoryHotel();
let customers = createCustomerService(depsOf());
let companies = createCompanyService(depsOf());

function depsOf(withCentral = true) {
  return {
    unit: hotel.unit,
    people: { get: async (ids: readonly string[]) => new Map(ids.filter((i) => people.has(i)).map((i) => [i, people.get(i) as Person])) },
    audit: { record: async () => undefined },
    catalog,
    now: () => new Date("2026-11-03T10:00:00+05:30"),
    guestAccounts: { issue: async () => ({ emailed: false }), reset: async () => ({ emailed: false }), lastLogins: async () => new Map() },
    central: withCentral ? central.unit : undefined,
  };
}

beforeEach(() => {
  central = createMemoryCentralProfiles();
  hotel = createMemoryHotel();
  customers = createCustomerService(depsOf());
  companies = createCompanyService(depsOf());
});

const guestBody = (over: Record<string, unknown> = {}) => ({ name: "Amit Joshi", mobile: "9825041236", email: "amit@example.com", address: "Satellite Road", city: "Ahmedabad", idProofType: "Aadhaar", idProofNumber: "123456784321", notes: "", isActive: true, ...over });
const companyBody = (over: Record<string, unknown> = {}) => ({
  name: "Tata Consultancy Services", address: "Kalawad Road", country: "India", nationality: "", email: "travel@tcs.example", pincode: "360005", mobile: "9824012345", phone: "",
  discountPct: 10, gstPct: 12, tcsPct: null, tdsPct: 2, instruction: "", gstNumber: "24AAACT2727Q1ZW", contacts: [{ role: "Accounts", name: "Deepa Iyer", email: "deepa@tcs.example", mobile: "9876543210" }],
  ...over,
});

describe("guests: find the central profile by mobile, or make it, then link the hotel's copy", () => {
  test("the second hotel's guest with the same mobile joins the first hotel's profile; the profile is not changed by the join", async () => {
    const first = await customers.create(deskA, guestBody() as never, META);
    assert.equal(central.data.guests.length, 1);
    const profile = structuredClone(central.data.guests[0]);
    const second = await customers.create(deskB, guestBody({ name: "Amit J.", mobile: "98250 41236", city: "Rajkot", email: "other@example.com" }) as never, META);
    assert.equal(central.data.guests.length, 1, "no second profile was made");
    assert.deepEqual(central.data.guestLinks.map((l) => [l.hotelId, l.customerId, l.guestId]), [[HOTEL_A, first.customer.id, profile.id], [HOTEL_B, second.customer.id, profile.id]], "both hotels' copies are linked by id to the one profile");
    assert.deepEqual([central.data.guests[0].city, central.data.guests[0].email, central.data.guests[0].displayName], [profile.city, profile.email, profile.displayName], "joining changes nothing in the profile");
    assert.equal(second.customer.common, true);
    assert.equal(second.customer.sharedHotels, 2);
    assert.equal(hotel.store.dataFor(HOTEL_B).customers[0].city, "Rajkot", "the hotel's own copy keeps what was typed");
    assert.equal((central.data.changes ?? []).length, 1, "only the first creation is in the history");
  });

  test("a new mobile makes the profile; a mobile that cannot be read makes one too (nothing to match)", async () => {
    await customers.create(deskA, guestBody() as never, META);
    await customers.create(deskB, guestBody({ name: "Neha", mobile: "9898012345" }) as never, META);
    assert.equal(central.data.guests.length, 2);
    await customers.create(deskA, guestBody({ name: "Foreign Guest", mobile: "+44 7700 900123" }) as never, META);
    assert.equal(central.data.guests.length, 3);
  });

  test("when the same mobile has two live profiles the oldest is joined; a merged one is never joined", async () => {
    const [older, newer] = await central.unit.run(async (r) => [
      await r.guests.create({ displayName: "Older", mobile: "+919825041236", email: null, address: null, city: null, userId: null }),
      await r.guests.create({ displayName: "Newer", mobile: "+919825041236", email: null, address: null, city: null, userId: null }),
    ]);
    central.data.guests.find((g) => g.id === older.id)!.createdAt = new Date("2026-01-01T00:00:00Z");
    central.data.guests.find((g) => g.id === newer.id)!.createdAt = new Date("2026-02-01T00:00:00Z");
    const made = await customers.create(deskA, guestBody() as never, META);
    assert.equal(central.data.guestLinks.find((l) => l.customerId === made.customer.id)?.guestId, older.id);
    central.data.guests.find((g) => g.id === older.id)!.mergedInto = newer.id;
    const next = await customers.create(deskB, guestBody({ mobile: "9825041236" }) as never, META);
    assert.equal(central.data.guestLinks.find((l) => l.customerId === next.customer.id)?.guestId, newer.id, "a merged profile is not joined: the live one is");
  });

  test("a database without the central tables behaves exactly as before: nothing made, nothing linked", async () => {
    central.data.ready = false;
    const { customer } = await customers.create(deskA, guestBody() as never, META);
    assert.deepEqual([customer.common, central.data.guests.length, central.data.guestLinks.length], [undefined, 0, 0]);
    const noTables = createCustomerService(depsOf(false));
    const plain = await noTables.create(deskB, guestBody({ mobile: "9898012345", name: "No Central" }) as never, META);
    assert.equal(plain.customer.common, undefined);
  });
});

describe("companies: find the central profile by GSTIN, or make it, then link the hotel's copy", () => {
  test("the second hotel's company with the same GSTIN joins the first hotel's profile; the profile is not changed by the join", async () => {
    const first = await companies.create(deskA, companyBody() as never, META);
    const profile = structuredClone(central.data.companies[0]);
    const second = await companies.create(deskB, companyBody({ name: "TCS at B", email: "b@tcs.example", discountPct: 5 }) as never, META);
    assert.equal(central.data.companies.length, 1, "no second profile was made");
    assert.deepEqual(central.data.companyLinks.map((l) => [l.hotelId, l.companyProfileId, l.companyId]), [[HOTEL_A, first.id, profile.id], [HOTEL_B, second.id, profile.id]]);
    assert.deepEqual([central.data.companies[0].name, central.data.companies[0].email], [profile.name, profile.email], "joining changes nothing in the profile");
    assert.equal(hotel.store.dataFor(HOTEL_B).companyProfiles[0].discountPercentage, "5", "the prices are the hotel's own copy");
    assert.equal(second.sharedHotels, 2);
  });

  test("a company without a GSTIN, or with a new one, makes its own profile", async () => {
    await companies.create(deskA, companyBody() as never, META);
    await companies.create(deskB, companyBody({ name: "No GST Ltd", gstNumber: "" }) as never, META);
    await companies.create(deskB, companyBody({ name: "Other Ltd", gstNumber: "24AAACT2727Q1ZB" }) as never, META);
    assert.equal(central.data.companies.length, 3);
  });

  test("a database without the central tables behaves exactly as before", async () => {
    central.data.ready = false;
    const made = await companies.create(deskA, companyBody() as never, META);
    assert.deepEqual([made.common, central.data.companies.length, central.data.companyLinks.length], [undefined, 0, 0]);
  });
});

describe("a hotel removing its own record never removes the central one", () => {
  test("deleting a company or a customer at the desk leaves the profile and its link; purging the recycle bin too", async () => {
    const owner = makeSession({ userId: ADMIN, client: "web", accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, grants: [grant("companies", "full")] });
    const co = await companies.create(owner, companyBody() as never, META);
    const g = await customers.create(owner, guestBody() as never, META);
    await companies.remove(owner, co.id, META);
    assert.equal(central.data.companies.length, 1);
    assert.equal(central.data.companyLinks.length, 1);
    await companies.purge(owner, co.id).catch(() => undefined);
    assert.deepEqual([central.data.companies.length, central.data.companyLinks.length, central.data.companies[0].mergedInto], [1, 1, null], "the profile is still live");
    assert.equal(central.data.guests.length, 1);
    void g;
  });

  test("the central repositories have no way to remove a profile (the port has no delete, and the database role has no DELETE: tests/db/central.console.test.ts)", async () => {
    await central.unit.run(async (r) => {
      for (const repo of [r.guests, r.companies] as unknown as Record<string, unknown>[]) assert.ok(!("delete" in repo) && !("remove" in repo) && !("purge" in repo));
    });
  });
});

describe("the GST lookup asks the hotel's own companies first", () => {
  const VALID = "27AAPFU0939F1ZV";
  const record = { legalName: "Sample Traders", tradeName: null, status: "active" as const, taxpayerType: null, constitution: null, registeredOn: null, cancelledOn: null, address: null, city: null, district: null, state: null, pincode: null, natureOfBusiness: [], blockStatus: null, stateJurisdiction: null, street: null, locality: null, buildingName: null, buildingNumber: null, floor: null, landmark: null, raw: {} };

  function world(opts: { saved?: boolean } = {}) {
    const ports = memoryGstPorts();
    let calls = 0;
    const provider: GstProvider = { id: "test-gsp", lookup: async () => ((calls += 1), { found: true as const, record }) };
    const asked: { gstin: string; except?: string }[] = [];
    const service = createGstService({
      ports, provider, now: () => new Date("2026-11-03T10:00:00Z"),
      hotelCompany: (session, gstin, except) => {
        asked.push({ gstin, except });
        return companies.byGstin(session, gstin, except);
      },
    });
    void opts;
    return { service, ports, calls: () => calls, asked };
  }

  test("a GSTIN that is already one of this hotel's companies is said, with the company, and nothing is fetched, saved, logged or counted", async () => {
    const made = await companies.create(deskA, companyBody({ gstNumber: VALID }) as never, META);
    const w = world();
    const r = await w.service.lookup(deskA, ` ${VALID.toLowerCase()} `);
    assert.deepEqual([r.from, r.inHotel, r.message, r.entry], ["hotel", { id: made.id, name: "Tata Consultancy Services" }, gstCopy.inHotel("Tata Consultancy Services"), null]);
    assert.equal(r.message, "Already in your hotel: Tata Consultancy Services");
    assert.deepEqual([w.calls(), w.ports.calls.length, w.ports.rows.size], [0, 0, 0]);
  });

  test("editing that company does not report it as a duplicate of itself; another hotel's company does not count", async () => {
    const made = await companies.create(deskA, companyBody({ gstNumber: VALID }) as never, META);
    const w = world();
    const own = await w.service.lookup(deskA, VALID, { except: made.id });
    assert.equal(own.from, "provider", "the company's own number goes on to the central record, then the service");
    assert.deepEqual(w.asked.at(-1), { gstin: VALID, except: made.id });
    const otherHotel = await w.service.lookup(deskB, VALID);
    assert.notEqual(otherHotel.from, "hotel", "hotel B has no such company");
    assert.equal(w.calls(), 1, "the service was asked once, then the saved central record answers");
    assert.equal((await w.service.lookup(deskB, VALID)).from, "saved");
  });

  test("a person who may not see companies, or has no hotel, goes on to the central record: the hotel check never blocks the lookup", async () => {
    await companies.create(deskA, companyBody({ gstNumber: VALID }) as never, META);
    const w = world();
    assert.notEqual((await w.service.lookup(noCompanies, VALID)).from, "hotel");
    const platform = makeSession({ userId: ADMIN, hotelId: "", accountRole: "platform_admin", roleKey: "platform_admin", roleLevel: 4, client: "web" });
    assert.notEqual((await w.service.lookup(platform, VALID)).from, "hotel");
    const broken = createGstService({ ports: memoryGstPorts(), provider: null, now: () => new Date(), hotelCompany: async () => { throw new Error("hotel store down"); } });
    assert.equal((await broken.lookup(deskA, VALID)).from, "none");
  });

  test("the order with a saved central record: the hotel's own company still comes first; the saved record is not counted as used", async () => {
    const w = world();
    await w.service.lookup(deskB, VALID);
    assert.equal(w.ports.rows.get(VALID)?.timesUsed, 1);
    await companies.create(deskA, companyBody({ gstNumber: VALID }) as never, META);
    const r = await w.service.lookup(deskA, VALID);
    assert.equal(r.from, "hotel");
    assert.equal(w.ports.rows.get(VALID)?.timesUsed, 1, "the hotel answered; the central record was not touched");
  });
});
