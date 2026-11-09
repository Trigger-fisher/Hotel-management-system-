// Website part 1 end to end through the REAL route files, the wrapper, the services and ONE in-memory hotel store shared with the front office (it reads the
// website's room types and enquiries, and confirming an enquiry makes its reservation in the same unit): enquiries, rooms, tariff plans and the rate and
// inventory calendar. Expected behaviour: docs/specs/website.md (each rule cites Pallav). The availability arithmetic is golden in website.golden.test.ts.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import type { WebCalendarWeek, WebEnquiry, WebRatePlan, WebRoom, WebRoomRates } from "@shared/dashboards/website";
import { PUT as saveCalendarRoute, GET as calendarRoute } from "../../src/app/api/v1/website/calendar/route";
import { POST as blockDateRoute } from "../../src/app/api/v1/website/calendar/block-date/route";
import { POST as blocksRoute } from "../../src/app/api/v1/website/calendar/blocks/route";
import { POST as bulkRoute } from "../../src/app/api/v1/website/calendar/bulk-rates/route";
import { GET as planNamesRoute } from "../../src/app/api/v1/website/calendar/plan-names/route";
import { POST as unblockRoute } from "../../src/app/api/v1/website/calendar/unblock/route";
import { POST as confirmRoute } from "../../src/app/api/v1/website/enquiries/[id]/confirm/route";
import { POST as declineRoute } from "../../src/app/api/v1/website/enquiries/[id]/decline/route";
import { DELETE as deleteEnquiryRoute, GET as getEnquiryRoute, PATCH as updateEnquiryRoute } from "../../src/app/api/v1/website/enquiries/[id]/route";
import { GET as listEnquiriesRoute } from "../../src/app/api/v1/website/enquiries/route";
import { POST as togglePlanRoute } from "../../src/app/api/v1/website/plans/[id]/toggle/route";
import { POST as movePlanRoute } from "../../src/app/api/v1/website/plans/[id]/move/route";
import { DELETE as deletePlanRoute, PATCH as updatePlanRoute } from "../../src/app/api/v1/website/plans/[id]/route";
import { GET as ratesRoute } from "../../src/app/api/v1/website/rates/route";
import { POST as moveRoomRoute } from "../../src/app/api/v1/website/rooms/[id]/move/route";
import { POST as createPlanRoute } from "../../src/app/api/v1/website/rooms/[id]/plans/route";
import { DELETE as deleteRoomRoute, GET as getRoomRoute, PATCH as updateRoomRoute } from "../../src/app/api/v1/website/rooms/[id]/route";
import { GET as listRoomsRoute, POST as createRoomRoute } from "../../src/app/api/v1/website/rooms/route";
import type { VerifiedSession } from "../../src/server/auth/session";
import { createMemoryMediaStore } from "../../src/server/media/store";
import { buildWebsiteServices, configureWebsite, noGoogle, memoryOAuthStates, noSiteMail } from "../../src/server/compose/website";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { createMemoryHotel } from "../../src/server/repos/memory/frontOffice";
import type { SiteEnquiryFields } from "../../src/server/repos/website";
import type { Person } from "../../src/server/services/cash/ports";
import { createBillService } from "../../src/server/services/billing/billService";
import { createReservationService } from "../../src/server/services/frontOffice/reservationService";
import type { SiteMail } from "../../src/server/services/website/context";
import { assertMatchesContract } from "./helpers/contract";
import { catalog, grant, HOTEL_A, makeSession } from "./helpers/session";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const people = new Map<string, Person>([
  [id(1), { id: id(1), name: "Meera Manager", roleKey: "editor", roleLevel: 2, deleted: false }],
  [id(2), { id: id(2), name: "Vikram Viewer", roleKey: "viewer", roleLevel: 1, deleted: false }],
]);
const sessions = new Map<string, VerifiedSession>();
const mk = (name: string, userId: string, options: Parameters<typeof makeSession>[0]) => sessions.set(name, makeSession({ userId, client: "web", ...options }));
mk("manager", id(1), { roleKey: "editor", roleLevel: 2, grants: [grant("website", "full")] });
mk("viewer", id(2), { grants: [grant("website.enquiries", "view"), grant("website.rooms", "view"), grant("website.rates", "view"), grant("website.calendar", "view")] });
mk("nobody", id(3), {});


let clock = new Date("2026-10-05T10:00:00+05:30");
let hotel = createMemoryHotel();
let mailed: string[] = [];
let failLog = false;

function wire(): void {
  hotel = createMemoryHotel();
  mailed = [];
  failLog = false;
  const now = () => clock;
  const people_ = { get: async (ids: readonly string[]) => new Map(ids.filter((i) => people.has(i)).map((i) => [i, people.get(i)!])) };
  const base = { unit: hotel.unit, people: people_, audit: { record: async () => undefined }, catalog, now };
  const reservations = createReservationService({ ...base, bills: createBillService(base) });
  const mail: SiteMail = { enquiryConfirmed: async (_h, e) => (mailed.push(`confirmed ${e.reference}`), "queued"), enquiryDeclined: async (_h, e) => (mailed.push(`declined ${e.reference}`), "queued") };
  // a log line that cannot be written rolls the action back
  const unit = {
    run: <T>(session: Parameters<typeof hotel.unit.run>[0], work: Parameters<typeof hotel.unit.run<T>>[1]) =>
      hotel.unit.run(session, (repos) => work({ ...repos, systemLogs: { write: async (entry) => (failLog ? Promise.reject(new Error("log")) : repos.systemLogs.write(entry)) } })),
  };
  configureWebsite(buildWebsiteServices({ ...base, unit, reservations, mail, google: noGoogle, oauthStates: memoryOAuthStates(), media: createMemoryMediaStore(), publicUrl: "https://hms.test" }));
  void noSiteMail;
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
  const d = hotel.store.dataFor(HOTEL_A);
  d.years = [{ id: "y1", label: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31" }];
}

const ORIGIN = "https://hms.test";
function req(method: string, path: string, who: string | null, body?: unknown): Request {
  const h: Record<string, string> = { host: "hms.test", origin: ORIGIN };
  if (who) h["x-test-session"] = who;
  if (body !== undefined) h["content-type"] = "application/json";
  return new Request(`${ORIGIN}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: bodies are asserted field by field
const json = async (res: Response) => (await res.json()) as any;
const fields = async (res: Response) => (await json(res)).error.details.fields;
const message = async (res: Response) => (await json(res)).error.message;
const data = () => hotel.store.dataFor(HOTEL_A);
const ok = async <T>(res: Response, status = 200): Promise<T> => {
  assert.equal(res.status, status, JSON.stringify(await res.clone().json()));
  return (await json(res)).data as T;
};

const roomInput = (over: Record<string, unknown> = {}) => ({ name: "Deluxe", bedType: "King", size: "250 sq.ft", maxGuests: 3, totalCount: 2, badgeLabel: "", note: "", showPrice: true, available: true, photos: [], ...over });
const room = async (over: Record<string, unknown> = {}): Promise<WebRoom> => ok(await createRoomRoute(req("POST", "/api/v1/website/rooms", "manager", roomInput(over)), ctx()), 201);
const planInput = (over: Record<string, unknown> = {}) => ({ name: "Room Only", code: "EP", tiers: [{ guests: 2, pricePaise: 400000 }, { guests: 1, pricePaise: 320000 }], extraPersonPaise: 50000, ...over });
const plan = async (roomId: string, over: Record<string, unknown> = {}): Promise<WebRatePlan> => ok(await createPlanRoute(req("POST", `/api/v1/website/rooms/${roomId}/plans`, "manager", planInput(over)), ctx({ id: roomId })), 201);
const enquiryAt = async (over: Partial<SiteEnquiryFields> & { reference?: string; at?: Date } = {}): Promise<string> => {
  const { reference, at, ...rest } = over;
  const created = await hotel.unit.run({ hotelId: HOTEL_A, userId: id(1) }, (repos) =>
    repos.siteEnquiries.create({ name: "Ravi Mehta", phone: "+919876543210", email: null, message: "Two nights please", roomId: null, checkIn: "2026-10-10", checkOut: "2026-10-12", guests: 2, children: 0, ...rest, reference: reference ?? `HP-05102026-${String(data().enquiries.length + 1).padStart(5, "0")}`, ipAddress: "1.2.3.4", createdAt: at ?? clock }),
  );
  return created.id;
};
const enquiryBody = (over: Record<string, unknown> = {}) => ({ name: "Ravi Mehta", phone: "98765 43210", email: "ravi@example.com", roomId: null, checkIn: "2026-10-10", checkOut: "2026-10-12", guests: 2, children: 1, message: "Two nights please", ...over });
const confirm = (e: string, who = "manager") => confirmRoute(req("POST", `/api/v1/website/enquiries/${e}/confirm`, who), ctx({ id: e }));
const decline = (e: string, reason: string, who = "manager") => declineRoute(req("POST", `/api/v1/website/enquiries/${e}/decline`, who, { reason }), ctx({ id: e }));
const week = async (start?: string, who = "manager"): Promise<WebCalendarWeek> => ok(await calendarRoute(req("GET", `/api/v1/website/calendar${start ? `?start=${start}` : ""}`, who), ctx()));
const cell = (w: WebCalendarWeek, roomId: string, date: string) => w.rooms.find((r) => r.roomId === roomId)!.cells.find((c) => c.date === date)!;

beforeEach(() => {
  clock = new Date("2026-10-05T10:00:00+05:30");
  wire();
});

describe("rooms (RoomController)", () => {
  test("added with a unique slug, last in the order; Pallav's words; the contract shape; today's free rooms", async () => {
    const a = await room();
    const b = await room();
    assert.deepEqual([data().roomTypes.map((r) => (r as unknown as { slug: string }).slug), a.freeToday, a.plansCount, a.photos], [["deluxe", "deluxe-2"], 2, 0, []]);
    const sample: WebRoom = { id: "x", name: "x", bedType: "x", size: "x", maxGuests: 1, totalCount: 1, badgeLabel: "x", note: "x", showPrice: true, available: true, photos: [{ id: "x", name: "x", alt: "x" }], freeToday: 1, plansCount: 1 };
    assertMatchesContract(a, sample);
    const res = await createRoomRoute(req("POST", "/api/v1/website/rooms", "manager", roomInput({ name: " ", maxGuests: 0, totalCount: 256, bedType: "x".repeat(51) })), ctx());
    assert.deepEqual(await fields(res), { name: "Room name is required.", bedType: "The bed type field must not be greater than 50 characters.", maxGuests: "The max guests field must be at least 1.", totalCount: "The total count field must not be greater than 255." });
    assert.equal(data().systemLogs.at(-1)?.summary, "Added Website room: Deluxe");
    assert.deepEqual((await ok<WebRoom[]>(await listRoomsRoute(req("GET", "/api/v1/website/rooms", "viewer"), ctx()))).map((r) => r.id), [a.id, b.id]);
    assert.equal((await createRoomRoute(req("POST", "/api/v1/website/rooms", "viewer", roomInput()), ctx())).status, 403);
    assert.equal((await listRoomsRoute(req("GET", "/api/v1/website/rooms", "nobody"), ctx())).status, 403);
  });

  test("an edit keeps the photos named, drops those left out, logs what moved; free rooms follow the front office's real rooms", async () => {
    const a = await room();
    const stored = data().roomTypes[0] as unknown as { photos: { path: string; name: string | null; alt: string | null }[] };
    stored.photos = [{ path: "a.jpg", name: null, alt: null }, { path: "b.jpg", name: "Lobby", alt: "The lobby" }];
    const out = await ok<WebRoom>(await updateRoomRoute(req("PATCH", `/api/v1/website/rooms/${a.id}`, "manager", roomInput({ totalCount: 4, photos: [{ id: "b.jpg", name: "Lobby view", alt: "" }] })), ctx({ id: a.id })));
    assert.deepEqual(out.photos, [{ id: "b.jpg", name: "Lobby view", alt: "" }]);
    assert.equal(data().systemLogs.at(-1)?.summary, "Changed Website room: Deluxe (total_count)");
    // with real rooms set up the category's capacity is the rooms in service
    data().rooms.push({ id: id(50), number: "101", roomTypeId: a.id, outOfOrder: false } as never, { id: id(51), number: "102", roomTypeId: a.id, outOfOrder: true } as never);
    assert.equal((await ok<WebRoom>(await getRoomRoute(req("GET", `/api/v1/website/rooms/${a.id}`, "viewer"), ctx({ id: a.id })))).freeToday, 1);
  });

  test("a room with enquiries is never deleted; one without is removed with its plans and calendar rows; the order moves", async () => {
    const a = await room({ name: "Deluxe" });
    const b = await room({ name: "Standard" });
    await enquiryAt({ roomId: a.id });
    let res = await deleteRoomRoute(req("DELETE", `/api/v1/website/rooms/${a.id}`, "manager"), ctx({ id: a.id }));
    assert.deepEqual([res.status, await message(res)], [409, "Can't delete Deluxe - it has existing enquiries or bookings. Untick \"Taking enquiries\" on it instead."]);
    await plan(b.id);
    await ok(await blockDateRoute(req("POST", "/api/v1/website/calendar/block-date", "manager", { roomId: b.id, date: "2026-10-08" }), ctx()));
    await ok(await moveRoomRoute(req("POST", `/api/v1/website/rooms/${b.id}/move`, "manager", { direction: "up" }), ctx({ id: b.id })));
    assert.deepEqual((await ok<WebRoom[]>(await listRoomsRoute(req("GET", "/api/v1/website/rooms", "manager"), ctx()))).map((r) => r.name), ["Standard", "Deluxe"]);
    res = await moveRoomRoute(req("POST", `/api/v1/website/rooms/${b.id}/move`, "manager", { direction: "up" }), ctx({ id: b.id }));
    assert.equal(res.status, 409);
    await ok(await deleteRoomRoute(req("DELETE", `/api/v1/website/rooms/${b.id}`, "manager"), ctx({ id: b.id })));
    assert.deepEqual([data().roomTypes.length, data().roomInventory.length], [1, 0]);
  });
});

describe("tariff plans (RateController)", () => {
  test("the ladder gives the double and single prices; Pallav's words; tonight's price follows a dated price; pause, order and delete", async () => {
    const r = await room();
    let res = await createPlanRoute(req("POST", `/api/v1/website/rooms/${r.id}/plans`, "manager", planInput({ name: "", tiers: [] })), ctx({ id: r.id }));
    assert.deepEqual(await fields(res), { name: "Please fill in the plan name and at least one occupancy price.", tiers: "Please fill in the plan name and at least one occupancy price." });
    const p = await plan(r.id);
    assert.deepEqual([p.tiers, p.extraPersonPaise, p.active], [[{ guests: 1, pricePaise: 320000 }, { guests: 2, pricePaise: 400000 }], 50000, true]);
    const stored = data().roomTypes[0].plans[0];
    assert.deepEqual([stored.doublePaise, stored.singlePaise], [BigInt(400000), BigInt(320000)]);
    // without a 2-guest tier the double price is the first tier
    const q = await plan(r.id, { name: "Breakfast", code: "CP", tiers: [{ guests: 3, pricePaise: 500000 }, { guests: 4, pricePaise: 600000 }], extraPersonPaise: null });
    const second = data().roomTypes[0].plans.find((x) => (x as unknown as { id: string }).id === q.id)!;
    assert.deepEqual([second.doublePaise, second.singlePaise], [BigInt(500000), null]);
    const sample: WebRatePlan = { id: "x", roomId: "x", name: "x", code: "x", tiers: [{ guests: 1, pricePaise: 1 }], extraPersonPaise: null, active: true };
    assertMatchesContract(p, sample);

    let rates = await ok<WebRoomRates[]>(await ratesRoute(req("GET", "/api/v1/website/rates", "viewer"), ctx()));
    assert.equal(rates[0].tonightPaise, 400000);
    await ok(await saveCalendarRoute(req("PUT", "/api/v1/website/calendar", "manager", { inventory: [], rates: [{ planId: p.id, date: "2026-10-05", occ: "double", pricePaise: 450000 }] }), ctx()));
    rates = await ok<WebRoomRates[]>(await ratesRoute(req("GET", "/api/v1/website/rates", "viewer"), ctx()));
    assert.equal(rates[0].tonightPaise, 450000);
    // pause the first plan: tonight is the next active plan's price
    assert.equal((await ok<WebRatePlan>(await togglePlanRoute(req("POST", `/api/v1/website/plans/${p.id}/toggle`, "manager"), ctx({ id: p.id })))).active, false);
    assert.equal((await ok<WebRoomRates[]>(await ratesRoute(req("GET", "/api/v1/website/rates", "viewer"), ctx())))[0].tonightPaise, 500000);
    await ok(await movePlanRoute(req("POST", `/api/v1/website/plans/${q.id}/move`, "manager", { direction: "up" }), ctx({ id: q.id })));
    assert.deepEqual((await ok<WebRoomRates[]>(await ratesRoute(req("GET", "/api/v1/website/rates", "viewer"), ctx())))[0].plans.map((x) => x.code), ["CP", "EP"]);
    res = await updatePlanRoute(req("PATCH", `/api/v1/website/plans/${p.id}`, "manager", planInput({ name: "Room Only", code: "EP", tiers: [{ guests: 2, pricePaise: 410000 }] })), ctx({ id: p.id }));
    assert.equal(res.status, 200);
    assert.equal(data().systemLogs.at(-1)?.summary, "Changed Tariff plan: Room Only (Deluxe) (price_double, price_single)");
    await ok(await deletePlanRoute(req("DELETE", `/api/v1/website/plans/${p.id}`, "manager"), ctx({ id: p.id })));
    assert.deepEqual([data().roomTypes[0].plans.length, data().datedRates.length], [1, 0]);
  });
});

describe("enquiries (EnquiryController)", () => {
  test("the tabs and search; \"new\" from an earlier day reads pending; the tiles count every enquiry whatever the search", async () => {
    const a = await enquiryAt({ name: "Asha Rao", reference: "HP-04102026-00001", at: new Date("2026-10-04T10:00:00+05:30") });
    await enquiryAt({ name: "Bimal Shah", reference: "HP-05102026-00002", at: new Date("2026-10-05T09:00:00+05:30") });
    const c = await enquiryAt({ name: "Chetan Patel", reference: "HP-05102026-00003", at: new Date("2026-10-05T09:30:00+05:30") });
    await ok(await confirm(c));
    const list = (q: string) => listEnquiriesRoute(req("GET", `/api/v1/website/enquiries${q}`, "viewer"), ctx()).then((r) => ok<{ page: { items: WebEnquiry[]; total: number }; stats: { all: number; pending: number; confirmed: number; declined: number } }>(r));
    const all = await list("");
    // Asha's "new" of yesterday is pending now; Bimal's of today is still "new" in the table, pending to the apps
    assert.equal(data().enquiries.find((e) => e.id === a) && (data().enquiries.find((e) => e.id === a) as unknown as { status: string }).status, "pending");
    assert.deepEqual(all.stats, { all: 3, pending: 2, confirmed: 1, declined: 0 });
    assert.deepEqual(all.page.items.map((e) => [e.name, e.status]), [["Chetan Patel", "confirmed"], ["Bimal Shah", "pending"], ["Asha Rao", "pending"]]);
    const searched = await list("?search=bimal&tab=pending");
    assert.deepEqual([searched.page.items.map((e) => e.name), searched.stats.all], [["Bimal Shah"], 3]);
    assert.deepEqual((await list("?tab=confirmed")).page.items.map((e) => e.name), ["Chetan Patel"]);
    assert.deepEqual((await list("?search=HP-04102026")).page.items.map((e) => e.reference), ["HP-04102026-00001"]);
    const sample: WebEnquiry = { id: "x", reference: "x", name: "x", phone: "x", email: null, roomId: null, roomName: null, checkIn: "x", checkOut: "x", guests: 1, children: 0, message: "x", status: "pending", createdAt: "x", ipAddress: null, decidedAt: null, decidedByName: null, decisionNote: null };
    assertMatchesContract(all.page.items[0], sample);
  });

  test("correcting an enquiry: Pallav's words, the phone normalised, the count kept as the total; the log says what moved", async () => {
    const r = await room();
    const e = await enquiryAt({ roomId: r.id });
    let res = await updateEnquiryRoute(req("PATCH", `/api/v1/website/enquiries/${e}`, "manager", enquiryBody({ name: "R", phone: "12", checkOut: "2026-10-09", message: "", guests: 0, email: "nope" })), ctx({ id: e }));
    assert.deepEqual(await fields(res), { name: "The name field must be at least 2 characters.", email: "The email field must be a valid email address.", checkOut: "Check-out must be on or after check-in.", guests: "The guests field must be at least 1.", message: "Please enter the enquiry message.", phone: "Please enter a valid phone number with country code." });
    res = await updateEnquiryRoute(req("PATCH", `/api/v1/website/enquiries/${e}`, "manager", enquiryBody({ roomId: id(999) })), ctx({ id: e }));
    assert.deepEqual(await fields(res), { roomId: "The selected room id is invalid." });
    const out = await ok<WebEnquiry>(await updateEnquiryRoute(req("PATCH", `/api/v1/website/enquiries/${e}`, "manager", enquiryBody({ roomId: r.id })), ctx({ id: e })));
    assert.deepEqual([out.phone, out.guests, out.children, out.roomName], ["+919876543210", 2, 1, "Deluxe"]);
    assert.equal((data().enquiries[0] as unknown as { guests: number }).guests, 3);
    assert.match(data().systemLogs.at(-1)!.summary, /^Changed Guest enquiry: HP-05102026-00001 \(.*email.*\)$/);
    assert.equal((await updateEnquiryRoute(req("PATCH", `/api/v1/website/enquiries/${e}`, "viewer", enquiryBody()), ctx({ id: e }))).status, 403);
  });

  test("confirm: it becomes a booking and a front-office reservation in the same unit; once only; it cannot overbook; cancelling frees it", async () => {
    const r = await room({ totalCount: 1 });
    const e1 = await enquiryAt({ roomId: r.id, name: "Asha Rao" });
    const e2 = await enquiryAt({ roomId: r.id, name: "Bimal Shah" });
    const done = await ok<{ enquiry: WebEnquiry; message: string; mail: string }>(await confirm(e1));
    assert.equal(done.mail, "queued", "the answer says what happened to the guest's mail");
    assert.deepEqual([done.enquiry.status, done.enquiry.decidedByName, done.message], ["confirmed", "Meera Manager", "Enquiry HP-05102026-00001 confirmed. Reservation RES-26-00001 made at the front desk."]);
    assert.deepEqual([data().reservations.length, data().reservations[0].siteEnquiryId, data().reservations[0].source, mailed], [1, e1, "website", ["confirmed HP-05102026-00001"]]);
    let res = await confirm(e1);
    assert.deepEqual([res.status, await message(res)], [409, "Enquiry HP-05102026-00001 is already confirmed."]);
    // the room's only unit is held for 10-12 Oct: the second enquiry cannot be confirmed
    res = await confirm(e2);
    assert.deepEqual([res.status, await message(res)], [409, "Can't confirm HP-05102026-00002 - no Deluxe is free on 10/10/2026. Free up inventory for that date first, or cancel this enquiry."]);
    assert.equal(data().reservations.length, 1);
    // cancelling the first (with a reason) frees the room and the reservation goes
    res = await decline(e1, "  ");
    assert.deepEqual([res.status, await fields(res)], [422, { reason: "Please give a reason for cancelling this enquiry." }]);
    const cancelled = await ok<{ enquiry: WebEnquiry; message: string; mail: string }>(await decline(e1, "Guest changed plans"));
    assert.equal(cancelled.mail, "queued");
    assert.deepEqual([cancelled.enquiry.status, cancelled.enquiry.decisionNote, cancelled.message, data().reservations[0].status, data().reservations[0].cancelReason], ["declined", "Guest changed plans", "Enquiry HP-05102026-00001 cancelled.", "cancelled", "Website enquiry cancelled: Guest changed plans"]);
    assert.equal((await decline(e1, "again")).status, 409);
    await ok(await confirm(e2));
    // a declined enquiry can be confirmed again (Pallav checks only "already confirmed")
    assert.equal(data().reservations.length, 2);
    assert.deepEqual(mailed.slice(-2), ["declined HP-05102026-00001", "confirmed HP-05102026-00002"]);
    await ok(await deleteEnquiryRoute(req("DELETE", `/api/v1/website/enquiries/${e1}`, "manager"), ctx({ id: e1 })));
    assert.equal((await getEnquiryRoute(req("GET", `/api/v1/website/enquiries/${e1}`, "manager"), ctx({ id: e1 }))).status, 404);
  });

  test("two people confirming the last room at once queue up: one is confirmed, the other is told it is full; a log that cannot be written confirms nothing", async () => {
    const r = await room({ totalCount: 1 });
    const e1 = await enquiryAt({ roomId: r.id });
    const e2 = await enquiryAt({ roomId: r.id });
    const [x, y] = await Promise.all([confirm(e1), confirm(e2)]);
    assert.deepEqual([x.status, y.status].sort(), [200, 409]);
    assert.equal(data().reservations.length, 1);
    failLog = true;
    const e3 = await enquiryAt({ roomId: r.id, checkIn: "2026-11-10", checkOut: "2026-11-11" });
    assert.equal((await confirm(e3)).status, 500);
    assert.equal((data().enquiries.find((e) => e.id === e3) as unknown as { status: string }).status, "new");
    assert.equal(data().reservations.length, 1);
  });

  test("an enquiry with no room is confirmed without a reservation; one for a date past the open window can still be confirmed (no window for a request already sent)", async () => {
    const r = await room({ totalCount: 1 });
    const none = await enquiryAt({ roomId: null });
    assert.equal((await ok<{ message: string }>(await confirm(none))).message, "Enquiry HP-05102026-00001 confirmed.");
    const far = await enquiryAt({ roomId: r.id, checkIn: "2027-03-01", checkOut: "2027-03-03" });
    assert.equal((await confirm(far)).status, 200);
    // a per-date closing still stops it
    const e = await enquiryAt({ roomId: r.id, checkIn: "2026-12-01", checkOut: "2026-12-03" });
    await ok(await blockDateRoute(req("POST", "/api/v1/website/calendar/block-date", "manager", { roomId: r.id, date: "2026-12-02" }), ctx()));
    const res = await confirm(e);
    assert.deepEqual([res.status, await message(res)], [409, "Can't confirm HP-05102026-00003 - no Deluxe is free on 02/12/2026. Free up inventory for that date first, or cancel this enquiry."]);
  });
});

describe("the calendar (CalendarController)", () => {
  test("a week from the date asked for: rooms open, sold, blocked and dated prices; nothing set is open for three months, closed beyond", async () => {
    const r = await room({ totalCount: 3 });
    const p = await plan(r.id);
    const e = await enquiryAt({ roomId: r.id, checkIn: "2026-10-06", checkOut: "2026-10-08" });
    await ok(await confirm(e));
    const w = await week();
    assert.deepEqual([w.days[0], w.days[6], w.prevStart, w.nextStart, w.today], ["2026-10-05", "2026-10-11", "2026-09-28", "2026-10-12", "2026-10-05"]);
    assert.deepEqual([cell(w, r.id, "2026-10-05"), cell(w, r.id, "2026-10-06")], [{ date: "2026-10-05", capacity: 3, sold: 0, blocked: false }, { date: "2026-10-06", capacity: 3, sold: 1, blocked: false }]);
    assert.deepEqual(w.rooms[0].plans[0].rows.map((x) => [x.occ, x.prices[0].pricePaise, x.prices[0].dated]), [["single", 320000, false], ["double", 400000, false]]);
    const far = await week("2027-01-04");
    assert.deepEqual([cell(far, r.id, "2027-01-04"), cell(far, r.id, "2027-01-06")], [{ date: "2027-01-04", capacity: 3, sold: 0, blocked: false }, { date: "2027-01-06", capacity: 0, sold: 0, blocked: true }]);
    const sample: WebCalendarWeek = { days: ["x"], prevStart: "x", nextStart: "x", today: "x", rooms: [{ roomId: "x", roomName: "x", totalCount: 1, cells: [{ date: "x", capacity: 1, sold: 1, blocked: false }], plans: [{ planId: "x", code: "x", name: "x", rows: [{ occ: "single", prices: [{ date: "x", pricePaise: 1, dated: false }] }] }] }], blocked: [{ roomId: "x", roomName: "x", start: "x", end: "x", nights: 1 }] };
    assertMatchesContract(w, sample);
    void p;
  });

  test("save: each cell checked on its own, so a refused one does not stop the rest; the answer counts and gives the first refusal in Pallav's words", async () => {
    const r = await room({ totalCount: 3 });
    const p = await plan(r.id);
    await ok(await confirm(await enquiryAt({ roomId: r.id, checkIn: "2026-10-06", checkOut: "2026-10-08" })));
    await ok(await confirm(await enquiryAt({ roomId: r.id, checkIn: "2026-10-06", checkOut: "2026-10-07" })));
    const out = await ok<{ saved: number; error: string | null }>(
      await saveCalendarRoute(
        req("PUT", "/api/v1/website/calendar", "manager", {
          inventory: [{ roomId: r.id, date: "2026-10-06", capacity: 1 }, { roomId: r.id, date: "2026-10-09", capacity: 4 }, { roomId: r.id, date: "2026-10-10", capacity: 2 }],
          rates: [{ planId: p.id, date: "2026-10-10", occ: "double", pricePaise: 520000 }, { planId: p.id, date: "2026-10-11", occ: "single", pricePaise: 300000 }],
        }),
        ctx(),
      ),
    );
    // 10-06 has 2 confirmed (below that is refused); 10-09 above the total is refused; the rest went through
    assert.deepEqual(out, { saved: 3, error: "Can't go below 2 - 2 rooms are already confirmed for this date." });
    const w = await week("2026-10-09");
    assert.equal(cell(w, r.id, "2026-10-10").capacity, 2);
    const row = (occ: string) => w.rooms[0].plans[0].rows.find((x) => x.occ === occ)!.prices;
    assert.deepEqual([row("double")[1], row("single")[2]], [{ date: "2026-10-10", pricePaise: 520000, dated: true }, { date: "2026-10-11", pricePaise: 300000, dated: true }]);
    // a new dated row takes the other price from the plan
    assert.deepEqual([row("single")[1].pricePaise, row("double")[2].pricePaise], [320000, 400000]);
    assert.equal(data().systemLogs.at(-1)?.summary, "Saved 3 calendar changes");
    const none = await ok<{ saved: number; error: string | null }>(await saveCalendarRoute(req("PUT", "/api/v1/website/calendar", "manager", { inventory: [{ roomId: r.id, date: "2026-10-10", capacity: 9 }], rates: [] }), ctx()));
    assert.deepEqual(none, { saved: 0, error: "Can't go above 3 - that's the total number of Deluxe rooms." });
  });

  test("blocking: a date with bookings cannot be closed; a stretch skips booked dates; opening always works; a range over 366 days is refused", async () => {
    const r = await room({ totalCount: 2 });
    await ok(await confirm(await enquiryAt({ roomId: r.id, checkIn: "2026-10-07", checkOut: "2026-10-08" })));
    let res = await blockDateRoute(req("POST", "/api/v1/website/calendar/block-date", "manager", { roomId: r.id, date: "2026-10-07" }), ctx());
    assert.deepEqual([res.status, await message(res)], [409, "Can't block this date - 1 room is already confirmed for it."]);
    assert.deepEqual(await ok(await blockDateRoute(req("POST", "/api/v1/website/calendar/block-date", "manager", { roomId: r.id, date: "2026-10-09" }), ctx())), { blocked: true });
    assert.deepEqual(await ok(await blockDateRoute(req("POST", "/api/v1/website/calendar/block-date", "manager", { roomId: r.id, date: "2026-10-09" }), ctx())), { blocked: false });
    const out = await ok<{ blocked: number; skipped: number; message: string }>(await blocksRoute(req("POST", "/api/v1/website/calendar/blocks", "manager", { roomIds: [r.id], start: "2026-10-06", end: "2026-10-09" }), ctx()));
    assert.deepEqual([out.blocked, out.skipped, out.message], [3, 1, "Blocked 4 dates for 1 room category (1 skipped: already booked)."]);
    const w = await week("2026-10-05");
    assert.deepEqual(w.blocked, [{ roomId: r.id, roomName: "Deluxe", start: "2026-10-06", end: "2026-10-06", nights: 1 }, { roomId: r.id, roomName: "Deluxe", start: "2026-10-08", end: "2026-10-09", nights: 2 }]);
    res = await blocksRoute(req("POST", "/api/v1/website/calendar/blocks", "manager", { roomIds: [r.id], start: "2026-10-09", end: "2026-10-01" }), ctx());
    assert.deepEqual(await fields(res), { end: "Start date must be before end date." });
    res = await blocksRoute(req("POST", "/api/v1/website/calendar/blocks", "manager", { roomIds: [], start: "2026-10-01", end: "2026-10-02" }), ctx());
    assert.deepEqual(await fields(res), { roomIds: "Select at least one room category." });
    res = await blocksRoute(req("POST", "/api/v1/website/calendar/blocks", "manager", { roomIds: [r.id], start: "2026-01-01", end: "2027-01-02" }), ctx());
    assert.deepEqual(await fields(res), { end: "Range cannot exceed 366 days." });
    const open = await ok<{ unblocked: number; message: string }>(await unblockRoute(req("POST", "/api/v1/website/calendar/unblock", "manager", { ranges: [{ roomId: r.id, start: "2026-10-08", end: "2026-10-09" }] }), ctx()));
    assert.deepEqual(open, { unblocked: 2, message: "Opened 1 blocked stretch." });
    assert.equal((await unblockRoute(req("POST", "/api/v1/website/calendar/unblock", "manager", { ranges: [] }), ctx())).status, 422);
    assert.equal((await week("2026-10-05")).blocked.length, 1);
  });

  test("bulk prices: the plan of that name in each room, only dates whose price changes are written, rooms without it are skipped", async () => {
    const a = await room({ name: "Deluxe" });
    const b = await room({ name: "Standard" });
    const pa = await plan(a.id);
    await plan(b.id, { name: "Breakfast", code: "CP" });
    assert.deepEqual(await ok(await planNamesRoute(req("GET", "/api/v1/website/calendar/plan-names", "viewer"), ctx())), ["Breakfast", "Room Only"]);
    let res = await bulkRoute(req("POST", "/api/v1/website/calendar/bulk-rates", "manager", { roomIds: [a.id], planName: "Room Only", start: "2026-10-10", end: "2026-10-12", singlePaise: null, doublePaise: null, extraPaise: null }), ctx());
    assert.deepEqual(await fields(res), { prices: "Enter a price for at least one kind of guest." });
    const out = await ok<{ dates: number; rooms: number; skipped: string[]; message: string }>(await bulkRoute(req("POST", "/api/v1/website/calendar/bulk-rates", "manager", { roomIds: [a.id, b.id], planName: "Room Only", start: "2026-10-10", end: "2026-10-12", singlePaise: null, doublePaise: 400000, extraPaise: 60000 }), ctx()));
    // the double price is the plan's own, so no date is written; the extra person price changes once
    assert.deepEqual([out.dates, out.rooms, out.skipped, data().datedRates.length, (data().roomTypes[0].plans[0] as unknown as { extraPersonPaise: bigint }).extraPersonPaise], [3, 1, ["Standard"], 0, BigInt(60000)]);
    assert.equal(out.message, 'Updated 1 room across 3 dates. No active plan named "Room Only" in Standard.');
    await ok(await bulkRoute(req("POST", "/api/v1/website/calendar/bulk-rates", "manager", { roomIds: [a.id], planName: "Room Only", start: "2026-10-10", end: "2026-10-12", singlePaise: 310000, doublePaise: 450000, extraPaise: null }), ctx()));
    assert.deepEqual(data().datedRates.map((d) => [d.date, d.doublePaise, d.singlePaise]), [["2026-10-10", BigInt(450000), BigInt(310000)], ["2026-10-11", BigInt(450000), BigInt(310000)], ["2026-10-12", BigInt(450000), BigInt(310000)]]);
    // the same prices again write nothing new
    const before = JSON.stringify(data().datedRates, (_k, v) => (typeof v === "bigint" ? String(v) : v));
    await ok(await bulkRoute(req("POST", "/api/v1/website/calendar/bulk-rates", "manager", { roomIds: [a.id], planName: "Room Only", start: "2026-10-10", end: "2026-10-12", singlePaise: 310000, doublePaise: 450000, extraPaise: null }), ctx()));
    assert.equal(JSON.stringify(data().datedRates, (_k, v) => (typeof v === "bigint" ? String(v) : v)), before);
    res = await bulkRoute(req("POST", "/api/v1/website/calendar/bulk-rates", "manager", { roomIds: [b.id], planName: "Nothing", start: "2026-10-10", end: "2026-10-12", singlePaise: 1, doublePaise: null, extraPaise: null }), ctx());
    assert.deepEqual([res.status, await message(res)], [409, 'No active plan named "Nothing" in Standard.']);
    void pa;
  });
});
