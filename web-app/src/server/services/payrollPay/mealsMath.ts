import "server-only";
import { phpRound } from "../../money/phpFloat";

// The staff-meals bill's arithmetic, pure: a line-by-line port of Pallav's Support/FoodCharges.php rateOn (:27-34), countedDays (:131-176), the
// per-person rows of statement (:213-238), pricesIn (:263-277) and note (:279-307), with EmployeeMealPeriod::covers. Days are "YYYY-MM-DD"
// strings (compared as text); amounts are PHP floats of rupees, rounded with PHP 8.3's round. Golden: generate-payroll-meals-fixtures.php.

export interface PriceRow {
  effectiveFrom: string;
  /** Rupees as PHP reads decimal(…,2). */
  amount: number;
}
interface PeriodRow {
  startsOn: string;
  endsOn: string | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number): string => String(n).padStart(2, "0");
export const daysIn = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();
const dayOf = (year: number, month: number, day: number): string => `${year}-${pad(month)}-${pad(day)}`;
/** Carbon format('j M'): "8 Sep". */
const jM = (date: string): string => `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;

/** The monthly price in force on a day (the last one starting on or before it), or null before any price. */
export function rateOn(day: string, rates: readonly PriceRow[]): number | null {
  let hit: number | null = null;
  for (const r of rates) if (r.effectiveFrom <= day) hit = r.amount;
  return hit;
}

const covers = (p: PeriodRow, day: string): boolean => p.startsOn <= day && (p.endsOn === null || p.endsOn >= day);

/** countedDays (:131-176): the day numbers of the month charged. */
function countedDays(year: number, month: number, joined: string | null, lastWorkingDay: string | null, skipped: readonly number[], periods: readonly PeriodRow[] | null, until: string | null): number[] {
  let from = dayOf(year, month, 1);
  let to = dayOf(year, month, daysIn(year, month));
  if (until !== null && until < to) to = until;
  if (periods === null) {
    if (joined !== null && joined > from) from = joined;
    if (lastWorkingDay !== null && lastWorkingDay < to) to = lastWorkingDay;
  }
  const out: number[] = [];
  for (let d = 1; d <= daysIn(year, month); d += 1) {
    const day = dayOf(year, month, d);
    if (day < from || day > to) continue;
    if (skipped.includes(d)) continue;
    if (periods !== null && !periods.some((p) => covers(p, day) && (p.endsOn !== null || lastWorkingDay === null || day <= lastWorkingDay))) continue;
    out.push(d);
  }
  return out;
}

/** pricesIn (:263-277): "3,000 until 14 Sep, then 3,500". */
export function pricesIn(year: number, month: number, rates: readonly PriceRow[]): { from: string; amount: number }[] {
  const start = dayOf(year, month, 1);
  const end = dayOf(year, month, daysIn(year, month));
  const opening = rateOn(start, rates);
  const out = opening !== null ? [{ from: start, amount: opening }] : [];
  for (const r of rates) if (r.effectiveFrom > start && r.effectiveFrom <= end) out.push({ from: r.effectiveFrom, amount: r.amount });
  return out;
}

/** note (:279-307) */
export function note(year: number, month: number, periods: readonly PeriodRow[], joined: string | null, left: string | null, leftOut: number): string | null {
  const start = dayOf(year, month, 1);
  const end = dayOf(year, month, daysIn(year, month));
  const ym = start.slice(0, 7);
  const parts: string[] = [];
  if (joined !== null && joined.slice(0, 7) === ym) parts.push(`joined ${jM(joined)}`);
  if (left !== null && left.slice(0, 7) === ym && periods.some((p) => p.endsOn === null)) parts.push(`left ${jM(left)}`);
  // sortBy('starts_on') is stable
  for (const p of [...periods].sort((a, b) => (a.startsOn < b.startsOn ? -1 : a.startsOn > b.startsOn ? 1 : 0))) {
    if (p.startsOn > start && p.startsOn <= end) parts.push(`meals from ${jM(p.startsOn)}`);
    if (p.endsOn !== null && p.endsOn >= start && p.endsOn < end) parts.push(`meals until ${jM(p.endsOn)}`);
  }
  if (leftOut > 0) parts.push(`${leftOut} ${leftOut === 1 ? "day" : "days"} not counted`);
  return parts.length ? parts.join(", ") : null;
}

/** One person's row of statement (:213-238). */
export function mealRow(x: { year: number; month: number; joined: string | null; left: string | null; skipped: readonly number[]; periods: readonly PeriodRow[] | null; until: string | null; rates: readonly PriceRow[] }) {
  const days = daysIn(x.year, x.month);
  const counted = countedDays(x.year, x.month, x.joined, x.left, x.skipped, x.periods, x.until);
  let total = 0;
  for (const d of counted) total += (rateOn(dayOf(x.year, x.month, d), x.rates) ?? 0) / days;
  const leftOut = countedDays(x.year, x.month, x.joined, x.left, [], x.periods, x.until).length - counted.length;
  return { days: counted.length, counted, leftOut, amount: phpRound(total, 2), note: note(x.year, x.month, x.periods ?? [], x.joined, x.left, leftOut) };
}
