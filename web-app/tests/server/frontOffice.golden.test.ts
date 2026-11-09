// Golden tests for the Front Office: expected values made by REAL PHP (FrontDesk::nights itself, and Pallav's expressions for the room charge,
// a charge's amount, the check-out GST and totals, the mobile and address on a bill, the reference, the enquiry rate and the occupancy).
// Regenerate: php db/scripts/php/generate-front-office-fixtures.php <pallav repo> > db/scripts/php/fixtures/front-office.json
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import type { AdvanceRecord } from "../../src/server/repos/billing";
import { billAddress, billMobile, chargeAmount, checkoutAdvance, checkoutTotals, enquiryRate, freeRooms, nightsOf, occupancy, parseRoomNumbers, reservationReference, roomCharge, stayNights } from "../../src/server/services/frontOffice/rules";

interface Fixture {
  nights: { from: string; to: string; count: number; first: string | null; last: string | null }[];
  roomCharges: { checkInAt: string; until: string; rate: string; nights: number; roomPaise: number }[];
  charges: { quantity: string; unitPricePaise: number; amountPaise: number }[];
  checkout: { roomPaise: number; extraBedPaise: number; laundryPaise: number; otherPaise: number; foodPaise: number; hotelGstPercent: string; foodGstPercent: string; hotelGstPaise: number; foodGstPaise: number; hotelTotalPaise: number; foodTotalPaise: number }[];
  mobiles: { in: string; out: string | null }[];
  addresses: { address: string | null; city: string | null; out: string | null }[];
  references: { at: string; n: number; reference: string }[];
  enquiryRates: { guests: number | null; children: number | null; doublePaise: number; singlePaise: number | null; ratePaise: number; adults: number }[];
  occupancy: { occupied: number; inService: number; percent: number }[];
}
const fx = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "..", "common", "db", "scripts", "php", "fixtures", "front-office.json"), "utf8")) as Fixture;
const B = BigInt;
/** A PHP local time in Asia/Kolkata as an instant. */
const ist = (local: string): Date => new Date(`${local.replace(" ", "T")}+05:30`);

describe("front office arithmetic (real PHP)", () => {
  test(`FrontDesk::nights: all ${fx.nights.length} cases, the 366 cap and leap days included`, () => {
    for (const row of fx.nights) {
      const n = nightsOf(row.from, row.to);
      assert.deepEqual([n.length, n[0] ?? null, n.at(-1) ?? null], [row.count, row.first, row.last], JSON.stringify(row));
    }
  });
  test("Stay::nights and roomCharge (whole-paise rates)", () => {
    for (const row of fx.roomCharges.filter((r) => /^\d+(\.\d{1,2})?$/.test(r.rate))) {
      const nights = stayNights(ist(row.checkInAt), ist(row.until));
      assert.equal(nights, row.nights, JSON.stringify(row));
      assert.equal(roomCharge(B(Math.round(Number(row.rate) * 100)), nights), B(row.roomPaise), JSON.stringify(row));
    }
  });
  test(`a charge's amount: all ${fx.charges.length} cases, ties included (PHP 8.3 rounding, exact decimals)`, () => {
    for (const row of fx.charges) assert.equal(chargeAmount(row.quantity, B(row.unitPricePaise)), B(row.amountPaise), JSON.stringify(row));
  });
  test(`the check-out bill's GST and totals: all ${fx.checkout.length} cases`, () => {
    for (const row of fx.checkout) {
      const t = checkoutTotals({ roomPaise: B(row.roomPaise), extraBedPaise: B(row.extraBedPaise), laundryPaise: B(row.laundryPaise), otherPaise: B(row.otherPaise), foodPaise: B(row.foodPaise) }, row.hotelGstPercent, row.foodGstPercent);
      assert.deepEqual([t.hotelGstPaise, t.foodGstPaise, t.hotelTotalPaise, t.foodTotalPaise], [B(row.hotelGstPaise), B(row.foodGstPaise), B(row.hotelTotalPaise), B(row.foodTotalPaise)], JSON.stringify(row));
    }
  });
  test("the mobile and the address on a bill", () => {
    for (const row of fx.mobiles) assert.equal(billMobile(row.in === "" ? null : row.in), row.in === "" ? null : row.out, row.in);
    for (const row of fx.addresses) assert.equal(billAddress(row.address, row.city), row.out, JSON.stringify(row));
  });
  test("the reservation reference", () => {
    for (const row of fx.references) assert.equal(reservationReference(row.at.slice(2, 4), row.n), row.reference);
  });
  test("the website enquiry's rate and adults", () => {
    for (const row of fx.enquiryRates) {
      const r = enquiryRate(row.guests, row.children, { singlePaise: row.singlePaise === null ? null : B(row.singlePaise), doublePaise: B(row.doublePaise) });
      assert.deepEqual([r.ratePaise, r.adults], [B(row.ratePaise), row.adults], JSON.stringify(row));
    }
  });
  test("the board's occupancy", () => {
    for (const row of fx.occupancy) assert.equal(occupancy(row.occupied, row.inService), row.percent, JSON.stringify(row));
  });
});

describe("front office rules written from Pallav's code", () => {
  test("the advance taken off at check-out: the most money left, not refunded (Billing.php:124-126)", () => {
    const a = (id: string, h: number, f: number, refunded = false) => ({ id, hotelBalancePaise: B(h), foodBalancePaise: B(f), refundPaymentDate: refunded ? "2026-10-01" : null }) as AdvanceRecord;
    assert.equal(checkoutAdvance([a("1", 100, 0), a("2", 300, 0), a("3", 900, 0, true), a("4", 200, 200)])?.id, "4");
    assert.equal(checkoutAdvance([a("1", 0, 0), a("2", 500, 0, true)]), null);
    assert.equal(checkoutAdvance([a("1", 300, 0), a("2", 300, 0)])?.id, "1", "the first of equals");
  });
  test("bulk room numbers (RoomController::bulk)", () => {
    assert.deepEqual(parseRoomNumbers("101-104, 201  205"), ["101", "102", "103", "104", "201", "205"]);
    assert.deepEqual(parseRoomNumbers("110-101"), ["110-101"]);
    assert.equal(parseRoomNumbers("1-300").length, 1, "a range of 200 or more is kept as typed");
    assert.deepEqual(parseRoomNumbers("A-very-long-room-number-here"), ["A-very-long-room-num"]);
  });
  test("availability (FrontDesk::freeFor): the busiest night counts", () => {
    const held = [{ checkIn: "2026-10-05", checkOut: "2026-10-07", rooms: 2 }, { checkIn: "2026-10-06", checkOut: "2026-10-08", rooms: 1 }];
    assert.equal(freeRooms(5, held, [], "2026-10-05", "2026-10-08"), 2);
    assert.equal(freeRooms(5, held, [{ from: "2026-10-06", until: "2026-10-07" }], "2026-10-05", "2026-10-08"), 1);
    assert.equal(freeRooms(2, held, [], "2026-10-06", "2026-10-07"), 0, "never below zero");
    assert.equal(freeRooms(5, [], [], "2026-10-05", "2026-10-05"), 0, "no nights");
  });
});
