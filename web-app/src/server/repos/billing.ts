import "server-only";
import type { Paise } from "../money/paise";
import type { AccountingYearRepo, ForceLogRepo, SystemLogRepo } from "./cashSupport";
import type { ListResult, Page, VersionedResult } from "./types";

// Billing (Bill Master): guest advances and bills, both in the hotel's own database (tables bill_master_advances, bill_master_bills,
// meal_plan_rates, company_profiles read-only). Plain records in and out, money as bigint paise, no SQL. Rules every implementation
// keeps (the in-memory double included): entry numbers per table = MAX+1 counting soft-deleted rows, taken inside the unit; soft delete
// (deleted_at/deleted_by) hides a row from everything except { deleted: true }; `version` starts at 1 and rises by exactly one on every
// update, soft delete and restore, and an update with another expected version answers { ok:false, reason:"conflict" }; another hotel's
// id is simply not found; receipt_number and bill_number are unique among LIVE rows (RepoError "unique"); balances never below zero
// (RepoError "check"). Spec: docs/specs/billing-advances.md, billing-bills.md.

/* ---------------------------------------------------------------- advances */

export interface AdvanceFields {
  receiptNumber: string;
  guestName: string;
  mobileNumber: string | null;
  roomNumber: string | null;
  companyId: string | null;
  /** Set when the front office took the advance for a reservation (B3). */
  reservationId: string | null;
  /** YYYY-MM-DD */
  paymentDate: string;
  hotelAmountPaise: Paise;
  foodAmountPaise: Paise;
  hotelMode: string | null;
  foodMode: string | null;
  referenceName: string | null;
  referenceMobileNumber: string | null;
  instruction: string | null;
  hotelBalancePaise: Paise;
  foodBalancePaise: Paise;
  /** Pallav's `total`: amounts after create/edit, the refunded amounts after a refund, the balances after a reversal. */
  totalPaise: Paise;
  hotelRefundAmountPaise: Paise | null;
  foodRefundAmountPaise: Paise | null;
  hotelRefundMode: string | null;
  foodRefundMode: string | null;
  refundPaymentDate: string | null;
  refundGuestName: string | null;
  refundMobileNumber: string | null;
  refundInstruction: string | null;
}

export interface AdvanceRecord extends AdvanceFields {
  id: string;
  entryNo: number;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export type NewAdvance = AdvanceFields & { createdBy: string };
type AdvancePatch = Partial<AdvanceFields>;

export type AdvanceState = "unused" | "partly" | "used" | "refunded";
export const ADVANCE_SORTS = ["paymentDate", "receiptNumber", "guestName", "totalAmountPaise", "balancePaise"] as const;
export type AdvanceSort = (typeof ADVANCE_SORTS)[number];

/** The screen's filters. Applied in SQL by the real repository; the search is plain text, every word must match. */
export interface AdvanceFilter {
  /** The accounting-year window on screen (payment_date between). With `from`, older OPEN advances (no refund, balance > 0) are carried in. */
  from?: string;
  to?: string;
  /** YYYY-MM of payment_date. */
  month?: string;
  /** A hotel or food mode equal to this text (case-insensitive). */
  mode?: string;
  /** A company id, or "walkin" = no company. */
  company?: string;
  /** Words (already split and lower-cased by the service); each must appear in receipt, guest, mobile, room, company name or "walk-in", modes, or the amount as 1234.50. */
  words?: readonly string[];
  /** Unit switcher (later): rows with an amount on that side. */
  side?: "hotel" | "food";
  deleted?: "no" | "only";
}

export interface AdvanceListQuery extends AdvanceFilter, Page {
  state?: AdvanceState;
  sort: AdvanceSort;
  dir: "asc" | "desc";
}

export interface AdvanceRepo {
  /** `forUpdate`: lock the row until the unit ends (SELECT ... FOR UPDATE): read this way before working out what a bill may take off it. */
  get(id: string, options?: { deleted?: boolean; forUpdate?: boolean }): Promise<AdvanceRecord | null>;
  /** The LIVE advance with exactly this receipt number (uniqueness check). */
  byReceipt(receiptNumber: string): Promise<AdvanceRecord | null>;
  /** Every LIVE advance with this receipt number (a debit settlement's excess advances, B2). */
  allByReceipt(receiptNumber: string): Promise<AdvanceRecord[]>;
  list(query: AdvanceListQuery): Promise<ListResult<AdvanceRecord>>;
  /** Counts per state for the same filter (before the state tab). */
  countByState(filter: AdvanceFilter): Promise<Record<AdvanceState, number>>;
  /** The numbers on top: taken in [monthFrom, monthTo], held (not refunded), unused count, refunded total. Live rows. */
  figures(monthFrom: string, monthTo: string): Promise<{ monthTakenPaise: Paise; heldPaise: Paise; unusedCount: number; refundedPaise: Paise; all: number }>;
  /** Distinct modes, company ids and YYYY-MM months of live advances, for the filter menus. */
  options(): Promise<{ modes: string[]; companyIds: string[]; months: string[] }>;
  /** Billing::suggest (Support/Pms/Billing.php:175-182): the highest number typed after `prefix` ("2026 / ") on any receipt, digits only; 0 when none. */
  highestTyped(prefix: string): Promise<number>;
  /** The LIVE advances taken against each of these reservations (front office), by payment date. */
  byReservation(reservationIds: readonly string[]): Promise<Map<string, AdvanceRecord[]>>;
  /** Live advances with hotel + food balance > 0, by guest name (the bill's picker). Capped at `limit`. */
  open(limit: number): Promise<AdvanceRecord[]>;
  /** Assigns the next entry number inside the same unit and inserts. */
  create(input: NewAdvance): Promise<AdvanceRecord>;
  update(id: string, expectedVersion: number, patch: AdvancePatch, actorId: string): Promise<VersionedResult<AdvanceRecord>>;
  softDelete(id: string, expectedVersion: number, actorId: string): Promise<VersionedResult<AdvanceRecord>>;
  restore(id: string, expectedVersion: number, actorId: string): Promise<VersionedResult<AdvanceRecord>>;
  /** Removes a recycle-bin row for good (hard-delete marker table). Live rows are never purged. */
  purge(id: string): Promise<boolean>;
}

/* ---------------------------------------------------------------- bills (B2; listed now so the interface is approved once) */

/** One of the five debit-settlement slots (debit_bill_date, debit_bill_date_1 ... _4 and their modes and amounts). */
export interface DebitSlot {
  date: string | null;
  hotelMode: string | null;
  foodMode: string | null;
  hotelPaise: Paise | null;
  foodPaise: Paise | null;
}

export interface PricedStayPart {
  from: string;
  to: string;
  plan: string;
  persons: number;
  nights: number;
  /** null when the rate changed during the part (Pallav MealPlanRate::price). */
  ratePaise: Paise | null;
  amountPaise: Paise;
}

/** The persons of a stay as a bill shows them (decision 52). */
export interface BillGuests {
  adults: number;
  children: number;
  names: string[];
}

export interface BillFields {
  billNumber: string;
  billDate: string;
  companyId: string | null;
  guestName: string;
  mobileNumber: string | null;
  roomNumber: string | null;
  grNumber: string | null;
  guestAddress: string | null;
  guestGstin: string | null;
  persons: number | null;
  arrivalAt: Date | null;
  departureAt: Date | null;
  hotelPlan: string | null;
  hotelAmountPaise: Paise;
  hotelPlanAmountPaise: Paise;
  hotelExtraBedAmountPaise: Paise;
  hotelLaundryAmountPaise: Paise;
  hotelOtherAmountPaise: Paise;
  hotelGstPaise: Paise;
  hotelModeOfPayment: string | null;
  foodAmountPaise: Paise;
  foodPlanAmountPaise: Paise;
  foodLaundryAmountPaise: Paise;
  foodGstPaise: Paise;
  foodModeOfPayment: string | null;
  totalHotelAmountPaise: Paise;
  totalFoodAmountPaise: Paise;
  balanceHotelAmountPaise: Paise;
  balanceFoodAmountPaise: Paise;
  referenceName: string | null;
  referenceMobileNumber: string | null;
  instruction: string | null;
  invoicePdfPath: string | null;
  foodInvoicePdfPath: string | null;
  staySegments: PricedStayPart[] | null;
  planFoodAmountPaise: Paise;
  /** The GST rate stored with the bill (decimal text "5", "2.5"; bill_master_bills.hotel_gst_percent / food_gst_percent DECIMAL(5,2) NULL CHECK 0..28):
   * the percent a check-out used, or the rate a Bill Master bill's typed GST stands for (MJ, 5 Nov 2026); null on an older bill. */
  hotelGstPercent: string | null;
  foodGstPercent: string | null;
  /** The SAC printed for each business, stored when the bill is made (bill_master_bills.hotel_sac / food_sac, hotel 0061); an edit never changes it. */
  hotelSac: string;
  foodSac: string;
  // the advance taken off (snapshots as Pallav keeps them, text)
  advanceId: string | null;
  advanceReceiptNumber: string | null;
  advanceGuestName: string | null;
  advanceHotelAmountSnapshot: string | null;
  advanceFoodAmountSnapshot: string | null;
  advanceDateSnapshot: string | null;
  advanceCompanySnapshot: string | null;
  advanceHotelAmountPaise: Paise;
  advanceFoodAmountPaise: Paise;
  advanceDeleteHotelAmountPaise: Paise;
  advanceDeleteFoodAmountPaise: Paise;
  // the debit settlement
  debit: [DebitSlot, DebitSlot, DebitSlot, DebitSlot, DebitSlot];
  debitHotelAdvance: string | null;
  debitFoodAdvance: string | null;
  debitReferenceName: string | null;
  debitReferenceMobileNumber: string | null;
  debitInstruction: string | null;
  formattedAdvanceReceiptNumber: string | null;
}

export interface BillRecord extends BillFields {
  id: string;
  entryNo: number;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export type NewBill = BillFields & { createdBy: string };
type BillPatch = Partial<BillFields>;

export type BillState = "paid" | "due" | "settled";
export const BILL_SORTS = ["billDate", "billNumber", "guestName", "totalPaise", "balancePaise"] as const;
type BillSort = (typeof BILL_SORTS)[number];

export interface BillFilter {
  /** With `from`, older debit bills still owed (no settlement, a side on Debit) are carried in. */
  from?: string;
  to?: string;
  month?: string;
  mode?: string;
  company?: string;
  words?: readonly string[];
  side?: "hotel" | "food";
  deleted?: "no" | "only";
}

export interface BillListQuery extends BillFilter, Page {
  state?: BillState;
  sort: BillSort;
  dir: "asc" | "desc";
}

export interface BillRepo {
  /** `forUpdate`: lock the row until the unit ends (SELECT ... FOR UPDATE). */
  get(id: string, options?: { deleted?: boolean; forUpdate?: boolean }): Promise<BillRecord | null>;
  byNumber(billNumber: string): Promise<BillRecord | null>;
  /** Many LIVE bills at once (the stays' bills: no N+1). */
  getMany(ids: readonly string[]): Promise<Map<string, BillRecord>>;
  /** Who stayed, for the bills that came from a stay (check-out): adults, children and the names kept (the main guest, then the room's other guests). A bill with no stay is left out. */
  guestsOf(billIds: readonly string[]): Promise<Map<string, BillGuests>>;
  list(query: BillListQuery): Promise<ListResult<BillRecord>>;
  countByState(filter: BillFilter): Promise<Record<BillState, number>>;
  figures(monthFrom: string, monthTo: string): Promise<{ monthCount: number; monthBilledPaise: Paise; owedPaise: Paise; dueCount: number; settledPaise: Paise; all: number }>;
  options(): Promise<{ modes: string[]; companyIds: string[]; months: string[] }>;
  /** Billing::suggest for bill numbers. */
  highestTyped(prefix: string): Promise<number>;
  /** Live bill numbers per advance id, for many advances at once (the advance list's "used on", no N+1). */
  numbersByAdvance(advanceIds: readonly string[]): Promise<Map<string, string[]>>;
  /** What the LIVE bills took off one advance, per side (restoring a recycle-binned advance must not count money twice). */
  takenFromAdvance(advanceId: string): Promise<{ hotelPaise: Paise; foodPaise: Paise }>;
  create(input: NewBill): Promise<BillRecord>;
  update(id: string, expectedVersion: number, patch: BillPatch, actorId: string): Promise<VersionedResult<BillRecord>>;
  softDelete(id: string, expectedVersion: number, actorId: string): Promise<VersionedResult<BillRecord>>;
  restore(id: string, expectedVersion: number, actorId: string): Promise<VersionedResult<BillRecord>>;
  purge(id: string): Promise<boolean>;
}

/* ---------------------------------------------------------------- read-only neighbours in the same hotel database */

/** company_profiles, read-only from billing (the Companies module owns writes). A soft-deleted company still exists (Laravel `exists`). */
interface CompanyNameRepo {
  exists(id: string): Promise<boolean>;
  /** Current names by id (a deleted company keeps its name). */
  names(ids: readonly string[]): Promise<Map<string, string>>;
  /** Live companies by name, for a form's picker; capped at `limit` (CompanyProfile::orderBy('name')). */
  list(limit: number): Promise<{ id: string; name: string }[]>;
}

/** meal_plan_rates (B2): every rate, oldest first (Pallav MealPlanRate::table). */
export interface MealPlanRateRepo {
  table(): Promise<{ plan: string; effectiveFrom: string; ratePaise: Paise }[]>;
}

/** Who prints on a bill: app_settings general.site_name / general.address / general.support_phone (Pallav Support/Settings.php:30-33) and the
 * food business unit's name, and (MJ #20 A) the hotel's and the food business's GSTIN, hotel settings `billing.hotel_gstin` and `billing.food_gstin`
 * (null while not set). Read-only. */
interface HotelProfileRepo {
  header(): Promise<{ name: string; foodName: string; address: string | null; phone: string | null; gstin: string | null; foodGstin: string | null }>;
  /** The hotel's GST defaults right now (app_settings checkout.hotel_gst_percent / checkout.food_gst_percent, text as typed; null while not set). */
  gstDefaults(): Promise<{ hotelPercent: string | null; foodPercent: string | null }>;
}

/** Master Data lists (option_sets / option_items): the ACTIVE items of a list in their order, with labels (Pallav Support/Masters.php items()). */
interface OptionListRepo {
  items(setKey: string): Promise<{ value: string; label: string; isDefault: boolean }[]>;
}

/** What a billing service gets inside a unit. */
export interface BillingRepos {
  advances: AdvanceRepo;
  bills: BillRepo;
  companies: CompanyNameRepo;
  mealPlanRates: MealPlanRateRepo;
  hotelProfile: HotelProfileRepo;
  optionLists: OptionListRepo;
  accountingYears: AccountingYearRepo;
  systemLogs: SystemLogRepo;
  forceLogs: ForceLogRepo;
}
