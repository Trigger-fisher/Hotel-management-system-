// Decision 48: a guest or company login linked to SEVERAL hotels. `?hotel=<id>|all`: a list merges every linked hotel's rows tagged with the hotel, a hotel the
// login is not linked to is 403, a hotel whose record is switched off or gone is left out while the others still answer, and only when none answers is the
// reason thrown. Staff and the other kind of portal account never get in (403).
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { GET as guestBills } from "../../src/app/api/v1/guest/bills/route";
import { GET as guestHistory } from "../../src/app/api/v1/guest/history/route";
import { GET as guestHotels } from "../../src/app/api/v1/guest/hotels/route";
import { GET as guestOverview } from "../../src/app/api/v1/guest/overview/route";
import { GET as corporateDashboard } from "../../src/app/api/v1/corporate/dashboard/route";
import { GET as corporateDueBills } from "../../src/app/api/v1/corporate/accounts/due-bills/route";
import { GET as corporateHotels } from "../../src/app/api/v1/corporate/hotels/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import type { Memberships, PortalMembership } from "../../src/server/services/portal/multiHotel";
import { bill, company, ctx, customer, json, pid, req, wirePortal } from "./helpers/portalWorld";
import { grant, HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";

const GUEST_USER = pid(900);
const COMPANY_USER = pid(901);
const CUST_A = pid(11);
const CUST_B = pid(12);
const CO_A = pid(21);
const CO_B = pid(22);

const sessions = new Map<string, VerifiedSession>();
sessions.set("guest", makeSession({ userId: GUEST_USER, hotelId: HOTEL_A, accountRole: "guest_user", roleKey: "guest", roleLevel: 0, client: "web", scope: { kind: "guest", id: CUST_A } }));
sessions.set("company", makeSession({ userId: COMPANY_USER, hotelId: HOTEL_A, accountRole: "corporate_user", roleKey: "corporate", roleLevel: 0, client: "web", scope: { kind: "company", id: CO_A } }));
sessions.set("staff", makeSession({ userId: pid(982), accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, client: "web", grants: [grant("bills", "full")] }));

let links: Record<string, PortalMembership[]> = {};
const memberships: Memberships = { list: async (userId, kind) => (links[`${userId}:${kind}`] ?? []).slice() };
const link = (userId: string, kind: "guest" | "company", rows: [string, string, string][]) => (links[`${userId}:${kind}`] = rows.map(([hotelId, hotelName, subjectId]) => ({ hotelId, hotelName, subjectId })));

let clock = new Date("2026-10-05T10:00:00+05:30");
let world = wirePortal(sessions, () => clock, new Map(), { memberships });
const data = (hotelId = HOTEL_A) => world.hotel.store.dataFor(hotelId);

beforeEach(() => {
  clock = new Date("2026-10-05T10:00:00+05:30");
  links = {};
  world = wirePortal(sessions, () => clock, new Map(), { memberships });
  link(GUEST_USER, "guest", [[HOTEL_A, "Hotel Sunrise", CUST_A], [HOTEL_B, "Hotel Moon", CUST_B]]);
  link(COMPANY_USER, "company", [[HOTEL_A, "Hotel Sunrise", CO_A], [HOTEL_B, "Hotel Moon", CO_B]]);
  const a = data(HOTEL_A);
  const b = data(HOTEL_B);
  a.customers.push(customer({ id: CUST_A, mobile: "9876543210" }));
  b.customers.push(customer({ id: CUST_B, name: "Amit at Moon", mobile: "9876543210" }));
  a.bills.push(bill({ id: pid(31), billNumber: "A / 1", billDate: "2026-08-14", mobileNumber: "9876543210" }), bill({ id: pid(32), billNumber: "A / 2", billDate: "2026-09-20", mobileNumber: "9876543210" }));
  b.bills.push(bill({ id: pid(33), billNumber: "B / 1", billDate: "2026-09-01", mobileNumber: "9876543210" }));
  a.companyProfiles.push(company({ id: CO_A, name: "Tata Consultancy Services" }));
  b.companyProfiles.push(company({ id: CO_B, name: "Tata Consultancy Services" }));
  a.bills.push(bill({ id: pid(41), billNumber: "CA / 1", billDate: "2026-09-10", companyId: CO_A, hotelModeOfPayment: "Debit", balanceHotelAmountPaise: BigInt(100000) }));
  b.bills.push(bill({ id: pid(42), billNumber: "CB / 1", billDate: "2026-09-30", companyId: CO_B, hotelModeOfPayment: "Debit", balanceHotelAmountPaise: BigInt(200000) }));
});

const get = (route: (r: Request, c: ReturnType<typeof ctx>) => Promise<Response>, path: string, who: string | null) => route(req("GET", path, who), ctx());
const ok = async (res: Response) => {
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  return (await json(res)).data;
};

describe("the guest portal across hotels", () => {
  test("GET /guest/hotels lists the linked hotels, each saying whether it can be paid online (no hotel yet: Pay at the front desk)", async () => {
    assert.deepEqual(await ok(await get(guestHotels, "/api/v1/guest/hotels", "guest")), [{ hotelId: HOTEL_A, name: "Hotel Sunrise", phone: null, onlinePayment: false }, { hotelId: HOTEL_B, name: "Hotel Moon", phone: null, onlinePayment: false }]);
  });

  test("bills: all hotels merged, newest first, each tagged; one hotel only its own; an unlinked or malformed hotel is 403", async () => {
    const all = await ok(await get(guestBills, "/api/v1/guest/bills?tab=all", "guest"));
    // a Bill Master bill shows as one bill per business (hotel side and food side)
    const hotelSide = (rows: { number: string; hotelName: string; business: string }[]) => rows.filter((b) => b.business === "hotel").map((b) => [b.number, b.hotelName]);
    assert.deepEqual(hotelSide(all.items), [["A / 2", "Hotel Sunrise"], ["B / 1", "Hotel Moon"], ["A / 1", "Hotel Sunrise"]]);
    assert.equal(all.counts.all, 6);
    const moon = await ok(await get(guestBills, `/api/v1/guest/bills?tab=all&hotel=${HOTEL_B}`, "guest"));
    assert.deepEqual([...new Set(moon.items.map((b: { number: string }) => b.number))], ["B / 1"]);
    assert.equal((await get(guestBills, `/api/v1/guest/bills?hotel=${pid(777)}`, "guest")).status, 403);
    assert.equal((await get(guestBills, "/api/v1/guest/bills?hotel=%27%3B--", "guest")).status, 422, "not even an id");
    const searched = await ok(await get(guestBills, "/api/v1/guest/bills?tab=all&search=moon", "guest"));
    assert.deepEqual([...new Set(searched.items.map((b: { number: string }) => b.number))], ["B / 1"], "the search also matches the hotel's name");
  });

  test("a hotel whose record is switched off is left out while the other still answers; when none answers the reason is told", async () => {
    data(HOTEL_B).customers[0].isActive = false;
    const left = await ok(await get(guestBills, "/api/v1/guest/bills?tab=all", "guest"));
    assert.deepEqual([...new Set(left.items.map((b: { number: string }) => b.number))], ["A / 2", "A / 1"]);
    data(HOTEL_A).customers[0].isActive = false;
    const none = await get(guestBills, "/api/v1/guest/bills?tab=all", "guest");
    assert.equal(none.status, 409);
    assert.equal((await json(none)).error.code, "PORTAL_INACTIVE");
  });

  test("history and the home page merge too; the totals are summed", async () => {
    const history = await ok(await get(guestHistory, "/api/v1/guest/history?tab=all", "guest"));
    assert.ok(history.items.every((h: { hotelName: string }) => h.hotelName === "Hotel Sunrise" || h.hotelName === "Hotel Moon"));
    assert.ok(new Set(history.items.map((h: { hotelId: string }) => h.hotelId)).size === 2);
    for (let i = 1; i < history.items.length; i += 1) assert.ok(history.items[i - 1].at >= history.items[i].at, "newest first");
    const home = await ok(await get(guestOverview, "/api/v1/guest/overview", "guest"));
    assert.deepEqual(home.byHotel.map((h: { hotelName: string }) => h.hotelName), ["Hotel Sunrise", "Hotel Moon"]);
  });

  test("staff and a company login are 403; no session 401; a guest linked to nothing is told so (409)", async () => {
    for (const who of ["staff", "company"]) assert.equal((await get(guestHotels, "/api/v1/guest/hotels", who)).status, 403, who);
    assert.equal((await get(guestHotels, "/api/v1/guest/hotels", null)).status, 401);
    links = {};
    const bare = makeSession({ userId: pid(990), accountRole: "guest_user", roleKey: "guest", roleLevel: 0, client: "web" });
    sessions.set("bare", bare);
    const res = await get(guestHotels, "/api/v1/guest/hotels", "bare");
    assert.equal(res.status, 409);
    assert.equal((await json(res)).error.code, "PORTAL_NOT_LINKED");
  });
});

describe("the company portal across hotels", () => {
  test("hotels, due bills (newest first, tagged, the total summed) and the dashboard", async () => {
    assert.deepEqual((await ok(await get(corporateHotels, "/api/v1/corporate/hotels", "company"))).map((h: { name: string }) => h.name), ["Hotel Sunrise", "Hotel Moon"]);
    const due = await ok(await get(corporateDueBills, "/api/v1/corporate/accounts/due-bills", "company"));
    assert.deepEqual(due.items.map((b: { billNumber: string; hotelName: string }) => [b.billNumber, b.hotelName]), [["CB / 1", "Hotel Moon"], ["CA / 1", "Hotel Sunrise"]]);
    assert.equal(due.summary.openBills, 2);
    assert.equal(due.summary.totalDuePaise, 300000);
    const one = await ok(await get(corporateDueBills, `/api/v1/corporate/accounts/due-bills?hotel=${HOTEL_A}`, "company"));
    assert.deepEqual(one.items.map((b: { billNumber: string }) => b.billNumber), ["CA / 1"]);
    assert.equal((await get(corporateDueBills, `/api/v1/corporate/accounts/due-bills?hotel=${pid(777)}`, "company")).status, 403);
    const dash = await ok(await get(corporateDashboard, "/api/v1/corporate/dashboard", "company"));
    assert.ok(JSON.stringify(dash).includes("Hotel Moon"));
    assert.ok(!/payLink|payUrl|payNow|payAll/i.test(JSON.stringify(dash)), "no pay links on the dashboard");
  });

  test("staff and a guest login are 403", async () => {
    for (const who of ["staff", "guest"]) assert.equal((await get(corporateHotels, "/api/v1/corporate/hotels", who)).status, 403, who);
  });
});
