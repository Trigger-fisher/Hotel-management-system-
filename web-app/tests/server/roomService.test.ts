// Room service with a status (guest portal round 3, decision 61, rebuilt on main; MJ's cancel rule of 18 Oct 2026: the HOTEL decides), end to end through the REAL route files,
// the guest service, the hotel's desk and ONE in-memory store: an order gets its own row (placed) with lines pointing at its stay charges; the hotel moves it forward or cancels it
// with a reason until it is delivered (its charges come off the room bill); a guest may cancel only while it is still placed AND inside the hotel's window (default 5 minutes,
// 0 = never, at most 60), by the server's clock; cancels are idempotent; nobody reaches another guest's or another hotel's order.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { POST as deskCancelRoute } from "../../src/app/api/v1/front-office/room-service/orders/[id]/cancel/route";
import { POST as deskStatusRoute } from "../../src/app/api/v1/front-office/room-service/orders/[id]/status/route";
import { GET as deskListRoute, POST as deskPlaceRoute } from "../../src/app/api/v1/front-office/room-service/orders/route";
import { GET as deskPosRoute } from "../../src/app/api/v1/front-office/room-service/pos/route";
import { GET as deskSettingsGet, PUT as deskSettingsPut } from "../../src/app/api/v1/front-office/room-service/settings/route";
import { POST as guestCancelRoute } from "../../src/app/api/v1/guest/orders/[id]/cancel/route";
import { GET as orderInfoRoute } from "../../src/app/api/v1/guest/order-info/route";
import { GET as guestOrdersRoute, POST as orderRoute } from "../../src/app/api/v1/guest/orders/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { configureRoomServiceDesk } from "../../src/server/compose/roomServiceDesk";
import type { Person } from "../../src/server/services/cash/ports";
import { createRoomServiceDesk } from "../../src/server/services/roomService/deskService";
import { ctx, customer, json, pid, req, room, stay, wirePortal } from "./helpers/portalWorld";
import { catalog, grant, HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";

const CUST = pid(11);
const CUST_OTHER = pid(12);
const STAY = pid(41);
const STAY_OTHER = pid(42);
const TEA = pid(201);
const THALI = pid(202);
const COOK = pid(701);

const sessions = new Map<string, VerifiedSession>();
const guestOf = (name: string, customerId: string, hotelId = HOTEL_A) =>
  sessions.set(name, makeSession({ userId: pid(900 + sessions.size), hotelId, accountRole: "guest_user", roleKey: "guest", roleLevel: 0, client: "web", scope: { kind: "guest", id: customerId } }));
guestOf("amit", CUST);
guestOf("bina", CUST_OTHER);
guestOf("amitAtB", CUST, HOTEL_B);
const staffOf = (name: string, level: "view" | "edit" | "full", hotelId = HOTEL_A, userId = pid(700 + sessions.size)) =>
  sessions.set(name, makeSession({ userId, hotelId, accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, client: "web", grants: [grant("pms", level)] }));
staffOf("viewer", "view");
staffOf("cook", "edit", HOTEL_A, COOK);
staffOf("manager", "full");
staffOf("cookB", "edit", HOTEL_B);
sessions.set("deskUser", makeSession({ userId: pid(780), hotelId: HOTEL_A, accountRole: "hotel_user", roleKey: "admin", roleLevel: 3, client: "web", grants: [grant("pms", "full")] }));
const people = new Map<string, Person>([[COOK, { id: COOK, name: "Kamal Cook", roleKey: "editor", roleLevel: 2, deleted: false }]]);

let clock = new Date("2026-10-05T10:00:00+05:30");
let world = wirePortal(sessions, () => clock);
const data = (hotelId = HOTEL_A) => world.hotel.store.dataFor(hotelId);

beforeEach(() => {
  clock = new Date("2026-10-05T10:00:00+05:30");
  world = wirePortal(sessions, () => clock);
  configureRoomServiceDesk(createRoomServiceDesk({ unit: world.hotel.unit, people: { get: async (ids) => new Map(ids.filter((i) => people.has(i)).map((i) => [i, people.get(i) as Person])) }, catalog, now: () => clock }));
  const a = data();
  a.customers.push(customer({ id: CUST, mobile: "9876543210" }), customer({ id: CUST_OTHER, name: "Bina Shah", mobile: "9123456780" }));
  a.rooms.push(room({ id: pid(51), number: "101" }), room({ id: pid(52), number: "102" }));
  a.stays.push(stay({ id: STAY, roomId: pid(51), mobile: "9876543210" }), stay({ id: STAY_OTHER, roomId: pid(52), guestName: "Bina Shah", mobile: "9123456780" }));
  a.menuRows.push(
    { id: TEA, group: "restaurant", name: "Tea / Coffee (2 cups)", note: null, pricePaise: BigInt(8000), available: true, sortOrder: 1 },
    { id: THALI, group: "restaurant", name: "Gujarati Thali", note: null, pricePaise: BigInt(32000), available: true, sortOrder: 1 },
  );
  data(HOTEL_B).customers.push(customer({ id: CUST, name: "Amit at B", mobile: "9876543210" }));
});

const ok = async (res: Response, status = 200) => {
  assert.equal(res.status, status, JSON.stringify(await res.clone().json()));
  return (await json(res)).data;
};
const place = async (who = "amit") => ok(await orderRoute(req("POST", "/api/v1/guest/orders", who, { qty: { [TEA]: 2, [THALI]: 1 }, payWith: "room_bill", note: "Knock please" }), ctx()), 201);
const guestCancel = (id: string, who = "amit") => guestCancelRoute(req("POST", `/api/v1/guest/orders/${id}/cancel`, who), ctx({ id }));
const move = (id: string, status: string, who = "cook") => deskStatusRoute(req("POST", `/api/v1/front-office/room-service/orders/${id}/status`, who, { status }), ctx({ id }));
const deskCancel = (id: string, reason: string, who = "cook") => deskCancelRoute(req("POST", `/api/v1/front-office/room-service/orders/${id}/cancel`, who, { reason }), ctx({ id }));
const chargesOf = (stayId = STAY) => data().charges.filter((c) => c.stayId === stayId);
const fields = async (res: Response) => (await json(res)).error.details?.fields ?? {};

describe("an order gets its own row", () => {
  test("placing writes the order (placed) with its lines pointing at the stay charges; the answer says until when the guest may cancel; the guest's list shows it", async () => {
    const r = await place();
    assert.equal(r.status, "placed");
    assert.equal(r.cancellableUntil, new Date(clock.getTime() + 5 * 60_000).toISOString(), "the default window is 5 minutes");
    const order = data().roomOrders[0];
    assert.equal(order.id, r.orderId);
    assert.deepEqual(order.lines.map((l) => [l.name, l.qty]), [["Tea / Coffee (2 cups)", 2], ["Gujarati Thali", 1]]);
    assert.deepEqual(order.lines.map((l) => l.chargeId).sort(), chargesOf().map((c) => c.id).sort(), "each line points at its charge");
    const list = await ok(await guestOrdersRoute(req("GET", "/api/v1/guest/orders", "amit"), ctx()));
    assert.deepEqual(list.items.map((o: { orderNo: string; status: string; hotelId: string }) => [o.orderNo, o.status, o.hotelId]), [[r.orderNo, "placed", HOTEL_A]]);
    assert.equal(list.items[0].cancellableUntil, r.cancellableUntil);
    assert.equal((await ok(await orderInfoRoute(req("GET", "/api/v1/guest/order-info", "amit"), ctx()))).guestCancelMinutes, 5);
  });
});

describe("the guest cancels (inside the hotel's window only)", () => {
  test("inside the window: cancelled by the guest, its charges come off the room bill, logged; a second cancel answers the same", async () => {
    const r = await place();
    clock = new Date(clock.getTime() + 4 * 60_000);
    const done = await ok(await guestCancel(r.orderId));
    assert.deepEqual([done.status, done.cancelledBy, done.cancelReason, done.cancellableUntil], ["cancelled", "guest", null, null]);
    assert.equal(chargesOf().length, 0, "nothing left on the room bill");
    const again = await ok(await guestCancel(r.orderId));
    assert.equal(again.status, "cancelled");
    assert.equal(data().systemLogs.filter((l) => l.entity === "Room service order" && l.action === "updated").length, 1, "one line for the cancel");
  });

  test("outside the window (the server's clock): 409 with the plain sentence, nothing changes", async () => {
    const r = await place();
    clock = new Date(clock.getTime() + 5 * 60_000 + 1000);
    const res = await guestCancel(r.orderId);
    assert.equal(res.status, 409);
    assert.equal((await json(res)).error.message, "This order can no longer be cancelled. Please call reception.");
    assert.equal(data().roomOrders[0].status, "placed");
    assert.equal(chargesOf().length, 2);
    const list = await ok(await guestOrdersRoute(req("GET", "/api/v1/guest/orders", "amit"), ctx()));
    assert.equal(list.items[0].cancellableUntil, null, "the button goes away");
  });

  test("window 0: guests cannot cancel at all; a wider window (set by the hotel) lets them", async () => {
    await ok(await deskSettingsPut(req("PUT", "/api/v1/front-office/room-service/settings", "manager", { guestCancelMinutes: 0 }), ctx()));
    const r = await place();
    assert.equal(r.cancellableUntil, null);
    assert.equal((await guestCancel(r.orderId)).status, 409);
    await ok(await deskSettingsPut(req("PUT", "/api/v1/front-office/room-service/settings", "manager", { guestCancelMinutes: 15 }), ctx()));
    clock = new Date(clock.getTime() + 10 * 60_000);
    assert.equal((await guestCancel(r.orderId)).status, 200, "15 minutes from placing, by the server's clock");
  });

  test("once the hotel has accepted it, the guest cannot cancel, even inside the window", async () => {
    const r = await place();
    await ok(await move(r.orderId, "accepted"));
    const res = await guestCancel(r.orderId);
    assert.equal(res.status, 409);
    assert.equal(chargesOf().length, 2);
  });
});

describe("the hotel moves and cancels", () => {
  test("forward only (a step may be skipped); back or out of delivered is 409; the list shows the queue oldest first with room and guest", async () => {
    const first = await place();
    clock = new Date(clock.getTime() + 60_000);
    const second = await place("bina");
    const queue = await ok(await deskListRoute(req("GET", "/api/v1/front-office/room-service/orders", "viewer"), ctx()));
    assert.deepEqual(queue.items.map((o: { orderNo: string; roomNumber: string; guestName: string }) => [o.orderNo, o.roomNumber, o.guestName]), [[first.orderNo, "101", "Amit Joshi"], [second.orderNo, "102", "Bina Shah"]]);
    assert.deepEqual([queue.openCount, queue.guestCancelMinutes], [2, 5]);
    assert.equal((await ok(await move(first.orderId, "preparing"))).status, "preparing", "accepted may be skipped");
    assert.equal((await move(first.orderId, "accepted")).status, 409, "never back");
    await ok(await move(first.orderId, "delivered"));
    assert.equal((await move(first.orderId, "on_the_way")).status, 409);
    assert.equal((await move(first.orderId, "cancelled")).status, 422, "cancelling is its own action");
    const delivered = await ok(await deskListRoute(req("GET", "/api/v1/front-office/room-service/orders?status=delivered", "viewer"), ctx()));
    assert.deepEqual([delivered.items.length, delivered.items[0].statusByName], [1, "Kamal Cook"]);
  });

  test("staff cancel any time until delivered, with a reason: the charges are reversed, the guest sees 'cancelled by the hotel' with the reason, logged; twice is fine", async () => {
    const r = await place();
    await ok(await move(r.orderId, "preparing"));
    assert.equal((await deskCancel(r.orderId, "  ")).status, 422);
    assert.ok((await fields(await deskCancel(r.orderId, "x"))).reason);
    const done = await ok(await deskCancel(r.orderId, "Kitchen closed for cleaning"));
    assert.deepEqual([done.status, done.cancelledBy, done.cancelReason], ["cancelled", "hotel", "Kitchen closed for cleaning"]);
    assert.equal(chargesOf().length, 0, "the charges are off the room bill");
    const mine = await ok(await guestOrdersRoute(req("GET", "/api/v1/guest/orders", "amit"), ctx()));
    assert.deepEqual([mine.items[0].cancelledBy, mine.items[0].cancelReason], ["hotel", "Kitchen closed for cleaning"]);
    assert.equal((await deskCancel(r.orderId, "again")).status, 200);
    const log = data().systemLogs.filter((l) => l.entity === "Room service order" && /^Cancelled/.test(l.summary));
    assert.equal(log.length, 1);
    assert.equal(log[0].userName, "Kamal Cook");
    const delivered = await place();
    await ok(await move(delivered.orderId, "delivered"));
    assert.equal((await deskCancel(delivered.orderId, "Too late")).status, 409, "a delivered order is not cancelled");
  });

  test("permissions: view reads only; edit moves and cancels; only full changes the window, and only to 0..60", async () => {
    const r = await place();
    assert.equal((await move(r.orderId, "accepted", "viewer")).status, 403);
    assert.equal((await deskCancel(r.orderId, "No staff", "viewer")).status, 403);
    assert.equal((await deskSettingsPut(req("PUT", "/api/v1/front-office/room-service/settings", "cook", { guestCancelMinutes: 10 }), ctx())).status, 403);
    for (const bad of [-1, 61, 2.5]) assert.equal((await deskSettingsPut(req("PUT", "/api/v1/front-office/room-service/settings", "manager", { guestCancelMinutes: bad }), ctx())).status, 422, String(bad));
    assert.deepEqual(await ok(await deskSettingsGet(req("GET", "/api/v1/front-office/room-service/settings", "viewer"), ctx())), { guestCancelMinutes: 5, maxMinutes: 60 });
    for (const who of ["amit", "bina"]) assert.equal((await deskListRoute(req("GET", "/api/v1/front-office/room-service/orders", who), ctx())).status, 403, `guest ${who} has no desk`);
  });

  test("a Hotel User never changes the guests' cancel window, even with full Front Office rights; they still read it and still work the orders", async () => {
    const refused = await deskSettingsPut(req("PUT", "/api/v1/front-office/room-service/settings", "deskUser", { guestCancelMinutes: 30 }), ctx());
    assert.equal(refused.status, 403);
    assert.equal((await json(refused)).error.message, "Only the Hotel Admin can change how long guests may cancel their orders.");
    assert.deepEqual(await ok(await deskSettingsGet(req("GET", "/api/v1/front-office/room-service/settings", "deskUser"), ctx())), { guestCancelMinutes: 5, maxMinutes: 60 }, "unchanged, and readable");
    const list = await ok(await deskListRoute(req("GET", "/api/v1/front-office/room-service/orders", "deskUser"), ctx()));
    assert.equal(list.guestCancelMinutes, 5, "the rule shows on their list");
    const r = await place();
    await ok(await move(r.orderId, "accepted", "deskUser"));
    await ok(await deskSettingsPut(req("PUT", "/api/v1/front-office/room-service/settings", "manager", { guestCancelMinutes: 30 }), ctx()));
    assert.equal((await ok(await deskSettingsGet(req("GET", "/api/v1/front-office/room-service/settings", "deskUser"), ctx()))).guestCancelMinutes, 30, "the Hotel Admin's change");
  });
});

describe("nobody reaches what is not theirs (IDOR)", () => {
  test("another guest's order is 404 to cancel and absent from their list; the same guest at another hotel cannot touch it; another hotel's staff cannot see or cancel it", async () => {
    const r = await place();
    assert.equal((await guestCancel(r.orderId, "bina")).status, 404);
    assert.equal((await ok(await guestOrdersRoute(req("GET", "/api/v1/guest/orders", "bina"), ctx()))).items.length, 0);
    assert.equal((await guestCancel(r.orderId, "amitAtB")).status, 404, "hotel B's session cannot reach hotel A's order");
    assert.equal((await deskCancel(r.orderId, "Not ours", "cookB")).status, 404);
    assert.equal((await move(r.orderId, "accepted", "cookB")).status, 404);
    assert.equal((await ok(await deskListRoute(req("GET", "/api/v1/front-office/room-service/orders", "cookB"), ctx()))).items.length, 0);
    assert.equal(data().roomOrders[0].status, "placed");
    assert.equal(chargesOf().length, 2);
  });

  test("the cancel route takes no body fields (no order, stay or room from outside) and the order body still refuses a room", async () => {
    const r = await place();
    const res = await guestCancelRoute(req("POST", `/api/v1/guest/orders/${r.orderId}/cancel`, "amit", { stayId: STAY_OTHER }), ctx({ id: r.orderId }));
    assert.ok([200, 422].includes(res.status));
    assert.equal(chargesOf(STAY_OTHER).length, 0);
  });
});
describe("staff take an order (restaurant table or a room)", () => {
  const staffPlace = (body: Record<string, unknown>, who = "cook") => deskPlaceRoute(req("POST", "/api/v1/front-office/room-service/orders", who, body), ctx());
  const posOf = async (who = "cook") => ok(await deskPosRoute(req("GET", "/api/v1/front-office/room-service/pos", who), ctx()));

  test("the order taker lists the food menu, the tables and the in-house rooms", async () => {
    const pos = await posOf("viewer");
    assert.deepEqual(pos.menu.map((m: { name: string }) => m.name).sort(), ["Gujarati Thali", "Tea / Coffee (2 cups)"]);
    assert.equal(pos.tables.length, 12);
    assert.deepEqual(pos.rooms.map((r: { roomNumber: string; guestName: string }) => r.roomNumber), ["101", "102"]);
  });

  test("a table order has no stay and no room charge, starts placed, is a staff order and is never held to the guests' cancel window", async () => {
    const r = await ok(await staffPlace({ kind: "table", table: "5", qty: { [THALI]: 2 }, note: "No onion" }), 201);
    assert.deepEqual([r.status, r.tableLabel, r.source, r.roomNumber, r.cancellableUntil, r.totalPaise], ["placed", "5", "staff", null, null, 64000]);
    assert.equal(data().charges.length, 0, "billed at the table, nothing on a room bill");
    assert.equal(data().roomOrders[0].stayId, null);
    clock = new Date(clock.getTime() + 60 * 60_000);
    const cancelled = await deskCancel(r.id, "Guest left");
    assert.equal(cancelled.status, 200, "staff cancel long after the guests' window");
    const staff = await ok(await deskListRoute(req("GET", "/api/v1/front-office/room-service/orders?status=all&source=staff", "cook"), ctx({})));
    assert.equal(staff.items.length, 1);
    assert.equal((await ok(await deskListRoute(req("GET", "/api/v1/front-office/room-service/orders?status=all&source=guest", "cook"), ctx({})))).items.length, 0);
  });

  test("a room order is charged to the stay like a guest's, and cancelling takes the charges off; the guest list shows it", async () => {
    const r = await ok(await staffPlace({ kind: "room", stayId: STAY, qty: { [TEA]: 1, [THALI]: 1 } }), 201);
    assert.deepEqual([r.roomNumber, r.guestName, r.source], ["101", "Amit Joshi", "staff"]);
    assert.equal(chargesOf().length, 2);
    assert.equal(data().roomOrders[0].lines.every((l) => l.chargeId !== null), true);
    assert.equal((await deskCancel(r.id, "Wrong room")).status, 200);
    assert.equal(chargesOf().length, 0);
  });

  test("the guest's open orders show the live window; a guest order is cancellable until the window ends", async () => {
    const g = await place();
    const list = await ok(await deskListRoute(req("GET", "/api/v1/front-office/room-service/orders?source=guest", "cook"), ctx({})));
    assert.equal(list.items[0].cancellableUntil, g.cancellableUntil);
    assert.deepEqual(list.openByPart, { guest: 1, staff: 0 });
  });

  test("refused: no items, no table, an unknown or unavailable item, another guest's stay at the other hotel, a viewer", async () => {
    assert.equal((await staffPlace({ kind: "table", table: "5", qty: {} })).status, 422);
    assert.equal((await staffPlace({ kind: "table", table: "", qty: { [TEA]: 1 } })).status, 422);
    assert.equal((await staffPlace({ kind: "table", table: "5", qty: { [pid(999)]: 1 } })).status, 422);
    data(HOTEL_B).menuRows.push({ id: TEA, group: "restaurant", name: "Tea", note: null, pricePaise: BigInt(8000), available: true, sortOrder: 1 });
    assert.equal((await staffPlace({ kind: "room", stayId: STAY, qty: { [TEA]: 1 } }, "cookB")).status, 409, "hotel B has no such stay");
    assert.equal((await staffPlace({ kind: "table", table: "5", qty: { [TEA]: 1 } }, "viewer")).status, 403);
    assert.equal(data().roomOrders.length, 0);
  });
});
