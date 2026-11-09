// Front Office end to end through the REAL route files, the wrapper, the services and ONE in-memory hotel store shared with billing (check-out
// writes its bill in the same unit). Expected behaviour: docs/specs/front-office.md (each rule cites Pallav).
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import type { CheckoutDefaults, GuestLookupMatch, Reservation, Room, Stay } from "@shared/dashboards/frontOffice";
import { GET as boardRoute } from "../../src/app/api/v1/front-office/board/route";
import { GET as optionsRoute } from "../../src/app/api/v1/front-office/options/route";
import { POST as advanceRoute } from "../../src/app/api/v1/front-office/reservations/[id]/advances/route";
import { POST as cancelRoute } from "../../src/app/api/v1/front-office/reservations/[id]/cancel/route";
import { GET as getReservationRoute, PATCH as updateReservationRoute } from "../../src/app/api/v1/front-office/reservations/[id]/route";
import { GET as listReservationsRoute, POST as createReservationRoute } from "../../src/app/api/v1/front-office/reservations/route";
import { PUT as housekeepingRoute } from "../../src/app/api/v1/front-office/rooms/[id]/housekeeping/route";
import { DELETE as deleteRoomRoute, PATCH as updateRoomRoute } from "../../src/app/api/v1/front-office/rooms/[id]/route";
import { PUT as serviceRoute } from "../../src/app/api/v1/front-office/rooms/[id]/service/route";
import { POST as bulkRoute } from "../../src/app/api/v1/front-office/rooms/bulk/route";
import { GET as listRoomsRoute, POST as createRoomRoute } from "../../src/app/api/v1/front-office/rooms/route";
import { DELETE as removeChargeRoute } from "../../src/app/api/v1/front-office/stays/[id]/charges/[chargeId]/route";
import { POST as chargeRoute } from "../../src/app/api/v1/front-office/stays/[id]/charges/route";
import { POST as checkoutRoute } from "../../src/app/api/v1/front-office/stays/[id]/checkout/route";
import { POST as extendRoute } from "../../src/app/api/v1/front-office/stays/[id]/extend/route";
import { PUT as guestDetailsRoute } from "../../src/app/api/v1/front-office/stays/[id]/guest-details/route";
import { POST as revealStayIdRoute } from "../../src/app/api/v1/front-office/stays/[id]/id-number/route";
import { POST as moveRoute } from "../../src/app/api/v1/front-office/stays/[id]/move/route";
import { GET as getStayRoute } from "../../src/app/api/v1/front-office/stays/[id]/route";
import { GET as checkoutDefaultsRoute } from "../../src/app/api/v1/front-office/stays/checkout-defaults/route";
import { GET as guestLookupRoute } from "../../src/app/api/v1/front-office/guests/lookup/route";
import { GET as prefillRoute } from "../../src/app/api/v1/front-office/stays/prefill/route";
import { POST as checkInRoute } from "../../src/app/api/v1/front-office/stays/route";
import { GET as requestsRoute } from "../../src/app/api/v1/front-office/requests/route";
import { POST as closeRequestRoute } from "../../src/app/api/v1/front-office/requests/[id]/close/route";
import { createRequestService } from "../../src/server/services/frontOffice/requestService";
import type { VerifiedSession } from "../../src/server/auth/session";
import { configureBillingAdvances, configureBillingBills } from "../../src/server/compose/billing";
import { configureFrontOffice } from "../../src/server/compose/frontOffice";
import type { AppError } from "../../src/server/errors";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { createMemoryHotel } from "../../src/server/repos/memory/frontOffice";
import { createAdvanceService } from "../../src/server/services/billing/advanceService";
import { createBillService } from "../../src/server/services/billing/billService";
import type { Person } from "../../src/server/services/cash/ports";
import { createReservationService, type ReservationService } from "../../src/server/services/frontOffice/reservationService";
import { createRoomService } from "../../src/server/services/frontOffice/roomService";
import { createStayService, type StayService } from "../../src/server/services/frontOffice/stayService";
import { assertMatchesContract } from "./helpers/contract";
import { catalog, grant, HOTEL_A, HOTEL_B, makeSession } from "./helpers/session";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TYPE_DLX = id(200);
const TYPE_STD = id(201);
const COMPANY = id(100);
const people = new Map<string, Person>([[id(4), { id: id(4), name: "Hari Admin", roleKey: "admin", roleLevel: 3, deleted: false }]]);
const sessions = new Map<string, VerifiedSession>();
const mk = (name: string, userId: string, options: Parameters<typeof makeSession>[0]) => sessions.set(name, makeSession({ userId, client: "web", ...options }));
mk("desk", id(1), { grants: [grant("pms", "view"), grant("pms.board", "view"), grant("pms.reservations", "edit"), grant("pms.stays", "full"), grant("pms.rooms", "full")] });
mk("viewer", id(2), { grants: [grant("pms.board", "view"), grant("pms.reservations", "view"), grant("pms.stays", "view"), grant("pms.rooms", "view")] });
mk("roomsOnly", id(3), { grants: [grant("pms.rooms", "edit")] });
mk("admin", id(4), { accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3, grants: [grant("pms", "view"), grant("pms.board", "view"), grant("pms.reservations", "edit"), grant("pms.stays", "full"), grant("pms.rooms", "full"), grant("bills", "full"), grant("users", "full")] });
mk("nobody", id(6), {});
mk("deskB", id(8), { hotelId: HOTEL_B, grants: [grant("pms.board", "view"), grant("pms.reservations", "edit"), grant("pms.stays", "full"), grant("pms.rooms", "full")] });

// the REAL encryption with test keys: the stored value must never be the number

let clock = new Date("2026-10-05T10:00:00+05:30");
let hotel = createMemoryHotel();
let stays: StayService;
let reservations: ReservationService;
let failLog = false;

function wire(): void {
  hotel = createMemoryHotel();
  const plain = hotel.unit;
  // while failLog is set, the system log cannot be written: everything the action did in the same unit must be rolled back
  const unit = { run: <T>(s: Parameters<typeof plain.run>[0], work: Parameters<typeof plain.run<T>>[1]) => plain.run(s, (repos) => work(failLog ? { ...repos, systemLogs: { write: async () => { throw new Error("log table is down"); } } } : repos)) } as typeof plain;
  const base = { unit, people: { get: async (ids: readonly string[]) => new Map(ids.filter((i) => people.has(i)).map((i) => [i, people.get(i) as Person])) }, audit: { record: async () => undefined }, catalog, now: () => clock };
  const bills = createBillService(base);
  configureBillingBills(bills);
  configureBillingAdvances(createAdvanceService(base));
  const deps = { ...base, bills };
  const rooms = createRoomService(deps);
  reservations = createReservationService(deps);
  stays = createStayService(deps, rooms);
  configureFrontOffice({ rooms, reservations, stays, requests: createRequestService(deps) });
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
  for (const h of [HOTEL_A, HOTEL_B]) {
    const d = hotel.store.dataFor(h);
    d.companies.set(COMPANY, "Infosys Rajkot");
    d.years = [{ id: "y1", label: "2025-26", startsOn: "2025-04-01", endsOn: "2026-03-31" }, { id: "y2", label: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31" }];
    d.roomTypes = [
      { id: TYPE_DLX, name: "Deluxe", totalCount: 2, sortOrder: 1, plans: [{ code: "CP", name: "With breakfast", singlePaise: BigInt(320000), doublePaise: BigInt(400000), active: true, sortOrder: 2 }, { code: "EP", name: "Room only", singlePaise: null, doublePaise: BigInt(350000), active: true, sortOrder: 1 }] },
      { id: TYPE_STD, name: "Standard", totalCount: 5, sortOrder: 2, plans: [] },
    ];
    d.idProofTypes = [{ name: "Passport", active: true }, { name: "Aadhaar", active: true }, { name: "Old card", active: false }];
    d.options = { payment_mode: [{ value: "Cash", label: "Cash", isDefault: true }, { value: "UPI", label: "UPI", isDefault: false }] };
    d.settings.set("checkout.hotel_gst_percent", "12");
    d.settings.set("checkout.food_gst_percent", "5");
  }
}

const ORIGIN = "https://hms.test";
function req(method: string, path: string, who: string | null, body?: unknown, headers: Record<string, string> = {}): Request {
  const h: Record<string, string> = { host: "hms.test", origin: ORIGIN, ...headers };
  if (who) h["x-test-session"] = who;
  if (body !== undefined) h["content-type"] = "application/json";
  return new Request(`${ORIGIN}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: bodies are asserted field by field
const json = async (res: Response) => (await res.json()) as any;
const fields = async (res: Response) => (await json(res)).error.details.fields;
const data = (h = HOTEL_A) => hotel.store.dataFor(h);

async function room(number: string, typeId: string | null = TYPE_DLX, who = "desk"): Promise<Room> {
  const res = await createRoomRoute(req("POST", "/api/v1/front-office/rooms", who, { number, floor: "1", roomTypeId: typeId ?? "", notes: "" }));
  assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
  return (await json(res)).data;
}
const reservationInput = (over: Record<string, unknown> = {}) => ({
  guestName: "Ravi Mehta", mobile: "+91 98765 43210", email: "ravi@example.com", companyId: "", source: "phone", checkIn: "2026-10-06", checkOut: "2026-10-08",
  adults: 2, children: 0, roomTypeId: TYPE_DLX, rooms: 1, plan: "CP", ratePaise: 400000, notes: "", ...over,
});
async function reservation(over: Record<string, unknown> = {}, who = "desk"): Promise<Reservation & { version: number }> {
  const res = await createReservationRoute(req("POST", "/api/v1/front-office/reservations", who, reservationInput(over)));
  assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
  return (await json(res)).data;
}
const checkInInput = (roomId: string, over: Record<string, unknown> = {}) => ({
  reservationId: "", roomId, expectedCheckOut: "2026-10-08", grNumber: "GR-1", adults: 2, children: 1, plan: "CP", ratePaise: 250000, guestName: "Ravi Mehta", mobile: "+91 98765 43210",
  email: "", address: "150 Ring Road", city: "Rajkot", nationality: "Indian", idProofType: "Aadhaar", idProofNumber: "1234 5678 9012", companyId: "", guestGstin: "", notes: "", ...over,
});
async function checkIn(roomId: string, over: Record<string, unknown> = {}, who = "desk"): Promise<Stay & { version: number }> {
  const res = await checkInRoute(req("POST", "/api/v1/front-office/stays", who, checkInInput(roomId, over)));
  assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
  return (await json(res)).data;
}
const charge = (who: string, stayId: string, body: unknown) => chargeRoute(req("POST", `/api/v1/front-office/stays/${stayId}/charges`, who, body), ctx({ id: stayId }));
const chargeInput = (over: Record<string, unknown> = {}) => ({ category: "food", description: "Dinner", chargeDate: "2026-10-05", quantity: 2, unitPricePaise: 45000, ...over });
const checkout = (who: string, stayId: string, body: unknown) => checkoutRoute(req("POST", `/api/v1/front-office/stays/${stayId}/checkout`, who, body), ctx({ id: stayId }));
const checkoutInput = (version: number, over: Record<string, unknown> = {}) => ({ billNumber: "1188", billDate: "2026-10-08", hotelGstPercent: 12, foodGstPercent: 5, hotelMode: "Cash", foodMode: "UPI", instruction: "", version, ...over });

beforeEach(() => {
  clock = new Date("2026-10-05T10:00:00+05:30");
  failLog = false;
  wire();
});

describe("the system log is in the same unit as the change", () => {
  test("a log line that cannot be written rolls back a check-in, a charge and a check-out (and the bill it makes): nothing is half done", async () => {
    const r1 = await room("101");
    const r2 = await room("102");
    failLog = true;
    assert.equal((await checkInRoute(req("POST", "/api/v1/front-office/stays", "desk", checkInInput(r1.id)))).status, 500);
    assert.equal(data().stays.length, 0, "no stay was left behind");
    failLog = false;
    const stay = await checkIn(r2.id);
    failLog = true;
    assert.equal((await charge("desk", stay.id, chargeInput())).status, 500);
    assert.equal(data().charges.length, 0);
    const before = data().bills.length;
    assert.equal((await checkout("desk", stay.id, checkoutInput(stay.version))).status, 500);
    assert.equal(data().bills.length, before, "the bill of the check-out was rolled back");
    assert.equal(data().stays.find((s) => s.id === stay.id)?.status, "in_house", "the guest is still in the room");
    failLog = false;
    assert.equal((await checkInRoute(req("POST", "/api/v1/front-office/stays", "desk", checkInInput(r1.id)))).status, 201, "the room was never taken by the failed check-in");
  });
});

describe("rooms (RoomController)", () => {
  test("add, unique number (any case), edit, sort order follows", async () => {
    const a = await room("101");
    const b = await room("102");
    assert.equal(data().rooms.find((r) => r.id === b.id)?.sortOrder, 2);
    const dup = await createRoomRoute(req("POST", "/api/v1/front-office/rooms", "desk", { number: "101", floor: "", roomTypeId: "", notes: "" }));
    assert.deepEqual(await fields(dup), { number: "There is already a room with that number." });
    const res = await updateRoomRoute(req("PATCH", `/api/v1/front-office/rooms/${a.id}`, "desk", { number: "101", floor: "2", roomTypeId: TYPE_STD, notes: "Sea view" }), ctx({ id: a.id }));
    assert.equal((await json(res)).data.roomTypeName, "Standard");
    assert.equal(data().systemLogs.at(-1)?.summary, "Changed Room: Room 101 (Floor, Room type id, Notes)");
  });
  test("Laravel's words: number required and max 20, category must exist", async () => {
    const res = await createRoomRoute(req("POST", "/api/v1/front-office/rooms", "desk", { number: "", floor: "f".repeat(21), roomTypeId: id(999), notes: "n".repeat(256) }));
    assert.deepEqual(await fields(res), { number: "The number field is required.", floor: "The floor field must not be greater than 20 characters.", roomTypeId: "The selected room type id is invalid.", notes: "The notes field must not be greater than 255 characters." });
  });
  test("bulk: ranges and lists, existing ones skipped; all there already is refused with Pallav's words", async () => {
    await room("103");
    const res = await bulkRoute(req("POST", "/api/v1/front-office/rooms/bulk", "desk", { numbers: "101-104, 201 202", floor: "", roomTypeId: TYPE_STD }));
    assert.deepEqual((await json(res)).data, { added: 5, skipped: ["103"] });
    assert.equal(data().systemLogs.at(-1)?.summary, "Added 5 rooms");
    const again = await bulkRoute(req("POST", "/api/v1/front-office/rooms/bulk", "desk", { numbers: "201", floor: "", roomTypeId: "" }));
    assert.equal((await json(again)).error.message, "Those rooms are all already there.");
  });
  test("delete only a room no stay names; housekeeping sets a status; out of order refused while a guest is in", async () => {
    const r = await room("101");
    const used = await room("102");
    await checkIn(used.id);
    assert.equal((await json(await deleteRoomRoute(req("DELETE", `/api/v1/front-office/rooms/${used.id}`, "desk"), ctx({ id: used.id })))).error.message, "Room 102 has guests on record and stays. Mark it out of order instead.");
    assert.equal((await deleteRoomRoute(req("DELETE", `/api/v1/front-office/rooms/${r.id}`, "roomsOnly"), ctx({ id: r.id }))).status, 403, "delete is Full Access");
    assert.equal((await deleteRoomRoute(req("DELETE", `/api/v1/front-office/rooms/${r.id}`, "desk"), ctx({ id: r.id }))).status, 200);
    const fresh = await room("103");
    const dirty = (await json(await housekeepingRoute(req("PUT", `/api/v1/front-office/rooms/${fresh.id}/housekeeping`, "roomsOnly", { hkStatus: "dirty" }), ctx({ id: fresh.id })))).data;
    assert.equal(dirty.state, "dirty");
    const busy = await serviceRoute(req("PUT", `/api/v1/front-office/rooms/${used.id}/service`, "desk", { outOfOrder: true, reason: "AC" }), ctx({ id: used.id }));
    assert.equal((await json(busy)).error.message, "Room 102 has a guest in it. Check them out or move them first.");
    const ooo = (await json(await serviceRoute(req("PUT", `/api/v1/front-office/rooms/${fresh.id}/service`, "desk", { outOfOrder: true, reason: "  AC broken  " }), ctx({ id: fresh.id })))).data;
    assert.deepEqual([ooo.state, ooo.outOfOrderReason], ["outOfOrder", "AC broken"]);
    assert.equal(data().systemLogs.at(-1)?.summary, "Room 103 taken out of order");
  });
  test("the rooms list: states, counts, hostile search; contract shape", async () => {
    const a = await room("101");
    await room("102");
    await checkIn(a.id);
    const body = (await json(await listRoomsRoute(req("GET", "/api/v1/front-office/rooms", "viewer")))).data;
    assert.deepEqual(body.counts, { all: 2, vacant: 1, occupied: 1, dirty: 0, outOfOrder: 0 });
    const sample: Room = { id: "x", number: "x", floor: null, roomTypeId: null, roomTypeName: null, notes: "x", hkStatus: "clean", outOfOrder: false, outOfOrderReason: null, hasHistory: true, currentStay: null, state: "vacant" };
    for (const item of body.items) assertMatchesContract(item, sample);
    for (const s of ["%", "' OR 1=1 --", "_"]) assert.equal((await json(await listRoomsRoute(req("GET", `/api/v1/front-office/rooms?search=${encodeURIComponent(s)}`, "viewer")))).data.total, 0, s);
    assert.equal((await listRoomsRoute(req("GET", "/api/v1/front-office/rooms?filter=bad", "viewer"))).status, 422);
  });
});

describe("the board (BoardController)", () => {
  test("floors, stats, occupancy over rooms in service, arrivals and departures", async () => {
    const a = await room("101");
    await room("102");
    const c = await room("201", TYPE_STD);
    await serviceRoute(req("PUT", `/api/v1/front-office/rooms/${c.id}/service`, "desk", { outOfOrder: true, reason: "" }), ctx({ id: c.id }));
    await checkIn(a.id, { expectedCheckOut: "2026-10-06" });
    await reservation({ checkIn: "2026-10-05", checkOut: "2026-10-07" });
    clock = new Date("2026-10-06T09:00:00+05:30");
    const boardRes = await boardRoute(req("GET", "/api/v1/front-office/board", "viewer"));
    assert.deepEqual([boardRes.headers.get("cache-control"), boardRes.headers.has("etag")], ["private, no-cache", true], "an ETag answer (API audit B22)");
    const b = (await json(boardRes)).data;
    assert.deepEqual(b.stats, { rooms: 3, occupied: 1, vacant: 1, dirty: 0, outOfOrder: 1, occupancy: 50 });
    assert.equal(b.arrivals.length, 1);
    assert.equal(b.departures.length, 1);
    assert.equal(b.inHouse, 1);
    assert.equal((await boardRoute(req("GET", "/api/v1/front-office/board", "nobody"))).status, 403);
  });
});

describe("reservations (ReservationController, FrontDesk)", () => {
  test("RES-{yy}-{n} from one past the highest number; confirmed; logged", async () => {
    const a = await reservation();
    assert.equal(a.reference, "RES-26-00001");
    assert.equal(a.status, "confirmed");
    assert.equal(a.nights, 2);
    assert.equal(a.roomTotalPaise, 800000);
    assert.equal(data().systemLogs[0].summary, "Added Reservation: RES-26-00001 - Ravi Mehta");
    data().reservations[0].reference = "RES-25-00041";
    clock = new Date("2027-01-02T10:00:00+05:30");
    assert.equal((await reservation({ checkIn: "2027-01-05", checkOut: "2027-01-06" })).reference, "RES-27-00042", "never reset by year");
  });
  test("availability: capacity from the category's total before real rooms; Pallav's words when full", async () => {
    await reservation({ rooms: 2 });
    let res = await createReservationRoute(req("POST", "/api/v1/front-office/reservations", "desk", reservationInput()));
    assert.equal((await json(res)).error.message, "No Deluxe room is free for every night of those dates.");
    await room("101");
    await room("102");
    await room("103");
    res = await createReservationRoute(req("POST", "/api/v1/front-office/reservations", "desk", reservationInput({ rooms: 2 })));
    assert.equal((await json(res)).error.message, "Only 1 Deluxe room is free for every night of those dates.");
  });
  test("Laravel's and Pallav's words for the fields", async () => {
    const res = await createReservationRoute(req("POST", "/api/v1/front-office/reservations", "desk", reservationInput({ guestName: "", email: "not-an-email", roomTypeId: "", rooms: 0, adults: 100, children: -1, checkIn: "2026-10-08", checkOut: "2026-10-08", ratePaise: -5 })));
    assert.deepEqual(await fields(res), {
      guestName: "The guest name field is required.",
      email: "The email field must be a valid email address.",
      roomTypeId: "Choose a room category.",
      rooms: "The rooms field must be at least 1.",
      ratePaise: "The rate field must be at least 0.",
      adults: "The adults field must not be greater than 99.",
      children: "The children field must be at least 0.",
      checkOut: "Check-out must be after check-in.",
    });
  });
  test("edit only while confirmed or checked in; version; cancel rules and the advance notice", async () => {
    const r = await reservation();
    const upd = await updateReservationRoute(req("PATCH", `/api/v1/front-office/reservations/${r.id}`, "desk", { ...reservationInput({ guestName: "Ravi M" }), version: 1 }), ctx({ id: r.id }));
    assert.equal((await json(upd)).data.version, 2);
    assert.equal((await updateReservationRoute(req("PATCH", `/api/v1/front-office/reservations/${r.id}`, "desk", { ...reservationInput(), version: 1 }), ctx({ id: r.id }))).status, 409);
    const noReason = await cancelRoute(req("POST", `/api/v1/front-office/reservations/${r.id}/cancel`, "desk", { noShow: false, reason: " ", version: 2 }), ctx({ id: r.id }));
    assert.equal((await json(noReason)).error.message, "Please give a reason for cancelling.");
    await advanceRoute(req("POST", `/api/v1/front-office/reservations/${r.id}/advances`, "desk", { receiptNumber: "77", paymentDate: "2026-10-05", hotelPaise: 100000, foodPaise: null, hotelMode: "UPI", foodMode: "", instruction: "" }), ctx({ id: r.id }));
    const noShow = (await json(await cancelRoute(req("POST", `/api/v1/front-office/reservations/${r.id}/cancel`, "desk", { noShow: true, reason: "", version: 2 }), ctx({ id: r.id })))).data;
    assert.equal(noShow.reservation.status, "noShow");
    assert.equal(noShow.reservation.cancelReason, "Did not arrive");
    assert.equal(noShow.notice, "It still has an advance: refund it from Guest Advances if it is to be returned.");
    const again = await cancelRoute(req("POST", `/api/v1/front-office/reservations/${r.id}/cancel`, "desk", { noShow: false, reason: "x", version: 3 }), ctx({ id: r.id }));
    assert.equal((await json(again)).error.message, "Only a reservation not yet checked in can be cancelled.");
    const edit = await updateReservationRoute(req("PATCH", `/api/v1/front-office/reservations/${r.id}`, "desk", { ...reservationInput(), version: 3 }), ctx({ id: r.id }));
    assert.equal((await json(edit)).error.message, "A reservation that is finished or cancelled cannot be changed.");
  });
  test("an advance against a reservation is a Guest Advance (Billing::advance): numbered, cleaned mobile, logged in bills", async () => {
    const r = await reservation();
    const res = await advanceRoute(req("POST", `/api/v1/front-office/reservations/${r.id}/advances`, "desk", { receiptNumber: "77", paymentDate: "2026-10-05", hotelPaise: 100000, foodPaise: 20000, hotelMode: "UPI", foodMode: "Cash", instruction: "" }), ctx({ id: r.id }));
    assert.equal(res.status, 201);
    const a = data().advances[0];
    assert.deepEqual([a.receiptNumber, a.mobileNumber, a.reservationId, a.referenceName, a.instruction], ["2026 / 77", "+919876543210", r.id, "RES-26-00001", "Advance for reservation RES-26-00001"]);
    assert.equal(data().systemLogs.at(-1)?.summary, "Added Advance: Advance 2026 / 77 - Ravi Mehta");
    assert.equal(data().systemLogs.at(-1)?.module, "bills");
    const dup = await advanceRoute(req("POST", `/api/v1/front-office/reservations/${r.id}/advances`, "desk", { receiptNumber: "77", paymentDate: "2026-10-05", hotelPaise: 1, foodPaise: null, hotelMode: "", foodMode: "", instruction: "" }), ctx({ id: r.id }));
    assert.equal((await json(dup)).error.message, "That receipt number is already used.");
    const none = await advanceRoute(req("POST", `/api/v1/front-office/reservations/${r.id}/advances`, "desk", { receiptNumber: "78", paymentDate: "2026-10-05", hotelPaise: 0, foodPaise: null, hotelMode: "", foodMode: "", instruction: "" }), ctx({ id: r.id }));
    assert.equal((await json(none)).error.message, "Enter how much the guest paid.");
    const one = (await json(await getReservationRoute(req("GET", `/api/v1/front-office/reservations/${r.id}`, "viewer"), ctx({ id: r.id })))).data;
    assert.equal(one.advanceBalancePaise, 120000);
  });
  test("views, search and the contract shape", async () => {
    await reservation({ guestName: "Arjun Rao", checkIn: "2026-10-05", checkOut: "2026-10-06" });
    await reservation({ guestName: "Neha Shah", checkIn: "2026-10-09", checkOut: "2026-10-10" });
    const body = (await json(await listReservationsRoute(req("GET", "/api/v1/front-office/reservations?view=today", "viewer")))).data;
    assert.deepEqual(body.items.map((r: Reservation) => r.guestName), ["Arjun Rao"]);
    assert.equal(body.counts.upcoming, 2);
    const sample: Reservation = {
      id: "x", version: 1, reference: "x", guestName: "x", mobile: "x", email: "x", companyId: null, companyName: null, roomTypeId: "x", roomTypeName: "x", rooms: 1, plan: "x", ratePaise: 1, adults: 1, children: 0,
      checkIn: "x", checkOut: "x", nights: 1, roomTotalPaise: 1, source: "phone", enquiryRef: null, notes: "x", status: "confirmed", cancelReason: null, advances: [], advancePaidPaise: 0, advanceBalancePaise: 0, stays: [], createdAt: "x",
    };
    assertMatchesContract(body.items[0], sample);
    const found = (await json(await listReservationsRoute(req("GET", "/api/v1/front-office/reservations?view=all&search=neha", "viewer")))).data;
    assert.equal(found.total, 1);
  });
  test("20 reservations made at once get 20 different references", async () => {
    await room("101");
    const desk = sessions.get("desk") as VerifiedSession;
    const meta = { traceId: "t", ip: null };
    const made = await Promise.all(Array.from({ length: 20 }, (_, i) => reservations.create(desk, reservationInput({ roomTypeId: TYPE_STD, checkIn: `2026-11-${String(i + 1).padStart(2, "0")}`, checkOut: `2026-11-${String(i + 2).padStart(2, "0")}` }) as never, meta)));
    assert.equal(new Set(made.map((r) => r.reference)).size, 20);
  });
  test("website enquiry -> reservation: once, first active plan, Pallav's single/double rule; cancelling the enquiry cancels it", async () => {
    data().enquiries = [{ id: id(300), reference: "ENQ-26-0007", name: "Asha", phone: "9999999999", email: null, message: "Late arrival", roomId: TYPE_DLX, checkIn: "2026-10-10", checkOut: "2026-10-12", guests: 1, children: 0 }];
    const desk = sessions.get("desk") as VerifiedSession;
    const first = await hotel.unit.run(desk, (repos) => reservations.reserveFromEnquiry(repos, desk, id(300)));
    assert.deepEqual([first?.plan, first?.ratePaise, first?.adults, first?.source, first?.notes], ["EP", BigInt(350000), 1, "website", "Website enquiry ENQ-26-0007\nLate arrival"]);
    const again = await hotel.unit.run(desk, (repos) => reservations.reserveFromEnquiry(repos, desk, id(300)));
    assert.equal(again?.id, first?.id);
    await hotel.unit.run(desk, (repos) => reservations.cancelFromEnquiry(repos, desk, id(300), "Guest changed plans"));
    assert.equal(data().reservations[0].status, "cancelled");
    const back = await hotel.unit.run(desk, (repos) => reservations.reserveFromEnquiry(repos, desk, id(300)));
    assert.equal(back?.status, "confirmed");
  });
  test("options: categories with their active plans, companies, active ID types, payment modes", async () => {
    const o = (await json(await optionsRoute(req("GET", "/api/v1/front-office/options", "viewer")))).data;
    assert.deepEqual(o.roomTypes[0].plans.map((p: { code: string }) => p.code), ["EP", "CP"]);
    assert.deepEqual(o.idTypes, ["Aadhaar", "Passport"]);
    assert.deepEqual(o.paymentModes, ["Cash", "UPI"]);
    assert.deepEqual(o.companies, [{ id: COMPANY, name: "Infosys Rajkot" }]);
  });
});

describe("check-in (StayController::store)", () => {
  test("in house, the ID number stored as typed but sent as its last 4 (decision 74), logged; the reservation becomes checked in", async () => {
    const r = await reservation({ checkIn: "2026-10-05" });
    const a = await room("101");
    const s = await checkIn(a.id, { reservationId: r.id });
    assert.equal(s.status, "inHouse");
    assert.deepEqual([s.idProofNumber, s.idProofMasked], ["\u2022\u2022\u2022\u20229012", true]);
    const row = data().stays[0];
    assert.equal(row.idProofNumber, "1234 5678 9012");
    assert.equal(data().reservations[0].status, "checked_in");
    assert.equal(data().systemLogs.at(-1)?.summary, "Added Check-in: Ravi Mehta in room 101");
  });
  test("Pallav's words: mobile required, check-out after today, adults 1-20", async () => {
    const a = await room("101");
    const res = await checkInRoute(req("POST", "/api/v1/front-office/stays", "desk", checkInInput(a.id, { mobile: "", expectedCheckOut: "2026-10-05", adults: 21, ratePaise: null })));
    assert.deepEqual(await fields(res), { mobile: "The mobile field is required.", adults: "The adults field must not be greater than 20.", ratePaise: "The rate field is required.", expectedCheckOut: "The check-out date must be after today." });
  });
  test("the prefill suggests the next G.R. number: none before the first stay, one past the highest digits on record after", async () => {
    const a = await room("101");
    const empty = (await json(await prefillRoute(req("GET", "/api/v1/front-office/stays/prefill", "desk")))).data;
    assert.equal("suggestedGrNumber" in empty, false, "no G.R. number on record yet");
    await checkIn(a.id, { grNumber: "GR-1" });
    await checkIn((await room("102")).id, { grNumber: "2026/118" });
    await room("103");
    const next = (await json(await prefillRoute(req("GET", "/api/v1/front-office/stays/prefill", "viewer")))).data;
    assert.equal(next.suggestedGrNumber, "2026119", "digits only, as a string");
  });
  test("a room not free: Pallav's words; the prefill refuses a finished reservation and an empty house", async () => {
    const a = await room("101");
    await checkIn(a.id);
    const res = await checkInRoute(req("POST", "/api/v1/front-office/stays", "desk", checkInInput(a.id)));
    assert.equal((await json(res)).error.message, "Room 101 is not free. Choose another.");
    const full = await prefillRoute(req("GET", "/api/v1/front-office/stays/prefill", "desk"));
    assert.equal((await json(full)).error.message, "No room is free to give: every room is occupied or out of order.");
  });
  test("RACE: two check-ins into one room at once: exactly one succeeds, the other gets Pallav's message", async () => {
    const a = await room("101");
    const desk = sessions.get("desk") as VerifiedSession;
    const meta = { traceId: "t", ip: null };
    const results = await Promise.allSettled([stays.checkIn(desk, checkInInput(a.id) as never, meta), stays.checkIn(desk, checkInInput(a.id, { guestName: "Other" }) as never, meta)]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason as AppError).message, "Room 101 is not free. Choose another.");
    assert.equal(data().stays.filter((s) => s.status === "in_house").length, 1);
  });
});

describe("guest lookup by mobile (HMS check-in)", () => {
  const lookup = (mobile: string, who = "desk") => guestLookupRoute(req("GET", `/api/v1/front-office/guests/lookup?mobile=${encodeURIComponent(mobile)}`, who));

  test("the last ten digits find the guest however the number was written; stays and a reservation group as one; the newest stay fills the register fields", async () => {
    const a = await room("101");
    const first = await checkIn(a.id, { mobile: "9876543210", address: "Old address", city: "Surat", idProofType: "Passport", idProofNumber: "P1", dateOfBirth: "1980-01-02" });
    clock = new Date("2026-10-08T10:30:00+05:30");
    await checkout("desk", first.id, checkoutInput(1));
    clock = new Date("2026-10-09T10:00:00+05:30");
    await checkIn(a.id, { mobile: "+91 98765 43210", expectedCheckOut: "2026-10-12", address: "150 Ring Road", city: "Rajkot", companyId: COMPANY, dateOfBirth: "1980-01-02" });
    await reservation({ mobile: "0098765 43210", guestName: "R Mehta", checkIn: "2026-10-20", checkOut: "2026-10-21" });
    await checkIn((await room("102")).id, { mobile: "9111143210", guestName: "Other Guest", expectedCheckOut: "2026-10-12" });
    const res = await lookup("+91-98765-43210");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "private, no-cache");
    const matches: GuestLookupMatch[] = (await json(res)).data.matches;
    assert.equal(matches.length, 1);
    const m = matches[0];
    assert.equal(m.guestName, "R Mehta", "the newest record (the reservation) names the guest");
    assert.deepEqual([m.stays, m.address, m.city, m.idProofType, m.idProofNumber, m.dateOfBirth, m.companyId], [2, "150 Ring Road", "Rajkot", "Aadhaar", "1234 5678 9012", "1980-01-02", COMPANY], "the newest stay's register fields");
    assert.deepEqual([m.lastRoomNumber, m.lastCheckOut], ["101", "2026-10-08"]);
    assertMatchesContract(m, { guestName: "x", mobile: "x", email: "x", address: "x", city: "x", nationality: "x", idProofType: "x", idProofNumber: "x", dateOfBirth: "x", stays: 1, lastRoomNumber: null, lastCheckOut: null, companyId: null } satisfies GuestLookupMatch);
  });
  test("fewer digits match the tail and list every guest newest first; no match is an empty list; under six digits is refused; another hotel sees nothing", async () => {
    await checkIn((await room("101")).id, { mobile: "9876543210", guestName: "Early Guest" });
    clock = new Date("2026-10-06T10:00:00+05:30");
    await checkIn((await room("102")).id, { mobile: "9111543210", guestName: "Late Guest" });
    assert.deepEqual((await json(await lookup("+91 432"))).error.details.fields, { mobile: "Enter at least the last 6 digits of the mobile number." }, "six characters but five digits");
    assert.deepEqual((await json(await lookup("543210"))).data.matches.map((m: GuestLookupMatch) => m.guestName), ["Late Guest", "Early Guest"]);
    assert.deepEqual((await json(await lookup("6543210"))).data.matches.map((m: GuestLookupMatch) => m.guestName), ["Early Guest"]);
    assert.deepEqual((await json(await lookup("9999999999"))).data, { matches: [] });
    assert.deepEqual((await json(await lookup("9876543210", "deskB"))).data, { matches: [] });
    assert.equal((await lookup("9876543210", "viewer")).status, 200);
    assert.equal((await lookup("9876543210", "roomsOnly")).status, 403);
    assert.equal((await lookup("12")).status, 422, "the query shape: 6 to 20 characters");
  });
});

describe("the guest's account: charges, move, extend", () => {
  test("a charge: quantity x price rounded as PHP; the side from the category; removal only of its own charge", async () => {
    const a = await room("101");
    const s = await checkIn(a.id);
    const c = (await json(await charge("desk", s.id, chargeInput({ category: "roomService", quantity: 1.5, unitPricePaise: 33333 })))).data;
    assert.deepEqual([c.side, c.amountPaise], ["food", 50000]);
    assert.equal(data().systemLogs.at(-1)?.summary, "Added Guest charge: Dinner - room 101");
    const other = await checkIn((await room("102")).id);
    assert.equal((await removeChargeRoute(req("DELETE", `/api/v1/front-office/stays/${other.id}/charges/${c.id}`, "desk"), ctx({ id: other.id, chargeId: c.id }))).status, 404);
    assert.equal((await removeChargeRoute(req("DELETE", `/api/v1/front-office/stays/${s.id}/charges/${c.id}`, "desk"), ctx({ id: s.id, chargeId: c.id }))).status, 200);
    assert.equal(data().charges.length, 0);
    assert.deepEqual(await fields(await charge("desk", s.id, chargeInput({ description: "", quantity: 0, unitPricePaise: null }))), { description: "The description field is required.", quantity: "The quantity field must be at least 0.01.", unitPricePaise: "The unit price field is required." });
  });
  test("move: the room left becomes dirty; a busy room refused; extend moves the reservation's check-out", async () => {
    const r = await reservation({ checkIn: "2026-10-05" });
    const a = await room("101");
    const b = await room("102");
    const c = await room("103");
    const s = await checkIn(a.id, { reservationId: r.id });
    await checkIn(c.id);
    const busy = await moveRoute(req("POST", `/api/v1/front-office/stays/${s.id}/move`, "desk", { roomId: c.id, ratePaise: null, version: 1 }), ctx({ id: s.id }));
    assert.equal((await json(busy)).error.message, "Room 103 is not free.");
    const moved = (await json(await moveRoute(req("POST", `/api/v1/front-office/stays/${s.id}/move`, "desk", { roomId: b.id, ratePaise: 300000, version: 1 }), ctx({ id: s.id })))).data;
    assert.deepEqual([moved.roomNumber, moved.ratePaise], ["102", 300000]);
    assert.equal(data().rooms.find((x) => x.id === a.id)?.hkStatus, "dirty");
    const bad = await extendRoute(req("POST", `/api/v1/front-office/stays/${s.id}/extend`, "desk", { expectedCheckOut: "2026-10-05", version: 2 }), ctx({ id: s.id }));
    assert.equal((await fields(bad)).expectedCheckOut, "The expected check out field must be a date after 2026-10-05.");
    await extendRoute(req("POST", `/api/v1/front-office/stays/${s.id}/extend`, "desk", { expectedCheckOut: "2026-10-10", version: 2 }), ctx({ id: s.id }));
    assert.equal(data().reservations[0].checkOut, "2026-10-10");
  });
});

describe("check-out into a Bill Master bill (StayController::checkout, Billing::bill)", () => {
  test("the bill through the billing service: room nights x rate, charges by side, GST at the typed percents (stored on stay and bill), modes, the reservation's advance taken off", async () => {
    const r = await reservation({ checkIn: "2026-10-05" });
    await advanceRoute(req("POST", `/api/v1/front-office/reservations/${r.id}/advances`, "desk", { receiptNumber: "77", paymentDate: "2026-10-05", hotelPaise: 100000, foodPaise: null, hotelMode: "UPI", foodMode: "", instruction: "" }), ctx({ id: r.id }));
    await advanceRoute(req("POST", `/api/v1/front-office/reservations/${r.id}/advances`, "desk", { receiptNumber: "78", paymentDate: "2026-10-05", hotelPaise: 300000, foodPaise: null, hotelMode: "UPI", foodMode: "", instruction: "" }), ctx({ id: r.id }));
    const a = await room("101");
    const s = await checkIn(a.id, { reservationId: r.id, ratePaise: 250000 });
    await charge("desk", s.id, chargeInput({ category: "food", quantity: 2, unitPricePaise: 45000 }));
    await charge("desk", s.id, chargeInput({ category: "laundry", description: "Laundry", quantity: 1, unitPricePaise: 15050 }));
    clock = new Date("2026-10-08T10:30:00+05:30");
    const defaults = (await json(await checkoutDefaultsRoute(req("GET", "/api/v1/front-office/stays/checkout-defaults", "desk")))).data;
    assert.deepEqual(defaults, { hotelGstPercent: 12, foodGstPercent: 5, suggestedBillNumber: "1" });
    assertMatchesContract(defaults, { hotelGstPercent: 1, foodGstPercent: 1, suggestedBillNumber: "x" } satisfies CheckoutDefaults);
    const res = await checkout("desk", s.id, checkoutInput(1));
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    const out = (await json(res)).data;
    assert.equal(out.status, "checkedOut");
    const bill = data().bills[0];
    assert.equal(bill.billNumber, "2026 / 1188");
    assert.equal(bill.hotelAmountPaise, BigInt(750000), "3 nights x 2,500");
    assert.equal(bill.hotelLaundryAmountPaise, BigInt(15050));
    assert.equal(bill.foodAmountPaise, BigInt(90000));
    assert.equal(bill.hotelGstPaise, BigInt(91806), "12% of 7,650.50 = 918.06");
    assert.equal(bill.foodGstPaise, BigInt(4500));
    assert.equal(bill.totalHotelAmountPaise, BigInt(856856));
    assert.equal(bill.hotelGstPercent, "12");
    assert.equal(data().stays[0].hotelGstPercent, "12");
    assert.equal(bill.guestAddress, "150 Ring Road, Rajkot");
    assert.equal(bill.persons, 3);
    assert.equal(bill.referenceName, "RES-26-00001");
    assert.equal(bill.advanceReceiptNumber, "2026 / 78", "the advance with the most money left");
    assert.equal(bill.advanceHotelAmountPaise, BigInt(300000));
    assert.equal(data().advances.find((x) => x.receiptNumber === "2026 / 78")?.hotelBalancePaise, BigInt(0));
    assert.equal(data().rooms[0].hkStatus, "dirty");
    assert.equal(data().reservations[0].status, "checked_out");
    assert.equal(data().reservations[0].checkOut, "2026-10-08");
    assert.ok(data().systemLogs.some((l) => l.module === "bills" && l.summary === "Added Bill: Bill 2026 / 1188 - Ravi Mehta"));
    assert.equal(data().systemLogs.at(-1)?.summary, "Ravi Mehta checked out of room 101");
    assert.equal(out.bill.billNumber, "2026 / 1188");
    assert.equal(out.bill.hotelGstPercent, 12);
  });
  test("GST slab (HMS): with no typed hotel percent the stay's rate picks 5 or 18 at the hotel's own limit; a typed percent still wins; no stay named is 5; unknown or another hotel's stay 404", async () => {
    const defaults = async (query: string, who = "desk") => checkoutDefaultsRoute(req("GET", `/api/v1/front-office/stays/checkout-defaults${query}`, who));
    const pct = async (query: string) => (await json(await defaults(query))).data.hotelGstPercent;
    const cheap = await checkIn((await room("101")).id, { ratePaise: 750000 });
    const dear = await checkIn((await room("102")).id, { ratePaise: 750001 });
    assert.equal(await pct(`?stayId=${dear.id}`), 12, "the hotel typed 12: it wins over the slab");
    data().settings.delete("checkout.hotel_gst_percent");
    assert.deepEqual([await pct(`?stayId=${cheap.id}`), await pct(`?stayId=${dear.id}`), await pct("")], [5, 18, 5]);
    data().settings.set("checkout.gst_slab_limit_paise", "800000");
    assert.equal(await pct(`?stayId=${dear.id}`), 5, "the hotel's own limit");
    data().settings.set("checkout.gst_slab_limit_paise", "nonsense");
    assert.equal(await pct(`?stayId=${dear.id}`), 18, "an unreadable limit falls back to 7,500");
    data().settings.set("checkout.hotel_gst_percent", "40");
    assert.equal(await pct(`?stayId=${dear.id}`), 18, "a typed percent outside 0 to 28 does not count");
    assert.equal((await json(await defaults(`?stayId=${dear.id}`))).data.foodGstPercent, 5);
    assert.equal((await defaults(`?stayId=${id(999)}`)).status, 404);
    assert.equal((await defaults(`?stayId=${dear.id}`, "deskB")).status, 404, "another hotel's stay");
    assert.equal((await defaults("?stayId=not-a-uuid")).status, 422);
    const out = await checkout("desk", dear.id, checkoutInput(1, { hotelGstPercent: 18 }));
    assert.equal(out.status, 200, "the typed path at check-out is untouched");
    assert.equal(data().stays.find((s) => s.id === dear.id)?.hotelGstPercent, "18");
  });
  test("a side with no total keeps no mode; bill number taken; already checked out; GST above 28 refused; closed-year bill date refused", async () => {
    const a = await room("101");
    const s = await checkIn(a.id);
    assert.deepEqual(await fields(await checkout("desk", s.id, checkoutInput(1, { hotelGstPercent: 29 }))), { hotelGstPercent: "The hotel gst percent field must not be greater than 28." });
    assert.match((await fields(await checkout("desk", s.id, checkoutInput(1, { billDate: "2026-03-31" })))).billDate, /2025-26 is closed/);
    await checkout("desk", s.id, checkoutInput(1));
    assert.equal(data().bills[0].foodModeOfPayment, null, "no food charges: no food mode");
    assert.equal((await json(await checkout("desk", s.id, checkoutInput(2)))).error.message, "This guest has already checked out.");
    const t = await checkIn((await room("102")).id);
    assert.equal((await json(await checkout("desk", t.id, checkoutInput(1)))).error.message, "That bill number is already used.");
    assert.equal((await json(await charge("desk", s.id, chargeInput()))).error.message, "This guest has checked out; their bill is in Bills.");
  });
  test("RACE: a charge added while the stay is checked out: exactly one outcome (in the bill, or refused)", async () => {
    const a = await room("101");
    const s = await checkIn(a.id);
    const desk = sessions.get("desk") as VerifiedSession;
    const meta = { traceId: "t", ip: null };
    const results = await Promise.allSettled([stays.checkOut(desk, s.id, checkoutInput(1) as never, meta), stays.addCharge(desk, s.id, chargeInput() as never, meta)]);
    assert.equal(results[0].status, "fulfilled");
    const bill = data().bills[0];
    if (results[1].status === "fulfilled") assert.equal(bill.foodAmountPaise, BigInt(90000), "the charge made it into the bill");
    else assert.equal(bill.foodAmountPaise, BigInt(0), "refused, and not in the bill");
    assert.equal(data().charges.length, results[1].status === "fulfilled" ? 1 : 0);
  });
  test("the stay's account and the contract shape (ID proof as its last 4)", async () => {
    const s = await checkIn((await room("101")).id);
    const one = (await json(await getStayRoute(req("GET", `/api/v1/front-office/stays/${s.id}`, "viewer"), ctx({ id: s.id })))).data;
    const sample: Stay & { hasIdPhoto: boolean } = {
      id: "x", version: 1, reservationId: null, reservationRef: null, roomId: "x", roomNumber: "x", roomTypeId: null, roomTypeName: null, grNumber: "x", guestName: "x", mobile: "x", email: "x", address: "x", city: "x", nationality: "x",
      idProofType: "x", idProofNumber: "x", idProofMasked: true, companyId: null, companyName: null, guestGstin: "x", adults: 1, children: 0, plan: "x", ratePaise: 1, checkInAt: "x", checkInDate: "x", expectedCheckOut: "x", checkOutAt: null,
      status: "inHouse", notes: "x", charges: [], nights: 1, roomChargePaise: 1, hotelExtrasPaise: 0, foodPaise: 0, totalSoFarPaise: 1, advancePaise: 0, bill: null,
      dateOfBirth: "", houseNo: "", locality: "", district: "", zipCode: "", state: "", country: "", phone: "", comingFrom: "", goingTo: "", vehicleType: "", vehicleRegistration: "", members: [], hasIdPhoto: false,
    };
    assertMatchesContract(one, sample);
  });
});

describe("ID numbers of a stay (decision 74)", () => {
  const MASK = "\u2022\u2022\u2022\u2022";
  const details = (version: number, over: Record<string, unknown> = {}) => ({ version, ...over });
  const putDetails = (who: string, stayId: string, body: unknown) => guestDetailsRoute(req("PUT", `/api/v1/front-office/stays/${stayId}/guest-details`, who, body), ctx({ id: stayId }));
  const showIds = (who: string, stayId: string) => revealStayIdRoute(req("POST", `/api/v1/front-office/stays/${stayId}/id-number`, who), ctx({ id: stayId }));

  test("the members' numbers are masked too; Show gives the whole numbers, one log line each, never the numbers", async () => {
    const s = await checkIn((await room("101")).id);
    const put = await putDetails("desk", s.id, details(s.version, { members: [{ fullName: "Mira Mehta", mobile: "", idType: "Aadhaar", idNumber: "9999 8888 7777" }] }));
    assert.equal(put.status, 200, JSON.stringify(await put.clone().json()));
    const stay = (await json(put)).data;
    assert.deepEqual([stay.members[0].idNumber, stay.members[0].idMasked, stay.idProofNumber], [`${MASK}7777`, true, `${MASK}9012`]);
    const lines = data().systemLogs.length;
    const shown = await showIds("desk", s.id);
    assert.equal(shown.status, 200);
    assert.deepEqual((await json(shown)).data, { idProofNumber: "1234 5678 9012", members: [{ idNumber: "9999 8888 7777" }] });
    assert.equal(data().systemLogs.length, lines + 1);
    assert.equal(data().systemLogs.at(-1)?.summary, "ID numbers shown");
    assert.ok(!JSON.stringify(data().systemLogs).includes("9012") && !JSON.stringify(data().systemLogs).includes("7777"), "no number in the log");
  });

  test("Show: needs edit on the stays; another hotel's stay is not found; a stay with no number is a plain refusal", async () => {
    const s = await checkIn((await room("101")).id);
    assert.equal((await showIds("viewer", s.id)).status, 403);
    assert.equal((await showIds("nobody", s.id)).status, 403);
    assert.equal((await showIds("deskB", s.id)).status, 404);
    const empty = await checkIn((await room("102")).id, { idProofType: "", idProofNumber: "" });
    assert.equal((await showIds("desk", empty.id)).status, 409);
  });

  test("saving the details with the masked numbers sent back keeps the stored numbers; another mask is refused; a typed number replaces", async () => {
    const s = await checkIn((await room("101")).id);
    const first = (await json(await putDetails("desk", s.id, details(s.version, { members: [{ fullName: "Mira Mehta", mobile: "", idType: "Aadhaar", idNumber: "9999 8888 7777" }] })))).data;
    // the screen sends back what it was shown
    const again = await putDetails("desk", s.id, details(first.version, { idProofNumber: first.idProofNumber, members: first.members.map((m: { fullName: string; mobile: string; idType: string; idNumber: string }) => ({ fullName: m.fullName, mobile: m.mobile, idType: m.idType, idNumber: m.idNumber })) }));
    assert.equal(again.status, 200, JSON.stringify(await again.clone().json()));
    assert.equal(data().stays[0].idProofNumber, "1234 5678 9012");
    assert.equal(data().stays[0].guestDetails?.members?.[0].idNumber, "9999 8888 7777");
    const v2 = (await json(again)).data.version;
    const wrong = await putDetails("desk", s.id, details(v2, { idProofNumber: `${MASK}0000` }));
    assert.equal(wrong.status, 422);
    assert.deepEqual(await fields(wrong), { idProofNumber: "Type the whole ID number again, or leave it as it is." });
    const wrongMember = await putDetails("desk", s.id, details(v2, { members: [{ fullName: "Mira Mehta", mobile: "", idType: "Aadhaar", idNumber: `${MASK}0000` }] }));
    assert.deepEqual(await fields(wrongMember), { "members.0.idNumber": "Type the whole ID number again, or leave it as it is." });
    assert.equal(data().stays[0].idProofNumber, "1234 5678 9012", "a refused save changes nothing");
    const typed = await putDetails("desk", s.id, details(v2, { idProofNumber: "P7654321" }));
    assert.equal(typed.status, 200);
    assert.equal(data().stays[0].idProofNumber, "P7654321");
  });
});

describe("the duplicate ID warning (decision 74)", () => {
  const stayOf = async (id: string) => (await json(await getStayRoute(req("GET", `/api/v1/front-office/stays/${id}`, "desk"), ctx({ id })))).data;

  test("the same main ID number on another guest in the house is named (room and guest), spaces and case ignored; it never blocks a check-in", async () => {
    const a = await checkIn((await room("101")).id, { guestName: "Ravi Mehta", idProofNumber: "ABCDE 1234-F" });
    const b = await checkIn((await room("102")).id, { guestName: "Neha Shah", idProofNumber: "abcde1234f" });
    const first = await stayOf(a.id);
    const second = await stayOf(b.id);
    assert.deepEqual(first.sameIdElsewhere, [{ stayId: b.id, roomNumber: "102", guestName: "Neha Shah" }]);
    assert.deepEqual(second.sameIdElsewhere, [{ stayId: a.id, roomNumber: "101", guestName: "Ravi Mehta" }]);
  });

  test("no warning for a different number, a stay with no number, or a guest who has left", async () => {
    const a = await checkIn((await room("101")).id, { idProofNumber: "P1234567" });
    const other = await checkIn((await room("102")).id, { idProofNumber: "Q7654321" });
    const none = await checkIn((await room("103")).id, { idProofType: "", idProofNumber: "" });
    for (const s of [a, other, none]) assert.equal((await stayOf(s.id)).sameIdElsewhere, undefined);
    // the same number on a guest who has since left is a returning guest, not a duplicate
    const gone = await checkIn((await room("104")).id, { idProofNumber: "P1234567" });
    assert.deepEqual((await stayOf(a.id)).sameIdElsewhere?.map((x: { stayId: string }) => x.stayId), [gone.id]);
    data().stays.find((x) => x.id === gone.id)!.status = "checked_out";
    assert.equal((await stayOf(a.id)).sameIdElsewhere, undefined);
  });
});

describe("permissions and hotel isolation", () => {
  test("no permission: 403; viewer cannot write; another hotel's stay, room and reservation are not found", async () => {
    const a = await room("101");
    const s = await checkIn(a.id);
    // the walk-in in 101 holds the only real Deluxe room (FrontDesk::held counts walk-ins), so this booking is for a Standard room
    const r = await reservation({ roomTypeId: TYPE_STD });
    assert.equal((await createRoomRoute(req("POST", "/api/v1/front-office/rooms", "viewer", { number: "9", floor: "", roomTypeId: "", notes: "" }))).status, 403);
    assert.equal((await checkInRoute(req("POST", "/api/v1/front-office/stays", "nobody", checkInInput(a.id)))).status, 403);
    assert.equal((await getStayRoute(req("GET", `/api/v1/front-office/stays/${s.id}`, "deskB"), ctx({ id: s.id }))).status, 404);
    assert.equal((await checkout("deskB", s.id, checkoutInput(1))).status, 404);
    assert.equal((await charge("deskB", s.id, chargeInput())).status, 404);
    assert.equal((await housekeepingRoute(req("PUT", `/api/v1/front-office/rooms/${a.id}/housekeeping`, "deskB", { hkStatus: "dirty" }), ctx({ id: a.id }))).status, 404);
    assert.equal((await getReservationRoute(req("GET", `/api/v1/front-office/reservations/${r.id}`, "deskB"), ctx({ id: r.id }))).status, 404);
    const b = await reservation({}, "deskB");
    assert.equal(b.reference, "RES-26-00001", "each hotel numbers from 1");
  });
});

const MYSQL = "needs the MySQL front-office repository (Worker A, M3): un-skipped when it lands";
describe("front office on MySQL (skipped until the repository exists)", () => {
  test("two connections check into one room: the functional unique index pms_stays_one_in_house_per_room_key refuses the second", { skip: MYSQL }, () => {});
  test("20 parallel reservations on two connections under GET_LOCK('<db>.pms_reservations.reference') give 20 references", { skip: MYSQL }, () => {});
  test("a charge and a check-out on two connections: the stay row FOR UPDATE serialises them", { skip: MYSQL }, () => {});
  test("EXPLAIN: the reservation views, the stays lists and FrontDesk::held use their indexes", { skip: MYSQL }, () => {});
});

describe("guest requests on the desk (G2)", () => {
  async function asked(stayId: string, kind: "towels" | "water" | "late_checkout" | "other", note: string | null = null, minutesAgo = 0): Promise<string> {
    const made = await hotel.unit.run(sessions.get("desk")!, (repos) => repos.guestRequests.create({ stayId, kind, note, createdBy: null }));
    const row = data().guestRequests.find((r) => r.id === made.id)!;
    row.createdAt = new Date(clock.getTime() - minutesAgo * 60_000);
    return made.id;
  }
  test("the queue (waiting, oldest first; closed, newest first) with room and guest; done or not possible with a reply, logged; a repeat 409; unknown 404; who may", async () => {
    const r1 = await room("101");
    const r2 = await room("102");
    const s1 = await checkIn(r1.id);
    const s2 = await checkIn(r2.id, { guestName: "Sita Shah", grNumber: "GR-2" });
    const a = await asked(s1.id, "towels", null, 30);
    const b = await asked(s2.id, "late_checkout", "Flight at 6 pm", 10);
    const list = await json(await requestsRoute(req("GET", "/api/v1/front-office/requests", "viewer"), ctx()));
    assert.deepEqual(list.data.page.items.map((x: { id: string; roomNumber: string; guestName: string; kind: string; note: string | null }) => [x.id, x.roomNumber, x.guestName, x.kind, x.note]), [[a, "101", "Ravi Mehta", "towels", null], [b, "102", "Sita Shah", "late_checkout", "Flight at 6 pm"]]);
    assert.equal(list.data.counts.open, 2);
    assert.equal((await closeRequestRoute(req("POST", `/api/v1/front-office/requests/${a}/close`, "viewer", { status: "done", reply: "" }), ctx({ id: a }))).status, 403, "view only cannot close");
    const done = await closeRequestRoute(req("POST", `/api/v1/front-office/requests/${a}/close`, "desk", { status: "done", reply: " On its way " }), ctx({ id: a }));
    assert.equal(done.status, 200, JSON.stringify(await done.clone().json()));
    const d = (await json(done)).data;
    assert.deepEqual([d.status, d.reply, d.roomNumber, typeof d.doneAt], ["done", "On its way", "101", "string"]);
    assert.equal((await closeRequestRoute(req("POST", `/api/v1/front-office/requests/${a}/close`, "desk", { status: "declined", reply: "" }), ctx({ id: a }))).status, 409);
    assert.equal((await closeRequestRoute(req("POST", `/api/v1/front-office/requests/${id(999)}/close`, "desk", { status: "done", reply: "" }), ctx({ id: id(999) }))).status, 404);
    assert.equal((await closeRequestRoute(req("POST", `/api/v1/front-office/requests/${b}/close`, "desk", { status: "done", reply: "x".repeat(301) }), ctx({ id: b }))).status, 422);
    const open = await json(await requestsRoute(req("GET", "/api/v1/front-office/requests?view=open", "desk"), ctx()));
    assert.deepEqual([open.data.page.items.map((x: { id: string }) => x.id), open.data.counts.open], [[b], 1]);
    const closed = await json(await requestsRoute(req("GET", "/api/v1/front-office/requests?view=closed", "desk"), ctx()));
    assert.deepEqual(closed.data.page.items.map((x: { id: string; status: string; doneBy: string | null }) => [x.id, x.status, x.doneBy]), [[a, "done", null]], "the closer is named when the people directory knows them");
    const log = data().systemLogs.filter((l) => l.entity === "Guest request").at(-1)!;
    assert.deepEqual([log.summary, log.details], ["Done: Fresh towels - room 101", { Reply: "On its way" }]);
    assert.equal((await requestsRoute(req("GET", "/api/v1/front-office/requests", "roomsOnly"), ctx())).status, 403);
    assert.deepEqual((await json(await requestsRoute(req("GET", "/api/v1/front-office/requests", "deskB"), ctx()))).data.page.items, [], "another hotel sees nothing");
  });
});
