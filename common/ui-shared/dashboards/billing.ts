// Guest Billing (Hotel dashboard): guest advances and bills.
// Source: Hotel Pallav "Bill Master" (advances, bills, debit settlement). Screens, fields and rules only.
// Pure TypeScript: types, totals, client validation, an in-memory mock API, mock data and copy.
// Money is always paise (integer). Plain dates are "YYYY-MM-DD"; moments are ISO UTC strings.

import type { DashResult, Kpi, ListQuery, Page } from './common';
import { mockEmptyHotel, sessionHotelNames } from './common';
import { formatMonth } from './format';

/* ------------------------------------------------------------------ */
/* Masters                                                             */
/* ------------------------------------------------------------------ */

export const paymentModes = ['Cash', 'Card', 'UPI', 'Bank Transfer', 'Cheque', 'Debit', 'Complimentary'] as const;
/**
 * Pallav stores any mode text (max 20 characters) and imported rows may hold other words, so the
 * type accepts any string; the list above is what the FORM offers. (Backend contract request 3.)
 */
export type PaymentMode = (typeof paymentModes)[number] | (string & {});

export const hotelPlans = ['EP', 'CP', 'MAP', 'AP'] as const;
export type HotelPlan = (typeof hotelPlans)[number];
/**
 * Plan text as STORED: Pallav keeps free text (max 100), so imported bills may hold other words.
 * Forms still offer `hotelPlans`; look labels up with `planLabel()`. (Backend bills request 2.)
 */
export type PlanText = HotelPlan | (string & {});

export function planLabel(plan: PlanText | null): string {
  if (!plan) return '';
  return (hotelPlanLabel as Record<string, string>)[plan] ?? plan;
}

export const hotelPlanLabel: Record<HotelPlan, string> = {
  EP: 'EP - room only',
  CP: 'CP - with breakfast',
  MAP: 'MAP - breakfast and one meal',
  AP: 'AP - all meals',
};

/**
 * Mock plan meal rate, per person per night (the hotel owes this to its food side).
 * TEMPORARY: real rates are dated rows in `meal_plan_rates` and come from the server; remove this
 * constant once the settings/options endpoint exists. (Backend contract request 5.)
 */
export const planRatePaise: Record<HotelPlan, number> = { EP: 0, CP: 25000, MAP: 60000, AP: 90000 };

export interface BillingCompany {
  id: string;
  name: string;
  gstin: string;
}

/**
 * Who prints on receipts and bills. TEMPORARY mock: the real name, food name, address, phone and
 * GSTIN are hotel settings from the server; remove once the settings endpoint exists. (Request 5.)
 */
const DEMO_BILLING_HOTEL = {
  name: 'Your hotel',
  foodName: 'Your restaurant',
  address: 'Hotel address, city',
  phone: '',
  gstin: '24ABCDE1234F1Z5',
};
/** The brand-new mock hotel (mockEmptyHotel()): its own name, never the demo hotel's. */
const NEW_BILLING_HOTEL = {
  name: 'Your hotel',
  foodName: 'Your restaurant',
  address: 'Surat, Gujarat',
  phone: '',
  gstin: '',
};
const pickBillingHotel = () => {
  const real = sessionHotelNames();
  // Real server: the session's own names (address, phone and GSTIN are printed by the server's PDF, never by these labels).
  return real ? { name: real.hotel, foodName: real.food, address: '', phone: '', gstin: '' } : mockEmptyHotel() ? NEW_BILLING_HOTEL : DEMO_BILLING_HOTEL;
};
/** Read when used (getters), so the new mock hotel shows its own name even though this module loads before the flag is set. */
export const billingHotel: { readonly name: string; readonly foodName: string; readonly address: string; readonly phone: string; readonly gstin: string } = {
  get name() { return pickBillingHotel().name; },
  get foodName() { return pickBillingHotel().foodName; },
  get address() { return pickBillingHotel().address; },
  get phone() { return pickBillingHotel().phone; },
  get gstin() { return pickBillingHotel().gstin; },
};

/* ------------------------------------------------------------------ */
/* Advances                                                            */
/* ------------------------------------------------------------------ */

export type AdvanceStatus = 'unused' | 'partly' | 'used' | 'refunded';
export type AdvanceCovers = 'hotel' | 'food' | 'both';

export interface AdvanceRefund {
  date: string;
  hotelPaise: number;
  foodPaise: number;
  hotelMode: PaymentMode | null;
  foodMode: PaymentMode | null;
  toName: string;
  toMobile: string;
  note: string;
}

export interface Advance {
  id: string;
  /** Row version for "someone else changed this, please reload" (MJ #14). Send it on edit, refund, refund reversal and delete. */
  version: number;
  /** Registration number (Pallav), worked out by the server. */
  entryNo: number;
  /** "2026 / 814", or "Excessive / {bill number}" when a debit bill was overpaid (Pallav BillMasterController:549; sent ready-made). */
  receiptNo: string;
  paymentDate: string;
  guestName: string;
  mobile: string;
  companyId: string | null;
  companyName: string | null;
  roomNo: string;
  hotelPaise: number;
  foodPaise: number;
  hotelMode: PaymentMode | null;
  foodMode: PaymentMode | null;
  /** What is still left to take off a bill or refund. */
  hotelBalancePaise: number;
  foodBalancePaise: number;
  referenceName: string;
  referenceMobile: string;
  instruction: string;
  refund: AdvanceRefund | null;
  /** Bill numbers this advance was taken off. */
  usedOn: string[];
  /** Made by the app from an overpaid debit bill (not typed in). */
  fromBillNo: string | null;
  createdAt: string;
}

export interface AdvanceInput {
  /** Number part only, on create ("814"); the year is added in front. Ignored on edit. */
  receiptNo: string;
  paymentDate: string;
  guestName: string;
  mobile: string;
  companyId: string | null;
  roomNo: string;
  covers: AdvanceCovers;
  hotelPaise: number | null;
  foodPaise: number | null;
  hotelMode: PaymentMode | null;
  foodMode: PaymentMode | null;
  referenceName: string;
  referenceMobile: string;
  instruction: string;
  /** Required on EDIT (the version the user saw); leave out on create. */
  version?: number;
}

export interface RefundInput {
  date: string;
  hotelPaise: number | null;
  foodPaise: number | null;
  hotelMode: PaymentMode | null;
  foodMode: PaymentMode | null;
  toName: string;
  toMobile: string;
  note: string;
  /** The advance's version the user saw (required by the server). */
  version?: number;
}

export type AdvanceTab = 'all' | AdvanceStatus;

/**
 * Server rules (backend contract request 4), anything else is 422:
 * sort = AdvanceSort; pageSize = 10 | 25 | 50 | 100; from/to = the accounting years on screen;
 * deleted = 'no' | 'only' (recycle bin, hotel super admin). Search: every word must appear
 * (receipt, guest, mobile, room, company or "walk-in", modes, amount as 1234.50).
 */
export type AdvanceSort = 'paymentDate' | 'receiptNumber' | 'guestName' | 'totalAmountPaise' | 'balancePaise';

export interface AdvanceQuery extends ListQuery {
  /** Use an AdvanceSort value; any other value is refused by the server (422). */
  sort?: AdvanceSort | string;
  deleted?: 'no' | 'only';
  tab?: AdvanceTab;
  mode?: string;
  /** Company id, or "walkin". */
  companyId?: string;
  /** "YYYY-MM". */
  month?: string;
}

export interface FilterOptions {
  modes: string[];
  companies: { id: string; name: string }[];
  months: string[];
  /** How many rows each choice would show (Pallav's "Narrow down" menus print a count per choice): by mode, by company id ("walkin" for walk-ins) and by month "YYYY-MM". */
  counts?: { modes: Record<string, number>; companies: Record<string, number>; months: Record<string, number> };
}

export interface AdvanceList {
  page: Page<Advance>;
  counts: Record<AdvanceTab, number>;
  kpis: Kpi[];
  options: FilterOptions;
  /** All advances, before filters. */
  all: number;
}

export function advanceTaken(a: Pick<Advance, 'hotelPaise' | 'foodPaise'>): number {
  return a.hotelPaise + a.foodPaise;
}

export function advanceLeft(a: Pick<Advance, 'hotelBalancePaise' | 'foodBalancePaise'>): number {
  return a.hotelBalancePaise + a.foodBalancePaise;
}

export function advanceStatus(a: Advance): AdvanceStatus {
  if (a.refund) return 'refunded';
  if (a.hotelBalancePaise === a.hotelPaise && a.foodBalancePaise === a.foodPaise) return 'unused';
  return advanceLeft(a) > 0 ? 'partly' : 'used';
}

/** Edit and delete: only while nothing has been used or refunded (as Pallav). */
export function canChangeAdvance(a: Advance): boolean {
  return advanceStatus(a) === 'unused';
}

export function canRefundAdvance(a: Advance): boolean {
  return !a.refund && advanceLeft(a) > 0;
}

export function advanceCovers(a: Pick<Advance, 'hotelPaise' | 'foodPaise'>): AdvanceCovers {
  if (a.hotelPaise > 0 && a.foodPaise > 0) return 'both';
  return a.foodPaise > 0 ? 'food' : 'hotel';
}

/* ------------------------------------------------------------------ */
/* Bills                                                               */
/* ------------------------------------------------------------------ */

export type BillStatus = 'paid' | 'due' | 'settled';

export interface HotelCharges {
  plan: PlanText | null;
  /** Room tariff. */
  roomPaise: number;
  planPaise: number;
  extraBedPaise: number;
  laundryPaise: number;
  /** V.P.O. - paid out on the guest's behalf. */
  vpoPaise: number;
  /** CGST + SGST. */
  gstPaise: number;
  mode: PaymentMode | null;
}

export interface FoodCharges {
  foodPaise: number;
  planPaise: number;
  laundryPaise: number;
  gstPaise: number;
  mode: PaymentMode | null;
}

export interface StaySegment {
  /** Night of (YYYY-MM-DD). */
  from: string;
  /** Until the morning of (YYYY-MM-DD). */
  to: string;
  plan: PlanText | null;
  persons: number;
}

export interface PricedSegment extends StaySegment {
  nights: number;
  /** null when the meal-plan rate changed during this part (Pallav shows "changing rate", MealPlanRate.php:81). */
  ratePaise: number | null;
  amountPaise: number;
}

export interface Installment {
  date: string;
  hotelPaise: number;
  hotelMode: PaymentMode | null;
  foodPaise: number;
  foodMode: PaymentMode | null;
}

export interface Settlement {
  installments: Installment[];
  referenceName: string;
  referenceMobile: string;
  instruction: string;
  /** Receipt of the advance made from an overpayment. */
  excessReceiptNo: string | null;
  /** Pallav keeps no "settled at": the server sends the bill's last change (a settled bill cannot be edited). */
  recordedAt: string;
}

export interface AppliedAdvance {
  advanceId: string;
  receiptNo: string;
  guestName: string;
  /** What was taken off this bill. */
  hotelPaise: number;
  foodPaise: number;
}

export interface Bill {
  id: string;
  /** Row version (MJ #14): send it on edit, settle, settlement reversal and delete. */
  version: number;
  /** Registration number, worked out by the server. */
  entryNo: number;
  /** "2026 / 1188". */
  billNo: string;
  billDate: string;
  /** Guest register number. */
  grNo: string;
  guestName: string;
  mobile: string;
  address: string;
  gstin: string;
  companyId: string | null;
  companyName: string | null;
  roomNo: string;
  persons: number | null;
  arrivalAt: string | null;
  departureAt: string | null;
  hotel: HotelCharges;
  food: FoodCharges;
  /** The GST rate (percent) stored with the bill when it was made; null on an older bill that never stored one. A later change of the hotel's defaults never changes it. */
  hotelGstPercent: number | null;
  foodGstPercent: number | null;
  /** The SAC stored with the bill when it was made (GST_SAC at that moment); absent from an older answer, which prints GST_SAC (billSac). */
  hotelSac?: string | null;
  foodSac?: string | null;
  hotelTotalPaise: number;
  foodTotalPaise: number;
  advance: AppliedAdvance | null;
  /** Still owed on debit (zero unless paid by Debit). */
  balanceHotelPaise: number;
  balanceFoodPaise: number;
  stay: PricedSegment[];
  /** Plan meals the hotel owes its food side (kept apart from the guest's bill). */
  planFoodOwedPaise: number;
  referenceName: string;
  referenceMobile: string;
  instruction: string;
  settlement: Settlement | null;
  createdAt: string;
}

export interface BillInput {
  /** Number part only, on create ("1188"). Ignored on edit. */
  billNo: string;
  billDate: string;
  grNo: string;
  /** Only on create (as Pallav): the advance to take off. */
  advanceId: string | null;
  guestName: string;
  mobile: string;
  address: string;
  gstin: string;
  companyId: string | null;
  roomNo: string;
  persons: number | null;
  arrivalAt: string | null;
  departureAt: string | null;
  hotel: HotelCharges;
  food: FoodCharges;
  stay: StaySegment[];
  referenceName: string;
  referenceMobile: string;
  instruction: string;
  /** Required on EDIT. No totals are sent: the server works out totals, balances, stay prices and advance snapshots (request 3). */
  version?: number;
}

export interface SettleInput {
  /** The first instalment's date is required by the server. */
  installments: Installment[];
  referenceName: string;
  referenceMobile: string;
  instruction: string;
  /** The bill's version the user saw. */
  version?: number;
}

export type BillTab = 'all' | BillStatus;

export interface BillQuery extends ListQuery {
  tab?: BillTab;
  mode?: string;
  companyId?: string;
  month?: string;
}

export interface BillList {
  page: Page<Bill>;
  counts: Record<BillTab, number>;
  kpis: Kpi[];
  options: FilterOptions;
  all: number;
}

export const MAX_INSTALLMENTS = 5;

export function hotelTotal(h: HotelCharges): number {
  return h.roomPaise + h.planPaise + h.extraBedPaise + h.laundryPaise + h.vpoPaise + h.gstPaise;
}

export function foodTotal(f: FoodCharges): number {
  return f.foodPaise + f.planPaise + f.laundryPaise + f.gstPaise;
}

export function billTotal(b: Pick<Bill, 'hotelTotalPaise' | 'foodTotalPaise'>): number {
  return b.hotelTotalPaise + b.foodTotalPaise;
}

export function advanceApplied(b: Pick<Bill, 'advance'>): number {
  return b.advance ? b.advance.hotelPaise + b.advance.foodPaise : 0;
}

/** Bill total less the advance taken off. */
export function billNet(b: Pick<Bill, 'hotelTotalPaise' | 'foodTotalPaise' | 'advance'>): number {
  return billTotal(b) - advanceApplied(b);
}

export function billBalance(b: Pick<Bill, 'balanceHotelPaise' | 'balanceFoodPaise'>): number {
  return b.balanceHotelPaise + b.balanceFoodPaise;
}

/** H6 part payments: a settlement was recorded but money is still owed; more payments may be added (up to five in all) until the balance is nil. */
export function isPartPaid(b: Pick<Bill, 'settlement' | 'balanceHotelPaise' | 'balanceFoodPaise'>): boolean {
  return b.settlement !== null && billBalance(b) > 0;
}

export function isDebit(b: Pick<Bill, 'hotel' | 'food'>): boolean {
  return b.hotel.mode === 'Debit' || b.food.mode === 'Debit';
}

/** paid: no side on debit; due: owed (nothing recorded yet, or part paid, H6); settled: a settlement recorded and nothing owed. */
export function billStatus(b: Bill): BillStatus {
  if (!isDebit(b)) return 'paid';
  return b.settlement && billBalance(b) <= 0 ? 'settled' : 'due';
}

export function settlementReceived(s: Settlement | null): number {
  return s ? s.installments.reduce((n, i) => n + i.hotelPaise + i.foodPaise, 0) : 0;
}

/** Bill payment modes, without repeats ("Cash · UPI"). */
export function billModes(b: Pick<Bill, 'hotel' | 'food'>): string[] {
  return uniq([b.hotel.mode, b.food.mode]);
}

export function advanceModes(a: Pick<Advance, 'hotelMode' | 'foodMode'>): string[] {
  return uniq([a.hotelMode, a.foodMode]);
}

function uniq(modes: (string | null)[]): string[] {
  const out: string[] = [];
  for (const m of modes) if (m && !out.includes(m)) out.push(m);
  return out;
}

/** "Room", "Food" or "Room + Food": what an entry covers. */
export function kindLabel(hotelPaise: number, foodPaise: number): string {
  const room = hotelPaise > 0 || foodPaise <= 0;
  const meal = foodPaise > 0;
  return room && meal ? 'Room + Food' : meal ? 'Food' : 'Room';
}

/** The hotel charges GST is worked on (V.P.O. is paid out on the guest's behalf, outside GST). */
export function hotelTaxable(h: HotelCharges): number {
  return h.roomPaise + h.planPaise + h.extraBedPaise + h.laundryPaise;
}

export function foodTaxable(f: FoodCharges): number {
  return f.foodPaise + f.planPaise + f.laundryPaise;
}

export const GST_SLABS = [5, 12, 18, 28] as const;

/**
 * The SAC (services accounting code) a GST bill prints for each business (MJ, 5 Nov 2026; his CA confirms them once): rooms 996311, restaurant
 * food 996331. HMS-wide, not a hotel setting: a hotel does not change tax codes. Each bill stores the codes it was made with (hotel 0061).
 */
export const GST_SAC = { hotel: '996311', food: '996331' } as const;

/** The codes a bill prints: its own stored ones; a bill read before they were stored prints the codes HMS always printed. */
export function billSac(b: { hotelSac?: string | null; foodSac?: string | null }): { hotel: string; food: string } {
  return { hotel: b.hotelSac || GST_SAC.hotel, food: b.foodSac || GST_SAC.food };
}

/**
 * The rate a typed GST amount stands for, stored with the bill: the first of the candidates (the bill's own stored rate, then the hotel's
 * default for that side) and then the GST slabs whose share of the taxable value is the GST to within one rupee; 0 when a taxable value
 * carries no GST; null when nothing fits or nothing is taxable. It never changes an amount.
 */
export function typedGstRate(taxablePaise: number, gstPaise: number, candidates: readonly (number | null)[]): number | null {
  if (taxablePaise <= 0 || gstPaise < 0) return null;
  if (gstPaise === 0) return 0;
  const fits = (rate: number): boolean => Math.abs((taxablePaise * rate) / 100 - gstPaise) <= 100;
  return [...candidates, ...GST_SLABS].find((rate): rate is number => rate !== null && rate > 0 && rate <= 28 && fits(rate)) ?? null;
}

/** GST as a percent of the charges before GST (for the form hint and the bill). */
export function gstPercent(basePaise: number, gstPaise: number): number | null {
  if (basePaise <= 0 || gstPaise <= 0) return null;
  return Math.round((gstPaise / basePaise) * 1000) / 10;
}

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

/** Today in IST as YYYY-MM-DD. */
export function todayIst(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

export function currentYear(): string {
  return todayIst().slice(0, 4);
}

/** Nights between two plain dates (0 when the order is wrong). */
export function nightsBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** IST date + "HH:MM" -> ISO UTC. */
export function istToIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00+05:30`).toISOString();
}

/** ISO UTC -> IST date and "HH:MM". */
export function isoToIst(iso: string): { date: string; time: string } {
  const s = new Date(Date.parse(iso) + 330 * 60_000).toISOString();
  return { date: s.slice(0, 10), time: s.slice(11, 16) };
}

/** Half-hour times for the arrival/departure pickers ("14:30" -> "2:30 pm"). */
export const timeOptions: { value: string; label: string }[] = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 ? '30' : '00';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return { value: `${String(h).padStart(2, '0')}:${m}`, label: `${h12}:${m} ${h < 12 ? 'am' : 'pm'}` };
});

/**
 * FORM PREVIEW ONLY: the server prices the stay itself with the dated meal_plan_rates (request 3).
 * Pass the rates from `getBillingOptions()` (plan code -> paise per person per night); without them
 * the temporary mock `planRatePaise` is used.
 */
export function priceStay(segments: StaySegment[], rates?: Readonly<Record<string, number>>): { segments: PricedSegment[]; totalPaise: number } {
  const table: Readonly<Record<string, number>> = rates ?? planRatePaise;
  const priced = segments.map((s) => {
    const nights = nightsBetween(s.from, s.to);
    const ratePaise = s.plan ? (table[s.plan] ?? null) : 0;
    return { ...s, nights, ratePaise, amountPaise: nights * Math.max(1, s.persons) * (ratePaise ?? 0) };
  });
  return { segments: priced, totalPaise: priced.reduce((n, s) => n + s.amountPaise, 0) };
}

/* ------------------------------------------------------------------ */
/* Validation (client and mock server use the same rules)              */
/* ------------------------------------------------------------------ */

export type FieldErrors = Record<string, string>;

const PHONE = /^[+0-9 ]{10,15}$/;
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function checkPhone(errors: FieldErrors, key: string, v: string): void {
  if (v.trim() && !PHONE.test(v.trim())) errors[key] = 'Enter 10 to 15 digits.';
}

export function validateAdvance(input: AdvanceInput, isNew: boolean): FieldErrors {
  const e: FieldErrors = {};
  if (isNew) {
    if (!input.receiptNo.trim()) e.receiptNo = 'Enter the receipt number.';
    else if (input.receiptNo.trim().length > 40) e.receiptNo = 'Keep it under 40 characters.';
  }
  if (!DATE.test(input.paymentDate)) e.paymentDate = 'Choose the date it was paid.';
  if (!input.guestName.trim()) e.guestName = "Enter the guest's name.";
  checkPhone(e, 'mobile', input.mobile);
  checkPhone(e, 'referenceMobile', input.referenceMobile);
  const wantsHotel = input.covers !== 'food';
  const wantsFood = input.covers !== 'hotel';
  if (wantsHotel && !(input.hotelPaise && input.hotelPaise > 0)) e.hotelPaise = 'Enter how much the guest paid.';
  if (wantsFood && !(input.foodPaise && input.foodPaise > 0)) e.foodPaise = 'Enter how much the guest paid.';
  if (input.instruction.length > 255) e.instruction = 'Keep it under 255 characters.';
  return e;
}

export function validateRefund(input: RefundInput, a: Advance): FieldErrors {
  const e: FieldErrors = {};
  const h = input.hotelPaise ?? 0;
  const f = input.foodPaise ?? 0;
  if (!DATE.test(input.date)) e.date = 'Choose the refund date.';
  if (h < 0 || h > a.hotelBalancePaise) e.hotelPaise = 'More than what is left on the hotel side.';
  if (f < 0 || f > a.foodBalancePaise) e.foodPaise = 'More than what is left on the food side.';
  // A refund of 0 is allowed: Pallav accepts it to close an advance (backend contract request 6).
  checkPhone(e, 'toMobile', input.toMobile);
  return e;
}

export function validateBill(input: BillInput, isNew: boolean): FieldErrors {
  const e: FieldErrors = {};
  if (isNew && !input.billNo.trim()) e.billNo = 'Enter the bill number.';
  if (!DATE.test(input.billDate)) e.billDate = 'Choose the bill date.';
  if (!input.guestName.trim()) e.guestName = "Enter the guest's name.";
  checkPhone(e, 'mobile', input.mobile);
  checkPhone(e, 'referenceMobile', input.referenceMobile);
  if (input.gstin.trim() && !GSTIN.test(input.gstin.trim().toUpperCase())) e.gstin = 'A GSTIN has 15 characters, like 24ABCDE1234F1Z5.';
  if (input.persons !== null && (input.persons < 1 || input.persons > 99)) e.persons = 'Between 1 and 99.';
  if (input.arrivalAt && input.departureAt && Date.parse(input.departureAt) < Date.parse(input.arrivalAt)) {
    e.departureAt = 'Departure is before arrival.';
  }
  const money = [
    input.hotel.roomPaise, input.hotel.planPaise, input.hotel.extraBedPaise, input.hotel.laundryPaise,
    input.hotel.vpoPaise, input.hotel.gstPaise, input.food.foodPaise, input.food.planPaise, input.food.laundryPaise, input.food.gstPaise,
  ];
  if (money.some((m) => m < 0)) e.charges = 'Amounts cannot be below zero.';
  input.stay.forEach((s, i) => {
    if (!DATE.test(s.from) || !DATE.test(s.to) || nightsBetween(s.from, s.to) < 1) e[`stay.${i}`] = 'Check the dates: at least one night.';
    else if (s.persons < 1 || s.persons > 99) e[`stay.${i}`] = 'Persons between 1 and 99.';
  });
  if (input.stay.length > 30) e.stay = 'Up to 30 parts.';
  return e;
}

export function validateSettle(input: SettleInput, opts: { alreadyRecorded?: number } = {}): FieldErrors {
  const e: FieldErrors = {};
  const already = opts.alreadyRecorded ?? 0;
  if (input.installments.length === 0) e['inst.0'] = 'Add the money received.';
  input.installments.forEach((i, n) => {
    if (!DATE.test(i.date)) e[`inst.${n}`] = 'Choose the date it was received.';
    else if (i.hotelPaise < 0 || i.foodPaise < 0) e[`inst.${n}`] = 'Amounts cannot be below zero.';
    else if (i.hotelPaise + i.foodPaise <= 0) e[`inst.${n}`] = 'Enter the hotel or food amount.';
  });
  if (already + input.installments.length > MAX_INSTALLMENTS) e.installments = already > 0 ? `Up to ${MAX_INSTALLMENTS} installments in all; ${already} already recorded.` : `Up to ${MAX_INSTALLMENTS} installments.`;
  checkPhone(e, 'referenceMobile', input.referenceMobile);
  return e;
}

/* ---------------- one-tap payment (QuickPay) ---------------- */

export interface QuickPaySplit {
  hotelPaise: number;
  foodPaise: number;
}

/** Lays an amount over the two balances, hotel first; anything past both stays on the hotel side (the server keeps it as an advance). */
export function splitQuickPay(bill: Pick<Bill, 'balanceHotelPaise' | 'balanceFoodPaise'>, amountPaise: number): QuickPaySplit {
  const amount = Math.max(0, Math.round(amountPaise));
  const hotelOwed = Math.max(0, bill.balanceHotelPaise);
  const foodOwed = Math.max(0, bill.balanceFoodPaise);
  if (hotelOwed === 0 && foodOwed > 0) return { hotelPaise: Math.max(0, amount - foodOwed), foodPaise: Math.min(amount, foodOwed) };
  const hotelPaise = Math.min(amount, hotelOwed);
  const foodPaise = Math.min(amount - hotelPaise, foodOwed);
  return { hotelPaise: hotelPaise + (amount - hotelPaise - foodPaise), foodPaise };
}

/** What an in-house stay still owes per side once the booking's advance is taken off (hotel side first). */
export function splitAfterAdvance(hotelPaise: number, foodPaise: number, advancePaise: number): QuickPaySplit {
  const offHotel = Math.min(Math.max(0, advancePaise), Math.max(0, hotelPaise));
  const offFood = Math.min(Math.max(0, advancePaise) - offHotel, Math.max(0, foodPaise));
  return { hotelPaise: Math.max(0, hotelPaise) - offHotel, foodPaise: Math.max(0, foodPaise) - offFood };
}

/**
 * The settle call of the Cash received sheet: one instalment dated `today`, the amount laid over the balances (or the split the desk typed),
 * one mode for both sides, the reference the bill already carries. Pure, so the sheet and its test share it.
 */
export function quickPayInput(
  bill: Pick<Bill, 'balanceHotelPaise' | 'balanceFoodPaise' | 'settlement' | 'referenceName' | 'referenceMobile' | 'version'>,
  amountPaise: number,
  mode: PaymentMode,
  today: string,
  split: QuickPaySplit = splitQuickPay(bill, amountPaise),
): SettleInput {
  const hotelPaise = Math.max(0, Math.round(split.hotelPaise));
  const foodPaise = Math.max(0, Math.round(split.foodPaise));
  return {
    installments: [{ date: today, hotelPaise, hotelMode: hotelPaise > 0 ? mode : null, foodPaise, foodMode: foodPaise > 0 ? mode : null }],
    referenceName: bill.settlement?.referenceName || bill.referenceName || '',
    referenceMobile: bill.settlement?.referenceMobile || bill.referenceMobile || '',
    instruction: bill.settlement?.instruction ?? '',
    version: bill.version,
  };
}

/* ---------------- mock data (Hotel Sunrise, Rajkot) ---------------- */

export function emptyHotel(): HotelCharges {
  return { plan: null, roomPaise: 0, planPaise: 0, extraBedPaise: 0, laundryPaise: 0, vpoPaise: 0, gstPaise: 0, mode: null };
}

export function emptyFood(): FoodCharges {
  return { foodPaise: 0, planPaise: 0, laundryPaise: 0, gstPaise: 0, mode: null };
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

export interface BillingApi {
  /** Company names for the pickers. On the real API this becomes the Companies module's LOOKUP (LookupItem, typeahead; request 7). */
  listCompanies(): Promise<DashResult<BillingCompany[]>>;
  listAdvances(q: AdvanceQuery): Promise<DashResult<AdvanceList>>;
  getAdvance(id: string): Promise<DashResult<Advance>>;
  /** Advances with money left, for the "take off an advance" picker on a new bill. */
  listOpenAdvances(): Promise<DashResult<Advance[]>>;
  createAdvance(input: AdvanceInput): Promise<DashResult<Advance>>;
  updateAdvance(id: string, input: AdvanceInput): Promise<DashResult<Advance>>;
  /** Send the version the user saw; a stale one gets CONFLICT with details.currentVersion. The advance goes to the recycle bin. */
  deleteAdvance(id: string, version?: number): Promise<DashResult<{ id: string }>>;
  refundAdvance(id: string, input: RefundInput): Promise<DashResult<Advance>>;
  /** Refund reversal; send the version the user saw. */
  undoRefund(id: string, version?: number): Promise<DashResult<Advance>>;
  /** Recycle bin (listAdvances with deleted: 'only'): bring a deleted advance back. Send the version the user saw (the server requires it; the mock ignores it). */
  restoreAdvance(id: string, version?: number): Promise<DashResult<Advance>>;
  /** Recycle bin: delete for ever. */
  purgeAdvance(id: string): Promise<DashResult<{ id: string }>>;
  listBills(q: BillQuery): Promise<DashResult<BillList>>;
  getBill(id: string): Promise<DashResult<Bill>>;
  createBill(input: BillInput): Promise<DashResult<Bill>>;
  updateBill(id: string, input: BillInput): Promise<DashResult<Bill>>;
  /** Send the version the user saw. */
  deleteBill(id: string, version?: number): Promise<DashResult<{ id: string }>>;
  settleBill(id: string, input: SettleInput): Promise<DashResult<Bill>>;
  /** Send the version the user saw. */
  reverseSettlement(id: string, version?: number): Promise<DashResult<Bill>>;
  /** Plans with TODAY's meal rates and the payment modes, from the server (replaces planRatePaise; request 6). */
  getBillingOptions(): Promise<DashResult<BillingOptions>>;
  /** The paper's fields for the print view (replaces billingHotel; request 5). */
  getBillPreview(id: string): Promise<DashResult<BillPreview>>;
  /** The advance RECEIPT's fields for its print view (same header as bills; replaces billingHotel). */
  getAdvancePreview(id: string): Promise<DashResult<AdvancePreview>>;
  /** Email the bill as a PDF (POST /billing/bills/{id}/email). 	o left out = the guest's address on file; none on file = a 	o field error. 202: queued, sent a moment later. */
  emailBill(id: string, to?: string): Promise<DashResult<InvoiceQueued>>;
  /** The same for an advance receipt (POST /billing/advances/{id}/email). */
  emailAdvance(id: string, to?: string): Promise<DashResult<InvoiceQueued>>;
}

/** The answer of an invoice mail: queued for sending (never sent at once) to this address. */
export interface InvoiceQueued {
  queued: boolean;
  to: string;
}

/** What the printed advance receipt shows. Server path: GET /api/v1/billing/advances/{id}/preview. */
export interface AdvancePreview {
  header: { name: string; foodName: string; address: string; phone: string; gstin: string | null; foodGstin: string | null };
  advance: Advance;
  /** Amount taken, in words (Indian), worked out by the server. */
  amountWords: string;
}

export interface BillingOptions {
  plans: { code: PlanText; label: string; ratePaise: number }[];
  paymentModes: string[];
}

/** What the printed bill shows. Header GSTINs come from hotel settings (MJ #20 A): `gstin` = the hotel, `foodGstin` = the food unit; null while not set. */
export interface BillPreview {
  header: { name: string; foodName: string; address: string; phone: string; gstin: string | null; foodGstin: string | null };
  bill: Bill;
  /** Amounts in words (Indian), worked out by the server. */
  hotelWords: string;
  foodWords: string;
}

/**
 * The scratch Hotel Pallav's own demo rows (docs/sessions/S08-fixtures: bill_master_bills, bill_master_advances, company_profiles), so a screen can be
 * compared with Pallav on the same data. Only used when the dev preview asks for it (`?data=s08`); the normal mock above is untouched.
 */
export interface BillingFixtures {
  companies: { id: number; name: string; gst_number: string | null }[];
  advances: { id: number; receipt_number: string; guest_name: string; mobile_number: string | null; company_id: number | null; payment_date: string; hotel_amount: number; food_amount: number | null; hotel_mode: string | null; food_mode: string | null; hotel_balance: number; food_balance: number | null; reference_name?: string | null; reference_mobile_number?: string | null; instruction?: string | null; room_number?: string | null; created_at: string; entry_no: number }[];
  bills: { id: number; advance_id?: number | null; advance_receipt_number?: string | null; advance_guest_name?: string | null; advance_hotel_amount?: number | null; advance_food_amount?: number | null; bill_number: string; company_id: number | null; bill_date: string; guest_name: string; mobile_number: string | null; hotel_plan?: string | null; hotel_amount?: number | null; hotel_plan_amount?: number | null; hotel_laundry_amount?: number | null; hotel_gst?: number | null; hotel_mode_of_payment?: string | null; food_amount?: number | null; food_plan_amount?: number | null; food_laundry_amount?: number | null; food_gst?: number | null; food_mode_of_payment?: string | null; total_hotel_amount: number; total_food_amount: number; balance_hotel_amount?: number | null; balance_food_amount?: number | null; reference_name?: string | null; reference_mobile_number?: string | null; instruction?: string | null; room_number?: string | null; created_at: string; entry_no: number }[];
}

/* ------------------------------------------------------------------ */
/* Drafts for the forms                                                */
/* ------------------------------------------------------------------ */

export function emptyAdvanceInput(): AdvanceInput {
  return {
    receiptNo: '', paymentDate: todayIst(), guestName: '', mobile: '', companyId: null, roomNo: '', covers: 'hotel',
    hotelPaise: null, foodPaise: null, hotelMode: 'Cash', foodMode: 'Cash', referenceName: '', referenceMobile: '', instruction: '',
  };
}

export function advanceToInput(a: Advance): AdvanceInput {
  return {
    receiptNo: a.receiptNo, paymentDate: a.paymentDate, guestName: a.guestName, mobile: a.mobile, companyId: a.companyId,
    roomNo: a.roomNo, covers: advanceCovers(a), hotelPaise: a.hotelPaise || null, foodPaise: a.foodPaise || null,
    hotelMode: a.hotelMode ?? 'Cash', foodMode: a.foodMode ?? 'Cash', referenceName: a.referenceName,
    referenceMobile: a.referenceMobile, instruction: a.instruction, version: a.version,
  };
}

export function emptyRefundInput(a: Advance): RefundInput {
  return {
    date: todayIst(), hotelPaise: a.hotelBalancePaise || null, foodPaise: a.foodBalancePaise || null,
    hotelMode: a.hotelMode ?? 'Cash', foodMode: a.foodMode ?? 'Cash', toName: a.guestName, toMobile: a.mobile, note: '', version: a.version,
  };
}

export function emptyBillInput(): BillInput {
  return {
    billNo: '', billDate: todayIst(), grNo: '', advanceId: null, guestName: '', mobile: '', address: '', gstin: '',
    companyId: null, roomNo: '', persons: null, arrivalAt: null, departureAt: null,
    hotel: { ...emptyHotel(), mode: 'Cash' }, food: { ...emptyFood(), mode: 'Cash' }, stay: [],
    referenceName: '', referenceMobile: '', instruction: '',
  };
}

export function billToInput(b: Bill): BillInput {
  return {
    billNo: b.billNo, billDate: b.billDate, grNo: b.grNo, advanceId: b.advance?.advanceId ?? null, guestName: b.guestName,
    mobile: b.mobile, address: b.address, gstin: b.gstin, companyId: b.companyId, roomNo: b.roomNo, persons: b.persons,
    arrivalAt: b.arrivalAt, departureAt: b.departureAt, hotel: { ...b.hotel }, food: { ...b.food },
    stay: b.stay.map(({ from, to, plan, persons }) => ({ from, to, plan, persons })),
    referenceName: b.referenceName, referenceMobile: b.referenceMobile, instruction: b.instruction, version: b.version,
  };
}

export function emptyInstallment(): Installment {
  return { date: todayIst(), hotelPaise: 0, hotelMode: 'Cash', foodPaise: 0, foodMode: 'Cash' };
}

/** Builds the stay from the arrival and departure (one part, the bill's plan and persons). */
export function stayFromDates(input: BillInput): StaySegment[] {
  if (!input.arrivalAt || !input.departureAt) return [];
  const from = isoToIst(input.arrivalAt).date;
  const to = isoToIst(input.departureAt).date;
  if (nightsBetween(from, to) < 1) return [];
  return [{ from, to, plan: input.hotel.plan, persons: input.persons ?? 1 }];
}

/* ------------------------------------------------------------------ */
/* Copy                                                                */
/* ------------------------------------------------------------------ */

export const advanceStatusLabel: Record<AdvanceStatus, string> = { unused: 'Unused', partly: 'Partly used', used: 'Used', refunded: 'Refunded' };
export const advanceStatusTone = { unused: 'warning', partly: 'info', used: 'success', refunded: 'neutral' } as const;
export const billStatusLabel: Record<BillStatus, string> = { paid: 'Paid', due: 'Debit waiting', settled: 'Debit settled' };
export const billStatusTone = { paid: 'success', due: 'warning', settled: 'info' } as const;

export function monthOptions(months: string[]): { value: string; label: string }[] {
  return months.map((m) => ({ value: m, label: formatMonth(m) }));
}

export const billingCopy = {
  common: {
    walkIn: 'Walk-in',
    walkInGuests: 'Walk-in guests',
    anyMode: 'Any payment',
    anyCompany: 'Any company',
    anyMonth: 'Any month',
    hotel: 'Hotel',
    food: 'Food',
    total: 'Total',
    inAll: 'In all',
    cancel: 'Cancel',
    close: 'Close',
    edit: 'Edit',
    delete: 'Delete',
    notSet: 'Not set',
    none: '—',
    optional: 'optional',
    resetFilters: 'Reset filters',
    paidBy: 'Paid by',
    reference: 'Reference',
    referenceName: 'Reference name',
    referenceMobile: 'Reference mobile',
    instruction: 'Instruction',
    recorded: 'Recorded',
    yearPrefix: (y: string) => `${y} /`,
    previewNote: 'Preview only. The PDF to print or email comes with the backend.',
    showing: (shown: number, total: number, one: string, many: string) => `Showing ${shown} of ${total} ${total === 1 ? one : many}`,
  },
  advances: {
    title: 'Advances',
    subtitle: 'Money guests paid ahead of their bill. Open one to see what is left, or to refund it.',
    newButton: 'New advance',
    search: 'Search receipt, guest, room, company or amount',
    tabs: { all: 'All', unused: 'Unused', partly: 'Partly used', used: 'Used', refunded: 'Refunded' } as Record<AdvanceTab, string>,
    kpi: { month: 'Taken this month', held: 'Still held', unused: 'Unused', refunded: 'Refunded' },
    col: { date: 'Paid on', receipt: 'Receipt No.', guest: 'Guest', company: 'Company', room: 'Room', covers: 'For', status: 'Status', taken: 'Taken', left: 'Balance left' },
    empty: { title: 'No advances yet', body: 'When a guest pays before checking out, record it here so it can be taken off their bill.' },
    noMatch: { title: 'No advance matches', body: 'Try a receipt number, a guest name, a room, a company or an amount. Or reset the filters.' },
    detailTitle: (no: string) => `Advance ${no}`,
    sections: { hotel: 'Hotel', food: 'Food', details: 'Details', refund: 'Refund', usedOn: 'Taken off bills' },
    fields: {
      covers: 'What is the advance for?',
      coversHotel: 'Hotel (room)',
      coversFood: 'Food only',
      coversBoth: 'Room and food',
      receipt: 'Receipt number',
      receiptHintNew: 'The year is added in front for you.',
      receiptHintEdit: 'Cannot be changed once recorded.',
      paidOn: 'Paid on',
      guest: 'Guest name',
      mobile: 'Mobile number',
      company: 'Company',
      room: 'Room number',
      hotelAmount: 'Hotel advance',
      foodAmount: 'Food advance',
      advanceTotal: 'Advance total',
      instructionPlaceholder: 'Anything the front desk should know',
      advance: 'Advance',
      balance: 'Balance left',
      refunded: 'Refunded',
      refundedOn: 'Refunded on',
      refundedTo: 'Refunded to',
      refundNote: 'Refund note',
      fromBill: 'Made from overpaid bill',
    },
    form: { newTitle: 'New advance', editTitle: (no: string) => `Edit advance ${no}`, save: 'Save advance', saveEdit: 'Save changes' },
    refund: {
      button: 'Refund',
      title: (no: string) => `Refund ${no}`,
      leftTitle: 'What is left to give back',
      hotelRefund: 'Hotel refund',
      foodRefund: 'Food refund',
      upTo: 'Up to',
      paidBackBy: 'Paid back by',
      date: 'Refund date',
      toName: 'Paid back to',
      toMobile: 'Mobile number',
      notePlaceholder: 'Why it is being refunded',
      total: 'Refund total',
      save: 'Process Refund',
    },
    undo: { button: 'Undo refund', title: 'Undo this refund?', body: 'The money goes back on the advance, as if it was never refunded.', confirm: 'Undo refund' },
    remove: { title: (no: string) => `Delete advance ${no}?`, body: 'This cannot be undone.', confirm: 'Delete' },
    receipt: { button: 'Receipt', title: 'Advance receipt', heading: 'Advance Receipt', receiptNo: 'Receipt No.', receivedFrom: 'Received from', towards: 'Towards', amountWords: 'Amount in words', signature: 'Authorised signatory', refundedStamp: 'Refunded' },
    locked: 'Used or refunded advances cannot be edited or deleted.',
    bin: {
      open: 'Recycle bin',
      back: 'Back to advances',
      title: 'Advances recycle bin',
      subtitle: 'Deleted advances. Restore one to bring it back, or delete it for ever.',
      emptyTitle: 'The recycle bin is empty',
      emptyBody: 'Deleted advances wait here until you restore them or delete them for ever.',
      restore: 'Restore',
      purge: 'Delete for ever',
      restored: (no: string) => `Advance ${no} restored.`,
      purged: (no: string) => `Advance ${no} deleted for ever.`,
      purgeTitle: (no: string) => `Delete advance ${no} for ever?`,
      purgeBody: 'This cannot be undone.',
    },
    toast: { created: 'Advance recorded.', updated: 'Advance updated.', deleted: 'Advance deleted.', refunded: 'Refund recorded.', undone: 'Refund reversed.' },
  },
  bills: {
    title: 'Bills',
    subtitle: 'Every guest bill, newest first, including those on debit. Open one for the charges, and to settle a debit.',
    newButton: 'New bill',
    search: 'Search bill, G.R. No., guest, room, company or amount',
    tabs: { all: 'All', due: 'Due', settled: 'Settled', paid: 'Paid' } as Record<BillTab, string>,
    kpi: { count: 'Bills this month', billed: 'Billed this month', due: 'Debit waiting', settled: 'Debit settled' },
    col: { date: 'Bill date', bill: 'Bill No.', guest: 'Guest', company: 'Company', room: 'Room', payment: 'Payment', status: 'Status', total: 'Bill total', due: 'Balance due' },
    empty: { title: 'No bills yet', body: 'When a guest checks out, create their bill here.' },
    noMatch: { title: 'No bill matches', body: 'Try another word, or reset the filters. Search looks at the bill number, guest, room, company and amount.' },
    detailTitle: (no: string) => `Bill ${no}`,
    sections: { bill: 'The bill', guest: 'The guest', hotel: 'Hotel charges', food: 'Food charges', stay: 'Nights, plan and people', reference: 'Reference', debit: 'On debit', received: 'Money received', advance: 'Advance taken off' },
    fields: {
      billNo: 'Bill number',
      billNoHintNew: 'The year is added in front for you.',
      billNoHintEdit: 'Cannot be changed once the bill is made.',
      billDate: 'Bill date',
      grNo: 'G.R. No.',
      grPlaceholder: 'Guest register',
      advanceCompany: 'Advance from',
      advancePick: 'Advance to take off',
      noAdvance: 'No advance',
      chooseCompanyFirst: 'Choose who paid first',
      advanceHint: 'What the guest paid ahead is taken off this bill, up to its total.',
      noOpenAdvances: 'No advance has money left right now.',
      advanceLocked: 'The advance is chosen when the bill is made.',
      guest: 'Guest name',
      mobile: 'Mobile number',
      address: 'Address',
      addressPlaceholder: 'City, or the full address',
      gstin: 'Guest GSTIN',
      company: 'Company',
      room: 'Room',
      persons: 'Persons',
      arrived: 'Arrived',
      left: 'Left',
      time: 'Time',
      plan: 'Plan',
      noPlan: 'No plan',
      rate: 'Rate',
      changingRate: 'Changing rate',
      room$: 'Room (tariff)',
      plan$: 'Plan amount',
      bed$: 'Extra bed',
      laundry$: 'Laundry',
      vpo$: 'V.P.O. (paid out)',
      gst$: 'GST (CGST + SGST)',
      food$: 'Food amount',
      hotelTotal: 'Hotel total',
      foodTotal: 'Food total',
      billTotal: 'Bill total',
      advanceLess: 'Less advance',
      net: 'To pay',
      gstHint: (p: number) => `GST is ${p}% of the charges.`,
      stayHint: 'If the plan or the number of people changed during the stay, split it. Each part is priced at its plan, per person per night.',
      stayFrom: 'From night of',
      stayTo: 'Until morning of',
      nights: (n: number) => `${n} ${n === 1 ? 'night' : 'nights'}`,
      persons$: (n: number) => `${n} ${n === 1 ? 'person' : 'persons'}`,
      addPart: 'Plan or people changed',
      rebuild: 'Rebuild from the dates',
      owedTitle: 'Owed to the food side for plan meals',
      owedHint: 'Kept apart from the guest bill.',
      removePart: 'Remove this part',
      stayed: 'Stayed',
      stillOwed: 'Still owed',
      hotelBalance: 'Hotel balance',
      foodBalance: 'Food balance',
      nothingReceived: 'Nothing received yet.',
      overpaid: 'Overpaid',
      keptAs: (no: string) => `Kept as advance ${no}`,
      instructionPlaceholder: 'Anything the front desk or accounts should know',
    },
    steps: ['Bill and guest', 'Charges', 'Stay and plan', 'Reference'] as const,
    form: { newTitle: 'New bill', editTitle: (no: string) => `Edit bill ${no}`, save: 'Create bill', saveEdit: 'Save changes', next: 'Next', backStep: 'Back' },
    settle: {
      button: 'Settle',
      title: (no: string) => `Settle bill ${no}`,
      owedTitle: 'What is owed',
      installment: (n: number) => `Installment ${n}`,
      receivedOn: 'Received on',
      hotelPaidBy: 'Hotel paid by',
      foodPaidBy: 'Food paid by',
      add: 'Add installment',
      remove: (n: number) => `Remove installment ${n}`,
      hint: 'One row for each payment, up to five. Anything paid over what is owed is kept as an advance.',
      instructionPlaceholder: 'Cheque number, transfer reference, anything accounts should know',
      received: 'Received',
      left: 'Still owed after this',
      over: 'Kept as advance',
      save: 'Record settlement',
      /** H6 part payments: the same pop-up for a bill that still owes after a first settlement. */
      more: 'Record payment',
      moreTitle: (no: string) => `Record a payment on Bill ${no}`,
      moreEyebrow: 'Debit · Payment',
      moreHint: 'The payments already received stay; add the new ones (up to five in all). Anything paid over what is owed is kept as an advance.',
      alreadyReceived: 'Already received',
      partPaid: 'Part paid',
      stillDue: (amount: string) => `${amount} still due`,
      /** The button on the list row (H6 "pay from the list"): opens the pop-up without opening the card. */
      rowPay: 'Pay',
    },
    /** One-tap payment (design preview, section 5): the balance is already on the two buttons. */
    quickPay: {
      link: (amount: string) => `Send pay link ${amount}`,
      cash: (amount: string) => `Cash received ${amount}`,
      linkShort: (amount: string) => `Link ${amount}`,
      cashShort: (amount: string) => `Cash ${amount}`,
      making: 'Making the link…',
      more: 'More ways to pay',
      balanceLabel: 'Balance on the stay',
      gstIncluded: (hotel: number, food: number) => (hotel === food ? `GST ${hotel}% included` : `GST ${hotel}% and ${food}% included`),
      autoLabel: 'Automatic',
      auto: 'A link payment shows under Admin > Online payments; record it here when it comes in. Cash is kept as an advance and taken off at check-out.',
      autoBill: 'A link payment shows under Admin > Online payments; record it on the bill when it comes in.',
      /** A Hotel User cannot open Admin > Online payments: the same notes without the way there (MJ, 5 Nov 2026). */
      autoStaff: 'When the guest pays by link, record the payment here. Cash is kept as an advance and taken off at check-out.',
      linkReadyStaff: '{0} can pay {1} with this link. It works for {2} days; when the guest has paid, record the payment here.',
      askAdmin: 'Ask your Hotel Admin about online payments.',
      linkEyebrow: 'Pay link',
      linkTitle: (amount: string) => `Pay link for ${amount}`,
      linkFailedTitle: 'Pay link could not be made',
      linkReady: (name: string, amount: string, days: number) => `${name || 'The guest'} can pay ${amount} with this link. It works for ${days} days; the payment shows under Admin > Online payments and is recorded here by the desk.`,
      linkField: 'Payment link',
      copy: 'Copy link',
      copied: 'Link copied.',
      copyFailed: 'Could not copy. Select the link and copy it.',
      whatsapp: 'Send on WhatsApp',
      sms: 'Send by SMS',
      email: 'Send by email',
      whatsappText: (name: string, hotel: string, what: string, amount: string, url: string) => `Hello ${name || 'guest'}, this is ${hotel || 'the hotel'}. Please pay ${amount} for ${what} here: ${url}`,
      notReady: 'Online payments are not switched on yet.',
      openAdmin: 'Open Admin > Online payments',
      cashEyebrow: 'Cash received',
      cashTitle: (who: string) => `Cash from ${who}`,
      amount: 'Amount received',
      hotelPart: 'Hotel',
      foodPart: 'Food',
      mode: 'Paid by',
      date: 'Received on',
      stillOwed: (amount: string) => `Still owed after this: ${amount}`,
      over: (amount: string) => `Over what is owed: ${amount}, kept as an advance`,
      stayNote: 'Kept as an advance on the booking and taken off the bill at check-out.',
      receiptWait: 'Getting the receipt number…',
      confirm: (amount: string) => `Confirm ${amount} received`,
      saving: 'Recording…',
      toastBill: (amount: string, billNo: string) => `${amount} received · bill ${billNo} paid`,
      toastBillPart: (amount: string, billNo: string, left: string) => `${amount} received · bill ${billNo} still owes ${left}`,
      toastStay: (amount: string, receipt: string) => `${amount} received · receipt ${receipt}, taken off at check-out`,
      linkMade: (amount: string, name: string) => `Pay link for ${amount} made for ${name}.`,
    },
    reverse: { button: 'Reverse settlement', title: 'Reverse this settlement?', body: 'The bill goes back to having a balance due. Any advance made from an overpayment is removed.', confirm: 'Reverse' },
    remove: { title: (no: string) => `Delete bill ${no}?`, body: 'This cannot be undone. Any advance taken off goes back on the advance.', confirm: 'Delete' },
    locked: 'Locked while settled. Reverse the settlement to edit.',
    preview: { button: 'Preview Bill', title: 'Bill preview', heading: 'Tax Invoice', billNo: 'Bill No.', grNo: 'G.R. No.', billedTo: 'Billed to', particulars: 'Particulars', amount: 'Amount', cgst: 'CGST', sgst: 'SGST', amountWords: 'Amount in words', signature: 'Authorised signatory', thanks: 'Thank you for staying with us.' },
    toast: { created: 'Bill created.', updated: 'Bill updated.', deleted: 'Bill deleted.', settled: 'Settlement recorded.', payment: 'Payment recorded.', reversed: 'Settlement reversed.' },
  },
} as const;

const fillTemplate = (template: string, values: readonly (string | number)[]): string => template.replace(/\{(\d+)\}/g, (m, i: string) => String(values[Number(i)] ?? m));

/** The pay-by-link notes as this person reads them: a Hotel User cannot open Admin > Online payments, so they get the notes without that path and no button to it. */
export function payLinkNotes(role: string, format: (template: string, values: readonly (string | number)[]) => string = fillTemplate) {
  const q = billingCopy.bills.quickPay;
  const staff = role === 'hotel_user';
  return {
    auto: staff ? q.autoStaff : q.auto,
    linkReady: (name: string, amount: string, days: number): string => (staff ? format(q.linkReadyStaff, [name || 'The guest', amount, days]) : q.linkReady(name, amount, days)),
    adminButton: !staff,
  };
}
