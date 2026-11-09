// Guest dashboard (role guest_user) = the Hotel Pallav guest portal (S03).
// Pure TypeScript: types, a mock API with an in-memory store, pure helpers and copy.
// Money is in paise. Dates are "YYYY-MM-DD" (stay nights) or ISO UTC timestamps.

import type { DashResult, Kpi, ListQuery, Page } from './common';
import { formatDate } from './format';
import type { PortalCursorQuery, PortalPartial } from './portalHotels';
import type { ProfileLastChange } from './profileReview';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** "Today" for the mock data (IST calendar date). The real API sends dates relative to now. */
export const GUEST_TODAY = '2026-11-05';

export const guestHotel = {
  name: 'Your hotel',
  shortName: 'Your hotel',
  // same phone and email as the hotel's own settings mock (billing.ts billingHotel, admin.ts general.*)
  reception: '',
  receptionNote: 'Reception: dial 0 from your room',
  email: 'stay@hotelsunriserajkot.in',
  checkInTime: '12:00 pm',
  checkOutTime: '11:00 am',
} as const;

export type BusinessKey = 'hotel' | 'food';

/** Each business is a separate company with its own GSTIN, bill and payment account (Pallav rule). */
export interface Business {
  key: BusinessKey;
  name: string;
  legalName: string;
  gstin: string;
  /** Icon name from the dashboard icon set. */
  icon: string;
  gstRatePercent: number;
  gstLabel: string;
  address: string;
}

export const guestBusinesses: Record<BusinessKey, Business> = {
  hotel: {
    key: 'hotel',
    name: 'Your hotel',
    legalName: 'Your hotel',
    gstin: '24ABCDE1234F1Z5',
    icon: 'building',
    gstRatePercent: 12,
    gstLabel: 'GST 12%',
    address: 'Hotel address, city',
  },
  food: {
    key: 'food',
    name: 'Your restaurant',
    legalName: 'Your restaurant',
    gstin: '24AAKFS5678K1Z2',
    icon: 'utensils',
    gstRatePercent: 5,
    gstLabel: 'GST 5%',
    address: 'Hotel address, city',
  },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IdProofType = 'aadhaar' | 'passport' | 'driving_licence' | 'voter_id' | 'none';

export const idProofOptions: { value: IdProofType; label: string }[] = [
  { value: 'aadhaar', label: 'Aadhaar card' },
  { value: 'passport', label: 'Passport' },
  { value: 'driving_licence', label: 'Driving licence' },
  { value: 'voter_id', label: 'Voter ID' },
  { value: 'none', label: 'Not added yet' },
];

export interface GuestProfile {
  id: string;
  name: string;
  /** Sign-in mobile. Read-only for the guest (reception changes it). */
  mobile: string;
  email: string;
  city: string;
  address: string;
  idProofType: IdProofType;
  /** Shown masked, e.g. "XXXX XXXX 4321". */
  idProofNumber: string;
  notifyEmail: boolean;
  lastSignInAt: string;
  memberSince: string;
  staysCount: number;
  /** Decision 52: the sign-in name shown on My profile (read-only). Optional until the server sends it. */
  username?: string;
  /** Decision 46: whether the emailed sign-in code is on for this person. Optional until the server sends it. */
  signInCodeOn?: boolean;
  /**
   * The ONE common profile (platform 0132): true = name, email, city and address are the guest's one profile, the same at every hotel (a save changes them everywhere once).
   * false = this hotel's own record (before the change is live; the first save makes the common profile). The mobile and the ID proof stay each hotel's. Optional.
   */
  common?: boolean;
  /** When `common`: who last changed the ONE profile, from which hotel, when (profileReview.ts ProfileLastChange; show `lastChangeLine`). Read-only. */
  lastChange?: ProfileLastChange | null;
  /** The login's profile photo (GET /profile/photo, admin.ts profilePhotoPath), or null. Optional until every server sends it. */
  photoUrl?: string | null;
}

export interface CurrentStay {
  bookingNo: string;
  roomNumber: string;
  roomType: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  /** Nights already stayed (0 on arrival day). */
  nightsDone: number;
  adults: number;
  children: number;
  /**
   * Decision 71 (D2, not built yet): the company that pays this stay's bills, when a company booked it. The server does not send it today (company stays are left
   * out of the guest portal); the screens ignore it until MJ decides.
   */
  billedToCompany?: string | null;
}

/**
 * Decision 71 (D1): a confirmed booking that starts later (the guest is arriving soon). Optional: the server sends it only once D1 is approved; the mock and the
 * hotel's portal preview always can. Money in paise, dates "YYYY-MM-DD".
 */
export interface UpcomingStay {
  /** The booking reference ("BK-26-1061"). */
  reference: string;
  hotelId: string;
  hotelName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  /** The room type booked ("Deluxe Room"); empty when not known. */
  roomType: string;
  adults: number;
  children: number;
  /** Advance already received for this booking (0 = none). */
  advancePaise: number;
}

/** One hotel the guest login is linked to (GET /guest/hotels). `slug` (D4) is the hotel's public website slug, for its check-in times and address. */
export interface GuestHotel {
  hotelId: string;
  name: string;
  /** The reception phone (the Call buttons); null or absent = not known. */
  phone?: string | null;
  /** Decision 71 (D4): the public website slug; absent = the hotel card and every time line stay hidden. */
  slug?: string;
}

/**
 * A guest list query (Bills, Payments). `hotel` (decision 71): the page's own hotel chips, sent only on that page's calls: a hotel id, or "all" for every hotel
 * even when the sidebar chose one. Left out = the sidebar's choice (`?hotel=`), as before.
 */
export type GuestListQuery = ListQuery & PortalCursorQuery & { hotel?: string };

export type ChargeKind = 'room' | 'food' | 'laundry' | 'service' | 'other';

export interface BillLine {
  id: string;
  label: string;
  /** Small text under the label, e.g. "3 nights × ₹4,500.00". */
  detail: string | null;
  date: string;
  kind: ChargeKind;
  /** Before GST. */
  amountPaise: number;
}

export type PaymentMethod = 'upi' | 'card' | 'cash' | 'netbanking' | 'advance';

export const paymentMethodLabel: Record<PaymentMethod, string> = {
  upi: 'UPI',
  card: 'Card',
  cash: 'Cash',
  netbanking: 'Net banking',
  advance: 'Advance',
};

export interface BillPayment {
  id: string;
  at: string;
  method: PaymentMethod;
  reference: string;
  amountPaise: number;
}

export type BillStatus = 'open' | 'paid' | 'cancelled';

/** Who issued a bill: the business's name, address, phone and GST number as the hotel keeps them (null = not entered). Shown on the bill and its copy. */
export interface GuestBillSeller {
  name: string;
  address: string | null;
  phone: string | null;
  gstin: string | null;
}

/** The people a bill is for: counts, and the names where the stay's members are known (else just the main guest). Every role's bill pages show it. */
export interface BillPersons {
  adults: number;
  children: number;
  names: string[];
}

/** The bill number, or "Running bill" while the stay's bill has none yet (it is numbered at check-out). */
export const billNumberText = (n: string): string => (n.trim() ? n : 'Running bill');

/** "2 adults, 1 child" (zero parts left out). */
export function personsText(p: BillPersons): string {
  const parts = [p.adults > 0 ? `${p.adults} ${p.adults === 1 ? 'adult' : 'adults'}` : '', p.children > 0 ? `${p.children} ${p.children === 1 ? 'child' : 'children'}` : ''].filter(Boolean);
  return parts.join(', ');
}

export interface GuestBill {
  id: string;
  number: string;
  business: BusinessKey;
  /** Who issued the bill. The server and the mock send it; the screen falls back to the business's default details when it is absent. */
  seller?: GuestBillSeller;
  /** Guest name printed on the bill. */
  billedTo: string;
  issuedOn: string;
  /** Pay-by date. null = pay at check-out. */
  dueOn: string | null;
  roomNumber: string;
  stayFrom: string;
  stayTo: string;
  /** Part of the stay going on now. */
  current: boolean;
  status: BillStatus;
  lines: BillLine[];
  payments: BillPayment[];
  /** Decision 52: who the bill is for, and (with "All hotels") which hotel issued it. Optional until the server sends them. */
  persons?: BillPersons;
  hotelId?: string;
  hotelName?: string;
  /** The real server sends the bill's own figures (GST as written on the bill); the mock leaves it out and billTotals() works them out. */
  totals?: BillTotals;
  /** The SAC printed on the bill (stored with it); absent from the mock, which shows the business's code (GST_SAC). */
  sac?: string;
}

export interface BillTotals {
  subtotalPaise: number;
  gstPaise: number;
  totalPaise: number;
  paidPaise: number;
  duePaise: number;
}

/** What the guest sees on the bill: due, overdue, paid or cancelled. */
export type BillState = 'due' | 'overdue' | 'paid' | 'cancelled';

export type BillTab = 'open' | 'paid' | 'cancelled' | 'all';

export interface BillList extends Page<GuestBill>, PortalPartial {
  counts: Record<BillTab, number>;
}

export interface PaymentReceipt {
  billId: string;
  billNumber: string;
  business: BusinessKey;
  amountPaise: number;
  reference: string;
}

export interface PayResult {
  receipts: PaymentReceipt[];
  totalPaise: number;
}

export type HistoryCategory = 'room' | 'food' | 'laundry' | 'service' | 'payment' | 'booking';
export type HistoryStatus = 'on_bill' | 'paid' | 'cancelled';

export interface HistoryItem {
  id: string;
  at: string;
  kind: 'charge' | 'payment';
  category: HistoryCategory;
  title: string;
  business: BusinessKey;
  /** Always positive; `kind` says whether it was charged or paid. */
  amountPaise: number;
  status: HistoryStatus;
  billNumber: string | null;
  /** Decision 52: the hotel, shown on the row with "All hotels". */
  hotelId?: string;
  hotelName?: string;
}

export type HistoryTab = 'all' | 'charges' | 'payments';

export interface HistoryList extends Page<HistoryItem>, PortalPartial {
  counts: Record<HistoryTab, number>;
}

export interface HistoryDay {
  /** IST calendar date "YYYY-MM-DD". */
  date: string;
  /** "Today", "Yesterday" or "04 Oct 2026". */
  label: string;
  items: HistoryItem[];
}

export type MenuGroupId = 'restaurant' | 'laundry' | 'service';

/** MJ, 26 Oct 2026: room service is food to the room only. Guests see and order the restaurant group alone; laundry and other services are not offered
 *  (the server's ORDERABLE_GROUP_KEYS says the same). Past laundry charges on bills stay as they are. */
export const ORDERABLE_MENU_GROUPS: readonly MenuGroupId[] = ['restaurant'];

export interface MenuItem {
  id: string;
  name: string;
  pricePaise: number;
  note: string | null;
  available: boolean;
  /** Round 3: the hotel's own category (null = the group's), the veg mark, and the photo's address (a signed-in GET; null = no photo). */
  category?: string | null;
  veg?: 'yes' | 'no' | 'unknown';
  photoUrl?: string | null;
}

export interface MenuGroup {
  id: MenuGroupId;
  label: string;
  icon: string;
  business: BusinessKey;
  kind: ChargeKind;
  hint: string;
  items: MenuItem[];
}

export type OrderPayWith = 'room_bill' | 'pay_now';

export interface OrderRequest {
  /** itemId -> quantity (0 or missing = not ordered). */
  qty: Record<string, number>;
  payWith: OrderPayWith;
  note: string;
  /** Decision 52: deliver at this time (ISO date-time with +05:30, inside the open hours and the stay). Left out = as soon as possible. */
  scheduledFor?: string;
}

export interface CartLine {
  item: MenuItem;
  group: MenuGroup;
  qty: number;
  amountPaise: number;
}

export interface CartPart {
  business: BusinessKey;
  subtotalPaise: number;
  gstPaise: number;
  totalPaise: number;
}

export interface CartSummary {
  lines: CartLine[];
  parts: CartPart[];
  count: number;
  subtotalPaise: number;
  gstPaise: number;
  totalPaise: number;
}

/** One room-service order placed for a later time (decision 52). */
export interface ScheduledOrder {
  id: string;
  orderNo: string;
  /** ISO date-time with +05:30. */
  scheduledFor: string;
  lines: { name: string; qty: number }[];
  totalPaise: number;
  hotelId?: string;
  hotelName?: string;
}

export interface ScheduledOrderList {
  items: ScheduledOrder[];
}

export interface OrderResult {
  orderNo: string;
  placedAt: string;
  payWith: OrderPayWith;
  totalPaise: number;
  parts: CartPart[];
  etaMinutes: number;
}

export interface GuestOverview {
  profile: GuestProfile;
  stay: CurrentStay | null;
  /** Bills with something to pay, current stay first. */
  openBills: GuestBill[];
  recent: HistoryItem[];
  kpis: Kpi[];
  /** Linked hotels missing from this answer (All hotels); empty when all answered. */
  unavailable?: PortalPartial['unavailable'];
  /** Decision 71 (D1): the next confirmed booking when the guest is not staying now; absent or null = none (or the server does not send it yet). */
  upcoming?: UpcomingStay | null;
}

export interface ProfileInput {
  name: string;
  email: string;
  city: string;
  address: string;
  idProofType: IdProofType;
  idProofNumber: string;
  notifyEmail: boolean;
}

export interface PasswordChangeInput {
  current: string;
  next: string;
  confirm: string;
}

// ---------------------------------------------------------------------------
// Pure helpers (used by both apps)
// ---------------------------------------------------------------------------

export function gstOn(subtotalPaise: number, business: BusinessKey): number {
  return Math.round((subtotalPaise * guestBusinesses[business].gstRatePercent) / 100);
}

export function billTotals(bill: GuestBill): BillTotals {
  if (bill.totals) return bill.totals;
  const subtotalPaise = bill.lines.reduce((s, l) => s + l.amountPaise, 0);
  const gstPaise = gstOn(subtotalPaise, bill.business);
  const totalPaise = subtotalPaise + gstPaise;
  const paidPaise = bill.payments.reduce((s, p) => s + p.amountPaise, 0);
  const duePaise = bill.status === 'cancelled' ? 0 : Math.max(0, totalPaise - paidPaise);
  return { subtotalPaise, gstPaise, totalPaise, paidPaise, duePaise };
}

export function billState(bill: GuestBill, today: string = GUEST_TODAY): BillState {
  if (bill.status === 'cancelled') return 'cancelled';
  if (billTotals(bill).duePaise <= 0) return 'paid';
  return bill.dueOn !== null && bill.dueOn < today ? 'overdue' : 'due';
}

export const billStateLabel: Record<BillState, string> = {
  due: 'To pay',
  overdue: 'Overdue',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

export const historyIcon: Record<HistoryCategory, string> = {
  room: 'bed',
  food: 'utensils',
  laundry: 'tag',
  service: 'inbox',
  payment: 'wallet',
  booking: 'calendar',
};

/** Whole days between two "YYYY-MM-DD" dates (b - a). */
export function daysBetween(a: string, b: string): number {
  const pa = Date.parse(`${a}T00:00:00Z`);
  const pb = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(pa) || Number.isNaN(pb)) return 0;
  return Math.round((pb - pa) / 86_400_000);
}

/** "YYYY-MM-DD" + n days. */
export function addDays(date: string, n: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** IST calendar date of an ISO timestamp. */
export function istDate(iso: string): string {
  return new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10);
}

export function dayLabel(date: string, today: string = GUEST_TODAY): string {
  if (date === today) return guestCopy.history.today;
  if (date === addDays(today, -1)) return guestCopy.history.yesterday;
  return formatDate(date);
}

/** Groups history items (already newest first) by IST day. */
export function groupHistoryByDay(items: HistoryItem[], today: string = GUEST_TODAY): HistoryDay[] {
  const days: HistoryDay[] = [];
  for (const item of items) {
    const date = istDate(item.at);
    const last = days[days.length - 1];
    if (last && last.date === date) last.items.push(item);
    else days.push({ date, label: dayLabel(date, today), items: [item] });
  }
  return days;
}

/** "2 of 3 nights" progress, 0..1. */
export function stayProgress(stay: CurrentStay): number {
  return stay.nights <= 0 ? 0 : Math.min(1, stay.nightsDone / stay.nights);
}

export function nightsLeft(stay: CurrentStay): number {
  return Math.max(0, stay.nights - stay.nightsDone);
}

/** Cart lines, totals per business (each business bills on its own) and the grand total. */
export function cartSummary(menu: MenuGroup[], qty: Record<string, number>): CartSummary {
  const lines: CartLine[] = [];
  for (const group of menu) {
    for (const item of group.items) {
      const q = qty[item.id] ?? 0;
      if (q > 0) lines.push({ item, group, qty: q, amountPaise: q * item.pricePaise });
    }
  }
  const parts: CartPart[] = [];
  for (const key of ['hotel', 'food'] as BusinessKey[]) {
    const sub = lines.filter((l) => l.group.business === key).reduce((s, l) => s + l.amountPaise, 0);
    const count = lines.filter((l) => l.group.business === key).length;
    if (count > 0) {
      const gst = gstOn(sub, key);
      parts.push({ business: key, subtotalPaise: sub, gstPaise: gst, totalPaise: sub + gst });
    }
  }
  return {
    lines,
    parts,
    count: lines.reduce((s, l) => s + l.qty, 0),
    subtotalPaise: parts.reduce((s, p) => s + p.subtotalPaise, 0),
    gstPaise: parts.reduce((s, p) => s + p.gstPaise, 0),
    totalPaise: parts.reduce((s, p) => s + p.totalPaise, 0),
  };
}

/** Max quantity of one item per order. */
export const MAX_ITEM_QTY = 20;

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

export const guestCopy = {
  /**
   * The one name of each guest page (sidebar, phone tab bar, page title, Home buttons). Decision 71: Home, Dining (food to the room; MJ 26 Oct 2026, the hotels' own word for it), Bills, Payments, Account.
   * `profile` is kept for older callers and now says "Account" too; `more` is no longer on the guest's tab bar.
   */
  nav: {
    home: 'Home',
    order: 'Dining',
    bills: 'Bills',
    payments: 'Payments',
    account: 'Account',
    profile: 'Account',
    more: 'More',
    signOut: 'Sign out',
  },
  common: {
    retry: 'Try again',
    cancel: 'Cancel',
    close: 'Close',
    back: 'Back',
    room: 'Room',
    night: 'night',
    nights: 'nights',
    guest: 'guest',
    guests: 'guests',
    free: 'Free',
    previewNote: 'Preview only. The real PDF comes with the live system.',
    print: 'Print',
    showing: (shown: number, total: number) => `Showing ${shown} of ${total}`,
  },
  home: {
    title: 'Home',
    welcome: 'Welcome back',
    noStayTitle: 'No stay right now',
    noStayBody: 'When you check in, your room, bills and orders show here.',
    totalToPay: 'Total to pay',
    nothingToPay: 'Nothing to pay',
    kpiDue: 'To pay now',
    kpiPaid: 'Paid so far',
    kpiOrdered: 'Charged this stay',
    kpiNights: 'Nights left',
    quickTitle: 'Quick actions',
    quickOrder: 'Dining',
    quickPay: 'Pay bills',
    quickCall: 'Call reception',
    quickPayments: 'Payments',
    quickAccount: 'My profile',
    payLink: 'Pay',
    billsTitle: 'Your bills',
    billsSub: 'Open a bill to see it and pay it.',
    billsSubtitle: 'Two businesses, paid separately or together',
    allBills: 'See all bills',
    stayTitle: 'Your stay',
    bookingLabel: 'Booking',
    nightsLeftLine: (n: number) => (n === 1 ? '1 night left' : `${n} nights left`),
    stayProgressLabel: 'Your stay so far',
    ordersTitle: 'Your orders',
    ordersSub: 'What you ordered and where it is now.',
    ordersLink: 'Dining',
    comingTitle: 'Coming up',
    comingSub: 'Room-service orders you asked for a later time.',
    recentTitle: 'Recent activity',
    recentLink: 'See all payments',
    recentEmpty: 'Nothing charged yet.',
    checkOutAt: 'Check-out by',
    stayLine: (done: number, total: number, left: number, room: string) =>
      `${done} of ${total} nights done · ${left} left · Room ${room}`,
    guestsCount: (n: number) => (n === 1 ? '1 guest' : `${n} guests`),
    nightsCount: (n: number) => (n === 1 ? '1 night' : `${n} nights`),
  },
  bills: {
    title: 'Bills',
    subtitle: 'Each business bills you on its own. Pay one or both.',
    payTitle: 'To pay now',
    allTitle: 'All bills',
    tabs: { open: 'To pay', paid: 'Paid', cancelled: 'Cancelled', all: 'All' } as Record<BillTab, string>,
    search: 'Search bill number or business',
    cols: {
      number: 'Bill no.',
      business: 'Business',
      date: 'Date',
      stay: 'Stay',
      total: 'Total',
      paid: 'Paid',
      due: 'To pay',
      status: 'Status',
    },
    emptyTitle: 'No bills here',
    emptyBody: 'Bills from your stays show here.',
    emptySearchBody: 'No bill matches your search. Try another number.',
    allPaidTitle: 'All paid',
    allPaidBody: 'You have nothing to pay right now. Thank you.',
    pay: 'Pay',
    paidBadge: 'Paid',
    billNo: 'Bill',
    lines: 'Charges',
    billTotal: 'Bill total',
    paidAlready: 'Paid already',
    toPay: 'To pay',
    nothingDue: 'Nothing due',
    selectedLabel: 'Selected to pay',
    selectedAll: 'All selected bills together',
    selectedOne: 'One bill selected',
    selectedNone: 'Nothing selected',
    payAll: 'Select all',
    payNow: 'Pay now',
    secureNote:
      'Secure payment by Razorpay. Each business is paid into its own account, so paying both together is one quick payment per business, with a receipt for each.',
    confirmTitle: 'Pay now?',
    confirmBody: (amount: string, count: number) =>
      count > 1
        ? `You are paying ${amount} for ${count} bills. Razorpay opens once for each business, and you get a receipt for each.`
        : `You are paying ${amount}. Razorpay opens and you get a receipt by email.`,
    confirmLabel: 'Pay',
    paidToast: (amount: string) => `Paid ${amount}. Receipts sent to your email.`,
    overdueNote: 'This bill was due on',
    staySub: (room: string, from: string, to: string) => `Room ${room} · ${from} to ${to}`,
    copiesTitle: 'Copies',
    copiesSub: (email: string) => `PDF of each bill, sent to ${email} too`,
    copiesSubNoEmail: 'PDF of each bill',
    copyLine: 'Invoice with GST details',
    /** Opens the bill's in-page preview (not a PDF file). */
    pdf: 'Preview',
    open: 'Open the bill',
    allNote: 'Every bill, latest first. The ones still to pay are also above.',
  },
  bill: {
    title: 'Bill',
    from: 'Billed by',
    gstin: 'GSTIN',
    billNo: 'Bill number',
    date: 'Date',
    room: 'Room',
    stay: 'Stay',
    dueOn: 'Pay by',
    dueAtCheckout: 'At check-out',
    status: 'Status',
    charges: 'Charges',
    colItem: 'Item',
    colDate: 'Date',
    colAmount: 'Amount',
    subtotal: 'Subtotal',
    total: 'Bill total',
    paid: 'Paid',
    due: 'To pay',
    inWords: 'Amount in words',
    payments: 'Payments',
    paymentsEmpty: 'No payments yet.',
    colPaidOn: 'Paid on',
    colMethod: 'Method',
    colRef: 'Reference',
    previewPdf: 'Preview PDF',
    emailCopy: 'Email me a copy',
    emailed: (email: string) => `A copy is on its way to ${email}.`,
    payNow: 'Pay now',
    previewTitle: 'Bill preview',
    taxInvoice: 'Tax invoice',
    billedTo: 'Billed to',
    cancelledNote: 'This bill was cancelled. Nothing is due.',
    downloadPdf: 'Download PDF',
    summaryTitle: 'Summary',
    documentTitle: 'The bill',
    persons: 'Persons',
    hotel: 'Hotel',
  },
  history: {
    title: 'Payments',
    subtitle: 'Every payment, with receipts and statements',
    tabs: { all: 'All', charges: 'Charges', payments: 'Payments' } as Record<HistoryTab, string>,
    search: 'Search charges and payments',
    today: 'Today',
    yesterday: 'Yesterday',
    status: { on_bill: 'On room bill', paid: 'Paid', cancelled: 'Cancelled' } as Record<HistoryStatus, string>,
    emptyTitle: 'Nothing here yet',
    emptyBody: 'The payments you make show here.',
    emptySearchBody: 'Nothing matches your search.',
    billRef: 'Bill',
    loadMore: 'Show more',
  },
  order: {
    title: 'Dining',
    subtitle: (room: string) => `Food from our kitchen, delivered to Room ${room}`,
    noStayTitle: 'Ordering opens at check-in',
    noStayBody: 'You can order food to your room while you stay with us.',
    billedBy: 'Billed by',
    less: 'Less',
    more: 'More',
    soldOut: 'Not available now',
    cartTitle: 'Your order',
    cartEmpty: 'Nothing added yet.',
    items: 'Items',
    gst: 'GST',
    total: 'Total',
    note: 'Note for the kitchen',
    notePlaceholder: 'Optional. For example: less spicy.',
    addToBill: 'Add to my room bill',
    payNow: 'Pay now',
    split: 'Charged by each business on its own bill.',
    viewOrder: (n: number) => (n === 1 ? 'View order (1 item)' : `View order (${n} items)`),
    clear: 'Clear',
    confirmPayTitle: 'Pay for this order?',
    confirmPayBody: (amount: string) => `Razorpay opens for ${amount}, once for each business in your order.`,
    confirmPayLabel: 'Pay',
    placedRoom: (no: string, mins: number) => `Order ${no} placed. It is on your room bill and arrives in about ${mins} minutes.`,
    placedPaid: (no: string, mins: number) => `Order ${no} paid. It arrives in about ${mins} minutes.`,
  },
  profile: {
    title: 'My profile',
    subtitle: 'Your details and sign-in',
    detailsTitle: 'Your details',
    name: 'Full name',
    mobile: 'Mobile (your sign-in)',
    mobileHint: 'To change it, ask reception.',
    email: 'Email',
    city: 'City',
    idType: 'ID proof',
    idNumber: 'ID number',
    idHint: 'We show only the last 4 digits.',
    address: 'Address',
    save: 'Save details',
    saved: 'Your details are saved.',
    passwordTitle: 'Change password',
    current: 'Current password',
    next: 'New password',
    confirm: 'Confirm new password',
    passwordHint: 'At least 8 characters, with a letter and a number.',
    changePassword: 'Change password',
    passwordChanged: 'Your password is changed.',
    reachTitle: 'Where we reach you',
    reachBody: 'Bills, receipts and booking updates.',
    byEmail: 'Email',
    billsAndReceipts: 'Bills and receipts',
    channels: (email: boolean) => (email ? 'Email' : 'At the desk only'),
    lastSignIn: 'Last sign-in',
    memberSince: 'Guest since',
    signOut: 'Sign out',
    stays: 'Stays with us',
    youTitle: 'You',
    securityTitle: 'Sign-in and security',
    signInCodeTitle: 'Sign-in code',
    signInsTitle: 'Sign-ins',
    editDetails: 'Edit my details',
  },
  errors: {
    nameRequired: 'Enter your full name.',
    nameLong: 'Keep the name under 80 characters.',
    emailInvalid: 'Enter a valid email, like name@example.com.',
    idNumberRequired: 'Enter the ID number, or pick "Not added yet".',
    currentRequired: 'Enter your current password.',
    currentWrong: 'That is not your current password.',
    nextShort: 'Use at least 8 characters.',
    nextWeak: 'Use at least one letter and one number.',
    nextSame: 'Pick a password different from the current one.',
    confirmMismatch: 'The two passwords do not match.',
    nothingSelected: 'Select at least one bill.',
    cartEmpty: 'Add at least one item.',
    alreadyPaid: 'This bill is already paid.',  },
} as const;

// ---------------------------------------------------------------------------
// Mock API
// ---------------------------------------------------------------------------

export interface GuestApi {
  /** The hotels this guest login is linked to (decision 48: the sidebar's hotel selector). */
  /** `phone` = the hotel's reception phone (the Call reception buttons); null or absent = not known. */
  listHotels(): Promise<DashResult<GuestHotel[]>>;
  /** `q.hotel` (decision 71): Home asks for every hotel ("all") whatever the sidebar shows; left out = the sidebar's choice. */
  getOverview(q?: { hotel?: string }): Promise<DashResult<GuestOverview>>;
  listBills(q: GuestListQuery): Promise<DashResult<BillList>>;
  /** `hotelId` = the bill's own hotel (from the list row), so a bill opened from a page's hotel chip is found whatever the sidebar shows. */
  getBill(id: string, hotelId?: string): Promise<DashResult<GuestBill>>;
  payBills(billIds: string[]): Promise<DashResult<PayResult>>;
  emailBill(id: string, hotelId?: string): Promise<DashResult<{ sentTo: string }>>;
  listHistory(q: GuestListQuery): Promise<DashResult<HistoryList>>;
  getMenu(): Promise<DashResult<{ stay: CurrentStay | null; profileName: string; menu: MenuGroup[] }>>;
  /** The guest's room-service orders for a later time that have not arrived yet, soonest first (the "Coming up" list on Home). */
  listScheduledOrders(): Promise<DashResult<ScheduledOrderList>>;
  placeOrder(req: OrderRequest): Promise<DashResult<OrderResult>>;
  getProfile(): Promise<DashResult<GuestProfile>>;
  updateProfile(input: ProfileInput): Promise<DashResult<GuestProfile>>;
  changePassword(input: PasswordChangeInput): Promise<DashResult<{ changed: true }>>;
}

/** A guest who is not the demo guest (e.g. one who just made an account): their own name and contact, nothing stayed, billed or booked yet. */
export interface GuestAccount {
  id: string;
  name: string;
  /** Sign-in mobile, 10 digits or as typed. */
  mobile: string;
  email: string;
}

/** What a mock guest store keeps between page loads (mock only: see `GuestKeep`). */
export interface GuestSnapshot {
  v: 1;
  profile: GuestProfile;
  bills: GuestBill[];
  history: HistoryItem[];
  password: string | null;
  seq: number;
  nowOffset: number;
}

/**
 * Optional place a mock store saves itself after every successful change and reads back when it is made (the web app passes the
 * tab's sessionStorage for registered guests, mock mode only). `load` may return anything: a wrong shape is ignored.
 */
export interface GuestKeep {
  load(): unknown;
  save(snapshot: GuestSnapshot): void;
}

/** Client-side check for the change-password form (the server checks again). */
export function validatePasswordChange(input: PasswordChangeInput): Record<string, string> {
  const fields: Record<string, string> = {};
  if (!input.current) fields.current = guestCopy.errors.currentRequired;
  if (input.next.length < 8) fields.next = guestCopy.errors.nextShort;
  else if (!/[A-Za-z]/.test(input.next) || !/\d/.test(input.next)) fields.next = guestCopy.errors.nextWeak;
  else if (input.next === input.current) fields.next = guestCopy.errors.nextSame;
  if (input.confirm !== input.next) fields.confirm = guestCopy.errors.confirmMismatch;
  return fields;
}

/** "03 Oct → 06 Oct 2026" style stay range. */
export function stayRange(from: string, to: string): string {
  // decision 71: the short form, as people write a stay ("03 – 06 Oct 2026", "28 Sep – 02 Oct 2026"); two years stay in full
  const a = formatDate(from);
  const b = formatDate(to);
  const pa = a.split(' ');
  const pb = b.split(' ');
  if (pa.length !== 3 || pb.length !== 3) return `${a} – ${b}`;
  if (pa[2] !== pb[2]) return `${a} – ${b}`;
  if (a === b) return a;
  return pa[1] === pb[1] ? `${pa[0]} – ${b}` : `${pa[0]} ${pa[1]} – ${b}`;
}
