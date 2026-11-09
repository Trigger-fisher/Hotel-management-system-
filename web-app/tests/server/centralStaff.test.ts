// The front desk and the ONE common guest and company profile (platform 0132): Companies > Customers and Company profiles show the central profile of a linked record (the
// same the guest or company and every hotel see), a save at the desk changes the hotel's OWN record only and never the central profile (MJ, 3 Nov 2026), a record made at the
// desk gets its own profile at once, the prices and the hotel-only fields stay the hotel's, and a database without the central tables behaves as before.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import type { VerifiedSession } from "../../src/server/auth/session";
import { createMemoryCentralProfiles } from "../../src/server/repos/memory/centralProfiles";
import { createMemoryHotel } from "../../src/server/repos/memory/frontOffice";
import type { Person } from "../../src/server/services/cash/ports";
import { createCompanyService } from "../../src/server/services/companies/companyService";
import { createCustomerService } from "../../src/server/services/companies/customerService";
import { catalog, grant, HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";

const ADMIN = "00000000-0000-4000-8000-000000000004";
const people = new Map<string, Person>([[ADMIN, { id: ADMIN, name: "Hari Admin", roleKey: "admin", roleLevel: 3, deleted: false }]]);
const deskA: VerifiedSession = makeSession({ userId: ADMIN, client: "web", accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("companies", "full")] });
const deskB: VerifiedSession = makeSession({ userId: ADMIN, hotelId: HOTEL_B, client: "web", accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("companies", "full")] });
const META = { ip: "127.0.0.1", traceId: "trace-central-staff" } as never;

let central = createMemoryCentralProfiles();
let hotel = createMemoryHotel();
let customers = createCustomerService(depsOf());
let companies = createCompanyService(depsOf());

function depsOf() {
  return {
    unit: hotel.unit,
    people: { get: async (ids: readonly string[]) => new Map(ids.filter((i) => people.has(i)).map((i) => [i, people.get(i) as Person])) },
    audit: { record: async () => undefined },
    catalog,
    now: () => new Date("2026-10-18T10:00:00+05:30"),
    guestAccounts: { issue: async () => ({ emailed: false }), reset: async () => ({ emailed: false }), lastLogins: async () => new Map() },
    central: central.unit,
  };
}

beforeEach(() => {
  central = createMemoryCentralProfiles();
  hotel = createMemoryHotel();
  customers = createCustomerService(depsOf());
  companies = createCompanyService(depsOf());
});

const guestBody = (over: Record<string, unknown> = {}) => ({ name: "Amit Joshi", mobile: "9825041236", email: "amit@example.com", address: "Satellite Road", city: "Ahmedabad", idProofType: "Aadhaar", idProofNumber: "123456784321", notes: "Likes a quiet room", isActive: true, ...over });
const companyBody = (over: Record<string, unknown> = {}) => ({
  name: "Tata Consultancy Services", address: "Kalawad Road", country: "India", nationality: "", email: "travel@tcs.example", pincode: "360005", mobile: "9824012345", phone: "",
  discountPct: 10, gstPct: 12, tcsPct: null, tdsPct: 2, instruction: "Bill to head office", gstNumber: "24AAACT2727Q1ZW", contacts: [{ role: "Accounts", name: "Deepa Iyer", email: "deepa@tcs.example", mobile: "9876543210" }],
  ...over,
});

const snapshot = <T>(rows: T[]): string => JSON.stringify(rows);

describe("customers at the desk", () => {
  test("a customer made at the desk gets its own profile; a desk edit changes the hotel's own record ONLY (the central row stays byte for byte, updated_at included); the desk shows its own record", async () => {
    const { customer } = await customers.create(deskA, guestBody() as never, META);
    assert.equal(customer.common, true);
    assert.equal(central.data.guests.length, 1);
    assert.equal(central.data.guests[0].mobile, "+919825041236");
    // the guest changes their profile (in the portal): that is central data; the desk's record keeps its own copy
    await central.unit.run((r) => r.guests.update(central.data.guests[0].id, { city: "Surat" }));
    const before = snapshot(central.data.guests);
    const seen = await customers.get(deskA, customer.id);
    assert.deepEqual([seen.common, seen.city, seen.notes, seen.idProofNumber], [true, "Ahmedabad", "Likes a quiet room", "\u2022\u2022\u2022\u20224321"], "the desk shows the hotel's own record, its ID number as the last 4 (decision 74)");
    // the desk edits name, mobile, email, address and city: no confirm step, only the hotel's copy changes
    await customers.update(deskA, customer.id, guestBody({ name: "Amit J. Joshi", mobile: "9825041237", email: "new@example.com", city: "Rajkot", address: "Ring Road" }) as never, META);
    assert.equal(snapshot(central.data.guests), before, "the central row is untouched");
    assert.equal(snapshot(central.data.changes ?? []), JSON.stringify((central.data.changes ?? [])), "no change recorded");
    assert.deepEqual([hotel.store.dataFor(HOTEL_A).customers[0].name, hotel.store.dataFor(HOTEL_A).customers[0].address, hotel.store.dataFor(HOTEL_A).customers[0].mobile], ["Amit J. Joshi", "Ring Road", "9825041237"]);
  });

  test("a second hotel's edit never asks to confirm and never reaches the profile or the other hotel", async () => {
    const a = await customers.create(deskA, guestBody() as never, META);
    const b = await customers.create(deskB, guestBody({ name: "Amit J." }) as never, META);
    assert.equal(central.data.guests.length, 1, "the same mobile joined the one profile");
    assert.equal((await customers.get(deskA, a.customer.id)).sharedHotels, 2);
    const before = snapshot(central.data.guests);
    await customers.update(deskA, a.customer.id, guestBody({ city: "Surat", email: "new@example.com" }) as never, META);
    assert.equal(snapshot(central.data.guests), before);
    assert.equal((await customers.get(deskB, b.customer.id)).city, "Ahmedabad", "the other hotel's copy is its own");
    assert.equal(central.data.changes?.length, 1, "only the profile's creation is in the history");
  });

  test("a database without the central tables: the hotel's record as before, nothing made", async () => {
    central.data.ready = false;
    const { customer } = await customers.create(deskA, guestBody() as never, META);
    assert.equal(customer.common, undefined);
    assert.equal(central.data.guests.length, 0);
    assert.equal((await customers.get(deskA, customer.id)).city, "Ahmedabad");
  });
});

describe("companies at the desk", () => {
  test("a company made at the desk gets its own profile; a desk edit (name, mobile, email, address, GSTIN, contacts, prices) changes the hotel's own record ONLY, the central row stays byte for byte", async () => {
    const made = await companies.create(deskA, companyBody() as never, META);
    assert.equal(made.common, true);
    assert.deepEqual([central.data.companies[0].gstin, central.data.companies[0].mainContactName], ["24AAACT2727Q1ZW", "Deepa Iyer"]);
    const before = snapshot(central.data.companies);
    const changes = snapshot(central.data.changes ?? []);
    const saved = await companies.update(deskA, made.id, companyBody({ name: "TCS India", mobile: "9000000000", email: "x@tcs.example", address: "New Road", gstNumber: "24AAACT2727Q1ZX", phone: "0281 2450000", discountPct: 15 }) as never, META);
    assert.deepEqual([saved.name, saved.gstNumber, saved.email, saved.discountPct, saved.common], ["TCS India", "24AAACT2727Q1ZX", "x@tcs.example", 15, true], "the desk shows its own record");
    assert.equal(snapshot(central.data.companies), before, "the central row is untouched");
    assert.equal(snapshot(central.data.changes ?? []), changes, "no change recorded");
  });

  test("the GSTIN and the name of a linked company still change only with Full Access on Companies (403); other details and prices do not need it; nothing reaches the profile", async () => {
    const made = await companies.create(deskA, companyBody() as never, META);
    const desk = makeSession({ userId: ADMIN, client: "web", accountRole: "hotel_user", roleKey: "front-desk", roleLevel: 1, grants: [grant("companies", "edit")] });
    const before = snapshot(central.data.companies);
    const g = await companies.update(desk, made.id, companyBody({ gstNumber: "24AAACT2727Q1ZX" }) as never, META).then(() => null, (e: unknown) => e as { code: string; message: string });
    assert.deepEqual([g?.code, g?.message], ["FORBIDDEN", "Ask a manager to change the GSTIN."]);
    const n = await companies.update(desk, made.id, companyBody({ name: "TCS Renamed" }) as never, META).then(() => null, (e: unknown) => e as { code: string; message: string });
    assert.deepEqual([n?.code, n?.message], ["FORBIDDEN", "Ask a manager to change the company name."]);
    await companies.update(desk, made.id, companyBody({ email: "new@tcs.example", discountPct: 12 }) as never, META);
    assert.equal((await companies.get(desk, made.id)).email, "new@tcs.example");
    await companies.update(deskA, made.id, companyBody({ gstNumber: "24AAACT2727Q1ZX", email: "new@tcs.example" }) as never, META);
    assert.equal((await companies.get(deskA, made.id)).gstNumber, "24AAACT2727Q1ZX");
    assert.equal(snapshot(central.data.companies), before);
  });

  test("two hotels sharing a company profile: no confirm step for either, and neither edit reaches the profile or the other hotel", async () => {
    const made = await companies.create(deskA, companyBody() as never, META);
    const atB = await companies.create(deskB, companyBody({ name: "TCS at B" }) as never, META);
    assert.equal(central.data.companies.length, 1);
    assert.equal((await companies.get(deskA, made.id)).sharedHotels, 2);
    const before = snapshot(central.data.companies);
    await companies.update(deskA, made.id, companyBody({ email: "other@tcs.example" }) as never, META);
    assert.equal(snapshot(central.data.companies), before);
    assert.equal((await companies.get(deskB, atB.id)).email, "travel@tcs.example");
  });
});