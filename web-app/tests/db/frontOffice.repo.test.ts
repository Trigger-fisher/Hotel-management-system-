// The Front Office repositories on the REAL PostgreSQL instance (repos/postgres/frontOffice.ts), through the unit the front-office services get.
// The in-memory double (repos/memory/frontOffice.ts) is the reference for every rule proven here against the database.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { newId } from "../../src/server/db/ids";
import type { FrontOfficeRepos, ReservationFields, RoomFields, StayFields } from "../../src/server/repos/frontOffice";
import { createPgFrontOfficeUnit } from "../../src/server/repos/postgres/frontOffice";
import { RepoError, type Unit } from "../../src/server/repos/types";
import { appUrl, connectOwner, lockTestDatabase } from "./helpers/realDb";
import { createTestHotel, removeAllTestHotels } from "./helpers/hotels";

let releaseTestLock: (() => Promise<void>) | undefined;
before(async () => {
  releaseTestLock = await lockTestDatabase();
});

let owner: DbClient;
let hotel: CreatedHotel;
let database: Database;
let unit: Unit<FrontOfficeRepos>;
let deluxe: string;
let standard: string;
const USER = newId();
const ACTOR = newId();
const run = <T>(work: (r: FrontOfficeRepos) => Promise<T>): Promise<T> => unit.run({ hotelId: hotel.id, userId: USER }, work);

before(async () => {
  owner = await connectOwner();
  await removeAllTestHotels(owner);
  hotel = await createTestHotel(owner, "Front Hotel");
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 10 });
  unit = createPgFrontOfficeUnit(database.withHotel);
  deluxe = String((await owner.query(`INSERT INTO "${hotel.schema}".site_rooms (slug, name, total_count, sort_order) VALUES ('deluxe', 'Deluxe', 5, 1) RETURNING id`)).rows[0].id);
  standard = String((await owner.query(`INSERT INTO "${hotel.schema}".site_rooms (slug, name, total_count, sort_order) VALUES ('standard', 'Standard', 3, 2) RETURNING id`)).rows[0].id);
  await owner.query(`INSERT INTO "${hotel.schema}".site_rate_plans (room_id, name, code, price_double_paise, price_single_paise, sort_order, active) VALUES ($1, 'Room only', 'EP', 300000, 250000, 1, true), ($1, 'With breakfast', 'CP', 350000, NULL, 2, false)`, [deluxe]);
});

after(async () => {
  await database?.close();
  await removeAllTestHotels(owner);
  await owner.end();
});

const room = (over: Partial<RoomFields> = {}): RoomFields & { createdBy: string } => ({ number: `R${Math.random().toString(36).slice(2, 6)}`, floor: "1", roomTypeId: deluxe, hkStatus: "clean", outOfOrder: false, outOfOrderReason: null, notes: null, sortOrder: 1, createdBy: ACTOR, ...over });
const reservation = (over: Partial<ReservationFields> = {}): ReservationFields & { createdBy: string; year2: string } => ({
  guestName: "Asha Rao", mobile: "9876543210", email: null, companyId: null, roomTypeId: deluxe, rooms: 1, plan: "EP", ratePaise: BigInt(300_000), adults: 2, children: 0, checkIn: "2026-03-10", checkOut: "2026-03-12",
  source: "phone", status: "confirmed", siteEnquiryId: null, notes: null, cancelReason: null, createdBy: ACTOR, year2: "26", ...over,
});
const stay = (roomId: string, over: Partial<StayFields> = {}): StayFields & { createdBy: string } => ({
  reservationId: null, roomId, grNumber: null, guestName: "Walk In", mobile: null, email: null, address: null, city: null, nationality: "Indian", idProofType: "Aadhaar", idProofNumber: "1234 5678 9012", companyId: null, guestGstin: null,
  adults: 1, children: 0, plan: "EP", ratePaise: BigInt(300_000), checkInAt: new Date("2026-03-10T08:00:00Z"), expectedCheckOut: "2026-03-12", checkOutAt: null, status: "in_house", billId: null, hotelGstPercent: null,
  foodGstPercent: null, notes: null, guestDetails: null, idProofPath: null, createdBy: ACTOR, ...over,
});

describe("rooms", () => {
  test("create, read back, unique number without regard to case, ordering, update, existing numbers, max sort order", async () => {
    const a = await run((r) => r.rooms.create(room({ number: "A1", sortOrder: 2, outOfOrder: true, outOfOrderReason: "Leak" })));
    const b = await run((r) => r.rooms.create(room({ number: "b2", sortOrder: 1 })));
    assert.deepEqual([a.number, a.outOfOrder, a.outOfOrderReason, a.hkStatus, a.sortOrder, a.roomTypeId, a.createdBy, a.updatedBy], ["A1", true, "Leak", "clean", 2, deluxe, ACTOR, null]);
    await assert.rejects(() => run((r) => r.rooms.create(room({ number: "a1" }))), (e) => e instanceof RepoError && e.kind === "unique");
    assert.deepEqual((await run((r) => r.rooms.all())).map((x) => x.number), ["b2", "A1"], "by sort order, then number");
    assert.deepEqual((await run((r) => r.rooms.existingNumbers(["a1", "ZZ", "B2"]))).sort(), ["A1", "b2"]);
    assert.equal(await run((r) => r.rooms.maxSortOrder()), 2);
    const upd = await run((r) => r.rooms.update(a.id, { hkStatus: "dirty", outOfOrder: false, notes: "Fixed" }, ACTOR));
    assert.deepEqual([upd?.hkStatus, upd?.outOfOrder, upd?.notes, upd?.updatedBy], ["dirty", false, "Fixed", ACTOR]);
    assert.equal(await run((r) => r.rooms.update(newId(), { notes: "x" }, ACTOR)), null);
    await assert.rejects(() => run((r) => r.rooms.update(b.id, { number: "A1" }, ACTOR)), (e) => e instanceof RepoError && e.kind === "unique");
    assert.deepEqual(await run((r) => r.rooms.get(b.id)), b);
    assert.equal(await run((r) => r.rooms.get(newId())), null);
  });

  test("a room with a stay cannot be deleted (a rule the database holds); one without can, once", async () => {
    const used = await run((r) => r.rooms.create(room()));
    const free = await run((r) => r.rooms.create(room()));
    await run((r) => r.stays.create(stay(used.id)));
    assert.equal(await run((r) => r.rooms.hasStays(used.id)), true);
    assert.deepEqual([...(await run((r) => r.rooms.withStays([used.id, free.id])))], [used.id]);
    await assert.rejects(() => run((r) => r.rooms.delete(used.id)), (e) => e instanceof RepoError && e.kind === "check");
    assert.equal(await run((r) => r.rooms.delete(free.id)), true);
    assert.equal(await run((r) => r.rooms.delete(free.id)), false);
  });
});

describe("reservations", () => {
  test("references are one past the highest number, even under 10 creates at once; every field reads back; the dates are checked", async () => {
    const made = await Promise.all(Array.from({ length: 10 }, (_, i) => run((r) => r.reservations.create(reservation({ guestName: `Guest ${i}` })))));
    const numbers = made.map((m) => Number(/(\d+)$/.exec(m.reference)?.[1])).sort((x, y) => x - y);
    assert.deepEqual(numbers, Array.from({ length: 10 }, (_, i) => numbers[0] + i), "no gaps, no duplicates");
    assert.match(made[0].reference, /^RES-26-\d{5}$/);
    const one = made[0];
    assert.deepEqual([one.rooms, one.ratePaise, one.checkIn, one.status, one.version, one.createdBy], [1, BigInt(300_000), "2026-03-10", "confirmed", 1, ACTOR]);
    await assert.rejects(() => run((r) => r.reservations.create(reservation({ checkIn: "2026-03-10", checkOut: "2026-03-10" }))), (e) => e instanceof RepoError && e.kind === "check");
    assert.deepEqual(await run((r) => r.reservations.get(one.id)), one);
    assert.equal((await run((r) => r.reservations.getMany([one.id, newId()]))).size, 1);
  });

  test("update raises the version, a stale one is a conflict, a bad range is refused and leaves the row", async () => {
    const r1 = await run((r) => r.reservations.create(reservation()));
    const ok = await run((r) => r.reservations.update(r1.id, 1, { status: "cancelled", cancelReason: "Changed plans" }, ACTOR));
    assert.ok(ok.ok && ok.record.version === 2 && ok.record.status === "cancelled" && ok.record.updatedBy === ACTOR);
    assert.deepEqual(await run((r) => r.reservations.update(r1.id, 1, { notes: "late" }, ACTOR)), { ok: false, reason: "conflict", currentVersion: 2 });
    assert.deepEqual(await run((r) => r.reservations.update(newId(), 1, {}, ACTOR)), { ok: false, reason: "not_found" });
    await assert.rejects(() => run((r) => r.reservations.update(r1.id, 2, { checkOut: "2026-03-01" }, ACTOR)), (e) => e instanceof RepoError && e.kind === "check");
    assert.equal((await run((r) => r.reservations.get(r1.id)))?.version, 2);
  });

  test("a website enquiry becomes at most one reservation", async () => {
    const enquiry = String((await owner.query(`INSERT INTO "${hotel.schema}".site_enquiries (reference, name, phone, room_id, check_in, check_out, guests) VALUES ('ENQ-1', 'Web Guest', '9000000000', $1, '2026-05-01', '2026-05-03', 2) RETURNING id`, [deluxe])).rows[0].id);
    const res = await run((r) => r.reservations.create(reservation({ siteEnquiryId: enquiry, source: "website" })));
    await assert.rejects(() => run((r) => r.reservations.create(reservation({ siteEnquiryId: enquiry }))), (e) => e instanceof RepoError && e.kind === "unique");
    assert.equal((await run((r) => r.reservations.byEnquiry(enquiry)))?.id, res.id);
    assert.equal(await run((r) => r.reservations.byEnquiry(newId())), null);
    const found = await run((r) => r.enquiries.get(enquiry));
    assert.deepEqual([found?.reference, found?.name, found?.roomId, found?.checkIn, found?.guests, found?.children], ["ENQ-1", "Web Guest", deluxe, "2026-05-01", 2, null]);
    assert.equal((await run((r) => r.enquiries.getMany([enquiry, newId()]))).size, 1);
  });

  describe("views, counts, arrivals, holding and the check-in picker", () => {
    before(async () => {
      await owner.query(`DELETE FROM "${hotel.schema}".pms_stays`);
      await owner.query(`DELETE FROM "${hotel.schema}".pms_reservations`);
      const make = (over: Partial<ReservationFields>) => run((r) => r.reservations.create(reservation(over)));
      await make({ guestName: "Early Arrival", checkIn: "2026-06-01", checkOut: "2026-06-03" });
      await make({ guestName: "Later Arrival", checkIn: "2026-06-05", checkOut: "2026-06-07", mobile: "9111111111" });
      await make({ guestName: "In House", checkIn: "2026-05-30", checkOut: "2026-06-02", status: "checked_in" });
      await make({ guestName: "Gone Guest", checkIn: "2026-05-01", checkOut: "2026-05-03", status: "checked_out" });
      await make({ guestName: "Cancelled Guest", status: "cancelled", cancelReason: "x" });
      await make({ guestName: "No Show", status: "no_show", roomTypeId: standard, rooms: 2 });
    });
    const names = async (view: string, words?: string[]) => (await run((r) => r.reservations.list({ view: view as never, today: "2026-06-02", words, page: 1, pageSize: 20 }))).rows.map((x) => x.guestName);

    test("each view's filter and order, with the search words and paging", async () => {
      assert.deepEqual(await names("upcoming"), ["Later Arrival", "Early Arrival"], "decision 52: the latest check-in first");
      assert.deepEqual(await names("today"), ["Early Arrival"], "confirmed with check-in on or before today");
      assert.deepEqual(await names("in_house"), ["In House"]);
      assert.deepEqual(await names("past"), ["Gone Guest"]);
      assert.deepEqual((await names("cancelled")).sort(), ["Cancelled Guest", "No Show"]);
      assert.equal((await names("all")).length, 6);
      assert.deepEqual((await names("all"))[0], "Later Arrival", "all: check-in newest first");
      assert.deepEqual(await names("all", ["9111"]), ["Later Arrival"], "words match the mobile");
      assert.deepEqual(await names("all", ["early", "arrival"]), ["Early Arrival"]);
      assert.deepEqual(await names("all", ["res-26"]), (await names("all")), "and the reference");
      const page = await run((r) => r.reservations.list({ view: "all", today: "2026-06-02", page: 2, pageSize: 4 }));
      assert.deepEqual([page.total, page.rows.length], [6, 2]);
      assert.deepEqual(await run((r) => r.reservations.countByView("2026-06-02")), { upcoming: 2, today: 1, in_house: 1, past: 1, cancelled: 2, all: 6 });
      assert.deepEqual(await run((r) => r.reservations.countByView("2026-06-02", ["guest"])), { upcoming: 0, today: 0, in_house: 0, past: 1, cancelled: 1, all: 2 });
    });

    test("arrivals, rooms held on a night, the check-in picker", async () => {
      assert.deepEqual((await run((r) => r.reservations.arrivals("2026-06-10"))).map((x) => x.guestName), ["Early Arrival", "Later Arrival"]);
      assert.deepEqual((await run((r) => r.reservations.arrivals("2026-06-02"))).map((x) => x.guestName), ["Early Arrival"]);
      const held = await run((r) => r.reservations.holding(deluxe, "2026-06-01", "2026-06-02"));
      assert.deepEqual(held.map((h) => [h.checkIn, h.checkOut, h.rooms]).sort(), [["2026-05-30", "2026-06-02", 1], ["2026-06-01", "2026-06-03", 1]], "check-out day is free; cancelled and no-show hold nothing");
      assert.deepEqual(await run((r) => r.reservations.holding(standard, "2026-03-10", "2026-03-11")), []);
      const early = (await run((r) => r.reservations.arrivals("2026-06-02")))[0];
      assert.equal((await run((r) => r.reservations.holding(deluxe, "2026-06-01", "2026-06-02", { ignoreId: early.id }))).length, 1);
      assert.deepEqual((await run((r) => r.reservations.openForCheckIn(10))).map((x) => x.guestName), ["In House", "Early Arrival", "Later Arrival"]);
      assert.equal((await run((r) => r.reservations.openForCheckIn(1))).length, 1);
    });

    test("website reservations can be left out of the held count", async () => {
      const enquiry = String((await owner.query(`INSERT INTO "${hotel.schema}".site_enquiries (reference, name) VALUES ('ENQ-W', 'Held By Web') RETURNING id`)).rows[0].id);
      await run((r) => r.reservations.create(reservation({ guestName: "Web Booking", checkIn: "2026-07-01", checkOut: "2026-07-03", siteEnquiryId: enquiry, source: "website" })));
      assert.equal((await run((r) => r.reservations.holding(deluxe, "2026-07-01", "2026-07-02"))).length, 1);
      assert.equal((await run((r) => r.reservations.holding(deluxe, "2026-07-01", "2026-07-02", { countWebsite: false }))).length, 0);
    });
  });
});

describe("stays and charges", () => {
  let r101: string;
  let r102: string;
  before(async () => {
    await owner.query(`DELETE FROM "${hotel.schema}".pms_charges`);
    await owner.query(`DELETE FROM "${hotel.schema}".pms_stays`);
    r101 = (await run((r) => r.rooms.create(room({ number: "101", sortOrder: 10 })))).id;
    r102 = (await run((r) => r.rooms.create(room({ number: "102", sortOrder: 11, roomTypeId: standard })))).id;
  });

  test("a stay reads back in full (the ID number in plain text); one in-house stay per room is a rule of the database; a checked-out stay frees the room", async () => {
    const first = await run((r) => r.stays.create(stay(r101, { guestName: "First Guest", idProofNumber: "ABCDE1234F", hotelGstPercent: "2.5" })));
    assert.deepEqual([first.idProofNumber, first.hotelGstPercent, first.status, first.version, first.checkInAt.toISOString(), first.expectedCheckOut], ["ABCDE1234F", "2.5", "in_house", 1, "2026-03-10T08:00:00.000Z", "2026-03-12"]);
    await assert.rejects(() => run((r) => r.stays.create(stay(r101))), (e) => e instanceof RepoError && e.kind === "unique");
    const out = await run((r) => r.stays.update(first.id, 1, { status: "checked_out", checkOutAt: new Date("2026-03-12T06:00:00Z"), hotelGstPercent: "5", foodGstPercent: "5" }, ACTOR));
    assert.ok(out.ok && out.record.status === "checked_out" && out.record.version === 2 && out.record.hotelGstPercent === "5" && out.record.updatedBy === ACTOR);
    const second = await run((r) => r.stays.create(stay(r101, { guestName: "Second Guest" })));
    assert.equal(second.status, "in_house");
    assert.deepEqual(await run((r) => r.stays.update(first.id, 1, { notes: "late" }, ACTOR)), { ok: false, reason: "conflict", currentVersion: 2 });
    await assert.rejects(() => run((r) => r.stays.update(second.id, 1, { checkOutAt: new Date("2026-03-09T00:00:00Z") }, ACTOR)), (e) => e instanceof RepoError && e.kind === "check");
    await assert.rejects(() => run((r) => r.stays.create(stay(r102, { expectedCheckOut: "2026-03-10" }))), (e) => e instanceof RepoError && e.kind === "check", "expected check-out must be after the check-in day (IST)");
  });

  test("the lists: in house by expected check-out, past by check-out time (newest first), words match guest, mobile, GR and room number; counts, rooms, departures, walk-ins", async () => {
    const reservation1 = (await run((r) => r.reservations.create(reservation({ guestName: "Booked Guest" })))).id;
    await run((r) => r.stays.create(stay(r102, { guestName: "Booked Stay", mobile: "9222222222", grNumber: "GR-77", reservationId: reservation1, expectedCheckOut: "2026-03-11" })));
    const inHouse = await run((r) => r.stays.list({ view: "in_house", page: 1, pageSize: 10 }));
    assert.deepEqual(inHouse.rows.map((s) => s.guestName), ["Booked Stay", "Second Guest"], "expected check-out 11th before the 12th");
    assert.deepEqual((await run((r) => r.stays.list({ view: "in_house", words: ["gr-77"], page: 1, pageSize: 10 }))).rows.map((s) => s.guestName), ["Booked Stay"]);
    assert.deepEqual((await run((r) => r.stays.list({ view: "in_house", words: ["101"], page: 1, pageSize: 10 }))).rows.map((s) => s.guestName), ["Second Guest"], "the room number");
    assert.deepEqual((await run((r) => r.stays.list({ view: "past", page: 1, pageSize: 10 }))).rows.map((s) => s.guestName), ["First Guest"]);
    assert.deepEqual(await run((r) => r.stays.countByView()), { in_house: 2, past: 1 });
    assert.deepEqual(await run((r) => r.stays.countByView(["9222"])), { in_house: 1, past: 0 });
    assert.equal(await run((r) => r.stays.inHouseCount()), 2);
    const current = await run((r) => r.stays.currentByRoom([r101, r102, newId()]));
    assert.deepEqual([...current.keys()].sort(), [r101, r102].sort());
    assert.equal(current.get(r101)?.guestName, "Second Guest");
    assert.deepEqual((await run((r) => r.stays.departures("2026-03-11"))).map((s) => s.guestName), ["Booked Stay"]);
    assert.deepEqual((await run((r) => r.stays.departures("2026-03-31"))).map((s) => s.guestName), ["Booked Stay", "Second Guest"]);
    assert.deepEqual((await run((r) => r.stays.walkInsOfType(deluxe))).map((s) => s.guestName), ["Second Guest"], "no reservation, in a deluxe room");
    assert.deepEqual((await run((r) => r.stays.walkInsOfType(standard))).map((s) => s.guestName), [], "the standard room's stay has a reservation");
    const byRes = await run((r) => r.stays.byReservation([reservation1, newId()]));
    assert.deepEqual(byRes.get(reservation1)?.map((s) => s.guestName), ["Booked Stay"]);
  });

  test("guest lookup by mobile: ten digits hit the last-ten index however the number was written, fewer compare the tail, newest first, capped; reservations the same; the highest G.R. number", async () => {
    const lookRoom = await run((r) => r.rooms.create(room()));
    const older = await run((r) => r.stays.create(stay(lookRoom.id, { guestName: "Older Visit", mobile: "+91 98765 43210", grNumber: "GR-41", status: "checked_out", checkOutAt: new Date("2026-03-11T05:00:00Z"), checkInAt: new Date("2026-03-01T08:00:00Z"), expectedCheckOut: "2026-03-05" })));
    const newer = await run((r) => r.stays.create(stay(lookRoom.id, { guestName: "Newer Visit", mobile: "9876543210", grNumber: "2026/42", checkInAt: new Date("2026-03-20T08:00:00Z"), expectedCheckOut: "2026-03-22" })));
    assert.deepEqual((await run((r) => r.stays.byMobileSuffix("9876543210", 50))).map((s) => s.id), [newer.id, older.id], "newest check-in first");
    assert.deepEqual((await run((r) => r.stays.byMobileSuffix("9876543210", 1))).map((s) => s.id), [newer.id], "capped");
    assert.deepEqual((await run((r) => r.stays.byMobileSuffix("543210", 50))).map((s) => s.guestName), ["Newer Visit", "Older Visit"], "the tail of the number");
    assert.deepEqual((await run((r) => r.stays.byMobileSuffix("1543210", 50))), [], "a tail that is not theirs");
    assert.deepEqual((await run((r) => r.stays.byMobileSuffix("9999999999", 50))), []);
    assert.deepEqual((await run((r) => r.stays.byMobileSuffix("2222222", 50))).map((s) => s.guestName), ["Booked Stay"], "the earlier test's stay by seven digits");
    const booked = await run((r) => r.reservations.byMobileSuffix("9876543210", 50));
    assert.ok(booked.length >= 1 && booked.every((x) => x.mobile === "9876543210"), "the reservations made above carry this number");
    assert.deepEqual(await run((r) => r.reservations.byMobileSuffix("0000000000", 50)), []);
    assert.equal(await run((r) => r.stays.highestGrNumber()), 202642, "digits only: '2026/42' reads as 202642, above 'GR-41' and 'GR-77'");
  });

  test("charges: by date then creation, a quantity as text, hard delete, the table refuses negative amounts, they go with their stay", async () => {
    const chargedRoom = await run((r) => r.rooms.create(room()));
    const owned = await run((r) => r.stays.create(stay(chargedRoom.id, { guestName: "Charged Guest" })));
    const charge = (over: Record<string, unknown>) => run((r) => r.charges.create({ stayId: owned.id, chargeDate: "2026-03-10", category: "food", side: "food", description: "Dinner", quantity: "1.50", unitPricePaise: BigInt(40_000), amountPaise: BigInt(60_000), createdBy: ACTOR, ...over } as never));
    const later = await charge({ chargeDate: "2026-03-11", description: "Laundry", category: "laundry", side: "hotel" });
    const earlier = await charge({ description: "Breakfast" });
    const map = await run((r) => r.charges.forStays([owned.id, newId()]));
    assert.deepEqual(map.get(owned.id)?.map((c) => c.description), ["Breakfast", "Laundry"]);
    assert.deepEqual([earlier.quantity, earlier.unitPricePaise, earlier.amountPaise, earlier.side, earlier.createdBy], ["1.50", BigInt(40_000), BigInt(60_000), "food", ACTOR]);
    assert.deepEqual(await run((r) => r.charges.get(later.id)), later);
    await assert.rejects(() => charge({ amountPaise: BigInt(-1) }), (e) => e instanceof RepoError && e.kind === "check");
    assert.equal(await run((r) => r.charges.delete(later.id)), true);
    assert.equal(await run((r) => r.charges.delete(later.id)), false);
    assert.equal(await run((r) => r.charges.get(later.id)), null);
    await owner.query(`DELETE FROM "${hotel.schema}".pms_stays WHERE id = $1`, [owned.id]);
    assert.equal((await run((r) => r.charges.forStays([owned.id]))).get(owned.id)?.length, 0, "a stay's charges go with it");
  });
});

describe("the read-only neighbours", () => {
  test("room types with their plans, ID proof types, settings", async () => {
    const types = await run((r) => r.roomTypes.all());
    assert.deepEqual(types.map((t) => [t.name, t.totalCount]), [["Deluxe", 5], ["Standard", 3]]);
    assert.deepEqual(types[0].plans.map((p) => [p.code, p.singlePaise, p.doublePaise, p.active]), [["EP", BigInt(250_000), BigInt(300_000), true], ["CP", null, BigInt(350_000), false]]);
    assert.equal((await run((r) => r.roomTypes.get(standard)))?.name, "Standard");
    assert.equal(await run((r) => r.roomTypes.get(newId())), null);
    const names = await run((r) => r.idProofTypes.activeNames());
    assert.equal(names.length, 5);
    assert.deepEqual([...names].sort(), names, "by name");
    const settings = await run((r) => r.settings.values(["checkout.hotel_gst_percent", "checkout.food_gst_percent", "no.such.key"]));
    assert.deepEqual([...settings.entries()].sort(), [["checkout.food_gst_percent", "5"], ["checkout.hotel_gst_percent", "5"], ["no.such.key", null]]);
  });
});

after(async () => {
  await releaseTestLock?.();
});
