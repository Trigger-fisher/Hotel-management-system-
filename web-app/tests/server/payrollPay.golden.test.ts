// Golden tests for the salary run: every expected value was produced by REAL PHP running verbatim copies of Pallav's SalaryProcessor and
// OvertimeCalculator arithmetic (db/scripts/php/generate-payroll-pay-fixtures.php → fixtures/payroll-pay.json), with PHP 8.3's round()
// (Pallav's live server). Then PHP's own round() (8.4 here) is shown to differ only on the documented exact ties. Also PHP 8.3 round itself.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { phpRound } from "../../src/server/money/phpFloat";
import { salaryForMonth, type MonthInput, type MonthResult } from "../../src/server/services/payrollPay/salaryMath";

type Money = string;
interface Run {
  daysInMonth: number;
  buckets: number[];
  payableDays: number;
  attendanceSalary: number;
  dailySalary: number;
  hourlyRate: number;
  overtimeHours: number;
  overtimeAmount: number;
  bonus: number;
  incentive: number;
  deduction: number;
  advanceDeducted: number;
  pendingAdvance: number;
  net: number;
  lines: { category: string; label: string; type: string | null; amount: number; pending: number }[];
  settled: number[];
  advances: { id: number; recovered: number; settled: boolean }[];
  carry: { parent: number; date: string; amount: number; type: string; deductionAmount: number; remarks: string }[];
}
interface Scenario {
  name: string;
  salary: Money;
  hours: Money;
  year: number;
  month: number;
  entries: [number, number, Money][];
  revisions: [string, Money | null, Money][];
  bonuses: ["Bonus" | "Incentive", Money, string][];
  assignments: [number, string | null, "One Time" | "Monthly", Money, boolean][];
  advances: [number, string, Money, Money, "One Time" | "Monthly", Money, string][];
  php83: Run;
  native: Run;
}
const fx = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "..", "common", "db", "scripts", "php", "fixtures", "payroll-pay.json"), "utf8")) as { php: string; scenarios: Scenario[] };
const paise = (rupees: Money | number): bigint => BigInt(Math.round(Number(rupees) * 100));

function input(s: Scenario): MonthInput {
  return {
    year: s.year,
    month: s.month,
    salaryPaise: paise(s.salary),
    dailyWorkingHours: s.hours,
    entries: s.entries.map(([day, percentage, ot]) => ({ day, percentage, overtimeHours: ot })),
    revisions: s.revisions.map(([effectiveDate, previousValue, newValue]) => ({ effectiveDate, previousValue, newValue })),
    bonuses: s.bonuses.map(([type, amount, remarks], i) => ({ id: `b${i}`, type, amountPaise: paise(amount), remarks })),
    assignments: s.assignments.map(([id, name, type, amount, isSettled]) => ({ id: String(id), name, type, amountPaise: paise(amount), isSettled })),
    advances: s.advances.map(([id, , amount, recovered, type, deductionAmount, remarks]) => ({ id: String(id), amountPaise: paise(amount), recoveredPaise: paise(recovered), type, deductionAmountPaise: paise(deductionAmount), remarks })),
  };
}

/** The PHP run in the engine's units (paise, text counts), for one deepEqual. */
function expected(r: Run): Omit<MonthResult, "lines"> & { lines: object[] } {
  return {
    daysInMonth: r.daysInMonth,
    buckets: r.buckets as MonthResult["buckets"],
    payableDays: r.payableDays.toFixed(2),
    attendanceSalaryPaise: paise(r.attendanceSalary),
    dailySalaryPaise: paise(r.dailySalary),
    hourlyRatePaise: paise(r.hourlyRate),
    overtimeHours: r.overtimeHours.toFixed(2),
    overtimeAmountPaise: paise(r.overtimeAmount),
    bonusPaise: paise(r.bonus),
    incentivePaise: paise(r.incentive),
    deductionPaise: paise(r.deduction),
    advanceDeductedPaise: paise(r.advanceDeducted),
    pendingAdvancePaise: paise(r.pendingAdvance),
    netPaise: paise(r.net),
    lines: r.lines.map((l) => ({ category: l.category, label: l.label, type: l.type, amountPaise: paise(l.amount), pendingPaise: paise(l.pending) })),
    settled: r.settled.map(String),
    advances: r.advances.map((a) => ({ id: String(a.id), recoveredPaise: paise(a.recovered) })),
    carry: r.carry.map((c) => ({ parentId: String(c.parent), date: c.date, amountPaise: paise(c.amount), type: c.type as "One Time" | "Monthly", deductionAmountPaise: paise(c.deductionAmount), remarks: c.remarks })),
  };
}

describe(`salary run golden (real PHP ${fx.php}, PHP 8.3 round)`, () => {
  test("PHP 8.3 round: exact decimal ties go up (1640.625 → 1640.63), the rest as PHP", () => {
    assert.equal(phpRound(1640.625, 2), 1640.63);
    assert.equal(phpRound(83.325, 2), 83.33);
    assert.equal(phpRound(-2.5), -3);
    assert.equal(phpRound(62.5), 63);
    assert.equal(phpRound(1.955, 2), 1.96);
    assert.equal(phpRound(0), 0);
  });

  test(`all ${fx.scenarios.length} months equal Pallav's run (buckets, rates, overtime, bonuses, deductions, advances, carry-forwards, net)`, () => {
    for (const s of fx.scenarios) {
      const got = salaryForMonth(input(s));
      const { lines, ...rest } = got;
      assert.deepEqual({ ...rest, lines: lines.map((l) => ({ category: l.category, label: l.label, type: l.type, amountPaise: l.amountPaise, pendingPaise: l.pendingPaise })) }, expected(s.php83), s.name);
    }
  });

  test("PHP 8.4's own round differs from 8.3 only on the exact ties", () => {
    const differ = fx.scenarios.filter((s) => JSON.stringify(s.php83) !== JSON.stringify(s.native)).map((s) => s.name);
    assert.ok(differ.includes("Pallav tie: 30000 over 28 days, 12.25 overtime hours (1640.625)"));
    assert.ok(differ.length <= 3, differ.join(", "));
  });
});
