// Decision 71: the words of Room service (live orders, the menu, the cart sheet) and the page's small pure rules (whether the guest can order or only browse,
// the status line under the title, when the kitchen opens next, the days an order can be scheduled for). Owned by the Room service page.
// Rules: "Sign in" never "Log in"; money ₹126,000.00; dates 25 Oct 2026.
import { formatDate } from '../format';
import { clockText, dayOfDate, type RestaurantDay } from '../guestPortal';

export const orderCopy = {
  title: 'Dining',
  call: 'Call reception',
  search: 'Search the menu',
  searchOpen: 'Search the menu',
  searchClose: 'Close search',
  noMatch: 'Nothing on the menu matches that search.',
  clearSearch: 'Clear search',
  emptyGroup: 'Nothing on this list yet. Please call reception to order.',
  menuLabel: 'Menu sections',
  /** MJ, 26 Oct 2026: the menu in a food-app structure (Zomato-like, in the portal's own look). */
  kitchen: 'In-room dining',
  deliverTo: (room: string) => `Delivering to Room ${room}`,
  vegOnly: 'Veg only',
  addShort: 'Add',
  viewCart: 'View cart',
  dishes: (n: number) => (n === 1 ? '1 dish' : `${n} dishes`),
  otherSection: 'More from the kitchen',
  add: (name: string) => `Add ${name}`,
  free: 'Free',

  // the banners above the menu
  browseArriving: (date: string) => `Ordering opens when you check in on ${date}`,
  browseArrivingSub: 'Have a look at the menu meanwhile.',
  browseNone: 'Ordering is for guests staying with us',
  browseNoneSub: 'You can look at the menu. To order, check in or call the hotel.',
  paused: 'The kitchen is not taking orders right now',
  pausedSub: 'Please try again a little later, or call reception.',
  closedOpens: (when: string) => `Kitchen opens ${when}`,
  closedSchedule: 'You can schedule an order for later.',
  closedNoHours: 'The kitchen is closed',
  closedNoHoursSub: 'Please call reception for anything you need.',

  // live orders
  liveTitle: 'Your orders',
  comingUp: 'Coming up',
  pastOrders: (n: number) => `Past orders · ${n}`,
  orderNo: (no: string) => `Order ${no}`,
  placedAt: (when: string) => `Placed ${when}`,
  forWhen: (date: string, time: string) => `For ${date} at ${time}`,
  cancel: 'Cancel order',
  cancelLeft: (mmss: string) => `You can cancel for ${mmss} more`,
  callToChange: 'To change it, call reception.',
  cancelTitle: (no: string) => `Cancel order ${no}?`,
  cancelBody: 'The kitchen stops making it and it comes off your bill.',
  keep: 'Keep it',
  cancelled: (no: string) => `Order ${no} cancelled.`,
  progress: 'Order progress',
  homeLink: 'Dining',

  // the cart
  cartBar: (n: number, amount: string) => `${n} ${n === 1 ? 'item' : 'items'} · ${amount}`,
  review: 'Review order',
  sheetTitle: 'Your order',
  cartTitle: 'Your order',
  cartEmpty: 'Add something from the menu and it shows here.',
  when: 'When',
  now: 'As soon as possible',
  later: 'Later',
  day: 'Day',
  time: 'Time',
  payWith: 'Pay with',
  roomBill: (room: string) => `Add to my Room ${room} bill`,
  roomBillSub: 'Settle it with your other bills.',
  payNow: 'Pay now',
  payNowSub: 'Pay online for this order now.',
  place: 'Place order',
  payAndPlace: (amount: string) => `Pay ${amount} and place order`,
  placing: 'Placing…',
  clear: 'Clear order',
  billedSplit: 'Food and services are billed by each business on its own bill.',
  addedRoom: (no: string, room: string, mins: number) => `Order ${no} added to your Room ${room} bill. It arrives in about ${mins} minutes.`,
  addedLater: (no: string, room: string, date: string, time: string) => `Order ${no} added to your Room ${room} bill. It reaches you on ${date} at ${time}.`,
  paid: (no: string, mins: number) => `Order ${no} paid. It arrives in about ${mins} minutes.`,

  // choosing the hotel (several hotels, "All hotels")
  chooseHotel: 'Choose the hotel you are staying at.',
  notHere: 'You are not staying here now',
  // no stay at any hotel: each hotel opens its menu to look at (ordering opens at check-in)
  seeMenu: 'See the menu',
  noneInHouse: 'You are not staying at any of your hotels right now. Dining opens when you check in.',
} as const;

/** Whether the guest can order now or only look at the menu (no stay going on: the server would refuse an order with 403). */
export type OrderMode = 'order' | 'browse';
export const orderModeOf = (staying: boolean, menuStay: unknown): OrderMode => (staying && menuStay ? 'order' : 'browse');

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

const addDays = (ymd: string, n: number): string => {
  const [y = 1970, m = 1, d = 1] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/**
 * When the kitchen opens next, for the closed banner: "at 7:00 am" (later today), "tomorrow at 7:00 am", "on Sat at 7:00 am"; null when no day of the week has
 * hours (or the kitchen is open now). `nowHHMM` is the hotel's clock ("19:05", India time).
 */
export function kitchenOpensText(days: readonly RestaurantDay[], todayYmd: string, nowHHMM: string): string | null {
  const today = days.find((x) => x.day === dayOfDate(todayYmd));
  if (today && !today.closed && nowHHMM < today.opens) return `at ${clockText(today.opens)}`;
  for (let i = 1; i <= 7; i += 1) {
    const ymd = addDays(todayYmd, i);
    const dow = dayOfDate(ymd);
    const d = days.find((x) => x.day === dow);
    if (d && !d.closed) return i === 1 ? `tomorrow at ${clockText(d.opens)}` : `on ${DAY_SHORT[dow]} at ${clockText(d.opens)}`;
  }
  return null;
}

/** The short hours part of the status line: "Open now · until 11:00 pm", "Closed now · opens 7:00 am", "Closed today", "Not taking orders". */
export function hoursShort(hours: { accepting: boolean; openNow: boolean; days: readonly RestaurantDay[] }, todayYmd: string, nowHHMM: string): string {
  if (!hours.accepting) return 'Not taking orders';
  const d = hours.days.find((x) => x.day === dayOfDate(todayYmd));
  if (!d || d.closed) return 'Closed today';
  if (hours.openNow) return `Open now · until ${clockText(d.closes)}`;
  return nowHHMM < d.opens ? `Closed now · opens ${clockText(d.opens)}` : 'Closed now';
}

/** The line under the large title: "Room 204 · Hotel Sunrise, Rajkot · Open now · until 11:00 pm" (the parts that are known). */
export function orderStatusLine(p: { roomNumber?: string | null; hotelName?: string | null; hours?: string | null }): string {
  return [p.roomNumber ? `Room ${p.roomNumber}` : null, p.hotelName?.trim() || null, p.hours || null].filter(Boolean).join(' · ');
}

/** The days an order can be scheduled for: today (or check-in, if later) to check-out, each with its label "25 Oct 2026". */
export function scheduleDays(checkIn: string, checkOut: string, todayYmd: string): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  let day = checkIn > todayYmd ? checkIn : todayYmd;
  for (let i = 0; day <= checkOut && i < 62; i += 1) {
    out.push({ value: day, label: i === 0 && day === todayYmd ? `Today, ${formatDate(day)}` : formatDate(day) });
    day = addDays(day, 1);
  }
  return out;
}

/** "02:31": the time left to cancel. */
export const mmss = (ms: number): string => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
