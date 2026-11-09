// "All hotels" for the GUEST portal and the safety of Order to room (docs/plans/PORTAL-ALL-HOTELS-PLAN-2026-10-18.md, PM 18 Oct 2026), end to end through the REAL route
// files and an in-memory store of three hotels. A guest is linked to hotels A and B (a customer record in each, found by their own mobile); hotel C has its own guest. Covered:
// merged bills and history with hotel id and name, cursors, a hotel that is down, the selector summary (owed, open bills, open requests, in house + room), order-info for the app
// bar, and orders: only for the guest's own stay going on now at the hotel they name (a second hotel must be named), never a room or stay from the body, not after check-out,
// not at a hotel where they are not staying, 10 an hour... (10 in 10 minutes), and IDOR.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { GET as billsRoute } from "../../src/app/api/v1/guest/bills/route";
import { GET as billRoute } from "../../src/app/api/v1/guest/bills/[id]/route";
import { GET as historyRoute } from "../../src/app/api/v1/guest/history/route";
import { GET as summaryRoute } from "../../src/app/api/v1/guest/hotels/summary/route";
import { GET as orderInfoRoute } from "../../src/app/api/v1/guest/order-info/route";
import { POST as orderRoute } from "../../src/app/api/v1/guest/orders/route";
import { GET as overviewRoute } from "../../src/app/api/v1/guest/overview/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { createMemoryRateLimitStore } from "../../src/server/http/limits";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import type { Memberships } from "../../src/server/services/portal/multiHotel";
import { bill, ctx, customer, json, pid, req, room, stay, wirePortal } from "./helpers/portalWorld";
import { catalog, HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";

const HOTEL_C = "33333333-3333-4333-8333-333333333333";
const MOBILE = "9876543210";
const CUST_A = pid(11);
const CUST_B = pid(12);
const CUST_C = pid(13);
const OTHER_A = pid(14); // another guest at hotel A
const STAY_A = pid(41); // our guest in house at hotel A, room 101
const STAY_OTHER = pid(42); // the other guest in house at hotel A, room 102
const STAY_B_OLD = pid(43); // our guest's stay at hotel B: checked out
const MENU_TEA = pid(201);

const sessions = new Map<string, VerifiedSession>();
let n = 700;
const guest = (name: string, hotelId: string, customerId: string) =>
  sessions.set(name, makeSession({ userId: pid(n++), hotelId, accountRole: "guest_user", roleKey: "guest", roleLevel: 0, client: "web", scope: { kind: "guest", id: customerId } }));
guest("amitAB", HOTEL_A, CUST_A); // linked to A and B
guest("amitA", HOTEL_A, CUST_A); // linked to A only (no memberships: its own hotel)
guest("other", HOTEL_A, OTHER_A);
guest("onlyC", HOTEL_C, CUST_C);
const linksOf = (name: string) =>
  name === "amitAB" ? [{ hotelId: HOTEL_A, hotelName: "Hotel A", subjectId: CUST_A }, { hotelId: HOTEL_B, hotelName: "Hotel B", subjectId: CUST_B }] : name === "onlyC" ? [{ hotelId: HOTEL_C, hotelName: "Hotel C", subjectId: CUST_C }] : [];
const memberships: Memberships = { list: async (userId, kind) => (kind === "guest" ? linksOf([...sessions].find(([, s]) => s.userId === userId)?.[0] ?? "") : []) };

let clock = new Date("2026-10-05T10:00:00+05:30");
let world = wirePortal(sessions, () => clock, new Map(), { memberships });
const data = (hotelId: string) => world.hotel.store.dataFor(hotelId);
const down = new Set<string>();

function seed(): void {
  const a = data(HOTEL_A);
  a.profile.name = "Hotel A";
  a.customers.push(customer({ id: CUST_A, mobile: MOBILE }), customer({ id: OTHER_A, name: "Bina Shah", mobile: "9123456780" }));
  a.rooms.push(room({ id: pid(51), number: "101" }), room({ id: pid(52), number: "102" }));
  a.stays.push(stay({ id: STAY_A, roomId: pid(51), mobile: MOBILE }), stay({ id: STAY_OTHER, roomId: pid(52), guestName: "Bina Shah", mobile: "9123456780" }));
  a.bills.push(
    bill({ id: pid(31), billNumber: "A / 1", billDate: "2026-09-20", mobileNumber: MOBILE, hotelModeOfPayment: "Debit", balanceHotelAmountPaise: BigInt(100000) }),
    bill({ id: pid(32), billNumber: "A / 2", billDate: "2026-09-25", mobileNumber: MOBILE }),
    bill({ id: pid(39), billNumber: "A / 9", billDate: "2026-09-26", mobileNumber: "9123456780", guestName: "Bina Shah" }),
  );
  a.menuRows.push({ id: MENU_TEA, group: "restaurant", name: "Tea / Coffee (2 cups)", note: null, pricePaise: BigInt(8000), available: true, sortOrder: 1 });
  const b = data(HOTEL_B);
  b.profile.name = "Hotel B";
  b.customers.push(customer({ id: CUST_B, name: "Amit at B", mobile: MOBILE }));
  b.rooms.push(room({ id: pid(53), number: "201" }));
  b.stays.push(stay({ id: STAY_B_OLD, roomId: pid(53), mobile: MOBILE, status: "checked_out", checkOutAt: new Date("2026-09-12T05:00:00Z") }));
  b.bills.push(bill({ id: pid(33), billNumber: "B / 1", billDate: "2026-09-25", mobileNumber: MOBILE, hotelModeOfPayment: "Debit", balanceHotelAmountPaise: BigInt(50000) }), bill({ id: pid(34), billNumber: "B / 2", billDate: "2026-09-10", mobileNumber: MOBILE }));
  b.menuRows.push({ id: pid(202), group: "restaurant", name: "Tea at B", note: null, pricePaise: BigInt(9000), available: true, sortOrder: 1 });
  const c = data(HOTEL_C);
  c.customers.push(customer({ id: CUST_C, name: "Chirag", mobile: "9000000003" }));
  c.bills.push(bill({ id: pid(35), billNumber: "C / 1", billDate: "2026-09-30", mobileNumber: "9000000003" }));
}

beforeEach(() => {
  clock = new Date("2026-10-05T10:00:00+05:30");
  down.clear();
  world = wirePortal(sessions, () => clock, new Map(), { memberships });
  const unit = world.hotel.unit;
  const run = unit.run.bind(unit);
  unit.run = ((session: { hotelId: string }, work: never) => (down.has(session.hotelId) ? Promise.reject(new Error("db-secret-host refused")) : run(session as never, work))) as typeof unit.run;
  // the same routes with a rate-limit store (orders are limited)
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), rateLimits: createMemoryRateLimitStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
  seed();
});

const get = (route: (r: Request, c: ReturnType<typeof ctx>) => Promise<Response>, path: string, who: string | null, params: Record<string, string> = {}) => route(req("GET", path, who), ctx(params));
const ok = async (res: Response) => {
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  return (await json(res)).data;
};
const order = (who: string, path = "/api/v1/guest/orders", body: unknown = { qty: { [MENU_TEA]: 1 }, payWith: "room_bill", note: "" }) => orderRoute(req("POST", path, who, body), ctx());

describe("guest all hotels: the merged reads", () => {
  test("bills over the two linked hotels, each row with its hotel; nothing of another guest or of hotel C; tab counts over both", async () => {
    const page = await ok(await get(billsRoute, "/api/v1/guest/bills?hotel=all&tab=all", "amitAB"));
    const numbers = page.items.map((b: { hotelName: string; number: string }) => `${b.hotelName}:${b.number}`).join(" ");
    for (const want of ["Hotel A:A / 1", "Hotel A:A / 2", "Hotel B:B / 1", "Hotel B:B / 2"]) assert.ok(numbers.includes(want), want);
    assert.ok(!numbers.includes("A / 9") && !numbers.includes("C / 1"), "another guest's bill and hotel C never show");
    assert.ok(page.items.every((b: { hotelId: string }) => [HOTEL_A, HOTEL_B].includes(b.hotelId)));
    assert.deepEqual(page.unavailable, []);
    assert.equal(page.nextCursor, null);
    const one = await ok(await get(billsRoute, `/api/v1/guest/bills?hotel=${HOTEL_B}&tab=all`, "amitAB"));
    assert.ok(one.items.every((b: { hotelId: string }) => b.hotelId === HOTEL_B));
  });

  test("bills and history by cursor: every row once, the same order as one big page; a cursor is bound to the tab", async () => {
    for (let i = 0; i < 14; i++) data(i % 2 ? HOTEL_A : HOTEL_B).bills.push(bill({ id: pid(3000 + i), billNumber: `M / ${i}`, billDate: `2026-08-0${1 + (i % 4)}`, mobileNumber: MOBILE }));
    const big = await ok(await get(billsRoute, "/api/v1/guest/bills?hotel=all&tab=all&limit=100", "amitAB"));
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await ok(await get(billsRoute, `/api/v1/guest/bills?hotel=all&tab=all&limit=10${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, "amitAB"));
      seen.push(...page.items.map((b: { id: string }) => b.id));
      cursor = page.nextCursor;
    } while (cursor);
    assert.deepEqual(seen, big.items.map((b: { id: string }) => b.id));
    assert.equal(new Set(seen).size, seen.length);
    const first = await ok(await get(billsRoute, "/api/v1/guest/bills?hotel=all&tab=all&limit=10", "amitAB"));
    assert.equal((await get(billsRoute, `/api/v1/guest/bills?hotel=all&tab=open&limit=10&cursor=${encodeURIComponent(first.nextCursor)}`, "amitAB")).status, 422, "another tab");
    const hist = await ok(await get(historyRoute, "/api/v1/guest/history?hotel=all&limit=10", "amitAB"));
    assert.ok(Array.isArray(hist.items) && "nextCursor" in hist && Array.isArray(hist.unavailable));
  });

  test("a hotel that is down is named and left out; the overview says so too; all down is 503", async () => {
    down.add(HOTEL_B);
    const page = await ok(await get(billsRoute, "/api/v1/guest/bills?hotel=all&tab=all", "amitAB"));
    assert.ok(page.items.every((b: { hotelId: string }) => b.hotelId === HOTEL_A));
    assert.deepEqual(page.unavailable, [{ hotelId: HOTEL_B, hotelName: "Hotel B" }]);
    assert.ok(!JSON.stringify(page).includes("secret"));
    assert.deepEqual((await ok(await get(overviewRoute, "/api/v1/guest/overview", "amitAB"))).unavailable, [{ hotelId: HOTEL_B, hotelName: "Hotel B" }]);
    down.add(HOTEL_A);
    assert.equal((await get(billsRoute, "/api/v1/guest/bills?hotel=all", "amitAB")).status, 503);
  });

  test("the selector summary: owed, open bills, open requests, in house with the room, per hotel and in total", async () => {
    // an open front-desk request on the guest's stay at A (the guest can no longer send one: the desk keeps the ones already there)
    data(HOTEL_A).guestRequests.push({ id: pid(61), stayId: STAY_A, kind: "towels", note: null, status: "open", reply: null, createdBy: null, doneBy: null, doneAt: null, createdAt: new Date("2026-10-05T03:00:00Z") });
    const sum = await ok(await get(summaryRoute, "/api/v1/guest/hotels/summary", "amitAB"));
    const a = sum.hotels.find((h: { hotelId: string }) => h.hotelId === HOTEL_A);
    const b = sum.hotels.find((h: { hotelId: string }) => h.hotelId === HOTEL_B);
    assert.deepEqual([a.name, a.inHouse, a.roomNumber, a.openRequests], ["Hotel A", true, "101", 1]);
    assert.deepEqual([b.name, b.inHouse, b.roomNumber, b.openRequests, b.openBills, b.outstandingPaise], ["Hotel B", false, null, 0, 1, b.outstandingPaise]);
    assert.ok(b.outstandingPaise > 0);
    assert.equal(sum.totals.openRequests, 1);
    assert.equal(sum.totals.openBills, a.openBills + b.openBills);
    assert.deepEqual(sum.unavailable, []);
    assert.deepEqual(Object.keys(a).sort(), ["hotelId", "inHouse", "name", "openBills", "openRequests", "outstandingPaise", "phone", "roomNumber"], "only what the chip and the selector need");
  });
});

describe("Order to room: the app bar and safety", () => {
  test("order-info for one hotel: the hotel's name, the room, the guest's name (no stay id); under all hotels: each hotel with in house and room", async () => {
    const one = await ok(await get(orderInfoRoute, `/api/v1/guest/order-info?hotel=${HOTEL_A}`, "amitAB"));
    assert.deepEqual([one.all, one.hotelId, one.hotelName, one.roomNumber, one.guestName, one.staying], [false, HOTEL_A, "Hotel A", "101", "Amit Joshi", true]);
    assert.ok(!JSON.stringify(one).includes(STAY_A), "the stay id is never sent");
    const all = await ok(await get(orderInfoRoute, "/api/v1/guest/order-info?hotel=all", "amitAB"));
    assert.equal(all.all, true);
    assert.deepEqual(all.hotels.map((h: { hotelId: string; hotelName: string; inHouse: boolean; roomNumber: string | null }) => [h.hotelId, h.hotelName, h.inHouse, h.roomNumber]), [[HOTEL_A, "Hotel A", true, "101"], [HOTEL_B, "Hotel B", false, null]]);
    const omitted = await ok(await get(orderInfoRoute, "/api/v1/guest/order-info", "amitAB"));
    assert.equal(omitted.all, true, "no hotel named = all hotels");
    const single = await ok(await get(orderInfoRoute, "/api/v1/guest/order-info", "amitA"));
    assert.deepEqual([single.all, single.hotelName, single.roomNumber], [false, "Hotel A", "101"], "a login with one hotel gets that hotel");
  });

  test("a guest linked to several hotels must name the hotel; 'all' is never an order's hotel; the order goes on THEIR room at that hotel", async () => {
    for (const path of ["/api/v1/guest/orders", "/api/v1/guest/orders?hotel=all"]) {
      const res = await order("amitAB", path);
      assert.equal(res.status, 422, path);
      assert.match((await json(res)).error.details.fields.hotel, /Choose the hotel/);
    }
    assert.equal(data(HOTEL_A).charges.length, 0, "nothing was ordered");
    const res = await order("amitAB", `/api/v1/guest/orders?hotel=${HOTEL_A}`);
    assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
    const charges = data(HOTEL_A).charges;
    assert.deepEqual([charges.length, charges[0].stayId], [1, STAY_A], "on the guest's own stay");
    assert.equal((await order("amitA")).status, 201, "a login with one hotel may leave it out");
  });

  test("not at a hotel where they are not staying (checked out there), and not after check-out at the hotel where they were", async () => {
    const atB = await order("amitAB", `/api/v1/guest/orders?hotel=${HOTEL_B}`);
    assert.equal(atB.status, 409);
    assert.match((await json(atB)).error.message, /staying with us/);
    data(HOTEL_A).stays[0].status = "checked_out";
    assert.equal((await order("amitAB", `/api/v1/guest/orders?hotel=${HOTEL_A}`)).status, 409);
    assert.equal(data(HOTEL_B).charges.length + data(HOTEL_A).charges.length, 0);
  });

  test("the body can never name a room, a stay, a hotel or a guest (the shape is strict), and another hotel's menu item is refused", async () => {
    for (const extra of [{ roomNumber: "102" }, { stayId: STAY_OTHER }, { hotelId: HOTEL_B }, { customerId: OTHER_A }, { room: "102" }]) {
      const res = await order("amitAB", `/api/v1/guest/orders?hotel=${HOTEL_A}`, { qty: { [MENU_TEA]: 1 }, payWith: "room_bill", note: "", ...extra });
      assert.equal(res.status, 422, JSON.stringify(extra));
    }
    const wrongMenu = await order("amitAB", `/api/v1/guest/orders?hotel=${HOTEL_A}`, { qty: { [pid(202)]: 1 }, payWith: "room_bill", note: "" });
    assert.equal(wrongMenu.status, 422, "hotel B's tea is not on hotel A's menu");
    assert.equal(data(HOTEL_A).charges.filter((c) => c.stayId === STAY_OTHER).length, 0, "the other guest's room got nothing");
  });

  test("IDOR: a hotel the guest is not linked to is 403; the other guest's own order goes on their own room", async () => {
    assert.equal((await order("amitAB", `/api/v1/guest/orders?hotel=${HOTEL_C}`)).status, 403);
    assert.equal((await get(billsRoute, `/api/v1/guest/bills?hotel=${HOTEL_C}`, "amitAB")).status, 403);
    assert.equal((await get(billRoute, `/api/v1/guest/bills/${pid(39)}.hotel?hotel=${HOTEL_A}`, "amitAB", { id: `${pid(39)}.hotel` })).status, 404, "another guest's bill");
    assert.equal((await get(billRoute, `/api/v1/guest/bills/${pid(33)}.hotel?hotel=${HOTEL_A}`, "amitAB", { id: `${pid(33)}.hotel` })).status, 404, "hotel B's bill asked at hotel A");
    assert.equal((await order("other")).status, 201);
    assert.deepEqual(data(HOTEL_A).charges.map((c) => c.stayId), [STAY_OTHER]);
    const onlyC = await ok(await get(billsRoute, "/api/v1/guest/bills?hotel=all&tab=all", "onlyC"));
    assert.deepEqual(onlyC.items.map((b: { number: string }) => b.number.split(" ")[0]), onlyC.items.map(() => "C"));
  });

  test("10 orders in 10 minutes per person: the 11th is 429 with a plain sentence", async () => {
    for (let i = 0; i < 10; i++) assert.equal((await order("amitAB", `/api/v1/guest/orders?hotel=${HOTEL_A}`)).status, 201, `order ${i + 1}`);
    const refused = await order("amitAB", `/api/v1/guest/orders?hotel=${HOTEL_A}`);
    assert.equal(refused.status, 429);
    assert.match((await json(refused)).error.message, /10 orders in the last few minutes/);
    assert.equal((await order("other")).status, 201, "another guest is not held up");
  });
});
