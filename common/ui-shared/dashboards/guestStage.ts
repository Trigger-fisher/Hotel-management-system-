// Decision 71 (MJ 26 Oct 2026, "user-wise"): the guest portal is organised around WHERE the guest is in a stay. Pure helpers every guest screen reads (no React,
// no API): the stage, the one money figure of a screen, past stays built from bills, a bill's real seller name, the status line under a page title and which phone
// tab is lit for a page. Dates are "YYYY-MM-DD" (IST calendar days); "today" always comes from the caller (portalToday(GUEST_TODAY) in the web app), never Date.now().
import { addDays, billState, billTotals, daysBetween, guestBusinesses, guestCopy, type CurrentStay, type GuestBill, type GuestOverview, type UpcomingStay } from './guest';
import { formatDate } from './format';

/** Where the guest is: a booking that starts later, in the stay, the check-out day, checked out lately (14 days), or nothing to show. */
export type GuestStage = 'arriving' | 'staying' | 'checkoutDay' | 'checkedOut' | 'none';

export const GUEST_STAGES: readonly GuestStage[] = ['arriving', 'staying', 'checkoutDay', 'checkedOut', 'none'];

/** How long after the last stay ended Home still says "Thanks for staying with us". */
export const CHECKED_OUT_DAYS = 14;

/**
 * The guest's stage.
 * - a stay going on: `checkoutDay` when its check-out is today (or already past: the stay is still open at the desk), else `staying`;
 * - no stay, an upcoming booking: `arriving`;
 * - no stay, the newest stay seen in `recentBills` began on or before today and ended at most 14 days ago (or ended early): `checkedOut`;
 * - otherwise `none`. Missing or failed bills (`undefined` / `null`) never guess: `none` (or the stay's stage when there is a stay).
 */
export function guestStage(ov: Pick<GuestOverview, 'stay' | 'upcoming'>, today: string, recentBills?: readonly GuestBill[] | null): GuestStage {
  if (ov.stay) return ov.stay.checkOut <= today ? 'checkoutDay' : 'staying';
  if (ov.upcoming) return 'arriving';
  const last = latestStayEnd(recentBills ?? [], today);
  return last !== null && daysBetween(last, today) <= CHECKED_OUT_DAYS ? 'checkedOut' : 'none';
}

/** The end date of the newest stay that has begun (stayFrom <= today), from bills that are not cancelled; null when there is none. */
function latestStayEnd(bills: readonly GuestBill[], today: string): string | null {
  let best: string | null = null;
  for (const b of bills) {
    if (b.status === 'cancelled' || !b.stayTo || !b.stayFrom || b.stayFrom > today) continue;
    if (best === null || b.stayTo > best) best = b.stayTo;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Money: one calculation per screen
// ---------------------------------------------------------------------------

export interface GuestMoney {
  /** Everything still to pay (overdue included). Coral on screen. */
  duePaise: number;
  /** The part of `duePaise` that is past its pay-by date. Red on screen. */
  overduePaise: number;
  /** Paid so far on these bills. */
  paidPaise: number;
  /** The bills' totals (what was charged). */
  chargedPaise: number;
  /** Bills with something to pay. */
  openCount: number;
}

/** The money of a set of bills, worked out once (cancelled bills count for nothing). `overduePaise` is a part of `duePaise`, never added to it. */
export function moneyOf(bills: readonly GuestBill[], today: string): GuestMoney {
  const m: GuestMoney = { duePaise: 0, overduePaise: 0, paidPaise: 0, chargedPaise: 0, openCount: 0 };
  for (const b of bills) {
    if (b.status === 'cancelled') continue;
    const t = billTotals(b);
    m.chargedPaise += t.totalPaise;
    m.paidPaise += t.paidPaise;
    if (t.duePaise > 0) {
      m.duePaise += t.duePaise;
      m.openCount += 1;
      if (billState(b, today) === 'overdue') m.overduePaise += t.duePaise;
    }
  }
  return m;
}

// ---------------------------------------------------------------------------
// Stays from bills (Past stays, the Bills page's groups)
// ---------------------------------------------------------------------------

export interface StaySummary {
  /** Stable key: hotel, dates and room. */
  key: string;
  hotelId: string | null;
  hotelName: string | null;
  roomNumber: string;
  from: string;
  to: string;
  nights: number;
  /** The stay's bills, newest first. */
  bills: GuestBill[];
  money: GuestMoney;
  /** Part of the stay going on now. */
  current: boolean;
  /** Every bill of it was cancelled (a cancelled booking). */
  cancelled: boolean;
}

/** Groups bills into stays (same hotel, dates and room), newest stay first. `today` decides what counts as overdue. */
export function staysFromBills(bills: readonly GuestBill[], today: string): StaySummary[] {
  const by = new Map<string, GuestBill[]>();
  for (const b of bills) {
    const key = `${b.hotelId ?? ''}|${b.stayFrom}|${b.stayTo}|${b.roomNumber}`;
    const list = by.get(key);
    if (list) list.push(b);
    else by.set(key, [b]);
  }
  const out: StaySummary[] = [];
  for (const [key, list] of by) {
    const first = list[0];
    if (!first) continue;
    const sorted = [...list].sort((a, b) => b.issuedOn.localeCompare(a.issuedOn) || b.number.localeCompare(a.number));
    out.push({
      key,
      hotelId: first.hotelId ?? null,
      hotelName: first.hotelName?.trim() || null,
      roomNumber: first.roomNumber,
      from: first.stayFrom,
      to: first.stayTo,
      nights: Math.max(0, daysBetween(first.stayFrom, first.stayTo)),
      bills: sorted,
      money: moneyOf(list, today),
      current: list.some((b) => b.current),
      cancelled: list.every((b) => b.status === 'cancelled'),
    });
  }
  return out.sort((a, b) => b.to.localeCompare(a.to) || b.from.localeCompare(a.from));
}

// ---------------------------------------------------------------------------
// Names and lines
// ---------------------------------------------------------------------------

const PLACEHOLDER_NAMES = new Set(Object.values(guestBusinesses).map((b) => b.name));

/** Who issued a bill, by its real name: the seller on the bill, else the hotel's name, else (last) the business placeholder ("Your hotel"). */
export function sellerName(bill: Pick<GuestBill, 'seller' | 'hotelName' | 'business'>): string {
  const seller = bill.seller?.name?.trim();
  if (seller && !PLACEHOLDER_NAMES.has(seller)) return seller;
  const hotel = bill.hotelName?.trim();
  if (hotel) return hotel;
  return seller || guestBusinesses[bill.business].name;
}

/** The status line's words (decision 71). */
export const stageCopy = {
  inStay: 'In stay',
  checkoutDay: 'Check-out day',
  arriving: 'Arriving',
  checkedOut: 'Checked out',
  noStay: 'No stay right now',
  room: (no: string) => `Room ${no}`,
  checksOutTomorrow: 'checks out tomorrow',
  checksOutOn: (date: string) => `checks out ${date}`,
  today: 'today',
  tomorrow: 'tomorrow',
  inDays: (n: number) => `in ${n} days`,
} as const;

/** "In 3 days", "Tomorrow", "Today": how far away a date is (past dates read "Today"). */
export function daysAwayText(date: string, today: string): string {
  const n = daysBetween(today, date);
  if (n <= 0) return stageCopy.today;
  if (n === 1) return stageCopy.tomorrow;
  return stageCopy.inDays(n);
}

/**
 * The line under a guest page's title: "In stay · Room 204 · checks out tomorrow", "Check-out day · Room 204", "Arriving 29 Oct 2026 · in 3 days",
 * "Checked out 06 Oct 2026", "No stay right now".
 */
export function stageStatusLine(stage: GuestStage, ctx: { stay?: CurrentStay | null; upcoming?: UpcomingStay | null; lastStayTo?: string | null; today: string }): string {
  const { stay, upcoming, lastStayTo, today } = ctx;
  if ((stage === 'staying' || stage === 'checkoutDay') && stay) {
    const room = stay.roomNumber ? stageCopy.room(stay.roomNumber) : null;
    if (stage === 'checkoutDay') return [stageCopy.checkoutDay, room].filter(Boolean).join(' · ');
    const out = stay.checkOut === addDays(today, 1) ? stageCopy.checksOutTomorrow : stageCopy.checksOutOn(formatDate(stay.checkOut));
    return [stageCopy.inStay, room, out].filter(Boolean).join(' · ');
  }
  if (stage === 'arriving' && upcoming) return `${stageCopy.arriving} ${formatDate(upcoming.checkIn)} · ${daysAwayText(upcoming.checkIn, today)}`;
  if (stage === 'checkedOut' && lastStayTo) return `${stageCopy.checkedOut} ${formatDate(lastStayTo)}`;
  return stageCopy.noStay;
}

// ---------------------------------------------------------------------------
// The phone tab bar
// ---------------------------------------------------------------------------

export type GuestTabId = 'guest.home' | 'guest.order' | 'guest.bills' | 'guest.history' | 'guest.profile';

/** The four phone tabs (decision 71): they never change with the stage. */
export const guestTabs: readonly { id: GuestTabId; label: string; icon: string }[] = [
  { id: 'guest.home', label: guestCopy.nav.home, icon: 'house' },
  { id: 'guest.order', label: guestCopy.nav.order, icon: 'cup-hot' },
  { id: 'guest.bills', label: guestCopy.nav.bills, icon: 'receipt' },
  // MJ, 26 Oct 2026: Bills and the payment history are separate tabs
  { id: 'guest.history', label: guestCopy.nav.payments, icon: 'wallet2' },
  { id: 'guest.profile', label: guestCopy.nav.account, icon: 'person-circle' },
];

/** Which tab is lit for a page: Bills for the bills and one bill, Payments for the payment history; null for a page that is not the guest's. */
export function guestTabFor(viewId: string): GuestTabId | null {
  switch (viewId) {
    case 'guest.home':
      return 'guest.home';
    case 'guest.order':
      return 'guest.order';
    case 'guest.bills':
    case 'guest.bill':
      return 'guest.bills';
    case 'guest.history':
      return 'guest.history';
    case 'guest.profile':
      return 'guest.profile';
    default:
      return null;
  }
}
