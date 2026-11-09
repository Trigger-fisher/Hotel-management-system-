import "server-only";
import { paiseToNumber, type Paise } from "../../money/paise";
import type { StayBillRow } from "../../repos/reports";
import { rateOn } from "../billing/billRules";

// What the hotel owes Pallav Food for its guests' plan meals (Pallav Services/Reports/FoodPlanMonth.php): each bill's stay is read night by night, only the
// nights inside the window count, and every night is priced at the plan rate in force THAT night, per person. Plan rates are the plain meal price: no GST, and
// nothing from the guest's own bill enters the sum. Pure: the rows come from the repository, the rates from the plan-rate table. Spec: docs/specs/overview.md §2.

interface MealRateRow {
  plan: string;
  effectiveFrom: string;
  ratePaise: Paise;
}

interface NightRow {
  date: string;
  plan: string;
  persons: number;
  ratePaise: Paise;
  amountPaise: Paise;
}

interface FoodPlanPartDto {
  from: string;
  to: string;
  plan: string;
  persons: number;
  ratePaise: number;
  nights: number;
  amountPaise: number;
}

export interface FoodPlanRowDto {
  id: string;
  guest: string;
  company: string | null;
  room: string;
  bill: string;
  arrival: string;
  departure: string;
  plans: string[];
  persons: number[];
  ratesPaise: number[];
  nightCount: number;
  personNights: number;
  amountPaise: number;
  /** Nights of this stay that fall outside the window (another month's report). */
  outside: number;
  parts: FoodPlanPartDto[];
  /** Kept for the day sheet (one night's meals) and the totals; not part of the screen's row. */
  firstNight: string;
  lastNight: string;
}

export interface FoodPlanResult {
  plan: string | null;
  plans: string[];
  rows: FoodPlanRowDto[];
  byPlan: { plan: string; personNights: number; ratesPaise: number[]; amountPaise: number }[];
  totals: { guests: number; nights: number; personNights: number; amountPaise: number };
}

export const DAY_MS = 86_400_000;
export const shortRef = (reference: string | null): string | null => {
  if (!reference) return null;
  const parts = reference.split("/").map((p) => p.trim());
  return parts[parts.length - 1] || reference;
};

// A stay is walked night by night and the same few thousand dates come up for every bill, so the next day of a date is remembered (bounded).
const NEXT_DAY = new Map<string, string>();
function nextDay(d: string): string {
  let n = NEXT_DAY.get(d);
  if (n === undefined) {
    n = new Date(Date.parse(`${d}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
    if (NEXT_DAY.size > 50_000) NEXT_DAY.clear();
    NEXT_DAY.set(d, n);
  }
  return n;
}
const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** Shift a YYYY-MM-DD by whole months, clamping the day (a loose window: the exact nights are checked one by one). */
export function shiftMonths(date: string, n: number): string {
  const idx = Number(date.slice(0, 4)) * 12 + (Number(date.slice(5, 7)) - 1) + n;
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(Math.min(Number(date.slice(8, 10)), last)).padStart(2, "0")}`;
}

/** The stay as saved, or one part built from arrival, departure and plan (FoodPlanMonth::segments). */
function segmentsOf(bill: StayBillRow): { from: string; to: string; plan: string | null; persons: number }[] {
  if (bill.stay && bill.stay.length > 0) return bill.stay;
  if (!bill.arrivalDate || !bill.departureDate) return [];
  return [{ from: bill.arrivalDate, to: bill.departureDate, plan: bill.hotelPlan, persons: bill.persons || 1 }];
}

function partsOf(nights: readonly NightRow[]): FoodPlanPartDto[] {
  const parts: FoodPlanPartDto[] = [];
  for (const n of nights) {
    const last = parts[parts.length - 1];
    if (last && last.plan === n.plan.toUpperCase() && last.persons === n.persons && last.ratePaise === paiseToNumber(n.ratePaise) && nextDay(last.to) === n.date) {
      last.to = n.date;
      last.nights += 1;
      last.amountPaise += paiseToNumber(n.amountPaise);
    } else {
      parts.push({ from: n.date, to: n.date, plan: n.plan.toUpperCase(), persons: n.persons, ratePaise: paiseToNumber(n.ratePaise), nights: 1, amountPaise: paiseToNumber(n.amountPaise) });
    }
  }
  return parts;
}

/** FoodPlanMonth::build over the bills the repository found, for the nights from `start` to `end` inclusive. */
export function buildFoodPlan(bills: readonly StayBillRow[], rates: readonly MealRateRow[], start: string, end: string, plan: string | null): FoodPlanResult {
  const rows: FoodPlanRowDto[] = [];
  // The price of a plan on a night does not depend on the bill, and thousands of nights share a few hundred (plan, night) pairs.
  const priced = new Map<string, bigint>();
  const rateFor = (plan: string | null, night: string): bigint => {
    const key = `${plan ?? ""}\u0000${night}`;
    let rate = priced.get(key);
    if (rate === undefined) {
      rate = rateOn(rates, plan, night);
      priced.set(key, rate);
    }
    return rate;
  };
  for (const bill of bills) {
    const nights: NightRow[] = [];
    const segments = segmentsOf(bill).filter((s) => s.from && s.to);
    for (const s of segments) {
      const persons = Math.max(0, Math.trunc(s.persons || 0));
      // only the nights inside the window are walked (a stay typed with absurd dates cannot make the loop run for years)
      for (let night = s.from < start ? start : s.from; night < s.to && night <= end; night = nextDay(night)) {
        const rate = rateFor(s.plan, night);
        nights.push({ date: night, plan: s.plan ?? "", persons, ratePaise: rate, amountPaise: rate * BigInt(persons) });
      }
    }
    if (nights.length === 0) continue;
    const amount = nights.reduce((a, n) => a + n.amountPaise, BigInt(0));
    if (amount <= BigInt(0)) continue;
    const planNames = [...new Set(nights.map((n) => n.plan.toUpperCase()))];
    if (plan && !planNames.some((p) => p.toLowerCase() === plan.toLowerCase())) continue;
    const total = segments.reduce((a, s) => a + Math.max(0, daysBetween(s.from, s.to)), 0);
    rows.push({
      id: bill.id,
      guest: bill.guestName || "Guest",
      company: bill.companyName,
      room: bill.roomNumber ?? "",
      bill: shortRef(bill.billNumber) ?? "",
      arrival: segments.map((s) => s.from).sort()[0],
      departure: segments.map((s) => s.to).sort().reverse()[0],
      plans: planNames,
      persons: [...new Set(nights.map((n) => n.persons))],
      ratesPaise: [...new Set(nights.map((n) => paiseToNumber(n.ratePaise)))],
      nightCount: nights.length,
      personNights: nights.reduce((a, n) => a + n.persons, 0),
      amountPaise: paiseToNumber(amount),
      outside: total - nights.length,
      parts: partsOf(nights),
      firstNight: nights[0].date,
      lastNight: nights[nights.length - 1].date,
    });
  }
  rows.sort((a, b) => (a.firstNight < b.firstNight ? -1 : a.firstNight > b.firstNight ? 1 : a.room < b.room ? -1 : a.room > b.room ? 1 : 0));

  const byPlan = new Map<string, { personNights: number; rates: Set<number>; amountPaise: number }>();
  for (const row of rows) {
    for (const part of row.parts) {
      const entry = byPlan.get(part.plan) ?? { personNights: 0, rates: new Set<number>(), amountPaise: 0 };
      entry.personNights += part.persons * part.nights;
      entry.rates.add(part.ratePaise);
      entry.amountPaise += part.amountPaise;
      byPlan.set(part.plan, entry);
    }
  }
  const plans = [...new Set(rates.filter((r) => r.ratePaise > BigInt(0)).map((r) => r.plan.toUpperCase()))].sort();
  return {
    plan,
    plans,
    rows,
    byPlan: [...byPlan].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([p, v]) => ({ plan: p, personNights: v.personNights, ratesPaise: [...v.rates].sort((a, b) => a - b), amountPaise: v.amountPaise })),
    totals: { guests: rows.length, nights: rows.reduce((a, r) => a + r.nightCount, 0), personNights: rows.reduce((a, r) => a + r.personNights, 0), amountPaise: rows.reduce((a, r) => a + r.amountPaise, 0) },
  };
}
