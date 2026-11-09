// Guest portal redesign (decision 52): what the order-to-room page and the hotel's restaurant hours need. (Add member was removed, decision 59.)
// Contract agreed with Backend (docs/BACKEND.md section 18): GET /guest/order-info, GET and PUT /admin/restaurant-hours.
// GET and PUT /admin/restaurant-hours. The mock is guestPortal.mock.ts (loaded only through lib/api/mockLoader.ts).
import type { DashResult } from './common';

// ---------------------------------------------------------------------------
// Restaurant hours
// ---------------------------------------------------------------------------

/** 0 = Monday ... 6 = Sunday. A closed day sends opens and closes as "00:00". Same-day spans only (opens is before closes). */
export interface RestaurantDay {
  day: number;
  closed: boolean;
  opens: string;
  closes: string;
}

export interface RestaurantHours {
  /** The "accepting orders" switch: off stops every room-service order, whatever the hours say. */
  accepting: boolean;
  days: RestaurantDay[];
}

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/** A hotel that never set its hours is open all day (the server's default). */
export function allDayHours(): RestaurantHours {
  return { accepting: true, days: DAY_NAMES.map((_, day) => ({ day, closed: false, opens: '00:00', closes: '23:59' })) };
}

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The hours form's checks, field by field (`day0`..`day6`). */
export function validateHours(h: RestaurantHours): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of h.days) {
    if (d.closed) continue;
    if (!HH_MM.test(d.opens) || !HH_MM.test(d.closes)) out[`day${d.day}`] = 'Use a time like 08:00.';
    else if (d.opens >= d.closes) out[`day${d.day}`] = 'Closing time must be after opening time.';
  }
  return out;
}

/** "08:00" -> "8:00 am". */
export function clockText(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${ap}`;
}

/**
 * GET /guest/order-info. One hotel (named with ?hotel=, or the login's only hotel): `all: false` with the app bar's read-only text (hotel name, room, guest name; never a stay id).
 * "All hotels" for a login linked to several: `all: true` and `hotels` (OrderInfoAllHotels); offer only hotels where `inHouse` is true and send the order with `?hotel=<that id>`
 * (POST /guest/orders refuses no hotel or `all` with 422 on `hotel` for such a login; 10 orders in 10 minutes, then 429 with a sentence).
 */
export interface OrderInfo {
  all?: false;
  hotelId?: string;
  hotelName?: string;
  guestName?: string;
  roomNumber?: string | null;
  staying: boolean;
  stay: { roomNumber: string; checkIn: string; checkOut: string } | null;
  hours: { accepting: boolean; openNow: boolean; days: RestaurantDay[] };
}

/** GET /guest/order-info under "All hotels" (a login linked to several hotels). */
export interface OrderInfoAllHotels {
  all: true;
  hotels: { hotelId: string; hotelName: string; inHouse: boolean; roomNumber: string | null }[];
  unavailable: { hotelId: string; hotelName: string }[];
}

/** The Monday-based day number (0..6) of a calendar date written YYYY-MM-DD. */
export function dayOfDate(ymd: string): number {
  const [y = 1970, m = 1, d = 1] = ymd.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** The line under the order page title: when the kitchen takes orders today. */
export function hoursLine(info: OrderInfo, todayYmd: string): string {
  if (!info.hours.accepting) return 'Room service is not taking orders right now.';
  const d = info.hours.days.find((x) => x.day === dayOfDate(todayYmd));
  if (!d || d.closed) return 'Room service is closed today. You can schedule an order for another day.';
  const span = `${clockText(d.opens)} to ${clockText(d.closes)}`;
  return info.hours.openNow ? `Open now · today ${span}` : `Closed now · today ${span}`;
}

/** Whether a "YYYY-MM-DD" date and "HH:MM" time fall inside the hours of that weekday (the schedule picker's check). */
export function insideHours(days: RestaurantDay[], ymd: string, hhmm: string): boolean {
  const d = days.find((x) => x.day === dayOfDate(ymd));
  return !!d && !d.closed && hhmm >= d.opens && hhmm <= d.closes;
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

export const guestPortalCopy = {
  order: {
    notStayingTitle: 'Room service is for guests who are staying with us',
    notStayingBody: 'You can order food and other services to your room once you have checked in. When you arrive, this page opens up for you.',
    scheduleTitle: 'When should it reach you?',
    now: 'As soon as possible',
    later: 'At a time I choose',
    pickDate: 'Day',
    pickTime: 'Time',
    outsideHours: 'The kitchen is closed at that time. Please choose a time inside the opening hours.',
    outsideStay: 'Please choose a time during your stay.',
    tooSoon: 'Please choose a time at least 15 minutes from now.',
    scheduledFor: (when: string) => `For ${when}`,
    pauseBody: 'Room service is not taking orders right now. You can come back later.',
  },
  hours: {
    title: 'Restaurant hours',
    about: 'When the kitchen takes room-service orders. Guests can also schedule an order for a time inside these hours.',
    accepting: 'Accepting orders',
    acceptingHint: 'Turn this off to stop all room-service orders for now, whatever the hours say.',
    closed: 'Closed',
    opens: 'Opens',
    closes: 'Closes',
    save: 'Save the hours',
    saved: 'Restaurant hours saved.',
  },
} as const;

// ---------------------------------------------------------------------------
// APIs
// ---------------------------------------------------------------------------

export interface GuestPortalApi {
  /** One hotel chosen: OrderInfo (all: false); "All hotels" for a guest linked to several: OrderInfoAllHotels (all: true). Check ll. */
  getOrderInfo(): Promise<DashResult<OrderInfo | OrderInfoAllHotels>>;
  /** Decision 46: the emailed sign-in code is the person's own choice. Turning it OFF carries the current password (a wrong one is a field error on `password`, not a sign-out). */
  setSignInCode(enabled: boolean, password?: string): Promise<DashResult<{ signInCodeOn: boolean }>>;
}

export interface RestaurantApi {
  getHours(): Promise<DashResult<RestaurantHours>>;
  saveHours(h: RestaurantHours): Promise<DashResult<RestaurantHours>>;
}
