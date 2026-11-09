// The ONE common guest and company profile (platform 0132; docs/plans/CENTRAL-GUEST-COMPANY-PLAN-2026-10-18.md) end to end through the REAL route files, the portal services,
// the in-memory hotel store (two hotels) and the in-memory central profiles: before a profile exists the hotel's record shows (safe before the backfill); the first save makes
// the ONE profile and links the login's records in every hotel; after that every hotel shows the same details and a save changes them once (no copy into the hotels' records);
// the ID proof and the prices stay each hotel's; a database without the central tables keeps the old behaviour.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { GET as companyGet, PUT as companyPut } from "../../src/app/api/v1/corporate/profile/route";
import { GET as guestGet, PUT as guestPut } from "../../src/app/api/v1/guest/profile/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { createMemoryCentralProfiles } from "../../src/server/repos/memory/centralProfiles";
import type { Memberships } from "../../src/server/services/portal/multiHotel";
import { company, ctx, customer, json, pid, req, wirePortal } from "./helpers/portalWorld";
import { HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";

const CUST_A = pid(11);
const CUST_B = pid(12);
const CO_A = pid(21);
const CO_B = pid(22);
const sessions = new Map<string, VerifiedSession>();
sessions.set("amit", makeSession({ userId: pid(900), hotelId: HOTEL_A, accountRole: "guest_user", roleKey: "guest", roleLevel: 0, client: "web", scope: { kind: "guest", id: CUST_A } }));
sessions.set("amitAtB", makeSession({ userId: pid(900), hotelId: HOTEL_B, accountRole: "guest_user", roleKey: "guest", roleLevel: 0, client: "web", scope: { kind: "guest", id: CUST_B } }));
sessions.set("tcs", makeSession({ userId: pid(901), hotelId: HOTEL_A, accountRole: "corporate_user", roleKey: "corporate", roleLevel: 0, client: "web", scope: { kind: "company", id: CO_A } }));
const memberships: Memberships = {
  list: async (userId, kind) =>
    kind === "guest" && userId === pid(900)
      ? [{ hotelId: HOTEL_A, hotelName: "Hotel A", subjectId: CUST_A }, { hotelId: HOTEL_B, hotelName: "Hotel B", subjectId: CUST_B }]
      : kind === "company" && userId === pid(901)
        ? [{ hotelId: HOTEL_A, hotelName: "Hotel A", subjectId: CO_A }, { hotelId: HOTEL_B, hotelName: "Hotel B", subjectId: CO_B }]
        : [],
};

let central = createMemoryCentralProfiles();
let world = wirePortal(sessions, () => new Date("2026-10-18T10:00:00+05:30"), new Map(), { memberships, central: central.unit, photoName: async () => null });
const data = (hotelId: string) => world.hotel.store.dataFor(hotelId);

beforeEach(() => {
  central = createMemoryCentralProfiles();
  world = wirePortal(sessions, () => new Date("2026-10-18T10:00:00+05:30"), new Map(), { memberships, central: central.unit, photoName: async (u) => (u === pid(900) ? "photo-0123456789abcdef01234567.webp" : null) });
  data(HOTEL_A).customers.push(customer({ id: CUST_A, name: "Amit Joshi", mobile: "98250 41236", city: "Ahmedabad" }));
  data(HOTEL_B).customers.push(customer({ id: CUST_B, name: "Amit J.", mobile: "9825041236", city: "Rajkot", idProofType: null, idProofNumber: null }));
  data(HOTEL_A).companyProfiles.push(company({ id: CO_A, name: "Tata Consultancy Services", discountPercentage: "10", contacts: [{ name: "Deepa Iyer", role: "Travel desk", email: "deepa@tcs.test", mobile: "9876543210" }] }));
  data(HOTEL_B).companyProfiles.push(company({ id: CO_B, name: "TCS at B", discountPercentage: "5", email: "old@tcs.test" }));
});

const ok = async (res: Response, status = 200) => {
  assert.equal(res.status, status, JSON.stringify(await res.clone().json()));
  return (await json(res)).data;
};
const guestBody = (over: Record<string, unknown> = {}) => ({ name: "Amit Joshi", email: "amit.joshi@example.com", city: "Surat", address: "Ring Road", idProofType: "aadhaar", idProofNumber: "XXXX 4321", notifyEmail: true, ...over });

describe("the guest's one common profile", () => {
  test("before a profile exists each hotel shows its own record; the first save makes ONE profile, every hotel shows it, the hotels' records keep their own copy", async () => {
    const atA = await ok(await guestGet(req("GET", "/api/v1/guest/profile", "amit"), ctx()));
    const atB = await ok(await guestGet(req("GET", `/api/v1/guest/profile?hotel=${HOTEL_B}`, "amitAtB"), ctx()));
    assert.deepEqual([atA.common, atA.city, atB.city], [false, "Ahmedabad", "Rajkot"], "the hotel's own record while there is no profile (safe before the backfill)");
    assert.match(atA.photoUrl, /^\/api\/v1\/profile\/photo\?v=/);

    const saved = await ok(await guestPut(req("PUT", "/api/v1/guest/profile", "amit", guestBody()), ctx()));
    assert.deepEqual([saved.common, saved.name, saved.email, saved.city, saved.address], [true, "Amit Joshi", "amit.joshi@example.com", "Surat", "Ring Road"]);
    assert.equal(saved.updatedHotels, 0, "the ID proof did not change: no hotel record was written");
    assert.equal(central.data.guests.length, 1);
    assert.equal(central.data.guests[0].userId, pid(900));
    assert.equal(central.data.guests[0].mobile, "+919825041236");
    assert.deepEqual(central.data.guestLinks.map((l) => l.customerId).sort(), [CUST_A, CUST_B].sort(), "both hotels' records are linked");

    const nowB = await ok(await guestGet(req("GET", `/api/v1/guest/profile?hotel=${HOTEL_B}`, "amitAtB"), ctx()));
    assert.deepEqual([nowB.common, nowB.city, nowB.address, nowB.email], [true, "Surat", "Ring Road", "amit.joshi@example.com"], "hotel B shows the same profile");
    assert.equal(nowB.mobile, "9825041236", "the mobile is still each hotel's own");
    assert.deepEqual([data(HOTEL_A).customers[0].city, data(HOTEL_B).customers[0].city], ["Ahmedabad", "Rajkot"], "no copy into the hotels' records");

    // a second save changes the one profile once
    await ok(await guestPut(req("PUT", "/api/v1/guest/profile", "amitAtB", guestBody({ city: "Vadodara" })), ctx()));
    assert.equal((await ok(await guestGet(req("GET", "/api/v1/guest/profile", "amit"), ctx()))).city, "Vadodara");
    assert.equal(central.data.guests.length, 1, "still one profile");
    assert.equal(data(HOTEL_A).systemLogs.filter((l) => l.entity === "Guest profile").length + data(HOTEL_B).systemLogs.filter((l) => l.entity === "Guest profile").length, 2, "one line per save, field names only");
  });

  test("the ID proof stays each hotel's: written to every linked hotel's record, and only when it changed", async () => {
    const res = await ok(await guestPut(req("PUT", "/api/v1/guest/profile", "amit", guestBody({ idProofType: "passport", idProofNumber: "Z1234567" })), ctx()));
    assert.equal(res.updatedHotels, 2);
    assert.deepEqual([data(HOTEL_A).customers[0].idProofNumber, data(HOTEL_B).customers[0].idProofNumber], ["Z1234567", "Z1234567"]);
    assert.deepEqual([data(HOTEL_A).customers[0].name, data(HOTEL_B).customers[0].name], ["Amit Joshi", "Amit J."], "the name was not copied");
  });

  test("a profile made by the backfill (linked, no login yet) is claimed by the guest's first save instead of a second one being made", async () => {
    const made = await central.unit.run(async (r) => {
      const g = await r.guests.create({ displayName: "Amit (from backfill)", mobile: null, email: null, address: null, city: "Ahmedabad", userId: null });
      await r.guests.link(HOTEL_A, CUST_A, g.id);
      return g;
    });
    assert.equal((await ok(await guestGet(req("GET", "/api/v1/guest/profile", "amit"), ctx()))).name, "Amit (from backfill)", "the linked profile shows before any save");
    await ok(await guestPut(req("PUT", "/api/v1/guest/profile", "amit", guestBody()), ctx()));
    assert.equal(central.data.guests.length, 1);
    assert.deepEqual([central.data.guests[0].id, central.data.guests[0].userId], [made.id, pid(900)]);
  });

  test("change history (review M1(a)): the guest's save is recorded with the hotel they were signed in to and the fields; My profile shows the last change", async () => {
    central.data.hotelNames = new Map([[HOTEL_A, "Hotel A"], [HOTEL_B, "Hotel B"]]);
    await ok(await guestPut(req("PUT", "/api/v1/guest/profile", "amit", guestBody()), ctx()));
    const saved = await ok(await guestPut(req("PUT", "/api/v1/guest/profile", "amitAtB", guestBody({ city: "Vadodara" })), ctx()));
    assert.deepEqual((central.data.changes ?? []).map((c) => [c.hotelId, c.byUserId, c.via, c.fields]), [
      [HOTEL_A, pid(900), "portal", ["email", "address", "city"]],
      [HOTEL_B, pid(900), "portal", ["city"]],
    ]);
    assert.deepEqual(saved.lastChange, { at: "2026-10-18T04:30:00.000Z", hotelName: "Hotel B", by: "Amit Joshi", via: "portal", fields: ["city"] });
    // the same save again changes nothing and adds nothing
    await ok(await guestPut(req("PUT", "/api/v1/guest/profile", "amitAtB", guestBody({ city: "Vadodara" })), ctx()));
    assert.equal((central.data.changes ?? []).length, 2);
  });

  test("a database without the central tables keeps the old behaviour: every field into every linked hotel's record", async () => {
    central.data.ready = false;
    const res = await ok(await guestPut(req("PUT", "/api/v1/guest/profile", "amit", guestBody()), ctx()));
    assert.deepEqual([res.common, res.updatedHotels], [false, 2]);
    assert.deepEqual([data(HOTEL_A).customers[0].city, data(HOTEL_B).customers[0].city], ["Surat", "Surat"]);
    assert.equal(central.data.guests.length, 0);
  });
});

describe("the company's one common profile", () => {
  test("contact details and GSTIN once for every hotel (no ?hotel= needed); the prices stay each hotel's", async () => {
    const before = await ok(await companyGet(req("GET", `/api/v1/corporate/profile?hotel=${HOTEL_B}`, "tcs"), ctx()));
    assert.deepEqual([before.common, before.email, before.pricing.discountPct], [false, "old@tcs.test", 5]);
    const saved = await ok(await companyPut(req("PUT", "/api/v1/corporate/profile", "tcs", { email: "Accounts@TCS.test", mainContactName: "Reena Shah", gstin: "24aaact2727q1zw" }), ctx()));
    assert.deepEqual([saved.common, saved.email, saved.mainContactName, saved.gstin, saved.name], [true, "accounts@tcs.test", "Reena Shah", "24AAACT2727Q1ZW", "Tata Consultancy Services"]);
    assert.equal(saved.contacts[0].role, "Travel desk", "the main contact keeps the rest of the first contact");
    const atB = await ok(await companyGet(req("GET", `/api/v1/corporate/profile?hotel=${HOTEL_B}`, "tcs"), ctx()));
    assert.deepEqual([atB.common, atB.email, atB.mainContactName, atB.pricing.discountPct], [true, "accounts@tcs.test", "Reena Shah", 5], "hotel B shows the same details and its own prices");
    assert.equal(data(HOTEL_B).companyProfiles[0].email, "old@tcs.test", "no copy into the hotel's record");
    assert.deepEqual(central.data.companyLinks.map((l) => l.companyProfileId).sort(), [CO_A, CO_B].sort());
    const refused = await companyPut(req("PUT", "/api/v1/corporate/profile", "tcs", { discountPct: 50 }), ctx());
    assert.equal(refused.status, 422, "the prices are the hotel's");
  });

  test("change history (review M1(a)): the company's own save is recorded (via the portal, from the hotel it picked) and shown on My profile", async () => {
    central.data.hotelNames = new Map([[HOTEL_A, "Hotel A"], [HOTEL_B, "Hotel B"]]);
    const saved = await ok(await companyPut(req("PUT", `/api/v1/corporate/profile?hotel=${HOTEL_B}`, "tcs", { gstin: "24aaact2727q1zw" }), ctx()));
    assert.deepEqual((central.data.changes ?? []).map((c) => [c.kind, c.hotelId, c.byUserId, c.via, c.fields]), [["company", HOTEL_B, pid(901), "portal", ["gstin"]]]);
    assert.deepEqual([saved.lastChange?.hotelName, saved.lastChange?.via, saved.lastChange?.fields], ["Hotel B", "portal", ["gstin"]]);
    // M1(c): the company's own login may change its GSTIN; the history keeps old -> new, masked to the last four
    assert.deepEqual(saved.lastChange?.gstin, { from: "XXXX Q1ZV", to: "XXXX Q1ZW" });
    assert.ok(!JSON.stringify(central.data.changes).includes("24AAACT2727"), "the full GSTIN is never in the history");
  });

  test("a database without the central tables: ?hotel= is still required and only that hotel's record changes", async () => {
    central.data.ready = false;
    assert.equal((await companyPut(req("PUT", "/api/v1/corporate/profile", "tcs", { email: "a@tcs.test" }), ctx())).status, 422);
    const saved = await ok(await companyPut(req("PUT", `/api/v1/corporate/profile?hotel=${HOTEL_A}`, "tcs", { email: "a@tcs.test" }), ctx()));
    assert.deepEqual([saved.common, saved.email], [false, "a@tcs.test"]);
    assert.equal(data(HOTEL_B).companyProfiles[0].email, "old@tcs.test");
  });
});
