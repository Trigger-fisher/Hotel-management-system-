// Corporate dashboard (role corporate_user): the Hotel Pallav COMPANY PORTAL, moved into HMS.
// A company's own account with the hotel: what it owes, its bills, payments, ledger,
// and its billing profile (booking rooms and the team list were removed, decisions 48 and 59).
// Pure TypeScript mock contract (S03 brief). Money in paise, dates as ISO strings.

import type { DashResult, Kpi, ListQuery, Page, Tone } from './common';
import type { BillPersons } from './guest';
import type { PortalCursorQuery, PortalPartial } from './portalHotels';
import type { ProfileLastChange } from './profileReview';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The two businesses a company pays separately (Pallav: hotel and food, each into its own account). */
export type Business = 'hotel' | 'food';

export interface BilledBy {
  name: string;
  gstin: string;
  address: string;
  phone: string;
  email: string;
}

export interface CompanyProfile {
  id: string;
  name: string;
  gstin: string;
  email: string;
  mobile: string;
  landline: string | null;
  address: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
  /** Billing rates the hotel applies, in percent. 0 = none. */
  discountPct: number;
  gstPct: number;
  tcsPct: number;
  tdsPct: number;
  /** Account opened (YYYY-MM-DD). */
  accountSince: string;
  /** Main contact (first team member) for the header chips. */
  mainContactName: string | null;
  billedBy: BilledBy;
}

/** A later payment against the part of a bill left on account (Pallav debit slots, up to 5). */
export interface BillSettlement {
  date: string;
  hotelPaise: number;
  foodPaise: number;
  mode: string;
  reference: string | null;
}

export interface CompanyBill {
  id: string;
  billNumber: string;
  billDate: string;
  guestName: string;
  /** Decision 52: how many people the bill is for, and their names where the stay's members are known. */
  persons?: BillPersons;
  guestMobile: string | null;
  roomNumber: string | null;
  roomType: string | null;
  /** Meal plan, e.g. "CP (with breakfast)". */
  plan: string | null;
  checkIn: string;
  nights: number;
  /** Hotel side */
  roomTariffPaise: number;
  discountPaise: number;
  laundryPaise: number;
  hotelGstPaise: number;
  totalHotelPaise: number;
  /** Food side */
  foodPaise: number;
  foodGstPaise: number;
  totalFoodPaise: number;
  /** The HSN/SAC stored with the bill (rooms, food); the demo leaves them out and shows GST_SAC. */
  hotelSac?: string;
  foodSac?: string;
  /** "On account" when left for the company to pay later; else how it was paid at checkout. */
  hotelMode: string | null;
  foodMode: string | null;
  advanceHotelPaise: number;
  advanceFoodPaise: number;
  /** Receipt of the advance used on this bill. */
  advanceReceipt: string | null;
  /** True when the advance used was paid by the company itself (already its own ledger line). */
  advanceIsCompanys: boolean;
  settlements: BillSettlement[];
  balanceHotelPaise: number;
  balanceFoodPaise: number;
  reference: string | null;
  note: string | null;
}

export type BillStatus = 'paid' | 'due' | 'overdue';
export type BillTab = 'all' | 'due' | 'overdue' | 'paid';

export interface BillsPage extends Page<CompanyBill> {
  counts: Record<BillTab, number>;
}

export interface BillDetail {
  bill: CompanyBill;
  company: CompanyProfile;
}

export type LedgerKind = 'bill' | 'advance' | 'checkout' | 'adjusted' | 'settlement' | 'refund';

export interface LedgerLine {
  id: string;
  kind: LedgerKind;
  date: string;
  /** "Bill HS-2041" or "Receipt ADV-0311". */
  ref: string | null;
  guest: string | null;
  room: string | null;
  mode: string | null;
  note: string | null;
  /** Bill this line belongs to, when any (opens the bill). */
  billId: string | null;
  debitPaise: number;
  creditPaise: number;
  /** Running balance after this line. Above 0 the company owes (Dr), below 0 the hotel holds its money (Cr). */
  balancePaise: number;
}

export interface LedgerTotals {
  billedPaise: number;
  receivedPaise: number;
  refundedPaise: number;
  balancePaise: number;
}

export interface Dues {
  hotelPaise: number;
  foodPaise: number;
  hotelOpen: number;
  foodOpen: number;
  totalPaise: number;
  openBills: number;
}

export type LedgerPeriod = 'all' | 'month' | 'last' | 'year';

export interface LedgerView {
  company: CompanyProfile;
  totals: LedgerTotals;
  dues: Dues;
  period: LedgerPeriod;
  /** null for "All time". */
  from: string | null;
  to: string | null;
  openingPaise: number;
  closingPaise: number;
  /** Newest first. */
  lines: LedgerLine[];
  /** The real server cut the list at its 5,000-line cap: the screen says so. Optional; the mock leaves it unset. */
  capped?: boolean;
}

export interface MonthPoint {
  /** "2026-10" */
  month: string;
  label: string;
  billedPaise: number;
  paidPaise: number;
}

export interface Overview {
  company: CompanyProfile;
  totals: LedgerTotals;
  dues: Dues;
  kpis: Kpi[];
  oldestUnpaidDays: number | null;
  months: MonthPoint[];
  recentBills: CompanyBill[];
  recentPayments: LedgerLine[];
}

export type PaymentTab = 'all' | 'settlement' | 'advance' | 'checkout' | 'adjusted';

export interface PaymentsPage extends Page<LedgerLine> {
  counts: Record<PaymentTab, number>;
  sumPaise: number;
}

export interface PaymentReceipt {
  id: string;
  receiptNumber: string;
  business: Business;
  amountPaise: number;
  date: string;
  billNumbers: string[];
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

export const corporateCopy = {
  /** Decision 48: the three Accounts pages, in the Handover page's design. */
  accounts: {
    dueBills: {
      sub: 'The bills your company still has to pay. Open one to see what is in it.',
      search: 'Search bills',
      openBill: 'Open the full bill',
      count: (n: number) => `${n} open ${n === 1 ? 'bill' : 'bills'}`,
      emptyTitle: 'No bills to pay',
      emptyText: 'Nothing is due right now. New bills from your stays appear here.',
      emptyFiltered: 'No bill matches this search.',
      tiles: { totalDue: 'Total due', openBills: 'Open bills' },
      cols: { bill: 'Bill', guest: 'Guest', hotel: 'Hotel', status: 'Status', due: 'Due' },
      due: 'Due',
      overdue: 'Overdue',
      detail: { hotel: 'Hotel', guest: 'Guest', mobile: 'Guest mobile', room: 'Room', plan: 'Meal plan', stay: 'Stay', hotelAmount: 'Room and hotel charges', foodAmount: 'Food', advance: 'Advance used', balanceHotel: 'Still due, hotel', balanceFood: 'Still due, food', reference: 'Your reference', note: 'Note' },
    },
    payments: {
      sub: 'What your company has paid, and the advances it gave.',
      search: 'Search payments',
      count: (n: number) => `${n} ${n === 1 ? 'payment' : 'payments'}`,
      emptyTitle: 'No payments yet',
      emptyText: 'Payments and advances appear here once the hotel records them.',
      emptyFiltered: 'No payment matches this search.',
      tiles: { received: 'Received' },
      cols: { mode: 'Paid by', for: 'For', hotel: 'Hotel', kind: 'Type', amount: 'Amount' },
      bill: 'Bill',
      payment: 'Payment',
      advance: 'Advance',
      detail: { hotel: 'Hotel', date: 'Date', kind: 'Type', mode: 'Paid by', reference: 'Reference', receipt: 'Receipt no.', bill: 'Bill', guest: 'Guest', note: 'Note' },
    },
    ledger: {
      sub: 'Every bill and payment of your account, with the balance after each line.',
      search: 'Search the ledger',
      print: 'Print statement',
      count: (n: number) => `${n} ${n === 1 ? 'line' : 'lines'}`,
      emptyTitle: 'Nothing in the ledger',
      emptyText: 'Bills and payments appear here as they are recorded.',
      emptyFiltered: 'No line matches this search.',
      periodLabel: 'Period',
      periods: { month: 'This month', last: 'Last month', year: 'This year', all: 'All time' } as Record<'month' | 'last' | 'year' | 'all', string>,
      tiles: { billed: 'Billed', received: 'Received', balance: 'Balance' },
      cols: { what: 'What', debit: 'Debit', credit: 'Credit', hotel: 'Hotel', balance: 'Balance' },
      capped: 'Only the newest lines are shown. Narrow the period to see the rest.',
      detail: { hotel: 'Hotel', date: 'Date', what: 'What', ref: 'Reference', guest: 'Guest', room: 'Room', mode: 'Paid by', note: 'Note', debit: 'Debit (you owe)', credit: 'Credit (you paid)', balance: 'Balance after this line' },
    },
  },
  /** The calm dashboard (no pay buttons) and the company's own profile. */
  calm: {
    intro: 'Your company at a glance. To pay a bill, open it from Bills.',
    cards: { totalDue: 'Total due', lastPayment: 'Last payment', billsThisMonth: 'Bills this month', credit: 'Credit with the hotel' },
    noPayment: 'No payment yet',
    welcome: 'Welcome',
    owes: (amount: string) => `Your company owes ${amount} at the moment.`,
    nothingDue: 'Nothing is due. All your bills are paid.',
    quick: { bills: 'Bills', payments: 'Payments', ledger: 'Statement' },
    attention: { title: 'Needs attention', sub: 'Your oldest open bills.', empty: 'Nothing is waiting. All bills are paid.', all: 'See all bills', age: (d: number) => `${d} ${d === 1 ? 'day' : 'days'} old` },
    recent: { title: 'Recent payments', sub: 'The last payments and advances.', empty: 'No payments yet.', all: 'See all payments' },
    byHotel: { title: 'By hotel' },
    chips: { due: 'Due', overdue: 'Overdue', advance: 'Advance', payment: 'Payment' },
    /** MJ, 26 Oct 2026: the accounts view (what is owed and how old it is) replaces "Bills this month" and the phone's welcome card. */
    overdueCard: 'Overdue',
    overdueSub: (n: number) => (n === 0 ? 'Nothing overdue' : n === 1 ? '1 bill past its due date' : `${n} bills past their due date`),
    ageing: { title: 'What you owe, by age', sub: 'Open bills by how long ago they were billed.', buckets: ['Up to 30 days', '31 to 60 days', '61 to 90 days', 'Over 90 days'] as const, none: 'Nothing is owed.' },
    payDue: 'Pay due bills',
    statement: 'Statement',
    openBill: (no: string) => `Open bill ${no}`,
  },
  portalProfile: {
    intro: 'Your company details at this hotel. You can keep the contact details up to date.',
    hotelPick: 'Hotel',
    hotelPickHint: 'Your company has a record at each hotel. Pick the one to see or change.',
    /** MJ, 26 Oct 2026: the hotel comes from the side menu. */
    shownFor: (hotel: string, common: boolean) =>
      common ? `The prices and percentages below are ${hotel}'s. Choose another hotel in the side menu to see its own.` : `This is your record at ${hotel}. Choose another hotel in the side menu to see or change its record.`,
    contactTitle: 'Contact details',
    contactSub: 'Change these and save. The hotel sees the update.',
    fields: { mainContactName: 'Contact person', email: 'Email', mobile: 'Mobile', landline: 'Phone', address: 'Address', pincode: 'Pincode', country: 'Country', gstin: 'GST number' },
    extraContacts: 'Other contacts',
    extraContactsSub: 'People at your company the hotel may call.',
    contact: { name: 'Name', role: 'Role', email: 'Email', mobile: 'Mobile' },
    addContact: 'Add a contact',
    removeContact: 'Remove this contact',
    save: 'Save changes',
    saving: 'Saving...',
    saved: 'Your details are saved.',
    pricingTitle: 'Prices and percentages',
    pricingNote: 'Set by the hotel. Ask the hotel to change them.',
    pricing: { discountPct: 'Discount', gstPct: 'GST', tcsPct: 'TCS', tdsPct: 'TDS' } as Record<'discountPct' | 'gstPct' | 'tcsPct' | 'tdsPct', string>,
    none: 'None',
  },
  portal: 'Company portal',
  businesses: {
    hotel: { name: 'Your hotel', short: 'Hotel', icon: 'building', what: 'Rooms, laundry and stay charges' },
    // same names as the guest portal and Bill Master mocks (guest.ts guestBusinesses, billing.ts billingHotel)
    food: { name: 'Your restaurant', short: 'Food', icon: 'utensils', what: 'Restaurant and room service' },
  } as Record<Business, { name: string; short: string; icon: string; what: string }>,
  hero: {
    eyebrow: 'Company account',
    owed: 'Total outstanding',
    credit: 'In credit with us',
    settled: 'All settled',
    gst: 'GST',
  },
  kinds: {
    bill: { label: 'Bill', icon: 'receipt' },
    advance: { label: 'Advance', icon: 'wallet' },
    checkout: { label: 'Paid at checkout', icon: 'card' },
    adjusted: { label: 'Advance used', icon: 'swap' },
    settlement: { label: 'Payment', icon: 'card' },
    refund: { label: 'Refund', icon: 'arrowUp' },
  } as Record<LedgerKind, { label: string; icon: string }>,
  billStatus: {
    paid: { label: 'Paid', tone: 'success' },
    due: { label: 'Due', tone: 'warning' },
    overdue: { label: 'Overdue', tone: 'danger' },
  } as Record<BillStatus, { label: string; tone: Tone }>,
  dashboard: {
    title: 'Overview',
    subtitle: "Where your company's account stands",
    quick: { pay: 'Pay bills', book: 'Book rooms', ledger: 'Open ledger', addUser: 'Add a user' },
    paySection: 'Pay',
    paySectionHint: 'Each business is paid into its own account',
    activity: 'Activity',
    activityHint: 'The last six months and the latest entries',
    chartTitle: 'Billed and paid',
    chartBilled: 'Billed',
    chartPaid: 'Paid',
    latestPayments: 'Latest payments',
    latestBills: 'Latest bills',
    seeLedger: 'Statement',
    seeAllPayments: 'All payments',
    seeAllBills: 'All bills',
    noPayments: 'No payments yet.',
    noBills: 'No bills yet.',
    oldestHintNone: 'Nothing waiting',
    oldestHintLate: 'Please settle soon',
    oldestHintOk: 'Within a month',
  },
  dues: {
    open: (n: number) => `${n} open ${n === 1 ? 'bill' : 'bills'}`,
    toPay: 'To pay',
    nothingDue: 'Nothing due',
    settled: 'Settled',
    pick: 'Pay',
    selectedBoth: 'Both businesses together',
    selectedOne: 'One business selected',
    selectedNone: 'Nothing selected',
    payBoth: 'Pay both together',
    payNow: 'Pay now',
    secure:
      'Secure payment by Razorpay: one payment per business into its own account, with a receipt each. The statement is also emailed.',
    confirmTitle: 'Confirm payment',
    confirmBody: (amount: string) =>
      `You are paying ${amount}. Razorpay checkout opens once for each business you ticked. (Preview: no money moves.)`,
    confirm: 'Pay',
    done: (amount: string) => `Paid ${amount}. Receipts are on the Payments page.`,
  },
  bills: {
    title: 'Bills',
    subtitle: 'Every bill raised for your company',
    columns: { date: 'Date', bill: 'Bill', hotel: 'Hotel', food: 'Food', total: 'Total', due: 'Due', status: 'Status' },
    tabs: { all: 'All', due: 'Due', overdue: 'Overdue', paid: 'Paid' } as Record<BillTab, string>,
    search: 'Search bill number, guest or room',
    /** Pallav's "The latest N" on page 1; later pages say which rows they are. */
    shown: (from: number, to: number, total: number) => (from <= 1 ? `The latest ${to} of ${total}` : `Bills ${from} to ${to} of ${total}`),
    emptyTitle: 'No bills here',
    emptyBody: 'No bills raised for this company yet.',
    emptyFiltered: 'No bills match. Try another search or tab.',
    reset: 'Reset',
  },
  bill: {
    title: (n: string) => `Bill ${n}`,
    stay: 'Stay',
    hotelSide: 'Hotel charges',
    foodSide: 'Food charges',
    payments: 'Payments on this bill',
    roomTariff: 'Room tariff',
    discount: 'Company discount',
    laundry: 'Laundry',
    gst: 'GST',
    food: 'Food and beverages',
    total: 'Total',
    advance: 'Advance used',
    paidAtCheckout: 'Paid at checkout',
    later: 'Paid later',
    balance: 'Balance due',
    onAccount: 'On account',
    invoice: 'View invoice',
    payThis: 'Pay this bill',
    payThisTitle: 'Pay this bill',
    noPayments: 'Nothing paid on this bill yet.',
    guest: 'Guest',
    mobile: 'Mobile',
    room: 'Room',
    plan: 'Plan',
    dates: 'Dates',
    reference: 'Booked by',
    note: 'Note',
  },
  payments: {
    title: 'Payments',
    subtitle: 'Money received from your company',
    summary: (n: number, sum: string) => `${n} received · ${sum} in all`,
    tabs: { all: 'All', settlement: 'Payments', advance: 'Advances', checkout: 'At checkout', adjusted: 'Advance used' } as Record<PaymentTab, string>,
    search: 'Search receipt, bill, guest or mode',
    emptyTitle: 'No payments yet',
    emptyBody: 'No payments received yet.',
    emptyFiltered: 'No payments match. Try another search or tab.',
    receipt: 'Receipt',
    receiptTitle: 'Payment receipt',
  },
  ledger: {
    title: 'Statement',
    subtitle: 'Your account with the hotel, line by line',
    toPay: 'To pay',
    toPayHint: 'Dues left on account, per business',
    totals: (billed: string, received: string, refunded: string | null) =>
      `Billed ${billed} · Received ${received}${refunded ? ` · Refunded ${refunded}` : ''}`,
    periods: { all: 'All time', month: 'This month', last: 'Last month', year: 'This financial year' } as Record<LedgerPeriod, string>,
    columns: { date: 'Date', details: 'Details', debit: 'Debit', credit: 'Credit', balance: 'Balance' },
    broughtForward: 'Brought forward from before this period',
    legend: 'Dr means the company owes the hotel. Cr means the hotel is holding the company’s money. Newest first.',
    capped: 'Showing the latest 5,000 lines',
    emptyAll: 'No entries yet.',
    emptyPeriod: 'No entries in this period.',
    statement: 'Statement',
    statementTitle: 'Account statement',
    opening: 'Opening balance',
    closing: 'Closing balance',
  },
  profile: {
    title: 'Company',
    subtitle: 'Your details as the hotel has them',
    rates: 'Billing rates',
    ratesHint: 'Applied to your bills',
    rateLabels: { discountPct: 'Discount', gstPct: 'GST', tcsPct: 'TCS', tdsPct: 'TDS' },
    none: '—',
    details: 'Company details',
    contacts: 'People to contact',
    billedBy: 'Billed by',
    fields: {
      name: 'Company name',
      gstin: 'GSTIN',
      email: 'Email',
      mobile: 'Mobile',
      landline: 'Landline',
      address: 'Address',
      since: 'Account since',
      phone: 'Phone',
    },
    changeNote: 'To change these details or rates, contact the hotel accounts team.',
    noContacts: 'No one recorded.',
  },
  preview: {
    badge: 'Preview',
    pdfNote: 'This is a preview. The PDF download comes with the live system.',
    print: 'Print',
    download: 'Download PDF',
    close: 'Close',
    amountInWords: 'Amount in words',
    taxInvoice: 'Tax invoice',
    billTo: 'Bill to',
  },
  common: {
    retry: 'Retry',
    back: 'Back',
    viewAll: 'View all',
    room: (r: string) => `Room ${r}`,
  },
} as const;

/** Pay within this many days before a bill counts as overdue (Pallav: "Please settle soon" after 30 days). */
export const PAY_WITHIN_DAYS = 30;

/** The mock's "today" (fixed so the data reads the same every day). */
export const MOCK_TODAY = '2026-11-05';
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Pure helpers (UI uses these; no React)
// ---------------------------------------------------------------------------

export function billTotalPaise(b: CompanyBill): number {
  return b.totalHotelPaise + b.totalFoodPaise;
}

export function billDuePaise(b: CompanyBill): number {
  return b.balanceHotelPaise + b.balanceFoodPaise;
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.UTC(Number(fromIso.slice(0, 4)), Number(fromIso.slice(5, 7)) - 1, Number(fromIso.slice(8, 10)));
  const b = Date.UTC(Number(toIso.slice(0, 4)), Number(toIso.slice(5, 7)) - 1, Number(toIso.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + days));
  return d.toISOString().slice(0, 10);
}

export function billStatus(b: CompanyBill, today: string = MOCK_TODAY): BillStatus {
  if (billDuePaise(b) <= 0) return 'paid';
  return daysBetween(b.billDate, today) > PAY_WITHIN_DAYS ? 'overdue' : 'due';
}

/** "Dr" when the company owes, "Cr" when the hotel holds its money, "" at zero. */
export function balanceSide(paise: number): 'Dr' | 'Cr' | '' {
  if (paise > 0) return 'Dr';
  if (paise < 0) return 'Cr';
  return '';
}

/** "Bill HS-2041 · Rohan Mehta · Room 204 · NEFT" */
export function ledgerLineSubtitle(l: LedgerLine): string {
  const mode = l.kind === 'bill' && l.mode === 'On account' ? 'On account' : l.mode;
  return [l.ref, l.guest, l.room ? `Room ${l.room}` : null, mode].filter(Boolean).join(' · ');
}

/** "Rohan Mehta · Room 204" */
export function billSubtitle(b: CompanyBill): string {
  return [b.guestName, b.roomNumber ? `Room ${b.roomNumber}` : null].filter(Boolean).join(' · ');
}

export function formatPct(v: number): string | null {
  if (!v || v <= 0) return null;
  return `${Number.isInteger(v) ? v : Number(v.toFixed(2))}%`;
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}

// ---------------------------------------------------------------------------
// Mock API
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Company portal redesign (decision 48): the calm dashboard, the three Accounts pages and the company's own profile, over several hotels.
// Every row carries its hotel; the sidebar's hotel choice is sent as `?hotel=` by the adapter. Shapes as in docs/BACKEND.md (decision 48 contract).
// ---------------------------------------------------------------------------

export interface HotelTag {
  hotelId: string;
  hotelName: string;
}

export interface HotelDue extends HotelTag {
  totalDuePaise: number;
}

export interface CorpDashboard {
  cards: {
    totalDuePaise: number;
    creditPaise: number;
    billsThisMonth: number;
    lastPayment: { date: string; amountPaise: number; mode: string | null; hotelName: string } | null;
  };
  /** What is owed by age of the bill (MJ, 26 Oct 2026: the accounts view a company's payables team expects): up to 30 days, 31-60, 61-90 and over 90. */
  ageing?: { upTo30Paise: number; upTo60Paise: number; upTo90Paise: number; over90Paise: number; overdueCount: number; overduePaise: number };
  /** The 5 oldest open bills. */
  attention: (HotelTag & { billId: string; billNumber: string; billDate: string; guestName: string; duePaise: number; ageDays: number; status: 'due' | 'overdue' })[];
  /** The last 5 payments and advances. */
  recentPayments: (HotelTag & { id: string; date: string; amountPaise: number; mode: string | null; reference: string | null; kind: 'payment' | 'advance' })[];
  byHotel: HotelDue[];
  /** Notifications the hotels sent that this company has not read yet, over the hotels asked for (the sidebar badge; ui-shared/dashboards/notifications.ts). */
  unreadNotifications: number;
  /** Linked hotels missing from these figures (failed, ran late, or past the 25th); empty when all answered. */
  unavailable?: PortalPartial['unavailable'];
}

export interface AccountsQuery extends PortalCursorQuery {
  search?: string;
  page?: number;
  pageSize?: number;
  /** Ledger only. */
  period?: 'month' | 'last' | 'year' | 'all';
}

export interface DueBillRow extends HotelTag {
  id: string;
  billNumber: string;
  billDate: string;
  guestName: string;
  duePaise: number;
  ageDays: number;
  status: 'due' | 'overdue';
  detail: {
    persons?: BillPersons;
    guestMobile: string | null;
    roomNumber: string | null;
    plan: string | null;
    checkIn: string | null;
    nights: number | null;
    hotelAmountPaise: number;
    foodAmountPaise: number;
    advancePaise: number;
    balanceHotelPaise: number;
    balanceFoodPaise: number;
    reference: string | null;
    note: string | null;
  };
}

export interface DueBillsPage extends Page<DueBillRow>, PortalPartial {
  summary: { totalDuePaise: number; openBills: number; byHotel: HotelDue[] };
}

export interface PaymentRow extends HotelTag {
  id: string;
  date: string;
  amountPaise: number;
  mode: string | null;
  reference: string | null;
  kind: 'payment' | 'advance';
  detail: { billNumber: string | null; guestName: string | null; receipt: string | null; note: string | null };
}

export interface PaymentHistoryPage extends Page<PaymentRow>, PortalPartial {
  summary: { receivedPaise: number; byHotel: (HotelTag & { receivedPaise: number })[] };
}

export interface LedgerRow extends HotelTag {
  id: string;
  date: string;
  what: string;
  debitPaise: number;
  creditPaise: number;
  /** The running balance WITHIN this hotel. */
  balancePaise: number;
  detail: { kind: LedgerKind | string; ref: string | null; guest: string | null; room: string | null; mode: string | null; note: string | null; billId: string | null };
}

export interface LedgerAccountPage extends Page<LedgerRow>, PortalPartial {
  totals: LedgerTotals;
  byHotel: (HotelTag & { openingPaise: number; closingPaise: number })[];
  capped?: boolean;
}

export interface PortalContact {
  name: string;
  role: string;
  email: string;
  mobile: string;
}

/** The company's own record at ONE hotel. The percentages are the hotel's: read-only for the company ("set by the hotel"). */
export interface PortalProfile extends HotelTag {
  id: string;
  name: string;
  mainContactName: string | null;
  email: string;
  mobile: string;
  landline: string | null;
  address: string;
  pincode: string;
  country: string;
  gstin: string;
  contacts: PortalContact[];
  pricing: { discountPct: number; gstPct: number; tcsPct: number; tdsPct: number };
  setByHotel: true;
  /**
   * The ONE common profile (platform 0132; docs/plans/CENTRAL-GUEST-COMPANY-PLAN-2026-10-18.md): true = the contact details and GSTIN above are the company's one profile,
   * the same at every hotel (a save changes them everywhere; `?hotel=` then only picks whose prices are shown). false = this hotel's own record (before the change is live).
   * Optional until every server sends it.
   */
  common?: boolean;
  /** When `common`: who last changed the ONE profile, from which hotel, when (profileReview.ts ProfileLastChange; show `lastChangeLine`). Read-only. */
  lastChange?: ProfileLastChange | null;
  /** The login's profile photo (GET /profile/photo, admin.ts profilePhotoPath), or null. Optional until every server sends it. */
  photoUrl?: string | null;
}

/** What the company may change: contact fields only. A percentage or any other field is a 422 on the server. With the one common profile `?hotel=` is not needed. */
export interface PortalProfileInput {
  mainContactName?: string;
  email?: string;
  mobile?: string;
  landline?: string;
  address?: string;
  pincode?: string;
  country?: string;
  gstin?: string;
  contacts?: PortalContact[];
}

export interface CorporateApi {
  /** The hotels this login is linked to (the selector's list). */
  listHotels(): Promise<DashResult<{ hotelId: string; name: string }[]>>;
  getDashboard(): Promise<DashResult<CorpDashboard>>;
  listDueBills(q: AccountsQuery): Promise<DashResult<DueBillsPage>>;
  listPaymentHistory(q: AccountsQuery): Promise<DashResult<PaymentHistoryPage>>;
  getLedgerAccount(q: AccountsQuery): Promise<DashResult<LedgerAccountPage>>;
  /** `hotelId` = the hotel whose record is read (the first linked one when omitted). */
  getPortalProfile(hotelId?: string): Promise<DashResult<PortalProfile>>;
  /** The hotel is required: the company edits its record in one hotel at a time. */
  savePortalProfile(hotelId: string, input: PortalProfileInput): Promise<DashResult<PortalProfile>>;
  getBill(id: string): Promise<DashResult<BillDetail>>;
  /** Pay the open dues of the ticked businesses (oldest bills first). Preview: no money moves. */
  payDues(businesses: Business[]): Promise<DashResult<PaymentReceipt[]>>;
  /** Pay everything still due on one bill. */
  payBill(id: string): Promise<DashResult<PaymentReceipt[]>>;
}
