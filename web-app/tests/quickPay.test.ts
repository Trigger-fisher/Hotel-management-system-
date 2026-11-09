// The pure part of the one-tap payment (common/ui-shared/dashboards/billing.ts): how an amount is laid over the hotel and food balances, what an in-house
// stay owes per side after its advance, and the settle call the Cash received sheet sends. Run with `node --test tests/quickPay.test.ts`.
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { describe, test } from "node:test";

type NextResolve = (specifier: string, context?: unknown) => unknown;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: unknown, next: NextResolve): unknown }): void;
};
const shared = new URL("../../common/ui-shared/", import.meta.url);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@shared/")) return next(new URL(`${specifier.slice("@shared/".length)}.ts`, shared).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const { quickPayInput, splitAfterAdvance, splitQuickPay, validateSettle } = await import("../../common/ui-shared/dashboards/billing.ts");

const bill = {
  balanceHotelPaise: 400_000,
  balanceFoodPaise: 56_000,
  settlement: null,
  referenceName: "Rajesh Patel",
  referenceMobile: "9876543210",
  version: 3,
};

describe("splitQuickPay", () => {
  test("the whole balance fills both sides", () => {
    assert.deepEqual(splitQuickPay(bill, 456_000), { hotelPaise: 400_000, foodPaise: 56_000 });
  });
  test("a part payment goes to the hotel side first", () => {
    assert.deepEqual(splitQuickPay(bill, 150_000), { hotelPaise: 150_000, foodPaise: 0 });
    assert.deepEqual(splitQuickPay(bill, 420_000), { hotelPaise: 400_000, foodPaise: 20_000 });
  });
  test("more than is owed stays on the hotel side", () => {
    assert.deepEqual(splitQuickPay(bill, 500_000), { hotelPaise: 444_000, foodPaise: 56_000 });
  });
  test("a food-only balance takes the food side first", () => {
    assert.deepEqual(splitQuickPay({ balanceHotelPaise: 0, balanceFoodPaise: 56_000 }, 56_000), { hotelPaise: 0, foodPaise: 56_000 });
    assert.deepEqual(splitQuickPay({ balanceHotelPaise: 0, balanceFoodPaise: 56_000 }, 60_000), { hotelPaise: 4_000, foodPaise: 56_000 });
  });
  test("never below zero, whole paise", () => {
    assert.deepEqual(splitQuickPay(bill, -5), { hotelPaise: 0, foodPaise: 0 });
    assert.deepEqual(splitQuickPay(bill, 100.6), { hotelPaise: 101, foodPaise: 0 });
  });
});

describe("splitAfterAdvance", () => {
  test("the advance comes off the hotel side first, then food", () => {
    assert.deepEqual(splitAfterAdvance(759_200, 67_200, 300_000), { hotelPaise: 459_200, foodPaise: 67_200 });
    assert.deepEqual(splitAfterAdvance(100_000, 50_000, 120_000), { hotelPaise: 0, foodPaise: 30_000 });
    assert.deepEqual(splitAfterAdvance(100_000, 50_000, 200_000), { hotelPaise: 0, foodPaise: 0 });
  });
  test("no advance leaves both sides as they are", () => {
    assert.deepEqual(splitAfterAdvance(100_000, 0, 0), { hotelPaise: 100_000, foodPaise: 0 });
  });
});

describe("quickPayInput", () => {
  test("one instalment dated today, the mode on the sides that carry money, the bill's reference and version", () => {
    const input = quickPayInput(bill, 456_000, "Cash", "2026-11-05");
    assert.deepEqual(input, {
      installments: [{ date: "2026-11-05", hotelPaise: 400_000, hotelMode: "Cash", foodPaise: 56_000, foodMode: "Cash" }],
      referenceName: "Rajesh Patel",
      referenceMobile: "9876543210",
      instruction: "",
      version: 3,
    });
    assert.deepEqual(validateSettle(input), {});
  });
  test("a side without money carries no mode", () => {
    const input = quickPayInput(bill, 150_000, "UPI", "2026-11-05");
    assert.deepEqual(input.installments, [{ date: "2026-11-05", hotelPaise: 150_000, hotelMode: "UPI", foodPaise: 0, foodMode: null }]);
  });
  test("a bill part paid before keeps the settlement's reference and instruction", () => {
    const paid = { ...bill, settlement: { installments: [], referenceName: "Accounts", referenceMobile: "9000000000", instruction: "Cheque 12", excessReceiptNo: null, recordedAt: "2026-11-01T05:00:00.000Z" } };
    const input = quickPayInput(paid, 56_000, "Cash", "2026-11-05");
    assert.equal(input.referenceName, "Accounts");
    assert.equal(input.referenceMobile, "9000000000");
    assert.equal(input.instruction, "Cheque 12");
  });
  test("a split typed by the desk is used as typed", () => {
    const input = quickPayInput(bill, 100_000, "Card", "2026-11-05", { hotelPaise: 40_000, foodPaise: 60_000 });
    assert.deepEqual(input.installments, [{ date: "2026-11-05", hotelPaise: 40_000, hotelMode: "Card", foodPaise: 60_000, foodMode: "Card" }]);
  });
  test("nothing received is refused by the shared check", () => {
    assert.ok(validateSettle(quickPayInput(bill, 0, "Cash", "2026-11-05"))["inst.0"]);
  });
});
