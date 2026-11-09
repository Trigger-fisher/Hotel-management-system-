// Overview module (Hotel dashboard): Dashboard, Reports (Daily Report, Food Plan) and Books (accounting years).
// Source: Hotel Pallav DashboardController + dashboard view, ReportController + reports views
// (AccountReports, DailySheet, FoodPlanMonth) and BooksController + books view. Screens, fields and behaviour only.
// Pure TypeScript: no React, no imports outside ui-shared. Money in paise, dates as YYYY-MM-DD (IST), times as ISO.

import { formatDate, formatINR, formatMonth } from './format';
import { mockEmptyHotel, type DashResult, type Tone } from './common';
import type { CashDeposit, CashExpense, ShiftHandover } from './cash';

/* ================================================================== dates (IST) */

export const DAY_MS = 86_400_000;
export const IST_MS = 330 * 60_000;

/** Today in IST as YYYY-MM-DD. */
export function istToday(): string {
  return new Date(Date.now() + IST_MS).toISOString().slice(0, 10);
}

export function toUtc(d: string): number {
  const [y, m, dd] = d.split('-').map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, dd ?? 1);
}

function fromUtc(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

export function addDays(d: string, n: number): string {
  return fromUtc(toUtc(d) + n * DAY_MS);
}

/** "2026-10" from "2026-10-05". */
export function monthOf(d: string): string {
  return d.slice(0, 7);
}

/** "2026-10" + 1 -> "2026-11". */
export function addMonths(yyyyMm: string, n: number): string {
  const [y, m] = yyyyMm.split('-').map(Number);
  const idx = (y ?? 1970) * 12 + ((m ?? 1) - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

export function daysInMonth(yyyyMm: string): number {
  const first = `${yyyyMm}-01`;
  return Math.round((toUtc(`${addMonths(yyyyMm, 1)}-01`) - toUtc(first)) / DAY_MS);
}

/** Full month name: "October". */
export function monthName(yyyyMm: string): string {
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return names[Number(yyyyMm.slice(5, 7)) - 1] ?? '';
}

/** "Today", "Yesterday" or "04 Oct 2026". */
export function dayLabel(d: string, today: string = istToday()): string {
  if (d === today) return 'Today';
  if (d === addDays(today, -1)) return 'Yesterday';
  return formatDate(d);
}

/** The accounting year (1 Apr - 31 Mar) a date falls in, e.g. 2026 for 2026-10-05 and 2025 for 2026-02-10. */
export function fyStartYear(d: string): number {
  const y = Number(d.slice(0, 4));
  return Number(d.slice(5, 7)) >= 4 ? y : y - 1;
}

/** "2026-27". */
export function fyLabel(startYear: number): string {
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

/* ================================================================== 1. Dashboard */

export type CashBookUnit = 'hotel' | 'food';
export type Direction = 'in' | 'out';
export type CashEntryKind = 'Deposit' | 'Withdrawal' | 'Expense' | 'Staff advance';

/** One movement in a cash book (deposit in; withdrawal, expense, staff advance out). */
export interface CashEntry {
  id: string;
  unit: CashBookUnit;
  direction: Direction;
  kind: CashEntryKind;
  /** Spending head for money out (expense head, "Cash withdrawals", "Staff advances"); null for deposits. */
  head: string | null;
  /** Depositor, withdrawer, expense name or staff name. */
  who: string;
  entryNo: string;
  /** Who recorded it. */
  by: string;
  amountPaise: number;
  /** ISO date-time. */
  at: string;
}

export interface CashBookSummary {
  unit: CashBookUnit;
  name: string;
  todayInPaise: number;
  todayOutPaise: number;
  todayCount: number;
  monthInPaise: number;
  monthOutPaise: number;
}

export interface TrendDay {
  date: string;
  inPaise: number;
  outPaise: number;
}

export interface SpendingHead {
  head: string;
  totalPaise: number;
  count: number;
}

export interface HandoverSnapshot {
  today: number;
  todayCashPaise: number;
  month: number;
  latest: { shift: string; at: string; by: string } | null;
}

export interface PayrollSnapshot {
  activeStaff: number;
  joinedThisMonth: number;
  openCount: number;
  openAmountPaise: number;
  /** Oldest unpaid salary month, "2026-08"; null when all are paid. */
  openSince: string | null;
  advancesPaise: number;
  advanceCount: number;
  paidPaise: number;
  paidCount: number;
}

export interface AttentionItem {
  id: string;
  tone: Extract<Tone, 'warning' | 'info'>;
  text: string;
  action: string;
  /** View to open (nav id of another module). */
  viewId: string;
}

/** The front desk's day in numbers (the "Front desk today" row; the server sends it only to people with the Front Office). */
export interface FrontDeskSnapshot {
  arrivals: number;
  departures: number;
  inHouse: number;
  roomsToClean: number;
  roomsReady: number;
}

export interface HotelDashboard {
  today: string;
  /** Absent or null for a person without the Front Office. */
  frontDesk?: FrontDeskSnapshot | null;
  /** "2026-10" */
  month: string;
  lastMonth: string;
  handovers: HandoverSnapshot;
  day: { inPaise: number; outPaise: number; count: number; yesterdayInPaise: number };
  monthToDate: { inPaise: number; outPaise: number; lastInPaise: number; lastOutPaise: number };
  books: CashBookSummary[];
  /** Last 30 days, oldest first. */
  trend: TrendDay[];
  spending: { totalPaise: number; heads: SpendingHead[] };
  recent: CashEntry[];
  /** Null for a Hotel User: the server never sends them salary figures (MJ, 5 Nov 2026). */
  payroll: PayrollSnapshot | null;
  attention: AttentionItem[];
}

/** Attention items about salaries, which a Hotel User never gets. */
export const PAYROLL_ATTENTION_IDS: readonly string[] = ['salary'];

/** True for the role that never sees payroll on Overview (the Hotel User; the Hotel Admin and the roles above keep it). */
export function hidesPayroll(role: string): boolean {
  return role === 'hotel_user';
}

/** The attention list as this person may see it. */
export function attentionForRole(items: AttentionItem[], role: string): AttentionItem[] {
  return hidesPayroll(role) ? items.filter((a) => !PAYROLL_ATTENTION_IDS.includes(a.id)) : items;
}

/** The Overview as this person may see it: a Hotel User gets no payroll row and no salary attention. */
export function dashboardForRole(d: HotelDashboard, role: string): HotelDashboard {
  return hidesPayroll(role) ? { ...d, payroll: null, attention: attentionForRole(d.attention, role) } : d;
}

/** Mock only: lets reviewers see the empty and "All clear" states. */
export type DashboardScenario = 'normal' | 'empty' | 'allClear';

export const bookNames: Record<CashBookUnit, string> = { hotel: 'Hotel book', food: 'Food book' };

const sumOf = (list: CashEntry[], dir: Direction) => list.filter((e) => e.direction === dir).reduce((s, e) => s + e.amountPaise, 0);

/** Things somebody still has to do today (same three checks as Pallav). */
function attentionFor(payroll: PayrollSnapshot | null, handoversToday: number, entriesToday: number): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (!handoversToday) {
    items.push({ id: 'handover', tone: 'warning', text: 'No shift handover recorded today', action: 'Record handover', viewId: 'hotel.cash.handover' });
  }
  if (payroll?.openCount) {
    const many = payroll.openCount === 1 ? 'payment is' : 'payments are';
    items.push({
      id: 'salary',
      tone: 'warning',
      text: `${payroll.openCount} salary ${many} still open, ${formatINR(payroll.openAmountPaise)} to pay`,
      action: 'Salary payments',
      viewId: 'hotel.payroll.salaryPayments',
    });
  }
  if (!entriesToday) {
    items.push({ id: 'entries', tone: 'info', text: 'Nothing entered in either cash book today', action: 'Open revenue', viewId: 'hotel.cash.revenue' });
  }
  return items;
}

/** The home screen's figures from a list of cash movements (`at` in IST, "2026-10-06T14:05:00+05:30"), the handover snapshot and payroll. */
export function assembleDashboard(today: string, all: CashEntry[], handovers: HandoverSnapshot, payroll: PayrollSnapshot | null): HotelDashboard {
  const month = monthOf(today);
  const lastMonth = addMonths(month, -1);
  const monthStart = `${month}-01`;
  const lastMonthStart = `${lastMonth}-01`;
  const sameDay = Math.min(Number(today.slice(8, 10)), daysInMonth(lastMonth));
  const lastMonthSameDay = `${lastMonth}-${String(sameDay).padStart(2, '0')}`;
  const trendStart = addDays(today, -29);
  const between = (a: string, b: string) => all.filter((e) => e.at.slice(0, 10) >= a && e.at.slice(0, 10) <= b);

  const todayLines = between(today, today);
  const yesterday = between(addDays(today, -1), addDays(today, -1));
  const monthLines = between(monthStart, today);
  const lastMonthLines = between(lastMonthStart, lastMonthSameDay);

  const books: CashBookSummary[] = (['hotel', 'food'] as const).map((unit) => {
    const t = todayLines.filter((e) => e.unit === unit);
    const m = monthLines.filter((e) => e.unit === unit);
    return {
      unit, name: bookNames[unit],
      todayInPaise: sumOf(t, 'in'), todayOutPaise: sumOf(t, 'out'), todayCount: t.length,
      monthInPaise: sumOf(m, 'in'), monthOutPaise: sumOf(m, 'out'),
    };
  });

  const trend: TrendDay[] = [];
  for (let d = trendStart; d <= today; d = addDays(d, 1)) {
    const rows = between(d, d);
    trend.push({ date: d, inPaise: sumOf(rows, 'in'), outPaise: sumOf(rows, 'out') });
  }

  // What this month's money out went on; six rows at most, the rest folded into one.
  const outLines = monthLines.filter((e) => e.direction === 'out');
  const byHead = new Map<string, SpendingHead>();
  for (const e of outLines) {
    const key = e.head ?? 'Unsorted';
    const h = byHead.get(key) ?? { head: key, totalPaise: 0, count: 0 };
    h.totalPaise += e.amountPaise;
    h.count += 1;
    byHead.set(key, h);
  }
  let heads = [...byHead.values()].sort((a, b) => b.totalPaise - a.totalPaise);
  if (heads.length > 6) {
    const rest = heads.slice(5);
    heads = [...heads.slice(0, 5), {
      head: `${rest.length} other heads`,
      totalPaise: rest.reduce((s, h) => s + h.totalPaise, 0),
      count: rest.reduce((s, h) => s + h.count, 0),
    }];
  }

  const recent = [...all].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 7);

  return {
    today,
    month,
    lastMonth,
    handovers,
    day: { inPaise: sumOf(todayLines, 'in'), outPaise: sumOf(todayLines, 'out'), count: todayLines.length, yesterdayInPaise: sumOf(yesterday, 'in') },
    monthToDate: { inPaise: sumOf(monthLines, 'in'), outPaise: sumOf(monthLines, 'out'), lastInPaise: sumOf(lastMonthLines, 'in'), lastOutPaise: sumOf(lastMonthLines, 'out') },
    books,
    trend,
    spending: { totalPaise: outLines.reduce((s, e) => s + e.amountPaise, 0), heads },
    recent,
    payroll,
    attention: attentionFor(payroll, handovers.today, todayLines.length),
  };
}

/** What the home screen needs from the cash book (Revenue, Expenses, Shift Handover rows; see cash.ts). */
export interface DashboardCashSource {
  deposits: CashDeposit[];
  expenses: CashExpense[];
  handovers: ShiftHandover[];
}

/** UTC ISO to the IST form the dashboard reads ("2026-10-06T14:05:09+05:30"), so `.slice(0, 10)` is the IST day. */
function toIstIso(iso: string): string {
  return `${new Date(Date.parse(iso) + IST_MS).toISOString().slice(0, 19)}+05:30`;
}

/**
 * Mock mode: the home screen's cash and handover figures worked out from the same in-memory cash book the Revenue, Expenses and
 * Shift Handover screens use, so a deposit, expense or handover saved there shows on the home screen at once. Payroll comes from `base`.
 */
export function dashboardFromCash(base: HotelDashboard, src: DashboardCashSource): HotelDashboard {
  const today = istToday();
  const no = (n: number) => String(n).padStart(4, '0');
  const all: CashEntry[] = [
    ...src.deposits.map((d): CashEntry => ({
      id: d.id, unit: d.book, direction: 'in', kind: 'Deposit', head: null, who: d.depositor, entryNo: no(d.entryNo), by: d.recordedBy.name, amountPaise: d.amountPaise, at: toIstIso(d.at),
    })),
    ...src.expenses.map((e): CashEntry => {
      const kind: CashEntryKind = e.kind === 'withdrawal' ? 'Withdrawal' : e.kind === 'advance' ? 'Staff advance' : 'Expense';
      const head = e.kind === 'withdrawal' ? 'Cash withdrawals' : e.kind === 'advance' ? 'Staff advances' : (e.lines[0]?.categoryName ?? 'Miscellaneous');
      const who = e.kind === 'withdrawal' ? (e.withdrawer ?? '') : e.kind === 'advance' ? (e.employee?.name ?? 'Staff member') : (e.lines.map((l) => l.itemName).join(', ') || (e.expenseName ?? ''));
      return { id: e.id, unit: e.book, direction: 'out', kind, head, who, entryNo: no(e.entryNo), by: e.recordedBy.name, amountPaise: e.amountPaise, at: toIstIso(e.at) };
    }),
  ];
  const month = monthOf(today);
  const ho = src.handovers.map((h) => ({ h, at: toIstIso(h.at) }));
  const todayHo = ho.filter((x) => x.at.slice(0, 10) === today);
  const newest = [...ho].sort((a, b) => (a.at < b.at ? 1 : -1))[0];
  const handovers: HandoverSnapshot = {
    today: todayHo.length,
    todayCashPaise: todayHo.reduce((s, x) => s + x.h.totalPaise, 0),
    month: ho.filter((x) => x.at.slice(0, 7) === month).length,
    latest: newest ? { shift: newest.h.shift, at: newest.at, by: newest.h.handedBy.name } : null,
  };
  const advances = all.filter((e) => e.kind === 'Staff advance' && e.at.slice(0, 7) === month);
  // A brand-new mock hotel has no staff or salaries yet: payroll starts at zero, not the demo hotel's figures.
  const basePayroll: PayrollSnapshot | null = mockEmptyHotel()
    ? { activeStaff: 0, joinedThisMonth: 0, openCount: 0, openAmountPaise: 0, openSince: null, advancesPaise: 0, advanceCount: 0, paidPaise: 0, paidCount: 0 }
    : base.payroll;
  const payroll: PayrollSnapshot | null = basePayroll && { ...basePayroll, advancesPaise: advances.reduce((s, e) => s + e.amountPaise, 0), advanceCount: advances.length };
  return { ...assembleDashboard(today, all, handovers, payroll), frontDesk: base.frontDesk ?? null };
}

/** Percent change, rounded; null when there is nothing to compare with. */
export function pctChange(now: number, before: number): number | null {
  return before > 0 ? Math.round(((now - before) / before) * 100) : null;
}

/** The last `days` of the trend with its totals (chart range 7 / 14 / 30). */
export function trendWindow(trend: TrendDay[], days: number): { days: TrendDay[]; inPaise: number; outPaise: number } {
  const slice = trend.slice(-days);
  return { days: slice, inPaise: slice.reduce((s, d) => s + d.inPaise, 0), outPaise: slice.reduce((s, d) => s + d.outPaise, 0) };
}

/** "3 entries" / "1 entry". */
export function plural(n: number, one: string, many?: string): string {
  return `${n} ${n === 1 ? one : (many ?? `${one}s`)}`;
}

/* ================================================================== 2. Reports */

export type ReportTypeId =
  | 'daily-report' | 'food-plan' | 'cash-book' | 'monthly-summary' | 'expense-heads'
  | 'revenue-sources' | 'receivables' | 'advance-ledger' | 'bill-register';

export interface ReportType {
  id: ReportTypeId;
  name: string;
  hint: string;
  icon: string;
  /** Offered now (Pallav offers only these two); the rest are shown as "Coming soon". */
  offered: boolean;
  /** View that opens it. */
  viewId: string | null;
  period: 'day' | 'month' | 'range';
}

export const reportTypes: ReportType[] = [
  { id: 'daily-report', name: 'Daily report', hint: 'One day at the front desk: cash in and out, the food plan for the night, money received online and bills on credit.', icon: 'calendar', offered: true, viewId: 'hotel.reports.daily', period: 'day' },
  { id: 'food-plan', name: 'Meal plans', hint: 'Guests on a meal plan in the month, guest by guest, with the plan total for each.', icon: 'utensils', offered: true, viewId: 'hotel.reports.foodPlan', period: 'month' },
  { id: 'cash-book', name: 'Day Book', hint: 'Every rupee in and out for a date range, with a running balance.', icon: 'book', offered: false, viewId: null, period: 'range' },
  { id: 'monthly-summary', name: 'Monthly Summary', hint: 'Day by day income, expense and closing balance for a month.', icon: 'calendar', offered: false, viewId: null, period: 'month' },
  { id: 'expense-heads', name: 'Expense Analysis', hint: 'What the money went on, grouped by expense head.', icon: 'chart', offered: false, viewId: null, period: 'range' },
  { id: 'revenue-sources', name: 'Revenue by Source', hint: 'Which collection point brought the cash in.', icon: 'rupee', offered: false, viewId: null, period: 'range' },
  { id: 'receivables', name: 'Outstanding Bills', hint: 'Debit bills still unpaid, oldest first, with days pending.', icon: 'clock', offered: false, viewId: null, period: 'range' },
  { id: 'advance-ledger', name: 'Staff Advance Ledger', hint: 'Advances paid to staff and what is still to be recovered.', icon: 'users', offered: false, viewId: null, period: 'range' },
  { id: 'bill-register', name: 'Bill Register', hint: 'Every bill raised in the period with hotel and food totals.', icon: 'receipt', offered: false, viewId: null, period: 'range' },
];

export type MealPlan = 'CP' | 'MAP' | 'AP';
export const mealPlans: MealPlan[] = ['CP', 'MAP', 'AP'];
export const mealPlanText: Record<MealPlan, string> = {
  CP: 'CP plan (breakfast)',
  MAP: 'MAP plan (breakfast + one meal)',
  AP: 'AP plan (all meals)',
};
/** Plan rate per person per night (from Master Data in the real app; no GST). */
export const mealPlanRatePaise: Record<MealPlan, number> = { CP: 25000, MAP: 55000, AP: 85000 };

export type PayMode = 'Cash' | 'UPI' | 'Card' | 'OTA' | 'Bank transfer' | 'Credit' | 'Complimentary';
export type DayLineKind = 'Bill' | 'Advance' | 'Refund' | 'Collection' | 'Expense' | 'Withdrawal' | 'Staff advance';

/** One line of the day sheet: Room, Ref, Particulars, Amount. */
export interface DayLine {
  id: string;
  kind: DayLineKind;
  room: string | null;
  ref: string | null;
  particulars: string;
  note: string | null;
  mode: PayMode;
  /** Company that pays a debit bill later. */
  party: string | null;
  amountPaise: number;
  /** A bill paid in full from an advance moved no money today ("From advance"). */
  fromAdvancePaise: number;
}

export interface FoodPlanTonight {
  id: string;
  room: string;
  bill: string;
  guest: string;
  company: string | null;
  plan: MealPlan;
  persons: number;
  ratePaise: number;
  amountPaise: number;
}

export interface DailyTotals {
  openingPaise: number;
  cashInPaise: number;
  cashOutPaise: number;
  cashOnHandPaise: number;
  foodPlanPaise: number;
  carryForwardPaise: number;
  bankedInPaise: number;
  debitPaise: number;
  complimentaryPaise: number;
  /** Cash in + online + on credit. */
  revenuePaise: number;
  /** Cash out + food plan. */
  paidOutPaise: number;
  netPaise: number;
  entries: number;
}

export interface DailyReport {
  date: string;
  cashIn: DayLine[];
  cashOut: DayLine[];
  banked: DayLine[];
  debit: DayLine[];
  complimentary: DayLine[];
  foodPlan: FoodPlanTonight[];
  totals: DailyTotals;
}

export interface FoodPlanPart {
  from: string;
  to: string;
  plan: MealPlan;
  persons: number;
  ratePaise: number;
  nights: number;
  amountPaise: number;
}

export interface FoodPlanRow {
  id: string;
  guest: string;
  company: string | null;
  room: string;
  bill: string;
  arrival: string;
  departure: string;
  plans: MealPlan[];
  persons: number[];
  ratesPaise: number[];
  nightCount: number;
  personNights: number;
  amountPaise: number;
  /** Nights of this stay that fall in another month. */
  outside: number;
  /** Night by night, consecutive same nights run together. */
  parts: FoodPlanPart[];
}

export interface FoodPlanByPlan {
  plan: MealPlan;
  personNights: number;
  ratesPaise: number[];
  amountPaise: number;
}

export interface FoodPlanMonthReport {
  month: string;
  plan: MealPlan | null;
  plans: MealPlan[];
  rows: FoodPlanRow[];
  byPlan: FoodPlanByPlan[];
  totals: { guests: number; nights: number; personNights: number; amountPaise: number };
}

/** Lines that contain every word of the search (Pallav report search). Totals stay the day's, not the search's. */
export function searchLines<T>(rows: T[], search: string, text: (row: T) => string): T[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return rows;
  return rows.filter((row) => {
    const t = text(row).toLowerCase();
    return words.every((w) => t.includes(w));
  });
}

export const dayLineText = (l: DayLine) => [l.room, l.ref, l.particulars, l.note, l.party, l.mode, l.kind].filter(Boolean).join(' ');
export const foodTonightText = (f: FoodPlanTonight) => [f.room, f.bill, f.guest, f.company, f.plan].filter(Boolean).join(' ');
export const foodRowText = (f: FoodPlanRow) => [f.guest, f.room, f.bill, f.company, ...f.plans].filter(Boolean).join(' ');

/** "₹550.00" for one rate, "Varies" when the rate changed. */
export function rateText(rates: number[]): string {
  return rates.length === 1 ? formatINR(rates[0] ?? 0) : 'Varies';
}

/** Detail under a day-sheet line: kind (unless the note already says it) and note. */
export function dayLineDetail(l: DayLine): string {
  const firstWord = l.kind.split(' ')[0]?.toLowerCase() ?? '';
  const kind = l.note && l.note.toLowerCase().includes(firstWord) ? null : l.kind;
  return [kind, l.note].filter(Boolean).join(' · ');
}

/** Report period navigation, capped at today / this month (Pallav). */
export function dayNav(date: string, today: string = istToday()) {
  const prev = addDays(date, -1);
  const next = addDays(date, 1);
  return { prev, next, canNext: next <= today, prevLabel: formatDate(prev).slice(0, 6), nextLabel: formatDate(next).slice(0, 6) };
}

export function monthNav(month: string, today: string = istToday()) {
  const prev = addMonths(month, -1);
  const next = addMonths(month, 1);
  return { prev, next, canNext: next <= monthOf(today), prevLabel: formatMonth(prev), nextLabel: formatMonth(next) };
}

/** Month picker options: this month back 24 months, newest first. */
export function monthOptions(today: string = istToday(), count = 24): { value: string; label: string }[] {
  const m = monthOf(today);
  return Array.from({ length: count }, (_, i) => {
    const v = addMonths(m, -i);
    return { value: v, label: `${monthName(v)} ${v.slice(0, 4)}` };
  });
}

/** A date from a picker, kept between 01 Apr 2023 (oldest books) and today. */
export function clampReportDate(d: string, today: string = istToday()): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return today;
  if (d > today) return today;
  if (d < OLDEST_DATE) return OLDEST_DATE;
  return d;
}

const OLDEST_DATE = '2023-04-01';

export function isMealPlan(v: string | undefined | null): v is MealPlan {
  return v === 'CP' || v === 'MAP' || v === 'AP';
}

/* ================================================================== 3. Books (accounting years) */

/** Display names of the dated tables, by the key the server sends (used by the mock). */
export const bookTableNames: Record<string, string> = {
  hotel_cash_deposits: 'Hotel deposits', food_cash_deposits: 'Food deposits',
  hotel_cash_withdrawals: 'Hotel withdrawals', food_cash_withdrawals: 'Food withdrawals',
  hotel_misc_expenses: 'Hotel expenses', food_misc_expenses: 'Food expenses',
  shift_handovers: 'Handovers', bill_master_bills: 'Bills', bill_master_advances: 'Guest advances',
  staff_advances: 'Staff advances (cash)', payroll_advances: 'Payroll advances', bonus_incentives: 'Bonus and incentives',
  employee_meal_periods: 'Staff meal periods', salary_processings: 'Salary runs', attendance_months: 'Attendance months',
};

export interface YearCount {
  key: string;
  name: string;
  count: number;
}

/** Server shape of one accounting year (GET admin/books). */
export interface AccountingYear {
  id: string;
  /** "2026-27" */
  label: string;
  /** 1 April */
  startsOn: string;
  /** 31 March */
  endsOn: string;
  /** The open year (the newest). */
  current: boolean;
  /** ISO time the year was closed; null while open. */
  closedAt: string | null;
  /** Rows dated in the year, per table. */
  counts: YearCount[];
}

export interface CarriedItem {
  count: number;
  amountPaise: number;
}

export interface BooksCarried {
  cashPaise: number | null;
  bills: CarriedItem;
  advances: CarriedItem;
  payroll: CarriedItem;
  salaries: CarriedItem;
}

export interface BooksOverview {
  /** Newest first. */
  years: AccountingYear[];
  next: { label: string; startsOn: string; endsOn: string };
  /** Why the next year cannot be started now; null when it can. */
  cannotStart: string | null;
  /** Why the newest year cannot be removed; null when it can. */
  cannotRemove: string | null;
  /** What older years left open; null when there is no current year. */
  carried: BooksCarried | null;
}

/** The open year (flagged `current`), if any. */
export function currentYear(o: Pick<BooksOverview, 'years'>): AccountingYear | undefined {
  return o.years.find((y) => y.current) ?? o.years[0];
}

/** "Apr 2026 - Mar 2027". */
export function yearSpan(y: Pick<AccountingYear, 'startsOn' | 'endsOn'>): string {
  return `${formatMonth(monthOf(y.startsOn))} - ${formatMonth(monthOf(y.endsOn))}`;
}

export function yearTotal(y: Pick<AccountingYear, 'counts'>): number {
  return y.counts.reduce((s, c) => s + c.count, 0);
}

export function removeConfirmText(label: string): string {
  return `DELETE ${label}`;
}

/* ================================================================== API */

/** One night of the occupancy report. */
export interface OccupancyDay {
  date: string;
  /** Rooms with a guest that night. */
  roomsSold: number;
  /** The night's room charges (the stays' rates), paise. */
  roomRevenuePaise: number;
  arrivals: number;
  departures: number;
  /** roomsSold / rooms, in percent (one decimal). */
  occupancyPct: number;
}

/** Occupancy, ADR (average daily rate) and RevPAR (revenue per available room) for one month, night by night. */
export interface OccupancyReport {
  /** "2026-10" */
  month: string;
  /** Rooms in service (not out of order) on the day the report was made. */
  rooms: number;
  /** Nights up to today for the current month, the whole month otherwise. */
  days: OccupancyDay[];
  totals: { nights: number; roomNights: number; roomsSold: number; roomRevenuePaise: number; occupancyPct: number; adrPaise: number; revParPaise: number; arrivals: number; departures: number };
}

/** The totals of a month from its nights (the server and the mock both use it). ADR = room revenue / rooms sold; RevPAR = room revenue / (rooms x nights). */
export function assembleOccupancy(month: string, rooms: number, days: OccupancyDay[]): OccupancyReport {
  const nights = days.length;
  const roomNights = rooms * nights;
  const roomsSold = days.reduce((s, d) => s + d.roomsSold, 0);
  const roomRevenuePaise = days.reduce((s, d) => s + d.roomRevenuePaise, 0);
  return {
    month,
    rooms,
    days,
    totals: {
      nights,
      roomNights,
      roomsSold,
      roomRevenuePaise,
      occupancyPct: roomNights ? Math.round((roomsSold / roomNights) * 1000) / 10 : 0,
      adrPaise: roomsSold ? Math.round(roomRevenuePaise / roomsSold) : 0,
      revParPaise: roomNights ? Math.round(roomRevenuePaise / roomNights) : 0,
      arrivals: days.reduce((s, d) => s + d.arrivals, 0),
      departures: days.reduce((s, d) => s + d.departures, 0),
    },
  };
}

/** One bill of the GST summary (H8): the taxable value and the GST of each business, with the guest's GSTIN when it is a B2B bill. */
export interface GstBillLine {
  id: string;
  date: string;
  billNumber: string;
  guest: string;
  /** The guest's or company's GSTIN on the bill; a bill with one is B2B (GSTR-1 table 4), without one B2C (table 7). */
  gstin: string | null;
  company: string | null;
  /** Hotel business: the bill's hotel total less its GST, and the GST. */
  hotelTaxablePaise: number;
  hotelGstPaise: number;
  /** "12", "5", "2.5" when a check-out priced it; null when the GST was typed as an amount. */
  hotelGstPercent: string | null;
  foodTaxablePaise: number;
  foodGstPaise: number;
  foodGstPercent: string | null;
  totalPaise: number;
}
export interface GstSlice {
  bills: number;
  taxablePaise: number;
  gstPaise: number;
  totalPaise: number;
}
/** The GST summary of one month: every live bill dated in it, with B2B/B2C and hotel/food totals (what the accountant fills GSTR-1 and 3B from). */
export interface GstReport {
  month: string;
  bills: GstBillLine[];
  totals: GstSlice & { b2b: GstSlice; b2c: GstSlice; hotel: GstSlice; food: GstSlice };
}
/** Adds the month's bill lines up (the server and the mock both use it). */
export function assembleGst(month: string, bills: GstBillLine[]): GstReport {
  const slice = (): GstSlice => ({ bills: 0, taxablePaise: 0, gstPaise: 0, totalPaise: 0 });
  const add = (s: GstSlice, taxable: number, gst: number) => {
    s.bills += 1;
    s.taxablePaise += taxable;
    s.gstPaise += gst;
    s.totalPaise += taxable + gst;
  };
  const totals = { ...slice(), b2b: slice(), b2c: slice(), hotel: slice(), food: slice() };
  for (const b of bills) {
    const taxable = b.hotelTaxablePaise + b.foodTaxablePaise;
    const gst = b.hotelGstPaise + b.foodGstPaise;
    add(totals, taxable, gst);
    add(b.gstin ? totals.b2b : totals.b2c, taxable, gst);
    if (b.hotelTaxablePaise + b.hotelGstPaise !== 0) add(totals.hotel, b.hotelTaxablePaise, b.hotelGstPaise);
    if (b.foodTaxablePaise + b.foodGstPaise !== 0) add(totals.food, b.foodTaxablePaise, b.foodGstPaise);
  }
  return { month, bills: [...bills].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.billNumber.localeCompare(b.billNumber, 'en', { numeric: true }))), totals };
}

/** An announcement from the platform this person has not dismissed yet (GET overview/announcements). */
export interface HotelAnnouncement {
  id: string;
  title: string;
  body: string;
  /** Permanent: docked under the top bar until the person presses Accept. Otherwise it floats over the page for a few seconds. */
  important: boolean;
  /** When it was published (ISO). */
  at: string;
}

/** The bell: what needs attention now (GET overview/attention). */
export interface AttentionFeed {
  items: AttentionItem[];
  /** When the server looked (ISO). */
  at: string;
}

export interface OverviewApi {
  getDashboard(opts?: { scenario?: DashboardScenario }): Promise<DashResult<HotelDashboard>>;
  getAttention(): Promise<DashResult<AttentionFeed>>;
  /** GET overview/announcements: the platform's announcements this person has not dismissed. */
  getAnnouncements(): Promise<DashResult<HotelAnnouncement[]>>;
  /** POST overview/announcements/{id}/dismiss. */
  dismissAnnouncement(id: string): Promise<DashResult<{ dismissed: true }>>;
  /** GET reports/occupancy?month=YYYY-MM (default: this month). */
  getOccupancy(month: string): Promise<DashResult<OccupancyReport>>;
  /** GET reports/gst?month=YYYY-MM (default: this month). */
  getGst(month: string): Promise<DashResult<GstReport>>;
  getDailyReport(date: string): Promise<DashResult<DailyReport>>;
  getFoodPlan(month: string, plan: MealPlan | null): Promise<DashResult<FoodPlanMonthReport>>;
  /** GET admin/books. */
  getBooks(): Promise<DashResult<BooksOverview>>;
  /** POST admin/books/start. */
  startNextYear(): Promise<DashResult<{ year: AccountingYear; message: string }>>;
  /** DELETE admin/books/latest. `confirm` must be exactly "DELETE <label>". `removed` is the row count per table. */
  removeLatestYear(confirm: string): Promise<DashResult<{ removed: Record<string, number>; message: string }>>;
}

/* ================================================================== copy */

export const overviewCopy = {
  occupancy: {
    title: 'Occupancy',
    sub: 'How full the hotel was each night, what a sold room earned on average (ADR) and what every room earned (RevPAR).',
    rooms: (n: number) => `${n} ${n === 1 ? 'room' : 'rooms'} in service`,
    tiles: { occupancy: 'Occupancy', adr: 'Average daily rate', revpar: 'RevPAR', roomNights: 'Room nights sold' },
    notes: { occupancy: (sold: number, avail: number) => `${sold} of ${avail} room nights`, adr: 'Room revenue per sold night', revpar: 'Room revenue per available night', roomNights: (a: number, d: number) => `${a} arrivals, ${d} departures` },
    cols: { date: 'Night', sold: 'Rooms sold', occupancy: 'Occupancy', revenue: 'Room revenue', adr: 'ADR', arrivals: 'Arrivals', departures: 'Departures' },
    csv: 'Download CSV',
    empty: { title: 'No nights yet', text: 'This month has no stays on record so far.' },
  },
  gst: {
    title: 'GST Summary',
    sub: 'Every bill of the month with its taxable value and GST, split hotel and food, B2B (a GSTIN on the bill) and B2C. The CSV is laid out for GSTR-1.',
    tiles: { gst: 'GST collected', taxable: 'Taxable value', b2b: 'B2B bills', b2c: 'B2C bills' },
    notes: { gst: (hotel: string, food: string) => `Hotel ${hotel}, food ${food}`, taxable: (n: number) => `${n} ${n === 1 ? 'bill' : 'bills'}`, b2b: 'With a GSTIN on the bill', b2c: 'Without a GSTIN' },
    cols: { date: 'Date', bill: 'Bill', guest: 'Guest', gstin: 'GSTIN', hotelTaxable: 'Hotel taxable', hotelGst: 'Hotel GST', foodTaxable: 'Food taxable', foodGst: 'Food GST', total: 'Total' },
    csv: 'Download CSV',
    empty: { title: 'No bills yet', text: 'This month has no bills on record so far.' },
  },
  announcements: {
    from: 'From EasyHotelSolutions',
    dismiss: 'Got it',
    dismissLabel: (title: string) => `Dismiss "${title}"`,
  },
  bell: {
    label: (n: number) => (n === 0 ? 'Nothing needs attention' : n === 1 ? '1 thing needs attention' : `${n} things need attention`),
    title: 'Needs attention',
    allClear: 'All clear for now.',
    checked: (when: string) => `Checked ${when}`,
  },
  dashboard: {
    title: 'Dashboard',
    subtitle: 'Today at the front desk, then the money and the shift handover.',
    actions: { deposit: 'Record deposit', expense: 'Record expense', handover: 'Handover' },
    handover: {
      section: 'Shift handover',
      link: 'All handovers',
      today: 'Handovers today',
      recorded: 'Recorded',
      noneToday: 'None yet today',
      cash: 'Cash counted today',
      cashNote: "Across today's handovers",
      month: 'This month',
      last: 'Last handover',
      lastNone: 'None yet',
      lastNoneNote: 'Record the first one',
    },
    cash: {
      section: 'Cash',
      link: 'Revenue',
      inToday: 'Cash in today',
      outToday: 'Cash out today',
      netToday: 'Net today',
      monthSoFar: (m: string) => `${m} so far`,
      noYesterday: 'Nothing came in yesterday',
      vsYesterday: (pct: number) => `${Math.abs(pct)}% vs yesterday`,
      monthIn: (amount: string) => `${amount} in`,
      vsLastMonth: (amount: string, pct: number, last: string) => `${amount} in, ${Math.abs(pct)}% vs ${last}`,
    },
    flow: {
      title: 'Cash flow',
      in: 'Money in',
      out: 'Money out',
      ranges: [{ id: '7', label: '7 days' }, { id: '14', label: '14 days' }, { id: '30', label: '30 days' }],
      emptyTitle: 'No cash recorded in the last 30 days',
      emptyBody: 'Deposits, withdrawals, expenses and staff advances draw this chart.',
    },
    attention: {
      title: 'Needs attention',
      clearTitle: 'All clear',
      clearBody: "Today's handover is in and every salary is settled.",
    },
    book: {
      inToday: 'In today',
      outToday: 'Out today',
      net: 'Net',
      today: (n: number) => `${plural(n, 'entry', 'entries')} today`,
      monthLine: (inText: string, outText: string) => `${inText} in · ${outText} out`,
      revenue: 'Revenue',
      expenses: 'Expenses',
    },
    recent: {
      title: 'Latest entries',
      note: 'The last 7 entries from both books',
      dateHeader: 'Date',
      whoHeader: 'Particulars',
      bookHeader: 'Book',
      kindHeader: 'Type',
      amountHeader: 'Amount',
      emptyTitle: 'No entries yet',
      emptyBody: 'Deposits, expenses and staff advances appear here as they are recorded.',
    },
    spending: {
      title: (m: string) => `Spending in ${m}`,
      total: 'Total spent',
      share: (pct: number, count: number) => `${pct}% of the month · ${plural(count, 'entry', 'entries')}`,
      emptyTitle: 'Nothing spent yet',
      emptyBody: 'Expenses, withdrawals and staff advances are grouped here by head.',
    },
    home: {
      greeting: { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening' },
      line: (hotel: string, date: string) => `${hotel} · ${date}`,
      summary: (rooms: number, inHouse: number, leaving: number, arriving: number) => `${plural(rooms, 'room')} · ${inHouse} in house · ${leaving} leave · ${arriving} arrive`,
      jobs: {
        label: "Today's jobs",
        checkIn: 'Check in',
        checkInNote: (n: number) => (n ? 'confirmed, not in yet' : 'nobody due in'),
        checkOut: 'Check out',
        checkOutNote: (n: number, overdue: number) => (overdue ? `${overdue} past the leaving date` : n ? 'leaving today' : 'nobody due out'),
        newBooking: 'New booking',
        newBookingNote: 'rooms free tonight',
        takePayment: 'Take payment',
        /** `stays` is null when the desk cannot see the room board: only the bills are counted. */
        takePaymentNote: (stays: number | null, bills: number) => (stays === null ? plural(bills, 'open bill') : `${plural(stays, 'stay')} · ${plural(bills, 'open bill')}`),
        staysNotCounted: (bills: number) => `${plural(bills, 'open bill')} · stays not counted`,
        counting: 'Counting…',
        noCount: 'Room board not loaded',
        noBills: 'Bills not loaded',
      },
      attention: {
        title: 'Needs attention',
        checked: (when: string) => `Checked ${when}`,
        emptyTitle: 'Nothing needs attention',
        emptyBody: 'New items appear here as they come in.',
        feedFailed: 'Live checks could not be loaded',
      },
      stats: {
        occupancy: 'Occupancy',
        occupancyNote: (occupied: number, rooms: number) => `${occupied} of ${plural(rooms, 'room')}`,
        collected: 'Collected today',
        collectedNote: (hotel: string, food: string) => `Hotel ${hotel} · Food ${food}`,
        arrivals: 'Arrivals',
        arrivalsNote: (n: number) => (n ? 'confirmed, not in yet' : 'none due'),
        departures: 'Departures',
        departuresNote: (n: number, overdue: number) => (overdue ? `${overdue} past the leaving date` : n ? 'due out today' : 'none due'),
      },
      arriving: {
        title: 'Arriving today',
        empty: 'Nobody is due in today.',
        loadError: 'Could not load the arrivals',
        guest: 'Guest',
        stay: 'Stay',
        status: 'Status',
        confirmed: 'Confirmed',
        dueSince: (d: string) => `Due since ${d}`,
        advance: 'Advance',
        booking: 'Booking',
        reference: 'Reference',
        source: 'Source',
        rooms: 'Rooms',
        roomUnit: (n: number) => (n === 1 ? 'room' : 'rooms'),
        people: 'People',
        booked: (d: string) => `Booked ${d}`,
        checkIn: 'Check in',
        open: 'Open booking',
        rate: 'Rate',
        perNight: '/ night',
      },
      leaving: {
        title: 'Leaving today',
        empty: 'Nobody is due to leave today.',
        loadError: 'Could not load the departures',
        guest: 'Guest',
        arrived: 'Arrived',
        nights: 'Nights',
        leaves: 'Leaves',
        wasDue: 'Was due',
        soFar: 'So far',
        advance: (amount: string) => `Advance ${amount}`,
        stayHead: 'Stay',
        room: 'Room',
        checkOut: 'Check out',
        account: 'Account',
      },
    },
    frontDesk: {
      section: 'Front desk today',
      link: 'Room board',
      arrivals: 'Arriving today',
      arrivalsNote: (n: number) => (n ? 'Confirmed, not checked in yet' : 'Nobody due to arrive'),
      departures: 'Leaving today',
      departuresNote: (n: number) => (n ? 'In house, check-out today or overdue' : 'Nobody due to leave'),
      inHouse: 'In house',
      inHouseNote: (ready: number) => `${ready} ${ready === 1 ? 'room' : 'rooms'} ready to sell`,
      toClean: 'Rooms to clean',
      toCleanNote: (n: number) => (n ? 'Marked dirty, not out of order' : 'All rooms clean'),
    },
    payroll: {
      section: 'Staff and payroll',
      link: 'Payroll',
      staff: 'Active staff',
      joined: (n: number, m: string) => (n ? `${n} joined in ${m}` : `Nobody new in ${m}`),
      toPay: 'Salary to pay',
      openSince: (n: number, since: string) => `${n} open since ${since}`,
      settled: 'Every salary is settled',
      paid: (m: string) => `Salary paid, ${m}`,
      paidNote: (n: number) => `${plural(n, 'payment')} this month`,
      advances: 'Staff advances',
      advancesNote: (n: number, m: string) => `${n} paid in ${m}`,
    },
  },
  reports: {
    title: 'Reports',
    subtitle: 'The accounts reports: read them on screen, then preview the PDF.',
    offeredTitle: 'Available reports',
    soonTitle: 'Coming soon',
    soonPill: 'Coming soon',
    open: 'Open report',
    previousDay: 'Previous day',
    nextDay: 'Next day',
    previousMonth: 'Previous month',
    nextMonth: 'Next month',
    capDay: 'Today is as far forward as you can go',
    capMonth: 'The current month is as far forward as you can go',
    jumpDay: 'Day',
    jumpMonth: 'Month',
    searchDay: 'Search guest, room or bill',
    searchMonth: 'Search guest, room, bill or company',
    plan: 'Plan',
    allPlans: 'All plans',
    pdf: 'Preview PDF',
    print: 'Print',
    pdfNote: 'This is how the PDF will look. Download comes with the live system.',
    /** Mock mode has no PDF server: the button prints the page on screen instead. */
    pdfMock: 'Demo data: the PDF is made by the server in the live system. The print view of this page opens instead.',
    noMatchTitle: 'Nothing matches your search',
    noMatchBody: 'Try a different name, room, bill or company. Totals still show the whole report.',
    clearSearch: 'Clear search',
  },
  daily: {
    title: 'Daily report',
    carry: 'Cash carry forward',
    carryHint: "Cash that should be in the drawer at the end of the day. It becomes tomorrow's opening balance.",
    step1: 'Cash at the desk',
    step1Body: "Cash taken in, and cash paid out. With tonight's food plan, these decide what is left in the drawer.",
    received: 'Cash received',
    paidOut: 'Cash paid out',
    opening: 'Opening balance (carried forward)',
    fromDrawer: 'Paid from the drawer',
    cashInHand: 'Cash in hand',
    totalPaidOut: 'Total paid out',
    noCashIn: 'No cash taken in.',
    noCashOut: 'Nothing paid out in cash.',
    foodTitle: 'Food plan for tonight',
    planMeals: 'Plan meals',
    noFood: 'No guest on a meal plan tonight.',
    sumCashInHand: 'Cash in hand',
    sumCashInHandNote: (opening: string, received: string) => `Opening ${opening} + received ${received}`,
    sumPaidOut: 'Cash paid out',
    sumFood: 'Food plan',
    sumFoodNote: (n: number) => `${plural(n, 'guest')} tonight`,
    sumCarry: 'Cash carry forward',
    sumCarryNote: "Tomorrow's opening balance",
    step2: 'Received online: Card, UPI and OTA',
    step2Body: 'Paid straight into the bank, so none of it is in the drawer and it does not change the cash carry forward.',
    online: 'Received online',
    noOnline: 'Nothing received by card, UPI or OTA.',
    totalOnline: 'Total received online',
    step3: 'On credit: debit bills to collect',
    step3Body: 'Bills given on credit today. No money has come in yet; the company pays later.',
    debit: 'Debit bills',
    noDebit: 'No bill left on debit today.',
    totalDebit: 'Total to collect',
    step4: 'Complimentary',
    step4Body: 'Bills settled free of charge. Shown for the record; no money moved.',
    totalFree: 'Total given free',
    summary: 'Day summary',
    summaryBody: 'The steps above in one place: what the business took in today, and what was paid out.',
    moneyIn: 'Money in',
    moneyOut: 'Money out',
    rowCash: 'Cash at the desk',
    rowFood: 'Food plan',
    rowFoodNote: 'paid to the kitchen from the drawer',
    rowOnline: 'Received online',
    rowOnlineNote: 'Card, UPI, OTA',
    rowCredit: 'On credit',
    rowCreditNote: 'to collect later',
    rowTotal: 'Total for the day',
    net: 'Net for the day',
    netHint: (inText: string, outText: string) => `Money in ${inText} − money out ${outText}`,
    fromAdvance: 'From advance',
    cols: { room: 'Room', ref: 'Ref', particulars: 'Particulars', bill: 'Bill', guest: 'Guest', received: 'Received', paid: 'Paid', toCollect: 'To collect', value: 'Value', foodPlan: 'Food plan' },
    payments: (n: number) => plural(n, 'payment'),
  },
  foodPlan: {
    title: 'Meal plans',
    figure: (month: string) => `Food plan · ${month}`,
    guestByGuest: 'Guest by guest',
    guestByGuestBody: (m: string) => `One line per guest. Only the nights in ${m} count; a stay running into another month is split between the two. Open a guest to see the stay night by night.`,
    cols: { sno: 'S.No.', guest: 'Guest', room: 'Room', plan: 'Plan', stay: 'Stay', persons: 'Persons', nights: 'Nights', rate: 'Rate', amount: 'Amount' },
    outside: (n: number) => `${plural(n, 'night')} in another month`,
    emptyTitle: (m: string) => `No plan meals in ${m}`,
    emptyBody: (plan: string | null) => `No guest was on a meal plan this month${plan ? ` on the ${plan} plan` : ''}.`,
    totalLine: (m: string) => `Total to charge the hotel · ${m}`,
    byPlan: 'Month total by plan',
    byPlanBody: 'The same nights added up plan by plan. Person-nights are one person for one night.',
    byPlanCols: { plan: 'Plan', personNights: 'Person-nights', rate: 'Rate', amount: 'Amount' },
    noByPlan: 'No plan meals this month.',
    total: 'Total',
    meta: (guests: number, nights: number) => `${plural(guests, 'guest')} · ${plural(nights, 'room-night')}`,
    nightByNight: 'Night by night',
    partCalc: (persons: number, rate: string, nights: number) => `${persons} × ${rate} × ${plural(nights, 'night')}`,
  },
  books: {
    title: 'Books (accounting years)',
    subtitle: 'Each accounting year runs from 1 April to 31 March. Only the open year takes new entries; earlier years are kept, read-only, and what they left unfinished carries forward.',
    openYear: 'Open year',
    cashForward: 'Cash brought forward',
    cashForwardNote: (d: string) => `Opening cash on ${d}`,
    stillOpen: 'Still open from before',
    stillOpenNote: (label: string) => `Carried into ${label}`,
    nextYear: 'Next year',
    nextFrom: (d: string) => `From ${d}`,
    ready: 'Ready to start',
    carriedTitle: (label: string) => `Carried forward into FY ${label}`,
    carriedNote: "Shown in this year's lists until finished",
    carried: {
      bills: 'Debit bills still owed',
      advances: 'Guest advances with money left',
      payroll: 'Staff advances being recovered',
      salaries: 'Salaries not yet paid',
    },
    open: 'Open',
    yearsTitle: 'Years',
    yearsNote: 'Newest first',
    cols: { year: 'Year', runs: 'Runs', started: 'Started', closed: 'Closed', status: 'Status', entries: 'Entries' },
    statusOpen: 'Taking entries',
    statusClosed: 'Read-only',
    nothingDated: 'Nothing dated in this year yet.',
    remove: (label: string) => `Remove FY ${label}`,
    start: (label: string) => `Start FY ${label}`,
    startReady: (cur: string, end: string) => `FY ${cur} has ended. Starting the next year closes it: its entries become read-only, and what it left open carries forward. Until then, its pending entries (dated up to ${end}) can still be made.`,
    startConfirmTitle: (label: string) => `Start FY ${label}?`,
    startConfirmBody: (cur: string, from: string) => `FY ${cur} closes and becomes read-only. Entries from ${from} can be made.`,
    startConfirm: 'Start the year',
    started: (label: string, from: string) => `Accounting year ${label} has started. ${from} onwards is open; earlier years are now read-only.`,
    removeEyebrow: 'Accounting years · Remove',
    removeTitle: (label: string) => `Remove FY ${label}?`,
    removeWarn: (label: string, prev: string) => `This deletes every entry dated in FY ${label}, payroll included, and cannot be undone. FY ${prev} opens again exactly as it was when it closed: advances this year used, bills it settled, refunds and salaries it paid are all put back.`,
    removeType: (text: string) => `Type ${text} to confirm`,
  },
  pdfSheet: {
    brand: 'Your hotel',
    lines: ['Hotel address, city'],
  },
  common: {
    retry: 'Try again',
    cancel: 'Cancel',
    close: 'Close',
    back: 'Back',
  },
} as const;
