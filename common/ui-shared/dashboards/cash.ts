// Daily Cash module contract (Hotel dashboard): Revenue (cash in), Expenses (cash out), Shift Handover.
// Source: Hotel Pallav RevenueController, ExpenseController (TYPES), ShiftHandoverController and their screens.
// Pure TypeScript, no React. Money in paise. Times stored as ISO UTC and shown in IST.
// Owned by the cash module agent (S03).

import type { Role } from '../auth/types';
import type { Kpi, ListQuery, Page } from './common';
import { mockEmptyHotel, sessionHotelNames } from './common';
import { amountInWords, formatDateTime, formatINR, formatMonth } from './format';import type { createCashApi } from './cash.mock';

/* ------------------------------------------------------------------ */
/* Shared shapes                                                       */
/* ------------------------------------------------------------------ */

/** The two cash books kept side by side: the hotel and its restaurant (two businesses, each with its own book). */
export type CashBook = 'hotel' | 'food';
export type CashBookFilter = 'all' | CashBook;

export const cashBooks: readonly CashBook[] = ['hotel', 'food'];
export const cashBookNames: Record<CashBook, string> = { hotel: 'Hotel', food: 'Food & restaurant' };
export const cashBookShort: Record<CashBook, string> = { hotel: 'Hotel', food: 'Food' };
/**
 * The two businesses' short names as the screens show them (Business filter, tiles, form choices).
 * DATA, not Pallav's brand: TEMPORARY mock of the signed-in hotel's settings; comes from the server with the settings endpoint.
 */
const DEMO_BUSINESS_NAME: Record<CashBook, string> = { hotel: 'Your hotel', food: 'Your restaurant' };
/** The brand-new mock hotel (mockEmptyHotel()): its own names, never the demo hotel's. */
const NEW_BUSINESS_NAME: Record<CashBook, string> = { hotel: 'Your hotel', food: 'Your restaurant' };
/** Read when used (getters), so the new mock hotel shows its own names even though this module loads before the flag is set. */
export const cashBusinessName: Record<CashBook, string> = {
  get hotel() { return sessionHotelNames()?.hotel ?? (mockEmptyHotel() ? NEW_BUSINESS_NAME : DEMO_BUSINESS_NAME).hotel; },
  get food() { return sessionHotelNames()?.food ?? (mockEmptyHotel() ? NEW_BUSINESS_NAME : DEMO_BUSINESS_NAME).food; },
};

export interface CashPerson {
  id: string;
  name: string;
}

/** Who is acting, worked out from the signed-in user. */
export interface CashActor {
  id: string;
  name: string;
  /** Hotel Admin (Pallav: Admin / SuperAdmin) may edit the latest entry of anyone and delete any entry. */
  isAdmin: boolean;
  /**
   * Ability `system.backdate` (Pallav): may set the entry date/time by hand. Everyone else gets the
   * moment of saving (an edit keeps the saved date/time) WITHOUT an error, so hide or disable the
   * date/time pickers when false. (Backend contract request 3.)
   */
  canBackdate?: boolean;
  /**
   * Force mode (super admin only, Pallav `CashLedger::editNote`): may correct a closed entry and step
   * past the accounting-year lock. Show the "Force mode" note when true. (Backend contract request 7.)
   */
  forceMode?: boolean;
}

/** Ability names the server sends in the signed-in user's `abilities` (see auth-pallav HmsUser). */
export const CASH_ABILITY = { backdate: 'system.backdate', force: 'system.force' } as const;

export function cashActorOf(user: { id: string; displayName: string; role: Role; abilities?: readonly string[] }): CashActor {
  const isAdmin = user.role === 'hotel_admin' || user.role === 'super_admin' || user.role === 'group_hotel_admin';
  const abilities = user.abilities ?? [];
  return {
    id: user.id,
    name: user.displayName,
    isAdmin,
    canBackdate: abilities.includes(CASH_ABILITY.backdate),
    forceMode: abilities.includes(CASH_ABILITY.force),
  };
}

/** When the entry was made. null = stamp the moment of saving (Pallav default); set = picked by hand. */
export interface StampInput {
  /** YYYY-MM-DD (IST) */
  date: string;
  /** HH:MM (24-hour, as typed) */
  time: string;
}

interface CashEntryBase {
  id: string;
  /** Registration number, counted per book (deposits), per type (expenses) or overall (handovers). */
  entryNo: number;
  /** ISO UTC moment of the entry (date + time, to the second). */
  at: string;
  recordedBy: CashPerson;
  createdAt: string;
  updatedAt: string;
  /** Only the newest entry in its book can still be edited (Pallav rule). Worked out by the API. */
  isLatest: boolean;
}

/* ------------------------------------------------------------------ */
/* Revenue (cash deposits)                                             */
/* ------------------------------------------------------------------ */

export interface CashDeposit extends CashEntryBase {
  /**
   * Row version for the "someone else changed this, please reload" check (MJ #14). Starts at 1,
   * goes up by one on every change. Send it back on update and delete; a stale one gets CONFLICT
   * with details.currentVersion. (isLatest, recordedBy, at and instruction defaults are worked out
   * by the server: never send them as inputs.)
   */
  version: number;
  book: CashBook;
  /** Name from the book's depositor list (Master Data). */
  depositor: string;
  amountPaise: number;
  /** Optional, max 500 (Pallav "Instruction", kept in the reason column). */
  instruction: string | null;
}

export interface DepositInput {
  book: CashBook;
  depositor: string;
  amountPaise: number | null;
  instruction: string;
  stamp: StampInput | null;
  /** Required on UPDATE (the version the user saw); leave out on create. */
  version?: number;
}

/* ------------------------------------------------------------------ */
/* Expenses: the 5 types                                               */
/* ------------------------------------------------------------------ */

export type ExpenseKind = 'withdrawal' | 'misc' | 'advance';
export type ExpenseType = 'hotel-withdrawal' | 'food-withdrawal' | 'hotel-misc' | 'food-misc' | 'staff-advance';

export const expenseKinds: readonly ExpenseKind[] = ['withdrawal', 'misc', 'advance'];
export const expenseKindNames: Record<ExpenseKind, string> = {
  withdrawal: 'Cash withdrawal',
  misc: 'Miscellaneous expense',
  advance: 'Staff advance',
};
export const expenseKindHints: Record<ExpenseKind, string> = {
  withdrawal: 'Cash taken out of the till',
  misc: 'Things bought, item by item',
  advance: 'Money given to staff',
};
export const expenseKindTone: Record<ExpenseKind, 'graphite' | 'info' | 'warning'> = {
  withdrawal: 'graphite',
  misc: 'info',
  advance: 'warning',
};
export const expenseTypeNames: Record<ExpenseType, string> = {
  'hotel-withdrawal': 'Hotel withdrawal',
  'food-withdrawal': 'Food withdrawal',
  'hotel-misc': 'Hotel miscellaneous',
  'food-misc': 'Food miscellaneous',
  'staff-advance': 'Staff advance',
};

export function expenseTypeOf(kind: ExpenseKind, book: CashBook): ExpenseType {
  if (kind === 'advance') return 'staff-advance';
  return `${book}-${kind}` as ExpenseType;
}

export type LinePricing = 'listed' | 'custom';

export interface ExpenseLine {
  id: string;
  categoryId: string;
  categoryName: string;
  itemId: string;
  itemName: string;
  pricing: LinePricing;
  /** Up to 3 decimals (2.5 kg). */
  quantity: number;
  /** Price for one, in paise (copied from the catalogue when saved). */
  pricePaise: number;
  totalPaise: number;
}

export interface CashExpense extends CashEntryBase {
  /** Row version for the "someone else changed this" check, as on a deposit: send it back on update and delete. */
  version?: number;
  type: ExpenseType;
  kind: ExpenseKind;
  /** The book it sits in; for an advance, the business it was filed under. */
  book: CashBook;
  /** Withdrawal: who took the cash (receiver list in Master Data). */
  withdrawer: string | null;
  /** Advance: the staff member (from that business's Payroll). */
  employee: StaffMember | null;
  /** Advance: month it is recovered from, "YYYY-MM". */
  yearMonth: string | null;
  /** Misc: what was bought. */
  lines: ExpenseLine[];
  amountPaise: number;
  /** Optional (max 1000; 500 for misc). */
  instruction: string | null;
  /** Misc entries from before items were listed (Pallav `expense_name`): what was bought, as one line of text. */
  expenseName?: string | null;
}

export interface ExpenseLineInput {
  /** Stable key for the form row. */
  key: string;
  /** The saved line this row came from (edit), else null. */
  lineId: string | null;
  /** 'keep' = an old item no longer in the catalogue, kept exactly as saved. */
  categoryId: string;
  itemId: string;
  /** As typed. */
  quantity: string;
  pricing: LinePricing;
  /** Custom pricing: what was paid for the whole line. */
  amountPaise: number | null;
}

export interface ExpenseInput {
  kind: ExpenseKind;
  book: CashBook;
  withdrawer: string;
  employeeId: string;
  yearMonth: string;
  amountPaise: number | null;
  lines: ExpenseLineInput[];
  instruction: string;
  stamp: StampInput | null;
  /** Required on UPDATE (the version the person saw); leave out on create. */
  version?: number;
}

/* ------------------------------------------------------------------ */
/* Shift handover                                                      */
/* ------------------------------------------------------------------ */

export type Denomination = 'd500' | 'd200' | 'd100' | 'd50' | 'd20' | 'd10' | 'd5' | 'coins';

/** Notes and coins in the till. Coins are counted by their rupee value (count = value). */
export const denominations: readonly { key: Denomination; rupees: number; label: string }[] = [
  { key: 'd500', rupees: 500, label: '₹500' },
  { key: 'd200', rupees: 200, label: '₹200' },
  { key: 'd100', rupees: 100, label: '₹100' },
  { key: 'd50', rupees: 50, label: '₹50' },
  { key: 'd20', rupees: 20, label: '₹20' },
  { key: 'd10', rupees: 10, label: '₹10' },
  { key: 'd5', rupees: 5, label: '₹5' },
  { key: 'coins', rupees: 1, label: 'Coins' },
];

export type DenominationCounts = Record<Denomination, number>;

export const emptyCounts = (): DenominationCounts => ({ d500: 0, d200: 0, d100: 0, d50: 0, d20: 0, d10: 0, d5: 0, coins: 0 });

export type Shift = 'Morning' | 'Afternoon' | 'Evening' | 'Night';
export const shifts: readonly Shift[] = ['Morning', 'Afternoon', 'Evening', 'Night'];
/** Hours each shift covers (IST, 24-hour, from inclusive, to exclusive). */
export const shiftHours: Record<Shift, [number, number]> = {
  Morning: [6, 12],
  Afternoon: [12, 17],
  Evening: [17, 22],
  Night: [22, 6],
};

export interface ShiftHandover {
  id: string;
  entryNo: number;
  at: string;
  shift: Shift;
  /** Who handed over the till (the person who recorded it). */
  handedBy: CashPerson;
  /** Who takes over. Kept by name so the record still reads right if they leave. null on old records. */
  handedTo: CashPerson | null;
  counts: DenominationCounts;
  totalPaise: number;
  /** General notes for the next shift, one point each. */
  notes: string[];
  /** Important points the next shift must not miss. */
  instructions: string[];
  createdAt: string;
  updatedAt: string;
  isLatest: boolean;
  /** Row version (the server's "someone else changed this" check): send it back on update and delete. The mock has none. */
  version?: number;
}

export interface HandoverInput {
  shift: Shift | '';
  handedToId: string;
  counts: DenominationCounts;
  notes: string[];
  instructions: string[];
  stamp: StampInput | null;
  /** Required by the server on UPDATE (the version the person saw); leave out on create. */
  version?: number;
}

/** What the handover form needs (GET /handover/options): who a shift can be handed to, the Master Data shifts, and the one the clock is in. */
export interface HandoverOptions {
  staff: StaffMember[];
  shifts: string[];
  currentShift: string | null;
}

/* ------------------------------------------------------------------ */
/* Lookups (Master Data and Payroll, read only)                        */
/* ------------------------------------------------------------------ */

export interface StaffMember {
  id: string;
  name: string;
  code: string;
  book: CashBook;
}

export interface CatalogueItem {
  id: string;
  name: string;
  /** e.g. "kg", "piece" */
  unit: string;
  pricePaise: number;
}

export interface ExpenseCategory {
  id: string;
  book: CashBook;
  name: string;
  items: CatalogueItem[];
}

export interface CashLookups {
  /** Revenue: who may deposit, per book. */
  depositors: Record<CashBook, string[]>;
  /** Expenses: who may receive a withdrawal, per book. */
  receivers: Record<CashBook, string[]>;
  /** Staff advance: active people on each business's Payroll. */
  staff: StaffMember[];
  catalogue: ExpenseCategory[];
  shifts: readonly Shift[];
}

/* ------------------------------------------------------------------ */
/* List results                                                        */
/* ------------------------------------------------------------------ */

export interface CashStats {
  todayPaise: number;
  monthPaise: number;
  hotelMonthPaise: number;
  foodMonthPaise: number;
}

export type CashList<T> = Page<T> & {
  stats: CashStats;
  /** Rows per book tab (after search, before paging). */
  counts: Record<CashBookFilter, number>;
  /** Sum of every row matching the filters (all pages). */
  shownTotalPaise: number;
};

/**
 * Server rules (backend contract request 2), anything else is 422:
 * - sort: 'at' (default, newest first) | 'entryNo' | 'amountPaise' | 'depositor'
 * - pageSize: 10 | 25 | 50 | 100 (phones use 10 with "Load more")
 * - filters: book, deleted, search, from, to
 */
export type DepositSort = 'at' | 'entryNo' | 'amountPaise' | 'depositor';
export const DEPOSIT_PAGE_SIZES = [10, 25, 50, 100] as const;
export type DepositQuery = ListQuery & {
  book?: CashBookFilter;
  sort?: DepositSort;
  /** 'only' = the recycle bin (deleted entries); default = live entries. */
  deleted?: 'exclude' | 'only';
};
export type ExpenseQuery = ListQuery & { book?: CashBookFilter; kind?: ExpenseKind | 'all' };

export interface HandoverStats {
  todayCount: number;
  todayCashPaise: number;
  monthCount: number;
  monthCashPaise: number;
  latest: ShiftHandover | null;
}

export type HandoverList = Page<ShiftHandover> & { stats: HandoverStats };

/* ------------------------------------------------------------------ */
/* Time helpers (IST)                                                  */
/* ------------------------------------------------------------------ */

const IST_MS = 330 * 60_000;

/** "YYYY-MM-DD" in IST for an ISO moment. */
export function istDateOf(iso: string): string {
  return new Date(new Date(iso).getTime() + IST_MS).toISOString().slice(0, 10);
}

/** Today's date in IST, "YYYY-MM-DD". */
export function istToday(nowMs: number = Date.now()): string {
  return new Date(nowMs + IST_MS).toISOString().slice(0, 10);
}

/** "HH:MM" in IST for an ISO moment. */
export function istTimeOf(iso: string): string {
  return new Date(new Date(iso).getTime() + IST_MS).toISOString().slice(11, 16);
}

/** ISO UTC for an IST date and time. */
export function istIso(date: string, hh: number, mm: number, ss = 0): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, hh, mm, ss) - IST_MS).toISOString();
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + n)).toISOString().slice(0, 10);
}

/** "YYYY-MM" months around now for the advance month picker (newest first). */
export function monthOptions(nowMs: number = Date.now(), back = 12, ahead = 2): { value: string; label: string }[] {
  const today = istToday(nowMs);
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1;
  const out: { value: string; label: string }[] = [];
  for (let i = ahead; i >= -back; i--) {
    const t = new Date(Date.UTC(y, m + i, 1));
    const v = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
    out.push({ value: v, label: formatMonth(v) });
  }
  return out;
}

/** The shift the clock is in (IST). */
export function shiftAt(nowMs: number = Date.now()): Shift {
  const h = new Date(nowMs + IST_MS).getUTCHours();
  for (const s of shifts) {
    const [from, to] = shiftHours[s];
    if (from < to ? h >= from && h < to : h >= from || h < to) return s;
  }
  return 'Morning';
}

/** "0042" */
export function entryLabel(n: number): string {
  return String(n).padStart(4, '0');
}

/* ------------------------------------------------------------------ */
/* Rules shared by web, mobile and the mock API                        */
/* ------------------------------------------------------------------ */

export function canEditCashEntry(entry: { isLatest: boolean; recordedBy: CashPerson }, actor: CashActor): boolean {
  if (actor.forceMode) return true;
  return entry.isLatest && (actor.isAdmin || entry.recordedBy.id === actor.id);
}

export function canDeleteCashEntry(actor: CashActor): boolean {
  return actor.isAdmin;
}

/** Why an entry cannot be edited, or null when it can. */
export function cashEditNote(entry: { isLatest: boolean; recordedBy: CashPerson }, actor: CashActor, noun: string): string | null {
  if (!entry.isLatest) return `Only the latest ${noun} in a book can be edited. This one is closed.`;
  if (!canEditCashEntry(entry, actor)) return `Only a Hotel Admin or whoever recorded this ${noun} can edit it.`;
  return null;
}

export const MAX_AMOUNT_PAISE = 999_999_999_999;

/** "2.5" -> 2.5; invalid -> null. Up to 3 decimals, 0.001 to 1,000,000. */
export function parseQuantity(text: string): number | null {
  const t = text.trim();
  if (!/^\d+(\.\d{1,3})?$/.test(t)) return null;
  const n = Number(t);
  return n >= 0.001 && n <= 1_000_000 ? n : null;
}

export function quantityLabel(q: number): string {
  return String(Math.round(q * 1000) / 1000);
}

/** Price and total of one form line, as the form shows it live. */
export function lineFigures(
  line: ExpenseLineInput,
  catalogue: ExpenseCategory[],
  saved: ExpenseLine[] = [],
): { pricePaise: number | null; totalPaise: number; categoryName: string; itemName: string } {
  const old = line.lineId ? saved.find((l) => l.id === line.lineId) : undefined;
  const qty = parseQuantity(line.quantity) ?? 0;
  let price: number | null = null;
  let categoryName = '';
  let itemName = '';
  if (line.itemId === 'keep' && old) {
    price = old.pricePaise;
    categoryName = old.categoryName;
    itemName = old.itemName;
  } else {
    const cat = catalogue.find((c) => c.id === line.categoryId);
    const item = cat?.items.find((i) => i.id === line.itemId);
    if (cat && item) {
      categoryName = cat.name;
      itemName = item.name;
      // An unchanged saved line keeps the price it was saved with, so an edit never quietly reprices it.
      price = old && old.itemId === item.id ? old.pricePaise : item.pricePaise;
    }
  }
  if (line.pricing === 'custom') {
    const total = line.amountPaise ?? 0;
    return { pricePaise: qty > 0 ? Math.round(total / qty) : null, totalPaise: total, categoryName, itemName };
  }
  return { pricePaise: price, totalPaise: price === null ? 0 : Math.round(qty * price), categoryName, itemName };
}

export function linesTotalPaise(lines: ExpenseLineInput[], catalogue: ExpenseCategory[], saved: ExpenseLine[] = []): number {
  return lines.reduce((s, l) => s + lineFigures(l, catalogue, saved).totalPaise, 0);
}

export function handoverTotalPaise(counts: DenominationCounts): number {
  return denominations.reduce((s, d) => s + Math.max(0, Math.floor(counts[d.key] || 0)) * d.rupees * 100, 0);
}

/** Notes counted (coins excluded). */
export function handoverPieces(counts: DenominationCounts): number {
  return denominations.reduce((s, d) => s + (d.key === 'coins' ? 0 : counts[d.key] || 0), 0);
}

type FieldErrors = Record<string, string>;

function validateStamp(stamp: StampInput | null, today: string, errors: FieldErrors): void {
  if (!stamp) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stamp.date)) errors.date = 'Enter the date.';
  else if (stamp.date > today) errors.date = 'The date cannot be in the future.';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(stamp.time.trim())) errors.time = 'Enter the time as HH:MM, for example 09:30 or 18:45.';
}

function validateAmount(paise: number | null, errors: FieldErrors): void {
  if (paise === null || paise <= 0) errors.amount = 'Enter an amount more than ₹0.';
  else if (paise > MAX_AMOUNT_PAISE) errors.amount = 'That amount is too large.';
}

export function validateDeposit(input: DepositInput, lookups: CashLookups, keepName?: string, nowMs: number = Date.now()): FieldErrors {
  const errors: FieldErrors = {};
  const allowed = [...lookups.depositors[input.book], ...(keepName ? [keepName] : [])];
  if (!input.depositor) errors.depositor = 'Choose who is depositing.';
  else if (!allowed.includes(input.depositor)) errors.depositor = `Choose a depositor from the ${cashBookNames[input.book]} list.`;
  validateAmount(input.amountPaise, errors);
  if (input.instruction.length > 500) errors.instruction = 'Keep the instruction under 500 characters.';
  validateStamp(input.stamp, istToday(nowMs), errors);
  return errors;
}

export function validateExpense(
  input: ExpenseInput,
  lookups: CashLookups,
  existing?: CashExpense,
  nowMs: number = Date.now(),
): FieldErrors {
  const errors: FieldErrors = {};
  if (input.kind === 'withdrawal') {
    const allowed = [...lookups.receivers[input.book], ...(existing?.withdrawer ? [existing.withdrawer] : [])];
    if (!input.withdrawer) errors.withdrawer = 'Choose who is taking the cash.';
    else if (!allowed.includes(input.withdrawer)) errors.withdrawer = `Choose a name from the ${cashBookNames[input.book]} list.`;
    validateAmount(input.amountPaise, errors);
  }
  if (input.kind === 'advance') {
    const person = lookups.staff.find((s) => s.id === input.employeeId);
    if (!input.employeeId || !person) errors.employeeId = 'Choose a staff member.';
    else if (person.book !== input.book) errors.employeeId = `${person.name} is on the ${cashBookNames[person.book]} Payroll. Choose the matching business, or someone else.`;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.yearMonth)) errors.yearMonth = 'Choose the month it is recovered from.';
    validateAmount(input.amountPaise, errors);
  }
  if (input.kind === 'misc') {
    if (input.lines.length === 0) errors.lines = 'Add at least one item.';
    if (input.lines.length > 40) errors.lines = 'Up to 40 items per entry.';
    const saved = existing?.lines ?? [];
    input.lines.forEach((l, i) => {
      if (l.itemId === 'keep') {
        if (!saved.some((s) => s.id === l.lineId)) errors[`lines.${i}.item`] = 'Choose an item for this line.';
      } else {
        const cat = lookups.catalogue.find((c) => c.id === l.categoryId && c.book === input.book);
        if (!cat) errors[`lines.${i}.category`] = 'Choose a category.';
        else if (!cat.items.some((it) => it.id === l.itemId)) errors[`lines.${i}.item`] = 'Choose an item from the list.';
      }
      if (parseQuantity(l.quantity) === null) errors[`lines.${i}.quantity`] = 'Enter a quantity, e.g. 1 or 2.5.';
      if (l.pricing === 'custom' && (l.amountPaise === null || l.amountPaise <= 0)) errors[`lines.${i}.amount`] = 'Enter what was paid.';
    });
    if (!errors.lines && Object.keys(errors).length === 0 && linesTotalPaise(input.lines, lookups.catalogue, saved) <= 0) {
      errors.lines = 'The total must be more than zero.';
    }
  }
  const max = input.kind === 'misc' ? 500 : 1000;
  if (input.instruction.length > max) errors.instruction = `Keep the instruction under ${max} characters.`;
  validateStamp(input.stamp, istToday(nowMs), errors);
  return errors;
}

export function validateHandover(input: HandoverInput, staff: StaffMember[], nowMs: number = Date.now()): FieldErrors {
  const errors: FieldErrors = {};
  if (!input.shift || !shifts.includes(input.shift)) errors.shift = 'Choose the shift that is ending.';
  if (!input.handedToId || !staff.some((s) => s.id === input.handedToId)) errors.handedToId = 'Choose who is taking over.';
  for (const d of denominations) {
    const c = input.counts[d.key];
    if (!Number.isInteger(c) || c < 0 || c > 1_000_000) errors[`count.${d.key}`] = 'Enter a whole number.';
  }
  if (input.notes.length > 100) errors.notes = 'Up to 100 notes.';
  if (input.instructions.length > 100) errors.instructions = 'Up to 100 instructions.';
  if (input.notes.some((n) => n.length > 5000)) errors.notes = 'Each note can be up to 5,000 characters.';
  if (input.instructions.some((n) => n.length > 2000)) errors.instructions = 'Each instruction can be up to 2,000 characters.';
  validateStamp(input.stamp, istToday(nowMs), errors);
  return errors;
}

/* ------------------------------------------------------------------ */
/* Receipt previews (the PDF comes with the backend)                   */
/* ------------------------------------------------------------------ */

export interface CashReceipt {
  /** "Hotel Sunrise, Rajkot" */
  hotelName: string;
  /** "Hotel Revenue Receipt" */
  title: string;
  /** "Cash Deposit" */
  kind: string;
  number: string;
  rows: { label: string; value: string }[];
  lines: { category: string; item: string; quantity: string; price: string; total: string }[];
  denominations: { label: string; count: string; total: string }[];
  /** Handover: show the cash count section even when nothing was counted. */
  showCash: boolean;
  notes: string[];
  instructions: string[];
  totalLabel: string;
  totalPaise: number;
  words: string;
  signLeft: { label: string; name: string };
  signRight: { label: string; name: string };
}

export const cashHotelName = 'Your hotel';
/** The receipt header name when the caller passes none: the brand-new mock hotel's own name, else the demo hotel's. */
function mockHotelName(): string {
  return sessionHotelNames()?.hotel ?? cashHotelName;
}

export function depositReceipt(d: CashDeposit, hotelName: string = mockHotelName()): CashReceipt {
  return {
    hotelName,
    title: `${cashBookShort[d.book]} Revenue Receipt`,
    kind: 'Cash Deposit',
    number: entryLabel(d.entryNo),
    rows: [
      { label: 'Depositor', value: d.depositor },
      { label: 'Receipt no.', value: entryLabel(d.entryNo) },
      { label: 'Recorded by', value: d.recordedBy.name },
      { label: 'Date & time', value: formatDateTime(d.at) },
      { label: 'Cash book', value: cashBookNames[d.book] },
      { label: 'Instruction', value: d.instruction ?? '—' },
    ],
    lines: [],
    denominations: [],
    showCash: false,
    notes: [],
    instructions: [],
    totalLabel: 'Amount deposited',
    totalPaise: d.amountPaise,
    words: amountInWords(d.amountPaise),
    signLeft: { label: 'Depositor', name: d.depositor },
    signRight: { label: 'Authorised signatory', name: hotelName },
  };
}

export function expenseReceipt(e: CashExpense, hotelName: string = mockHotelName()): CashReceipt {
  const party =
    e.kind === 'withdrawal'
      ? { label: 'Withdrawer', value: e.withdrawer ?? '' }
      : e.kind === 'advance'
        ? { label: 'Staff member', value: e.employee ? `${e.employee.name} (${e.employee.code})` : '' }
        : { label: 'Spent by', value: e.recordedBy.name };
  const rows = [
    party,
    { label: 'Receipt no.', value: entryLabel(e.entryNo) },
    { label: 'Recorded by', value: e.recordedBy.name },
    { label: 'Date & time', value: formatDateTime(e.at) },
    { label: 'Cash book', value: cashBookNames[e.book] },
    ...(e.kind === 'advance' && e.yearMonth ? [{ label: 'Recovered from', value: formatMonth(e.yearMonth) }] : []),
    { label: 'Instruction', value: e.instruction ?? '—' },
  ];
  const left =
    e.kind === 'misc'
      ? { label: 'Recorded by', name: e.recordedBy.name }
      : { label: 'Received by', name: e.kind === 'withdrawal' ? (e.withdrawer ?? '') : (e.employee?.name ?? '') };
  return {
    hotelName,
    title: `${cashBookShort[e.book]} Expense Receipt`,
    kind: expenseKindNames[e.kind],
    number: entryLabel(e.entryNo),
    rows,
    lines: e.lines.map((l) => ({
      category: l.categoryName,
      item: l.itemName,
      quantity: quantityLabel(l.quantity),
      price: formatINR(l.pricePaise),
      total: formatINR(l.totalPaise),
    })),
    denominations: [],
    showCash: false,
    notes: [],
    instructions: [],
    totalLabel: 'Amount paid out',
    totalPaise: e.amountPaise,
    words: amountInWords(e.amountPaise),
    signLeft: left,
    signRight: { label: 'Authorised signatory', name: hotelName },
  };
}

export function handoverReceipt(h: ShiftHandover, hotelName: string = mockHotelName()): CashReceipt {
  return {
    hotelName,
    title: 'Handover',
    kind: `${h.shift} shift`,
    number: entryLabel(h.entryNo),
    rows: [
      { label: 'Handed over by', value: h.handedBy.name },
      { label: 'Registration no.', value: entryLabel(h.entryNo) },
      { label: 'Handed over to', value: h.handedTo?.name ?? '—' },
      { label: 'Date & time', value: formatDateTime(h.at) },
      { label: 'Shift', value: h.shift },
    ],
    lines: [],
    denominations: denominations
      .filter((d) => h.counts[d.key] > 0)
      .map((d) => ({
        label: d.key === 'coins' ? 'Coins' : `${d.label} notes`,
        count: d.key === 'coins' ? `${h.counts[d.key]} in coins` : `× ${h.counts[d.key]}`,
        total: formatINR(h.counts[d.key] * d.rupees * 100),
      })),
    showCash: true,
    notes: h.notes,
    instructions: h.instructions,
    totalLabel: 'Total cash handed over',
    totalPaise: h.totalPaise,
    words: amountInWords(h.totalPaise),
    signLeft: { label: 'Handed over by', name: h.handedBy.name },
    signRight: { label: 'Received by', name: h.handedTo?.name ?? 'Name and signature' },
  };
}

export type CashApi = ReturnType<typeof createCashApi>;

/* ------------------------------------------------------------------ */
/* KPIs                                                                */
/* ------------------------------------------------------------------ */

export function revenueKpis(s: CashStats): Kpi[] {
  return [
    { id: 'today', label: 'Deposited today', value: s.todayPaise, kind: 'money', trend: null, tone: 'success', icon: 'arrowDown' },
    { id: 'month', label: 'This month', value: s.monthPaise, kind: 'money', trend: null, tone: 'graphite', icon: 'calendar' },
    { id: 'hotel', label: 'Hotel this month', value: s.hotelMonthPaise, kind: 'money', trend: null, tone: 'info', icon: 'building' },
    { id: 'food', label: 'Food this month', value: s.foodMonthPaise, kind: 'money', trend: null, tone: 'warning', icon: 'utensils' },
  ];
}

export function expenseKpis(s: CashStats): Kpi[] {
  return [
    { id: 'today', label: 'Paid out today', value: s.todayPaise, kind: 'money', trend: null, tone: 'danger', icon: 'arrowUp' },
    { id: 'month', label: 'This month', value: s.monthPaise, kind: 'money', trend: null, tone: 'graphite', icon: 'calendar' },
    { id: 'hotel', label: 'Hotel this month', value: s.hotelMonthPaise, kind: 'money', trend: null, tone: 'info', icon: 'building' },
    { id: 'food', label: 'Food this month', value: s.foodMonthPaise, kind: 'money', trend: null, tone: 'warning', icon: 'utensils' },
  ];
}

export function handoverKpis(s: HandoverStats): Kpi[] {
  return [
    { id: 'today', label: 'Handovers today', value: s.todayCount, kind: 'count', trend: null, tone: 'graphite', icon: 'swap' },
    { id: 'todayCash', label: 'Cash counted today', value: s.todayCashPaise, kind: 'money', trend: null, tone: 'success', icon: 'wallet' },
    { id: 'month', label: 'Handovers this month', value: s.monthCount, kind: 'count', trend: null, tone: 'info', icon: 'calendar' },
    { id: 'monthCash', label: 'Cash counted this month', value: s.monthCashPaise, kind: 'money', trend: null, tone: 'warning', icon: 'clock' },
  ];
}

/* ------------------------------------------------------------------ */
/* Copy                                                                */
/* ------------------------------------------------------------------ */

export const cashCopy = {
  common: {
    all: 'All',
    search: 'Search',
    cancel: 'Cancel',
    close: 'Close',
    edit: 'Edit',
    delete: 'Delete',
    preview: 'View receipt',
    previewNote: 'Preview only. The printable PDF comes with the backend.',
    deleteBody: 'This entry will be removed from the cash book. This cannot be undone.',
    stampToggle: 'Set the date and time by hand',
    stampHint: 'Off: the entry is stamped with the moment you save it, to the second.',
    stampAdminOnly: 'Only a Hotel Admin can change the date and time.',
    stampAuto: 'The date and time are set to the moment you save. Only people with permission can change them.',
    forceMode: 'Force mode is on. You can correct closed entries and go past the accounting-year lock.',
    date: 'Date',
    time: 'Time (24-hour, HH:MM)',
    instruction: 'Instruction',
    instructionHint: 'Optional. Anything worth knowing about this entry.',
    amount: 'Amount',
    inWords: 'In words',
    recordedBy: 'Recorded by',
    dateTime: 'Date and time',
    book: 'Cash book',
    entryNo: 'Reg. no.',
    none: '—',
    totalShown: 'Total shown',
    saveFailed: "Couldn't save. Please try again.",
    deleteFailed: "Couldn't delete. Please try again.",
    lookupsFailed: "Couldn't load the lists for this form.",
    latestOnly: 'Only the latest entry in each book can be edited.',
  },
  revenue: {
    title: 'Revenue',
    subtitle: 'Cash paid in to the Hotel and Food cash books',
    new: 'New deposit',
    searchPlaceholder: 'Search depositor, instruction, amount or date',
    columns: { no: 'Reg. no.', date: 'Date', time: 'Time', book: 'Book', depositor: 'Depositor', instruction: 'Instruction', by: 'Recorded by', amount: 'Amount' },
    emptyTitle: 'No deposits yet',
    emptyFiltered: 'No deposits match this view',
    emptyBody: 'When cash is handed in, record it here with who deposited it and what it was for.',
    formNew: 'New deposit',
    formEdit: (no: string) => `Edit deposit ${no}`,
    whichBook: 'Which cash book',
    depositor: 'Depositor',
    depositorPlaceholder: 'Choose a depositor',
    depositorEmpty: 'No depositors are set up for this book yet. A Hotel Admin adds them in Master Data.',
    amount: 'Amount deposited',
    save: 'Save deposit',
    detail: (no: string) => `Deposit ${no}`,
    saved: (no: string) => `Deposit ${no} recorded.`,
    updated: (no: string) => `Deposit ${no} updated.`,
    deleted: (no: string) => `Deposit ${no} deleted.`,
    deleteTitle: (no: string) => `Delete deposit ${no}?`,
    noun: 'deposit',
    bin: {
      open: 'Recycle bin',
      back: 'Back to revenue',
      title: 'Revenue recycle bin',
      subtitle: 'Deleted deposits. Restore one to bring it back, or delete it for ever.',
      columns: { deleted: 'Deleted' },
      emptyTitle: 'The recycle bin is empty',
      emptyBody: 'Deleted deposits wait here for 30 days before they are removed.',
      restore: 'Restore',
      purge: 'Delete for ever',
      restored: (no: string) => `Deposit ${no} restored.`,
      purged: (no: string) => `Deposit ${no} deleted for ever.`,
      purgeTitle: (no: string) => `Delete deposit ${no} for ever?`,
      purgeBody: 'This cannot be undone.',
    },
  },
  expenses: {
    title: 'Expenses',
    subtitle: 'Cash paid out: withdrawals, miscellaneous expenses and staff advances',
    new: 'New entry',
    searchPlaceholder: 'Search name, item, instruction, amount or date',
    kindFilter: 'Kind of entry',
    allKinds: 'All kinds',
    columns: { no: 'Reg. no.', date: 'Date', time: 'Time', book: 'Book', kind: 'Kind', who: 'Paid to / items', instruction: 'Instruction', amount: 'Amount' },
    emptyTitle: 'No expenses yet',
    emptyFiltered: 'No entries match this view',
    emptyBody: 'Record cash that leaves the till: what was taken out, who took it, and what it was for.',
    formNew: 'New entry',
    formEdit: (name: string, no: string) => `Edit ${name} ${no}`,
    whatKind: 'What are you recording?',
    whichBook: 'Which business',
    kindLocked: 'The kind of a saved entry cannot change.',
    receivedBy: 'Received by',
    receivedByPlaceholder: 'Choose who is taking the cash',
    receiversEmpty: 'No names are set up for this business yet. A Hotel Admin adds them in Master Data.',
    staff: 'Staff member',
    staffPlaceholder: 'Choose a staff member',
    staffEmpty: 'No active staff on this business’s Payroll.',
    month: 'Recovered from (month)',
    monthHint: "Taken back from this month's salary.",
    items: 'Items',
    itemsHint: 'Pick a category, then an item. Add as many lines as you need.',
    category: 'Category',
    item: 'Item',
    quantity: 'Quantity',
    customAmount: 'Custom amount',
    customHint: 'Type the amount paid when the cost is not fixed.',
    lineAmount: 'Amount paid',
    price: 'Price',
    lineTotal: 'Line total',
    addItem: 'Add another item',
    removeItem: 'Remove item',
    keptItem: 'No longer in the catalogue, kept as saved',
    catalogueEmpty: 'No categories are set up for this business yet. A Hotel Admin adds them in Master Data.',
    total: 'Total',
    save: 'Save entry',
    detail: (name: string, no: string) => `${name} ${no}`,
    saved: (name: string, no: string) => `${name} ${no} recorded.`,
    updated: (name: string, no: string) => `${name} ${no} updated.`,
    deleted: (name: string, no: string) => `${name} ${no} deleted.`,
    deleteTitle: (no: string) => `Delete entry ${no}?`,
    noun: 'entry',
  },
  handover: {
    title: 'Handover',
    subtitle: 'Count the till at the end of a shift and hand it over',
    new: 'New handover',
    searchPlaceholder: 'Search name, shift, note, amount or date',
    latest: (shift: string, when: string, by: string, to: string) => `Last handover: ${shift} shift, ${when}, ${by} to ${to}`,
    noneYet: 'No handovers yet. Record the first one.',
    columns: { no: 'Reg. no.', date: 'Date', time: 'Time', shift: 'Shift', by: 'Handed over by', to: 'Handover to', notes: 'Notes', instructions: 'Instructions', total: 'Total cash' },
    emptyTitle: 'No handovers yet',
    emptyFiltered: 'No handover matches that search',
    emptyBody: 'When a shift ends, count the cash and leave points for whoever takes over. They will all be listed here.',
    emptyFilteredBody: 'Try a different word, a date like 2026-10-04, a registration number like 5, or an amount.',
    formNew: 'New handover',
    formEdit: (no: string) => `Edit handover ${no}`,
    stepCash: 'Shift and cash',
    stepNotes: 'Notes and instructions',
    shift: 'Shift',
    shiftHint: 'The shift that is ending.',
    handedTo: 'Handover to',
    handedToPlaceholder: 'Choose who is taking over',
    count: 'Count the cash',
    countHint: 'Type how many of each note, or use + and −. Coins: type their total value in rupees.',
    reset: 'Reset count',
    coinsHint: 'total value',
    totalCash: 'Total cash',
    pieces: (n: number) => `${n} ${n === 1 ? 'note' : 'notes'}`,
    notes: 'Notes for the next shift',
    notesHint: 'General notes for whoever takes over. One point per line.',
    notePlaceholder: 'e.g. Laundry for 2nd floor comes back at 4 pm',
    addNote: 'Add note',
    instructions: 'Instructions',
    instructionsHint: 'Important. Things the next shift must not miss. Highlighted here and on the receipt.',
    instructionPlaceholder: 'e.g. VIP guest in 301: keep the suite ready by 11 am',
    addInstruction: 'Add instruction',
    removePoint: 'Remove point',
    noNotes: 'No notes.',
    noInstructions: 'No instructions.',
    cashCount: 'Cash count',
    noCash: 'No cash counted.',
    save: 'Save handover',
    detail: (no: string) => `Handover ${no}`,
    saved: (no: string) => `Handover ${no} recorded.`,
    updated: (no: string) => `Handover ${no} updated.`,
    deleted: (no: string) => `Handover ${no} deleted.`,
    deleteTitle: (no: string) => `Delete handover ${no}?`,
    noun: 'handover',
  },
} as const;
