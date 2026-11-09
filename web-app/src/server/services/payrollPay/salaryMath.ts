import "server-only";
import { paiseToRupees, phpRound, rupeesToPaise } from "../../money/phpFloat";

// The salary run's arithmetic, pure: a line-by-line port of Pallav's SalaryProcessor::processEmployee (:165-288), dailySalaryScheduleFor
// (:290-335), applyDeductions (:337-374), applyAdvances (:376-431), createCarryForward (:433-460) and OvertimeCalculator (:9-36). Pallav adds
// PHP floats and rounds with round(…, 2); this does the SAME float steps (JS numbers are the same doubles) with PHP 8.3's round, then stores
// paise. Golden: db/scripts/php/generate-payroll-pay-fixtures.php → fixtures/payroll-pay.json (128 months, real PHP). Spec: payroll-pay.md §3.

export interface MonthInput {
  year: number;
  month: number;
  salaryPaise: bigint;
  /** decimal(5,2) text. */
  dailyWorkingHours: string;
  entries: readonly { day: number; percentage: number; overtimeHours: string }[];
  /** "Salary" revisions dated inside the month, by effective date then id; values as stored (rupee text). */
  revisions: readonly { effectiveDate: string; previousValue: string | null; newValue: string | null }[];
  bonuses: readonly { id: string; type: "Bonus" | "Incentive"; amountPaise: bigint; remarks: string | null }[];
  /** The person's assignments in id order. */
  assignments: readonly { id: string; name: string | null; type: "One Time" | "Monthly"; amountPaise: bigint; isSettled: boolean }[];
  /** Unsettled advances by advance_date (then id). */
  advances: readonly { id: string; amountPaise: bigint; recoveredPaise: bigint; type: "One Time" | "Monthly"; deductionAmountPaise: bigint; remarks: string | null }[];
}

interface RunLine {
  category: "Deduction" | "Advance" | "Bonus" | "Incentive";
  label: string;
  type: string | null;
  amountPaise: bigint;
  pendingPaise: bigint;
  source: { type: "bonus_incentive" | "employee_deduction" | "advance"; id: string };
}

export interface MonthResult {
  daysInMonth: number;
  /** Days at 0, 25, 50, 75 and 100 per cent. */
  buckets: [number, number, number, number, number];
  payableDays: string;
  attendanceSalaryPaise: bigint;
  dailySalaryPaise: bigint;
  hourlyRatePaise: bigint;
  overtimeHours: string;
  overtimeAmountPaise: bigint;
  bonusPaise: bigint;
  incentivePaise: bigint;
  deductionPaise: bigint;
  advanceDeductedPaise: bigint;
  pendingAdvancePaise: bigint;
  netPaise: bigint;
  lines: RunLine[];
  /** One Time assignments this run settles. */
  settled: string[];
  /** Every advance the run touched: what it now shows as recovered; each is settled. */
  advances: { id: string; recoveredPaise: bigint }[];
  carry: { parentId: string; date: string; amountPaise: bigint; type: "One Time" | "Monthly"; deductionAmountPaise: bigint; remarks: string }[];
}

const BUCKETS = [0, 25, 50, 75, 100] as const;
const daysIn = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();
/** A decimal(…,2) column after a save, read back: HALF_UP of the float at 2 places. */
const col2 = (v: number): number => phpRound(v, 2);
const text2 = (v: number): string => col2(v).toFixed(2);
const pad = (n: number): string => String(n).padStart(2, "0");

export function salaryForMonth(s: MonthInput): MonthResult {
  const daysInMonth = daysIn(s.year, s.month);
  const salary = paiseToRupees(s.salaryPaise);
  const hours = Number(s.dailyWorkingHours);

  // dailySalaryScheduleFor: a revision this month pays its new rate from its effective date on
  const schedule = new Map<number, number>();
  if (s.revisions.length === 0) {
    for (let day = 1; day <= daysInMonth; day += 1) schedule.set(day, salary / daysInMonth);
  } else {
    let value = Number(s.revisions[0].previousValue ?? salary);
    let pointer = 0;
    let next = s.revisions[pointer];
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = `${s.year}-${pad(s.month)}-${pad(day)}`;
      while (next && date >= next.effectiveDate) {
        value = Number(next.newValue);
        pointer += 1;
        next = s.revisions[pointer];
      }
      schedule.set(day, value / daysInMonth);
    }
  }

  const counts = new Map<number, number>(BUCKETS.map((b) => [b, 0]));
  let overtimeHours = 0;
  let attendanceSalary = 0;
  for (const e of s.entries) {
    const percentage = Math.trunc(e.percentage);
    overtimeHours += Number(e.overtimeHours);
    if (!counts.has(percentage)) continue;
    counts.set(percentage, counts.get(percentage)! + 1);
    attendanceSalary += (schedule.get(e.day) ?? 0) * (percentage / 100);
  }
  attendanceSalary = phpRound(attendanceSalary, 2);
  let payableDays = 0;
  for (const b of BUCKETS) payableDays += counts.get(b)! * (b / 100);
  const dailySalary = daysInMonth > 0 ? salary / daysInMonth : 0;
  const hourlyRate = daysInMonth <= 0 || hours <= 0 ? 0 : salary / daysInMonth / hours;
  const overtimeAmount = phpRound(hourlyRate * overtimeHours, 2);

  let bonus = 0;
  let incentive = 0;
  for (const b of s.bonuses) {
    if (b.type === "Bonus") bonus += paiseToRupees(b.amountPaise);
    else incentive += paiseToRupees(b.amountPaise);
  }
  const lines: RunLine[] = s.bonuses.map((b) => ({ category: b.type, label: b.remarks || b.type, type: null, amountPaise: b.amountPaise, pendingPaise: BigInt(0), source: { type: "bonus_incentive", id: b.id } }));
  const gross = attendanceSalary + overtimeAmount + bonus + incentive;

  // applyDeductions
  let total = 0;
  const settled: string[] = [];
  for (const a of s.assignments) {
    if (a.type === "One Time" && a.isSettled) continue;
    const amount = paiseToRupees(a.amountPaise);
    if (amount <= 0) continue;
    total += amount;
    lines.push({ category: "Deduction", label: a.name ?? "Deduction", type: a.type, amountPaise: a.amountPaise, pendingPaise: BigInt(0), source: { type: "employee_deduction", id: a.id } });
    if (a.type === "One Time") settled.push(a.id);
  }
  const deductionTotal = phpRound(total, 2);
  const afterDeductions = Math.max(0, gross - deductionTotal);

  // applyAdvances + createCarryForward
  const nextMonth = s.month === 12 ? `${s.year + 1}-01-01` : `${s.year}-${pad(s.month + 1)}-01`;
  let remaining = afterDeductions;
  let totalDeducted = 0;
  let totalCarried = 0;
  const advances: MonthResult["advances"] = [];
  const carry: MonthResult["carry"] = [];
  for (const a of s.advances) {
    let recovered = paiseToRupees(a.recoveredPaise);
    const outstanding = Math.max(0, paiseToRupees(a.amountPaise) - recovered);
    if (!(outstanding > 0.001)) continue;
    const instalmentAmount = paiseToRupees(a.deductionAmountPaise);
    const instalment = a.type === "Monthly" ? Math.min(instalmentAmount, outstanding) : outstanding;
    const deducted = Math.max(0, Math.min(instalment, remaining));
    if (deducted > 0.001) {
      recovered += deducted;
      lines.push({ category: "Advance", label: a.remarks || "Salary Advance", type: a.type, amountPaise: rupeesToPaise(col2(phpRound(deducted, 2))), pendingPaise: rupeesToPaise(col2(phpRound(outstanding - deducted, 2))), source: { type: "advance", id: a.id } });
      remaining -= deducted;
      totalDeducted += deducted;
    }
    const remainder = outstanding - deducted;
    if (remainder > 0.001) {
      recovered += remainder;
      const amount = phpRound(remainder, 2);
      carry.push({ parentId: a.id, date: nextMonth, amountPaise: rupeesToPaise(amount), type: a.type, deductionAmountPaise: rupeesToPaise(col2(Math.min(instalmentAmount, amount))), remarks: `Carry Forward from Previous Month${a.remarks ? ` - ${a.remarks}` : ""}` });
      totalCarried += remainder;
    }
    advances.push({ id: a.id, recoveredPaise: rupeesToPaise(col2(recovered)) });
  }
  const advanceDeducted = phpRound(totalDeducted, 2);
  const pendingAdvance = phpRound(totalCarried, 2);
  const net = Math.max(0, afterDeductions - advanceDeducted);

  return {
    daysInMonth,
    buckets: BUCKETS.map((b) => counts.get(b)!) as MonthResult["buckets"],
    payableDays: text2(payableDays),
    attendanceSalaryPaise: rupeesToPaise(attendanceSalary),
    dailySalaryPaise: rupeesToPaise(phpRound(dailySalary, 2)),
    hourlyRatePaise: rupeesToPaise(phpRound(hourlyRate, 2)),
    overtimeHours: text2(overtimeHours),
    overtimeAmountPaise: rupeesToPaise(overtimeAmount),
    bonusPaise: rupeesToPaise(col2(bonus)),
    incentivePaise: rupeesToPaise(col2(incentive)),
    deductionPaise: rupeesToPaise(deductionTotal),
    advanceDeductedPaise: rupeesToPaise(advanceDeducted),
    pendingAdvancePaise: rupeesToPaise(pendingAdvance),
    netPaise: rupeesToPaise(phpRound(net, 2)),
    lines,
    settled,
    advances,
    carry,
  };
}
