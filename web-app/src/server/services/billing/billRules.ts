import "server-only";
import { atLeastZero } from "../../money/paise";
import type { PricedStayPart } from "../../repos/billing";

// The pure rules of a bill, ported from Pallav and golden-tested against the real PHP (db/scripts/php/fixtures/billing-bills.json): the totals
// (prepareBill, :377-383), the stay priced night by night (MealPlanRate::price, MealPlanRate.php:39-87), the advance taken off a new bill
// (:433-441), the debit balances (:443-444) and the settlement (:525-546). Money is bigint paise. Spec: docs/specs/billing-bills.md.

const ZERO = BigInt(0);
const HUNDRED = BigInt(100);

export interface HotelLines {
  roomPaise: bigint;
  planPaise: bigint;
  extraBedPaise: bigint;
  laundryPaise: bigint;
  otherPaise: bigint;
  gstPaise: bigint;
}
export interface FoodLines {
  foodPaise: bigint;
  planPaise: bigint;
  laundryPaise: bigint;
  gstPaise: bigint;
}

/** :380 every hotel line, Extra Bed and V.P.O. included, plus the typed GST amount. */
export const hotelTotal = (h: HotelLines): bigint => h.roomPaise + h.planPaise + h.extraBedPaise + h.laundryPaise + h.otherPaise + h.gstPaise;
/** :381 */
export const foodTotal = (f: FoodLines): bigint => f.foodPaise + f.planPaise + f.laundryPaise + f.gstPaise;

export interface MealRate {
  plan: string;
  effectiveFrom: string;
  ratePaise: bigint;
}

export interface StayPart {
  from: string;
  to: string;
  plan: string | null;
  persons: number;
}

const nextDay = (date: string): string => {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return t.toISOString().slice(0, 10);
};

/** MealPlanRate::rateOn: the latest rate of the plan (case-insensitive) that had started by that night; 0 when none. `rates` oldest first. */
export function rateOn(rates: readonly MealRate[], plan: string | null, night: string): bigint {
  const key = (plan ?? "").toLowerCase();
  let rate = ZERO;
  for (const r of rates) if (r.plan.toLowerCase() === key && r.effectiveFrom <= night) rate = r.ratePaise;
  return rate;
}

/** MealPlanRate::price: each part night by night; a part without from or to is dropped first (prepareBill :396). */
export function priceStay(parts: readonly StayPart[], rates: readonly MealRate[]): { segments: PricedStayPart[]; totalPaise: bigint } {
  const segments: PricedStayPart[] = [];
  let total = ZERO;
  for (const part of parts) {
    if (!part.from || !part.to) continue;
    const persons = BigInt(Math.max(0, Math.trunc(part.persons)));
    const nightly: bigint[] = [];
    let amount = ZERO;
    for (let night = part.from; night < part.to; night = nextDay(night)) {
      const rate = rateOn(rates, part.plan, night);
      nightly.push(rate);
      amount += rate * persons;
    }
    total += amount;
    segments.push({
      from: part.from,
      to: part.to,
      plan: part.plan ?? "",
      persons: Number(persons),
      nights: nightly.length,
      // count(array_unique($rates)) === 1: one rate for every night; none (no nights) or several is null
      ratePaise: new Set(nightly.map(String)).size === 1 ? nightly[0] : null,
      amountPaise: amount,
    });
  }
  return { segments, totalPaise: total };
}

export const isDebit = (mode: string | null): boolean => (mode ?? "").toLowerCase() === "debit";

export interface Taken {
  hotelPaise: bigint;
  foodPaise: bigint;
  /** The advance's balances after the bill. */
  hotelLeftPaise: bigint;
  foodLeftPaise: bigint;
}

/**
 * :433-439 what a new bill takes off an advance: min(balance, total) per side, and the advance keeps max(0, balance − total).
 * HMS deviation (billing-bills.md §11.1): a side whose total is ≤ 0 takes nothing and leaves the balance as it was (Pallav would raise it).
 */
export function takeAdvance(balances: { hotelBalancePaise: bigint; foodBalancePaise: bigint }, totals: { hotelPaise: bigint; foodPaise: bigint }): Taken {
  const side = (balance: bigint, total: bigint): [bigint, bigint] => (total <= ZERO ? [ZERO, balance] : [balance < total ? balance : total, atLeastZero(balance - total)]);
  const [hotel, hotelLeft] = side(balances.hotelBalancePaise, totals.hotelPaise);
  const [food, foodLeft] = side(balances.foodBalancePaise, totals.foodPaise);
  return { hotelPaise: hotel, foodPaise: food, hotelLeftPaise: hotelLeft, foodLeftPaise: foodLeft };
}

/** :443-444 a side on Debit owes its total, otherwise 0. With quirk (a) off, a debit side owes its total less the advance taken off it. */
export function debitBalances(args: { hotelMode: string | null; foodMode: string | null; hotelTotalPaise: bigint; foodTotalPaise: bigint; takenHotelPaise: bigint; takenFoodPaise: bigint; ignoreAdvance: boolean }): { hotelPaise: bigint; foodPaise: bigint } {
  const owed = (mode: string | null, total: bigint, taken: bigint): bigint => (!isDebit(mode) ? ZERO : args.ignoreAdvance ? atLeastZero(total) : atLeastZero(total - taken));
  return { hotelPaise: owed(args.hotelMode, args.hotelTotalPaise, args.takenHotelPaise), foodPaise: owed(args.foodMode, args.foodTotalPaise, args.takenFoodPaise) };
}

interface SettleMath {
  hotelLeftPaise: bigint;
  foodLeftPaise: bigint;
  /** Paid above what was owed: becomes the excess advance. */
  excessHotelPaise: bigint;
  excessFoodPaise: bigint;
  /** debit_hotel_advance / debit_food_advance as PHP writes the number into the text column: "1000", "50.25", "0". */
  hotelAdvanceText: string;
  foodAdvanceText: string;
}

/** :525-546 */
export function settleMath(balances: { hotelPaise: bigint; foodPaise: bigint }, paid: { hotelPaise: bigint; foodPaise: bigint }): SettleMath {
  const hotelRemaining = balances.hotelPaise - paid.hotelPaise;
  const foodRemaining = balances.foodPaise - paid.foodPaise;
  const excessHotel = atLeastZero(-hotelRemaining);
  const excessFood = atLeastZero(-foodRemaining);
  return {
    hotelLeftPaise: atLeastZero(hotelRemaining),
    foodLeftPaise: atLeastZero(foodRemaining),
    excessHotelPaise: excessHotel,
    excessFoodPaise: excessFood,
    hotelAdvanceText: phpNumberText(excessHotel),
    foodAdvanceText: phpNumberText(excessFood),
  };
}

/** PHP's (string) of a float of rupees, for a whole number of paise: no trailing zeros ("1000", "50.5", "50.25", "0"). */
export function phpNumberText(paise: bigint): string {
  const negative = paise < ZERO;
  const abs = negative ? -paise : paise;
  const rupees = abs / HUNDRED;
  const rest = abs % HUNDRED;
  const fraction = rest === ZERO ? "" : `.${String(rest).padStart(2, "0").replace(/0$/, "")}`;
  return `${negative ? "-" : ""}${rupees}${fraction}`;
}

/** :549 */
export const excessReceipt = (billNumber: string): string => `Excessive / ${billNumber}`;
/** :50-53 */
export const billLabel = (billNumber: string, guestName: string): string => `${billNumber} (${guestName})`;
