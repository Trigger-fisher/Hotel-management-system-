// Decision 52 (guest portal redesign) through the real routes and the in-memory hotel: order-info and the restaurant hours on orders (now / scheduled /
// not staying), and the persons on bills. (The Add member tests were removed with the feature, decision 59.)
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { GET as billRoute } from "../../src/app/api/v1/guest/bills/[id]/route";
import { GET as billsRoute } from "../../src/app/api/v1/guest/bills/route";
import { GET as hotelsRoute } from "../../src/app/api/v1/guest/hotels/route";
import { GET as orderInfoRoute } from "../../src/app/api/v1/guest/order-info/route";
import { GET as scheduledRoute } from "../../src/app/api/v1/guest/orders/scheduled/route";
import { POST as orderRoute } from "../../src/app/api/v1/guest/orders/route";
import { GET as profileRoute } from "../../src/app/api/v1/guest/profile/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { ACCEPTING_KEY, HOURS_KEY } from "../../src/server/services/menu/hours";
import { ctx, customer, json, pid, req, room, roomType, stay, wirePortal } from "./helpers/portalWorld";
import { HOTEL_A, makeSession } from "./helpers/session";

const CUST = pid(11);
const STAY = pid(41);
const ROOM = pid(51);
const TYPE = pid(61);
const TEA = pid(201);

const sessions = new Map<string, VerifiedSession>();
sessions.set("amit", { ...makeSession({ userId: pid(900), hotelId: HOTEL_A, accountRole: "guest_user", roleKey: "guest", roleLevel: 0, client: "web", scope: { kind: "guest", id: CUST } }), username: "amit.login" });
sessions.set("staff", makeSession({ userId: pid(982), accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, client: "web" }));

// Monday 5 October 2026, 10:00 IST; the stay runs to the morning of 7 October
let clock = new Date("2026-10-05T10:00:00+05:30");
let world = wirePortal(sessions, () => clock, new Map());
const data = () => world.hotel.store.dataFor(HOTEL_A);

function seed(withStay = true): void {
  const a = data();
  a.customers.push(customer({ id: CUST, mobile: "9876543210" }));
  a.roomTypes.push(roomType({ id: TYPE, name: "Deluxe Room", totalCount: 3 }));
  a.rooms.push(room({ id: ROOM, number: "101", roomTypeId: TYPE }));
  if (withStay) a.stays.push(stay({ id: STAY, roomId: ROOM, idProofNumber: "ABCD1234EF" }));
  a.menuRows.push({ id: TEA, group: "restaurant", name: "Tea / Coffee (2 cups)", note: null, pricePaise: BigInt(8000), available: true, sortOrder: 1 });
}

beforeEach(() => {
  clock = new Date("2026-10-05T10:00:00+05:30");
  world = wirePortal(sessions, () => clock, new Map());
  seed();
});

const ok = async (res: Response, status = 200) => {
  assert.equal(res.status, status, JSON.stringify(await res.clone().json()));
  return (await json(res)).data;
};
const orderBody = (extra: Record<string, unknown> = {}) => ({ qty: { [TEA]: 1 }, payWith: "room_bill", note: "", ...extra });
const order = (body: unknown, who = "amit") => orderRoute(req("POST", "/api/v1/guest/orders", who, body), ctx());
const hours = (accepting: boolean, days: { closed: boolean; opens: string; closes: string }[]) => {
  data().settings.set(ACCEPTING_KEY, accepting ? "1" : "0");
  data().settings.set(HOURS_KEY, JSON.stringify(days));
};
const OPEN_DAY = { closed: false, opens: "09:00", closes: "22:00" };
const week = (over: Record<number, { closed: boolean; opens: string; closes: string }> = {}) => Array.from({ length: 7 }, (_, d) => over[d] ?? OPEN_DAY);

describe("order-info: staying, and the restaurant hours the hotel admin set", () => {
  test("a guest in the house gets the stay and the hours; never set means open all day and accepting", async () => {
    const info = await ok(await orderInfoRoute(req("GET", "/api/v1/guest/order-info", "amit"), ctx()));
    assert.deepEqual([info.staying, info.stay, info.hours.accepting, info.hours.openNow, info.hours.days.length], [true, { roomNumber: "101", checkIn: "2026-10-03", checkOut: "2026-10-07" }, true, true, 7]);
    assert.deepEqual(info.hours.days[0], { day: 0, closed: false, opens: "00:00", closes: "23:59" });
  });

  test("the hours the admin saved decide openNow (in IST, Monday = 0); the switch off closes it whatever the hours", async () => {
    hours(true, week({ 0: { closed: false, opens: "11:00", closes: "22:00" } }));
    assert.equal((await ok(await orderInfoRoute(req("GET", "/api/v1/guest/order-info", "amit"), ctx()))).hours.openNow, false, "10:00 is before the 11:00 opening");
    clock = new Date("2026-10-05T12:00:00+05:30");
    assert.equal((await ok(await orderInfoRoute(req("GET", "/api/v1/guest/order-info", "amit"), ctx()))).hours.openNow, true);
    hours(false, week());
    assert.equal((await ok(await orderInfoRoute(req("GET", "/api/v1/guest/order-info", "amit"), ctx()))).hours.openNow, false);
  });

  test("not staying: staying false and no stay; staff and anonymous are refused", async () => {
    data().stays.length = 0;
    const info = await ok(await orderInfoRoute(req("GET", "/api/v1/guest/order-info", "amit"), ctx()));
    assert.deepEqual([info.staying, info.stay], [false, null]);
    assert.equal((await orderInfoRoute(req("GET", "/api/v1/guest/order-info", "staff"), ctx())).status, 403);
    assert.equal((await orderInfoRoute(req("GET", "/api/v1/guest/order-info", null), ctx())).status, 401);
  });
});

describe("orders: now only inside the hours, or scheduled inside them and inside the stay", () => {
  test("open now: a normal order works; closed now or not accepting: 409 with a sentence and no charge", async () => {
    hours(true, week());
    assert.equal((await ok(await order(orderBody()), 201)).scheduledFor, null);
    const charges = data().charges.length;
    hours(true, week({ 0: { closed: true, opens: "00:00", closes: "00:00" } }));
    const closed = await order(orderBody());
    assert.equal(closed.status, 409);
    assert.match((await json(closed)).error.message, /closed/i);
    hours(false, week());
    const off = await order(orderBody());
    assert.equal(off.status, 409);
    assert.match((await json(off)).error.message, /not taking/i);
    assert.equal(data().charges.length, charges, "a refusal adds no charge");
  });

  test("scheduled: inside an open period and the stay it is accepted (even when the restaurant is closed now); the charge names the time", async () => {
    hours(true, week({ 0: { closed: true, opens: "00:00", closes: "00:00" } }));
    const done = await ok(await order(orderBody({ scheduledFor: "2026-10-06T20:00:00+05:30" })), 201);
    assert.equal(done.scheduledFor, "2026-10-06T14:30:00.000Z");
    assert.ok(data().charges.some((c) => c.description.startsWith("Order for 6 Oct, 8:00 pm:")));
  });

  test("scheduled: too soon, after check-out, on a closed day, outside the hours, or in the wrong format is refused on scheduledFor", async () => {
    hours(true, week({ 1: { closed: true, opens: "00:00", closes: "00:00" } }));
    const refuse = async (when: string) => {
      const res = await order(orderBody({ scheduledFor: when }));
      assert.equal(res.status, 422, when);
      assert.ok((await json(res)).error.details.fields.scheduledFor, when);
    };
    await refuse("2026-10-05T10:05:00+05:30"); // under 15 minutes ahead
    await refuse("2026-10-07T13:00:00+05:30"); // after the check-out morning
    await refuse("2026-10-06T12:00:00+05:30"); // Tuesday is closed
    await refuse("2026-10-05T23:00:00+05:30"); // after 22:00
    await refuse("2026-10-05T20:00:00Z"); // not the hotel's +05:30
    assert.equal(data().charges.length, 0);
  });

  test("not staying: 409 with a sentence, scheduled or not", async () => {
    data().stays.length = 0;
    for (const body of [orderBody(), orderBody({ scheduledFor: "2026-10-06T20:00:00+05:30" })]) {
      const res = await order(body);
      assert.equal(res.status, 409);
      assert.match((await json(res)).error.message, /staying/i);
    }
  });
});

describe("bills show who stayed", () => {
  test("the running bill of the stay carries adults, children and the names (the main guest, then the members)", async () => {
    data().stays[0].guestDetails = { members: [{ fullName: "Meera Sharma Joshi" }] };
    const list = await ok(await billsRoute(req("GET", "/api/v1/guest/bills?tab=all", "amit"), ctx()));
    assert.ok(list.items.length > 0);
    for (const b of list.items) assert.deepEqual(b.persons, { adults: 2, children: 0, names: ["Amit Joshi", "Meera Sharma Joshi"] });
  });
});

describe("the guest's own screens: sign-in name, line texts, Coming up, the hotel's phone", () => {
  test("My profile names the login (not the mobile number) as the username", async () => {
    const p = await ok(await profileRoute(req("GET", "/api/v1/guest/profile", "amit"), ctx()));
    assert.equal(p.username, "amit.login");
    assert.equal(p.mobile, "9876543210");
  });

  test("a bill line reads '2 × ₹80' for a whole quantity, and a scheduled order is named 'Order for 6 Oct, 8:00 pm'", async () => {
    await ok(await order(orderBody({ qty: { [TEA]: 2 }, scheduledFor: "2026-10-06T20:00:00+05:30" })), 201);
    const bill = await ok(await billRoute(req("GET", `/api/v1/guest/bills/stay.${STAY}.food`, "amit"), ctx({ id: `stay.${STAY}.food` })));
    const line = JSON.stringify(bill.lines);
    assert.ok(line.includes("Order for 6 Oct, 8:00 pm: Tea / Coffee (2 cups)"), line);
    assert.ok(line.includes("2 × ₹80"), line);
    assert.ok(!line.includes("2.00"), "no decimals on a whole quantity");
  });

  test("Coming up: this stay's scheduled orders, soonest first; gone once their time has passed; empty when not staying; staff and anonymous refused", async () => {
    await ok(await order(orderBody({ scheduledFor: "2026-10-06T20:00:00+05:30" })), 201);
    await ok(await order(orderBody({ qty: { [TEA]: 3 }, scheduledFor: "2026-10-06T09:30:00+05:30" })), 201);
    await ok(await order(orderBody()), 201); // an order for now is not "coming up"
    const list = (await ok(await scheduledRoute(req("GET", "/api/v1/guest/orders/scheduled", "amit"), ctx()))).items;
    assert.deepEqual(list.map((o: { scheduledFor: string }) => o.scheduledFor), ["2026-10-06T09:30:00+05:30", "2026-10-06T20:00:00+05:30"]);
    assert.deepEqual(list[0].lines, [{ name: "Tea / Coffee (2 cups)", qty: 3 }]);
    assert.match(list[0].orderNo, /^O-[0-9A-F]{6}$/);
    assert.ok(list[0].totalPaise >= 24000);
    clock = new Date("2026-10-06T10:00:00+05:30");
    assert.deepEqual((await ok(await scheduledRoute(req("GET", "/api/v1/guest/orders/scheduled", "amit"), ctx()))).items.map((o: { scheduledFor: string }) => o.scheduledFor), ["2026-10-06T20:00:00+05:30"]);
    data().stays.length = 0;
    assert.deepEqual((await ok(await scheduledRoute(req("GET", "/api/v1/guest/orders/scheduled", "amit"), ctx()))).items, []);
    assert.equal((await scheduledRoute(req("GET", "/api/v1/guest/orders/scheduled", "staff"), ctx())).status, 403);
    assert.equal((await scheduledRoute(req("GET", "/api/v1/guest/orders/scheduled", null), ctx())).status, 401);
  });

  test("the hotel list carries the number to call (or null)", async () => {
    const hotels = await ok(await hotelsRoute(req("GET", "/api/v1/guest/hotels", "amit"), ctx()));
    assert.equal(hotels.length, 1);
    assert.ok("phone" in hotels[0] && (hotels[0].phone === null || typeof hotels[0].phone === "string"));
  });

  test("the number to call: the hotel profile phone, else the Website reception phone, else null", async () => {
    const phone = async () => (await ok(await hotelsRoute(req("GET", "/api/v1/guest/hotels", "amit"), ctx())))[0].phone;
    data().profile.phone = "";
    assert.equal(await phone(), null);
    await world.hotel.unit.run(sessions.get("amit") as VerifiedSession, (repos) => repos.siteSettings.update({ receptionPhone: "  0281 245 6789 " }, pid(1)));
    assert.equal(await phone(), "0281 245 6789", "the Website reception phone when the profile has none");
    data().profile.phone = "0281 111 2222";
    assert.equal(await phone(), "0281 111 2222", "the hotel profile phone first");
  });
});