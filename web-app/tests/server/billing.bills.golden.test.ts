// Golden tests for Billing, Bills: expected values produced by REAL PHP running Pallav's BillMasterController::prepareBill and
// MealPlanRate::price, plus verbatim copies of the inline advance application (:433-444) and debit settlement (:525-546).
// Regenerate: php db/scripts/php/generate-billing-fixtures.php <pallav repo> bills > db/scripts/php/fixtures/billing-bills.json
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { debitBalances, foodTotal, hotelTotal, phpNumberText, priceStay, settleMath, takeAdvance, type MealRate } from "../../src/server/services/billing/billRules";

type Seg = { from: string; to: string; plan: string; persons: number; nights: number; ratePaise: number | null; amountPaise: number };
type StayIn = { from: string; to: string; plan: string; persons: number };
interface Fixture {
  rates: { plan: string; effectiveFrom: string; ratePaise: number }[];
  prepare: { lines: Record<string, number>; stay: StayIn[]; hotelTotalPaise: number; foodTotalPaise: number; planFoodPaise: number; segments: Seg[] | null }[];
  stays: { stay: StayIn[]; totalPaise: number; segments: Seg[] }[];
  apply: { advanceHotelBalancePaise: number; advanceFoodBalancePaise: number; hotelTotalPaise: number; foodTotalPaise: number; hotelMode: string | null; foodMode: string | null; takenHotelPaise: number; takenFoodPaise: number; leftHotelPaise: number; leftFoodPaise: number; balanceHotelPaise: number; balanceFoodPaise: number }[];
  settle: { balanceHotelPaise: number; balanceFoodPaise: number; slots: [number, number][]; debitHotelAdvance: string; debitFoodAdvance: string; leftHotelPaise: number; leftFoodPaise: number; excessHotelPaise: number; excessFoodPaise: number }[];
}
const fx = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "..", "common", "db", "scripts", "php", "fixtures", "billing-bills.json"), "utf8")) as Fixture;
const rates: MealRate[] = fx.rates.map((r) => ({ plan: r.plan, effectiveFrom: r.effectiveFrom, ratePaise: BigInt(r.ratePaise) }));
const B = BigInt;
const asJson = (segments: ReturnType<typeof priceStay>["segments"]) => segments.map((s) => ({ ...s, ratePaise: s.ratePaise === null ? null : Number(s.ratePaise), amountPaise: Number(s.amountPaise) }));

describe("the stay priced night by night (MealPlanRate::price, real PHP)", () => {
  test(`all ${fx.stays.length} stays: nights, one rate or "changing", amounts, the total`, () => {
    for (const row of fx.stays) {
      const priced = priceStay(row.stay, rates);
      assert.deepEqual(asJson(priced.segments), row.segments, JSON.stringify(row.stay));
      assert.equal(priced.totalPaise, B(row.totalPaise), JSON.stringify(row.stay));
    }
  });
  test("the fixture covers a rate change mid-stay, nights before any rate, a plan in another case, an unknown plan and a part with no date", () => {
    assert.ok(fx.stays.some((s) => s.segments.some((g) => g.ratePaise === null)));
    assert.ok(fx.stays.some((s) => s.stay.some((p) => p.plan === "cp")));
    assert.ok(fx.stays.some((s) => s.stay.some((p) => p.from === "")));
  });
});

describe("the bill's totals and plan meals (BillMasterController::prepareBill, real PHP)", () => {
  test(`all ${fx.prepare.length} cases`, () => {
    for (const row of fx.prepare) {
      const l = (k: string): bigint => B(row.lines[k] ?? 0);
      assert.equal(hotelTotal({ roomPaise: l("hotel_amount"), planPaise: l("hotel_plan_amount"), extraBedPaise: l("hotel_extra_bed_amount"), laundryPaise: l("hotel_laundry_amount"), otherPaise: l("hotel_other_amount"), gstPaise: l("hotel_gst") }), B(row.hotelTotalPaise), JSON.stringify(row.lines));
      assert.equal(foodTotal({ foodPaise: l("food_amount"), planPaise: l("food_plan_amount"), laundryPaise: l("food_laundry_amount"), gstPaise: l("food_gst") }), B(row.foodTotalPaise), JSON.stringify(row.lines));
      const priced = priceStay(row.stay, rates);
      assert.equal(priced.totalPaise, B(row.planFoodPaise));
      assert.deepEqual(priced.segments.length > 0 ? asJson(priced.segments) : null, row.segments);
    }
  });
});

describe("the advance taken off a new bill and the debit balances (:433-444, real PHP)", () => {
  test(`all ${fx.apply.length} cases with Pallav's quirk (a) on`, () => {
    for (const row of fx.apply) {
      const taken = takeAdvance({ hotelBalancePaise: B(row.advanceHotelBalancePaise), foodBalancePaise: B(row.advanceFoodBalancePaise) }, { hotelPaise: B(row.hotelTotalPaise), foodPaise: B(row.foodTotalPaise) });
      assert.deepEqual([taken.hotelPaise, taken.foodPaise, taken.hotelLeftPaise, taken.foodLeftPaise], [B(row.takenHotelPaise), B(row.takenFoodPaise), B(row.leftHotelPaise), B(row.leftFoodPaise)], JSON.stringify(row));
      const owed = debitBalances({ hotelMode: row.hotelMode, foodMode: row.foodMode, hotelTotalPaise: B(row.hotelTotalPaise), foodTotalPaise: B(row.foodTotalPaise), takenHotelPaise: taken.hotelPaise, takenFoodPaise: taken.foodPaise, ignoreAdvance: true });
      assert.deepEqual([owed.hotelPaise, owed.foodPaise], [B(row.balanceHotelPaise), B(row.balanceFoodPaise)], JSON.stringify(row));
    }
  });
  test("quirk (a) worked example for MJ: ₹8,000 on Debit, ₹5,000 advance taken -> Pallav owes ₹8,000, corrected ₹3,000", () => {
    const taken = takeAdvance({ hotelBalancePaise: B(500000), foodBalancePaise: B(0) }, { hotelPaise: B(800000), foodPaise: B(0) });
    assert.equal(taken.hotelPaise, B(500000));
    const args = { hotelMode: "Debit", foodMode: null, hotelTotalPaise: B(800000), foodTotalPaise: B(0), takenHotelPaise: taken.hotelPaise, takenFoodPaise: taken.foodPaise };
    assert.equal(debitBalances({ ...args, ignoreAdvance: true }).hotelPaise, B(800000));
    assert.equal(debitBalances({ ...args, ignoreAdvance: false }).hotelPaise, B(300000));
    assert.equal(debitBalances({ ...args, takenHotelPaise: B(900000), ignoreAdvance: false }).hotelPaise, B(0), "never below zero");
  });
  test("HMS deviation §11.1: a side total of zero or less takes nothing and leaves the advance as it was (Pallav would raise it)", () => {
    const taken = takeAdvance({ hotelBalancePaise: B(300000), foodBalancePaise: B(100000) }, { hotelPaise: B(-52500), foodPaise: B(0) });
    assert.deepEqual([taken.hotelPaise, taken.hotelLeftPaise, taken.foodPaise, taken.foodLeftPaise], [B(0), B(300000), B(0), B(100000)]);
  });
});

describe("the debit settlement (:525-546, real PHP)", () => {
  test(`all ${fx.settle.length} settlements: what is left, the excess, and Pallav's text for the excess`, () => {
    for (const row of fx.settle) {
      const paid = row.slots.reduce((t, [h, f]) => ({ hotelPaise: t.hotelPaise + B(h), foodPaise: t.foodPaise + B(f) }), { hotelPaise: B(0), foodPaise: B(0) });
      const m = settleMath({ hotelPaise: B(row.balanceHotelPaise), foodPaise: B(row.balanceFoodPaise) }, paid);
      assert.deepEqual([m.hotelLeftPaise, m.foodLeftPaise, m.excessHotelPaise, m.excessFoodPaise], [B(row.leftHotelPaise), B(row.leftFoodPaise), B(row.excessHotelPaise), B(row.excessFoodPaise)], JSON.stringify(row));
      assert.equal(m.hotelAdvanceText, row.debitHotelAdvance, JSON.stringify(row));
      assert.equal(m.foodAdvanceText, row.debitFoodAdvance, JSON.stringify(row));
    }
  });
  test("PHP's number text", () => {
    assert.deepEqual([B(0), B(100000), B(5025), B(5050), B(1), B(10)].map(phpNumberText), ["0", "1000", "50.25", "50.5", "0.01", "0.1"]);
  });
});
