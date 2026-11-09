// Golden tests for Billing, Guest Advances: every expected value was produced by REAL PHP running Pallav's own BillMasterController and
// BillMasterAdvance (db/scripts/php/generate-billing-fixtures.php -> db/scripts/php/fixtures/billing-advances.json). Regenerate with:
//   php db/scripts/php/generate-billing-fixtures.php <pallav repo> > db/scripts/php/fixtures/billing-advances.json
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { advanceLogFields, WHOLE_KEYS } from "../../src/server/services/billing/advanceDto";
import { advanceLabel, advanceSides, advanceState, isRefunded, isUnused, readableField, receiptNumber, refundMath, reversalMath } from "../../src/server/services/billing/advanceRules";
import { istMoment } from "../../src/server/services/cash/ist";
import type { AdvanceRecord } from "../../src/server/repos/billing";

type P = number | null;
interface Fixture {
  advanceAmounts: { input: { hotel_amount: string | null; food_amount: string | null; hotel_mode: string | null; food_mode: string | null }; ok: boolean; hotelPaise: number; foodPaise: number; hotelBalancePaise: number; foodBalancePaise: number; totalPaise: number; hotelMode: string | null; foodMode: string | null }[];
  states: { hotelPaise: number; hotelBalancePaise: number; foodPaise: number; foodBalancePaise: number; refunded: boolean; isUnused: boolean; isRefunded: boolean }[];
  refunds: { hotelBalancePaise: number; foodBalancePaise: number; hotelRefundPaise: P; foodRefundPaise: P; refused: boolean; after: { hotelBalancePaise: number; foodBalancePaise: number; totalPaise: number } | null }[];
  reversals: { hotelBalancePaise: number; foodBalancePaise: number; hotelRefundPaise: P; foodRefundPaise: P; after: { hotelBalancePaise: number; foodBalancePaise: number; totalPaise: number } }[];
  receiptYears: { instant: string; typed: string; receipt: string }[];
  readable: Record<string, string>;
  label: string;
  whole: Record<string, string | number>;
  entryNumbers: { n: number; text: string }[];
}
const fx = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "..", "common", "db", "scripts", "php", "fixtures", "billing-advances.json"), "utf8")) as Fixture;
const B = (n: P): bigint | null => (n === null ? null : BigInt(n));

/** The PHP input as the apps send it: whole paise, or nothing. A value that is not whole paise ("0.005", "1e3") is refused by the input schema. */
function asPaise(text: string | null): { ok: true; value: bigint | null } | { ok: false } {
  if (text === null || text === "") return { ok: true, value: null };
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) return { ok: false };
  return { ok: true, value: BigInt(Math.round(Number(text) * 100)) };
}

describe("the two sides of an advance (BillMasterController::advanceAmounts, real PHP)", () => {
  test("every whole-paise case matches: amounts, balances, total, modes and 'nothing paid'", () => {
    let compared = 0;
    for (const row of fx.advanceAmounts) {
      const h = asPaise(row.input.hotel_amount);
      const f = asPaise(row.input.food_amount);
      if (!h.ok || !f.ok) continue;
      // Pallav's form sends only the sides the advance is for: a side the PHP case left out is not covered
      const covers = h.value === null && f.value !== null ? "food" : f.value === null && h.value !== null ? "hotel" : "both";
      const out = advanceSides({ covers, hotelPaise: h.value, foodPaise: f.value, hotelMode: row.input.hotel_mode, foodMode: row.input.food_mode });
      const label = JSON.stringify(row.input);
      assert.equal(out.paid, row.ok, label);
      assert.equal(out.hotelAmountPaise, BigInt(row.hotelPaise), label);
      assert.equal(out.foodAmountPaise, BigInt(row.foodPaise), label);
      assert.equal(out.hotelBalancePaise, BigInt(row.hotelBalancePaise), label);
      assert.equal(out.foodBalancePaise, BigInt(row.foodBalancePaise), label);
      assert.equal(out.totalPaise, BigInt(row.totalPaise), label);
      assert.equal(out.hotelMode, row.hotelMode, label);
      assert.equal(out.foodMode, row.foodMode, label);
      compared += 1;
    }
    assert.ok(compared >= 28, `compared ${compared} cases`);
  });
  test("a side the form did not cover is 0 even when an amount was sent for it", () => {
    const out = advanceSides({ covers: "hotel", hotelPaise: BigInt(1000), foodPaise: BigInt(500), hotelMode: "UPI", foodMode: "Cash" });
    assert.equal(out.foodAmountPaise, BigInt(0));
    assert.equal(out.foodMode, null);
    assert.equal(out.totalPaise, BigInt(1000));
  });
});

describe("isUnused / isRefunded (BillMasterAdvance, real PHP)", () => {
  test(`all ${fx.states.length} stored states match`, () => {
    for (const s of fx.states) {
      const money = { hotelAmountPaise: BigInt(s.hotelPaise), hotelBalancePaise: BigInt(s.hotelBalancePaise), foodAmountPaise: BigInt(s.foodPaise), foodBalancePaise: BigInt(s.foodBalancePaise), refundPaymentDate: s.refunded ? "2026-10-01" : null };
      assert.equal(isUnused(money), s.isUnused, JSON.stringify(s));
      assert.equal(isRefunded(money), s.isRefunded, JSON.stringify(s));
    }
  });
  test("the screen's status follows from them", () => {
    const base = { hotelAmountPaise: BigInt(1000), foodAmountPaise: BigInt(0), hotelBalancePaise: BigInt(1000), foodBalancePaise: BigInt(0), refundPaymentDate: null };
    assert.equal(advanceState(base), "unused");
    assert.equal(advanceState({ ...base, hotelBalancePaise: BigInt(400) }), "partly");
    assert.equal(advanceState({ ...base, hotelBalancePaise: BigInt(0) }), "used");
    assert.equal(advanceState({ ...base, refundPaymentDate: "2026-10-01" }), "refunded");
  });
});

describe("refund and its reversal (BillMasterController.php:256-265, :280-283, real PHP)", () => {
  test(`all ${fx.refunds.length} refunds: refused above the balance, else balances and total as PHP`, () => {
    for (const r of fx.refunds) {
      const math = refundMath({ hotelBalancePaise: BigInt(r.hotelBalancePaise), foodBalancePaise: BigInt(r.foodBalancePaise) }, { hotelPaise: B(r.hotelRefundPaise), foodPaise: B(r.foodRefundPaise) });
      assert.equal(math.overBalance, r.refused, JSON.stringify(r));
      if (r.after) {
        assert.equal(math.hotelBalancePaise, BigInt(r.after.hotelBalancePaise), JSON.stringify(r));
        assert.equal(math.foodBalancePaise, BigInt(r.after.foodBalancePaise), JSON.stringify(r));
        assert.equal(math.totalPaise, BigInt(r.after.totalPaise), JSON.stringify(r));
      }
    }
    assert.ok(fx.refunds.some((r) => r.refused) && fx.refunds.some((r) => !r.refused));
  });
  test(`all ${fx.reversals.length} reversals`, () => {
    for (const r of fx.reversals) {
      const back = reversalMath({ hotelBalancePaise: BigInt(r.hotelBalancePaise), foodBalancePaise: BigInt(r.foodBalancePaise), hotelRefundAmountPaise: B(r.hotelRefundPaise), foodRefundAmountPaise: B(r.foodRefundPaise) });
      assert.deepEqual(back, { hotelBalancePaise: BigInt(r.after.hotelBalancePaise), foodBalancePaise: BigInt(r.after.foodBalancePaise), totalPaise: BigInt(r.after.totalPaise) }, JSON.stringify(r));
    }
  });
});

describe("the receipt number (date('Y').' / '.$number, in IST)", () => {
  test(`all ${fx.receiptYears.length} cases, the IST new year included`, () => {
    for (const r of fx.receiptYears) assert.equal(receiptNumber(istMoment(new Date(r.instant)).date.slice(0, 4), r.typed), r.receipt, r.instant);
    assert.ok(fx.receiptYears.some((r) => r.instant === "2026-12-31T18:30:00Z" && r.receipt.startsWith("2027 / ")));
  });
});

describe("the system log's words (BillMasterController::readable / advanceLabel / whole, real PHP)", () => {
  test("every column reads as Pallav writes it", () => {
    for (const [readable] of Object.entries(fx.readable)) {
      const column = readable.toLowerCase().replace(/ /g, "_");
      assert.equal(readableField(column), readable);
    }
  });
  test("the label", () => assert.equal(advanceLabel("2026 / 814", "Ravi Mehta"), fx.label));
  test("`whole` leaves out empty fields and shows the date as d-m-Y (money in paise in HMS)", () => {
    const rec = {
      receiptNumber: "2026 / 814", guestName: "Ravi Mehta", mobileNumber: null, paymentDate: "2026-10-05", refundPaymentDate: null,
      hotelAmountPaise: BigInt(100000), foodAmountPaise: BigInt(0), hotelMode: "UPI", foodMode: null, totalPaise: BigInt(100000), entryNo: 7,
    } as unknown as AdvanceRecord;
    const out = advanceLogFields(rec, WHOLE_KEYS);
    // the same keys and order as PHP; amounts are paise here (PHP shows "1000.00")
    assert.deepEqual(Object.keys(out), Object.keys(fx.whole));
    assert.equal(out["Payment date"], fx.whole["Payment date"]);
    assert.equal(out["Hotel amount"], 100000);
    assert.equal(out["Food amount"], 0);
    assert.equal(out["Entry no"], fx.whole["Entry no"]);
  });
  test("entry numbers are four digits", () => {
    for (const e of fx.entryNumbers) assert.equal(String(e.n).padStart(4, "0"), e.text);
  });
});
