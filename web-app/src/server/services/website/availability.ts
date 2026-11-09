import "server-only";

// The website's availability (Pallav Support/Site/Availability.php), pure: the nights a stay occupies, capacity, sold, free and blocked per
// night, the rolling open window, the first night with no room left, the blocked stretches, and the calendar's inventory rule. Every function takes
// the rows the three reads of `room()` would return, so the arithmetic is golden against real PHP (db/scripts/php/generate-website-fixtures.php)
// and the same function serves the calendar, the public check and the confirm gate. Dates are "YYYY-MM-DD" (a night is the day it starts).
// Spec: docs/specs/website.md §2.

/** The longest stay considered, in nights (also caps what a crafted request can ask for). */
const MAX_STAY_NIGHTS = 60;
/** How far ahead a date is open with nothing set: today through this many months; beyond it a date is closed until an admin opens it. */
const OPEN_WINDOW_MONTHS = 3;

const DAY_MS = 86_400_000;
const ms = (day: string): number => Date.parse(`${day}T00:00:00Z`);
const text = (t: number): string => new Date(t).toISOString().slice(0, 10);
export const addDays = (day: string, n: number): string => text(ms(day) + n * DAY_MS);
const isDay = (d: string | null | undefined): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && text(ms(d)) === d;

/** stayNights (:22-39): check-in through the night before check-out; empty when missing, reversed, or longer than 60 nights. */
export function stayNights(checkIn: string | null, checkOut: string | null): string[] {
  if (!isDay(checkIn) || !isDay(checkOut)) return [];
  const start = ms(checkIn);
  const end = ms(checkOut);
  if (end <= start || end - start > MAX_STAY_NIGHTS * DAY_MS) return [];
  const nights: string[] = [];
  for (let cursor = start; cursor < end; cursor += DAY_MS) nights.push(text(cursor));
  return nights;
}

/** Carbon::addMonthsNoOverflow: the same day of the month N months on, clamped to that month's last day. */
export function addMonthsNoOverflow(day: string, months: number): string {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7)) - 1 + months;
  const year = y + Math.floor(m / 12);
  const month = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return text(Date.UTC(year, month, Math.min(Number(day.slice(8, 10)), last)));
}

export interface NightState {
  capacity: number;
  sold: number;
  free: number;
  blocked: boolean;
}

export interface RoomInput {
  today: string;
  /** The category's rooms when nothing is set: the real rooms in service when the front office has them, else the category's total. */
  defaultCapacity: number;
  /** The calendar's own row for a night. */
  overrides: ReadonlyMap<string, { roomsLeft: number; blocked: boolean }>;
  /** Confirmed website enquiries of the room overlapping the range. */
  stays: readonly { checkIn: string; checkOut: string }[];
  /** Front-office reservations (not website ones) and walk-ins holding rooms, per night. */
  held: ReadonlyMap<string, number>;
  nights: readonly string[];
  /** The rolling default closing: right for the calendar and the public check, wrong when deciding on a request a guest already sent. */
  respectOpenWindow: boolean;
}

/** room() (:72-143): per night capacity, sold, free and blocked. */
export function roomNights(i: RoomInput): Record<string, NightState> {
  if (i.nights.length === 0) return {};
  const openThrough = addMonthsNoOverflow(i.today, OPEN_WINDOW_MONTHS);
  const from = i.nights[0];
  const to = i.nights[i.nights.length - 1];
  const sold = new Map(i.nights.map((n) => [n, 0]));
  for (const stay of i.stays) {
    if (!(stay.checkIn <= to && stay.checkOut > from)) continue;
    for (const night of stayNights(stay.checkIn, stay.checkOut)) if (sold.has(night)) sold.set(night, sold.get(night)! + 1);
  }
  for (const [night, count] of i.held) if (sold.has(night)) sold.set(night, sold.get(night)! + count);
  const out: Record<string, NightState> = {};
  for (const night of i.nights) {
    const override = i.overrides.get(night);
    let blocked: boolean;
    let capacity: number;
    if (override) {
      blocked = override.blocked;
      capacity = override.roomsLeft;
    } else {
      // nothing set: open inside the booking window, closed beyond it, unless the caller is deciding on a real request
      blocked = i.respectOpenWindow && night > openThrough;
      capacity = blocked ? 0 : i.defaultCapacity;
    }
    if (blocked) capacity = 0;
    const s = sold.get(night)!;
    out[night] = { capacity, sold: s, free: Math.max(0, capacity - s), blocked };
  }
  return out;
}

/** freeForStay (:146-150): the fewest free rooms across every night of a stay. */
export function freeForStay(state: Record<string, NightState>): number {
  const free = Object.values(state).map((s) => s.free);
  return free.length === 0 ? 0 : Math.min(...free);
}

/** unavailableNight (:160-179), the stay's state computed WITHOUT the open window: the first night with no room left, or null. */
export function firstFullNight(state: Record<string, NightState>): string | null {
  for (const [night, s] of Object.entries(state)) if (s.free < 1) return night;
  return null;
}

export interface BlockedRange {
  roomId: string;
  roomName: string;
  start: string;
  end: string;
}

/** blockedRanges (:187-215): blocked dates from yesterday on, joined into stretches per room (rows in room then date order). */
export function blockedRanges(rows: readonly { roomId: string; roomName: string; date: string }[], today: string): BlockedRange[] {
  const floor = addDays(today, -1);
  const ranges: BlockedRange[] = [];
  let current: BlockedRange | null = null;
  for (const r of rows.filter((x) => x.date >= floor)) {
    if (current && current.roomId === r.roomId && r.date === addDays(current.end, 1)) {
      current.end = r.date;
      continue;
    }
    if (current) ranges.push(current);
    current = { roomId: r.roomId, roomName: r.roomName, start: r.date, end: r.date };
  }
  if (current) ranges.push(current);
  return ranges;
}

/** CalendarController::saveInventory's two refusals (:106-113), or null. */
export function inventoryRule(left: number, sold: number, total: number, name: string): string | null {
  if (left < sold) return `Can't go below ${sold} - ${sold} ${sold === 1 ? "room is" : "rooms are"} already confirmed for this date.`;
  if (left > total) return `Can't go above ${total} - that's the total number of ${name} rooms.`;
  return null;
}
