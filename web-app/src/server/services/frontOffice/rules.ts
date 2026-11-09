import "server-only";
import { mulDecimal, percentOf } from "../../money/paise";
import type { AdvanceRecord } from "../../repos/billing";
import type { RoomRecord, StayRecord } from "../../repos/frontOffice";

// The pure rules of the front office, ported from Pallav and golden-tested against real PHP (db/scripts/php/fixtures/front-office.json):
// nights (FrontDesk::nights), the room charge (Stay::nights/roomCharge), a charge's amount, the check-out bill's GST and totals
// (Support/Pms/Billing.php:78-88), the advance taken off at check-out (:124-126), the mobile and address on a bill, the reservation
// reference, the website-enquiry rate, the board's occupancy and the room state. Money is bigint paise. Spec: docs/specs/front-office.md.

const ZERO = BigInt(0);
const DAY_MS = 86_400_000;
const IST_MS = 5.5 * 60 * 60 * 1000;

export const addDay = (date: string): string => new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);

/** FrontDesk::nights (:39-51): check-in up to, not including, check-out; at most 366. */
export function nightsOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d < to && out.length < 366; d = addDay(d)) out.push(d);
  return out;
}

/** The IST calendar date of an instant. */
export const istDate = (at: Date): string => new Date(at.getTime() + IST_MS).toISOString().slice(0, 10);

/** Stay::nights (Stay.php:59-64): from the check-in date to the check-out date (or today in house), at least one. */
export function stayNights(checkInAt: Date, until: Date): number {
  const days = Math.round((Date.parse(`${istDate(until)}T00:00:00Z`) - Date.parse(`${istDate(checkInAt)}T00:00:00Z`)) / DAY_MS);
  return Math.max(1, Math.trunc(days));
}

/** Stay::roomCharge (:66-69): nights x rate. */
export const roomCharge = (ratePaise: bigint, nights: number): bigint => ratePaise * BigInt(nights);

/** StayController.php:159 round(quantity x unit price, 2); the quantity is a decimal ("1.5"). */
export const chargeAmount = (quantity: string, unitPricePaise: bigint): bigint => mulDecimal(unitPricePaise, quantity);

interface CheckoutLines {
  roomPaise: bigint;
  extraBedPaise: bigint;
  laundryPaise: bigint;
  otherPaise: bigint;
  /** food + room service */
  foodPaise: bigint;
}

/** Billing.php:85-88: GST at the percent given on each side, then the totals. Percents are decimal text ("5", "2.5"). */
export function checkoutTotals(lines: CheckoutLines, hotelGstPercent: string, foodGstPercent: string) {
  const hotelBase = lines.roomPaise + lines.extraBedPaise + lines.laundryPaise + lines.otherPaise;
  const hotelGstPaise = percentOf(hotelBase, hotelGstPercent);
  const foodGstPaise = percentOf(lines.foodPaise, foodGstPercent);
  return { hotelGstPaise, foodGstPaise, hotelTotalPaise: hotelBase + hotelGstPaise, foodTotalPaise: lines.foodPaise + foodGstPaise };
}

/** Billing.php:124-126: the reservation's advance with the most money left that is not refunded (the first of equals). */
export function checkoutAdvance(advances: readonly AdvanceRecord[]): AdvanceRecord | null {
  let best: AdvanceRecord | null = null;
  for (const a of advances) {
    const left = a.hotelBalancePaise + a.foodBalancePaise;
    if (left <= ZERO || a.refundPaymentDate !== null) continue;
    if (!best || left > best.hotelBalancePaise + best.foodBalancePaise) best = a;
  }
  return best;
}

/** Billing.php:39, :95: digits and + only, at most 15; null when nothing was given. */
export const billMobile = (mobile: string | null): string | null => (mobile ? Array.from(mobile.replace(/[^0-9+]/g, "")).slice(0, 15).join("") : null);

/** Billing.php:98: "address, city", empty parts left out ("0" counts as empty, as PHP's array_filter), null when nothing. */
export const billAddress = (address: string | null, city: string | null): string | null => [address, city].filter((p) => p !== null && p !== "" && p !== "0").join(", ") || null;

/** Reservation.php:45: "RES-{yy}-{n padded to 5}". */
export const reservationReference = (year2: string, n: number): string => `RES-${year2}-${String(n).padStart(5, "0")}`;

/** The number at the end of a reference ("RES-26-00042" -> 42), or 0. */

/** FrontDesk.php:159-171: single price when at most one adult and a single price exists, else double; adults = max(1, guests − children). */
export function enquiryRate(guests: number | null, children: number | null, plan: { singlePaise: bigint | null; doublePaise: bigint } | null): { ratePaise: bigint; adults: number; children: number } {
  const g = Math.max(1, Math.trunc(guests ?? 0));
  const c = Math.trunc(children ?? 0);
  const ratePaise = !plan ? ZERO : g - c <= 1 && plan.singlePaise !== null && plan.singlePaise > ZERO ? plan.singlePaise : plan.doublePaise;
  return { ratePaise, adults: Math.max(1, g - c), children: c };
}

/** BoardController.php:149 */
export const occupancy = (occupied: number, inService: number): number => (inService ? Math.round((occupied * 100) / inService) : 0);

export type RoomState = "occupied" | "out_of_order" | "dirty" | "vacant";
/** Room::state (Room.php:39-47). */
export const roomState = (room: Pick<RoomRecord, "outOfOrder" | "hkStatus">, current: StayRecord | undefined): RoomState =>
  current ? "occupied" : room.outOfOrder ? "out_of_order" : room.hkStatus === "dirty" ? "dirty" : "vacant";

/** RoomController::bulk (:30-40): "101-110" (at most 200, end ≥ start) or single numbers cut to 20 characters; split on commas and spaces. */
export function parseRoomNumbers(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[,\s]+/).filter((p) => p !== "")) {
    const m = /^(\d+)-(\d+)$/.exec(part);
    if (m && Number(m[2]) >= Number(m[1]) && Number(m[2]) - Number(m[1]) < 200) for (let n = Number(m[1]); n <= Number(m[2]); n++) out.push(String(n));
    else out.push(Array.from(part).slice(0, 20).join(""));
  }
  return out;
}

/** FrontDesk::freeFor (:126-137): capacity minus the busiest night, never below 0; no nights -> 0. */
export function freeRooms(capacity: number, held: readonly { checkIn: string; checkOut: string; rooms: number }[], walkIns: readonly { from: string; until: string }[], from: string, to: string): number {
  const nights = nightsOf(from, to);
  if (nights.length === 0) return 0;
  const count = new Map(nights.map((n) => [n, 0]));
  for (const r of held) for (const n of nightsOf(r.checkIn, r.checkOut)) if (count.has(n)) count.set(n, (count.get(n) ?? 0) + Math.max(1, r.rooms));
  for (const w of walkIns) for (const n of nightsOf(w.from, w.until)) if (count.has(n)) count.set(n, (count.get(n) ?? 0) + 1);
  return Math.max(0, capacity - Math.max(...count.values()));
}
