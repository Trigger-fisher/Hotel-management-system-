// Golden tests for the money module. Each case names the Pallav code its numbers come from; the expected
// values are what PHP's round($x, 2) gives for the same inputs (halves away from zero).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  MoneyError,
  add,
  atLeastZero,
  divRound,
  formatInr,
  fromRupees,
  mulBps,
  mulDecimal,
  paiseToNumber,
  percentOf,
  ratio,
  sub,
  sum,
  toPaise,
  toRupeeString,
} from "../../src/server/money/paise";

const p = (n: number | string): bigint => toPaise(n);

describe("rounding (PHP round(), halves away from zero)", () => {
  test("divRound", () => {
    assert.equal(divRound(p(5), p(2)), p(3)); // 2.5 -> 3
    assert.equal(divRound(p(-5), p(2)), p(-3)); // -2.5 -> -3
    assert.equal(divRound(p(5), p(-2)), p(-3));
    assert.equal(divRound(p(-5), p(-2)), p(3));
    assert.equal(divRound(p(7), p(3)), p(2)); // 2.33 -> 2
    assert.equal(divRound(p(8), p(3)), p(3)); // 2.67 -> 3
    assert.equal(divRound(p(0), p(7)), p(0));
    assert.throws(() => divRound(p(1), p(0)), MoneyError);
  });
});

describe("amount x decimal factor", () => {
  // Pms/Stay.php roomCharge(): round(nights * rate, 2)
  test("room charge: 3 nights x Rs 1,499.50", () => {
    assert.equal(mulDecimal(p(149950), "3"), p(449850));
  });
  // Http/Controllers/Pms/StayController.php:159: round(quantity * unit_price, 2)
  test("charge line: 2.5 x Rs 33.33 = 83.325 -> Rs 83.33 (half away, as PHP 8.3 gives; PHP 8.4 gives 83.32, see paise.php.test.ts)", () => {
    assert.equal(mulDecimal(p(3333), "2.5"), p(8333));
  });
  test("charge line: 0.125 x Rs 10.00 = 1.25", () => {
    assert.equal(mulDecimal(p(1000), "0.125"), p(125));
  });
  test("negative factor rounds away from zero", () => {
    assert.equal(mulDecimal(p(3333), "-2.5"), p(-8333));
  });
  test("rejects exponents, commas, spaces and long input", () => {
    for (const bad of ["1e3", "1,5", " 2", "2 ", "", "abc", "1.", ".5", "0.1234567891", "9".repeat(31)]) {
      assert.throws(() => mulDecimal(p(100), bad), MoneyError, `should reject ${JSON.stringify(bad)}`);
    }
  });
});

describe("percentages and basis points", () => {
  test("18 % of Rs 1,000.00 = Rs 180.00", () => {
    assert.equal(percentOf(p(100000), "18"), p(18000));
  });
  test("12 % of Rs 999.99 = 119.9988 -> Rs 120.00", () => {
    assert.equal(percentOf(p(99999), "12"), p(12000));
  });
  test("2.5 % of Rs 1.00 = 2.5 paise -> 3 paise (half away)", () => {
    assert.equal(percentOf(p(100), "2.5"), p(3));
  });
  test("basis points: 1800 bp of Rs 250.50", () => {
    assert.equal(mulBps(p(25050), 1800), p(4509)); // 4509.0
    assert.equal(mulBps(p(1), 5000), p(1)); // 0.5 -> 1
    assert.throws(() => mulBps(p(100), 1.5), MoneyError);
  });
});

describe("one rounding at the end", () => {
  // Services/Payroll/OvertimeCalculator.php: round(salary / daysInMonth / dailyWorkingHours * overtimeHours, 2)
  test("overtime: salary Rs 15,000 / 30 days / 8 h x 5 h = Rs 312.50", () => {
    // paise: 1,500,000 x 5 / (30 x 8) = 31250
    assert.equal(ratio(p(1500000), BigInt(5), BigInt(240)), p(31250));
  });
  test("overtime: salary Rs 12,345.67 / 31 days / 9 h x 2.5 h = Rs 110.62 (rounded once, not per step)", () => {
    // 1,234,567 x 2.5 / (31 x 9) = 1,234,567 x 5 / 558 = 11062.4 paise -> 11062
    assert.equal(ratio(p(1234567), BigInt(5), BigInt(558)), p(11062));
  });
  // Models/SalaryProcessing.php outstanding(): max(0, round(net - paid, 2))
  test("outstanding never goes below zero", () => {
    assert.equal(atLeastZero(sub(p(100000), p(120000))), p(0));
    assert.equal(atLeastZero(sub(p(120000), p(100000))), p(20000));
  });
});

describe("rupee text <-> paise", () => {
  // The import converts Pallav's decimal(10,2) columns; round($x, 2) on anything with a third decimal.
  test("fromRupees", () => {
    assert.equal(fromRupees("1234.56"), p(123456));
    assert.equal(fromRupees("0.005"), p(1)); // half away
    assert.equal(fromRupees("-0.005"), p(-1));
    assert.equal(fromRupees("10"), p(1000));
    assert.equal(fromRupees("1.004"), p(100));
    assert.throws(() => fromRupees("12,345.00"), MoneyError);
  });
  test("toRupeeString", () => {
    assert.equal(toRupeeString(p(123456)), "1234.56");
    assert.equal(toRupeeString(p(-5)), "-0.05");
    assert.equal(toRupeeString(p(0)), "0.00");
  });
  test("round trip", () => {
    for (const n of [0, 1, 99, 100, 101, 123456789, -250]) assert.equal(fromRupees(toRupeeString(p(n))), p(n));
  });
});

describe("formatting (same text as ui-shared formatINR)", () => {
  test("Indian grouping", () => {
    assert.equal(formatInr(p(12345600)), "₹1,23,456.00");
    assert.equal(formatInr(p(50000)), "₹500.00");
    assert.equal(formatInr(p(-50000)), "-₹500.00");
    assert.equal(formatInr(p(5)), "₹0.05");
    assert.equal(formatInr(p(123456789), { decimals: false }), "₹12,34,567");
  });
});

describe("whole numbers only, no floats, safe at the JSON edge", () => {
  test("toPaise", () => {
    assert.equal(toPaise(12), BigInt(12));
    assert.equal(toPaise("-7"), BigInt(-7));
    for (const bad of [1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1.5", "1e3", "", "12a", "0x10"]) {
      assert.throws(() => toPaise(bad), MoneyError, `should reject ${String(bad)}`);
    }
  });
  test("add, sum and no precision loss beyond 2^53", () => {
    assert.equal(add(p(1), p(2)), p(3));
    assert.equal(sum([p(100), p(250), p(-50)]), p(300));
    const big = toPaise("9007199254740993"); // 2^53 + 1 cannot be held by a JS number
    assert.equal(add(big, p(1)), toPaise("9007199254740994"));
    assert.throws(() => paiseToNumber(big), MoneyError);
    assert.equal(paiseToNumber(p(4200)), 4200);
  });
});
