import "server-only";
import type { Paise } from "../money/paise";
import type { ListResult, Page, VersionedResult } from "./types";

// Payroll pay, part a (task B6a): the salary run (Pallav SalaryProcessor), salary payments, slips, salary revisions (SalaryUpdateHistory),
// advances and bonuses, and the reports' rows, in the hotel's own database (hotel migration 0008_payroll_pay). Plain records, no SQL.
// Spec: docs/specs/payroll-pay.md. Rules every implementation keeps:
// - EVERY read and write is scoped to ONE payroll company; a row of another company reads as absent.
// - Bank numbers are plain text (MJ: plain data): salary_processings.account_number and ifsc_code (copied from the employee at the run), and the
//   salary_update_histories previous/new values of "Account Number" and "IFSC Code".
// - payroll_advances and bonus_incentives are SOFT-deleted (recycle bin, Pallav Recyclable) and numbered by entry_no (HasEntryNumber);
//   salary_processings and their lines are hard-deleted only by a re-generate (SalaryProcessor::reverse); revisions are never deleted.
// - A month's run is ONE unit: the batched reads of the month (entries, revisions, bonuses, assignments, advances of every active person) and
//   the batched writes. Never a query per employee per table: the reads are per month, grouped in code.
// - salary_processings carries no version; a payment update locks the row (SELECT ... FOR UPDATE).

/* ---------------------------------------------------------------- salary processings (one person, one month) */

export const PAYMENT_STATUSES = ["Pending", "Processing", "On Hold", "Partially Paid", "Paid", "Failed"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface SalaryProcessingFields {
  payrollCompanyId: string;
  employeeId: string;
  year: number;
  month: number;
  companyName: string;
  employeeCode: string;
  employeeName: string;
  designation: string | null;
  department: string | null;
  paymentMode: string | null;
  monthlySalaryPaise: Paise;
  /** decimal(5,2) as text. */
  dailyWorkingHours: string;
  totalDaysInMonth: number;
  dailySalaryPaise: Paise;
  /** decimal(6,2) counts as text ("12.00"). */
  days0: string;
  days25: string;
  days50: string;
  days75: string;
  days100: string;
  totalPayableDays: string;
  attendanceSalaryPaise: Paise;
  overtimeHours: string;
  hourlyRatePaise: Paise;
  overtimeAmountPaise: Paise;
  bonusAmountPaise: Paise;
  incentiveAmountPaise: Paise;
  deductionAmountPaise: Paise;
  advanceDeductionPaise: Paise;
  pendingAdvanceAmountPaise: Paise;
  /** May be below zero only as Pallav's columns allow (the run clamps it at 0). */
  netSalaryPaise: Paise;
  paymentStatus: PaymentStatus;
  generationCount: number;
  processedBy: string | null;
  processedAt: Date;
  paidAmountPaise: Paise;
  paidAt: string | null;
  paymentReference: string | null;
  paymentRemarks: string | null;
  paymentUpdatedBy: string | null;
  paymentUpdatedAt: Date | null;
  bankName: string | null;
  accountHolderName: string | null;
  /** Plain text. */
  accountNumber: string | null;
  /** Plain text. */
  ifscCode: string | null;
  branchName: string | null;
}

export interface SalaryProcessingRecord extends SalaryProcessingFields {
  id: string;
  createdAt: Date;
  /** +1 on every payment change and on a re-generate (MJ #23: a second clerk is warned, CONFLICT with currentVersion). */
  version: number;
}

export type LineCategory = "Deduction" | "Advance" | "Bonus" | "Incentive";
type LineSource = "bonus_incentive" | "employee_deduction" | "advance";

export interface SalaryLineRecord {
  id: string;
  salaryProcessingId: string;
  category: LineCategory;
  label: string;
  deductionType: string | null;
  amountPaise: Paise;
  pendingAmountPaise: Paise;
  sourceType: LineSource | null;
  sourceId: string | null;
}

export type NewSalaryLine = Omit<SalaryLineRecord, "id" | "salaryProcessingId">;

export type PaymentPatch = Pick<SalaryProcessingFields, "paymentStatus" | "paidAmountPaise" | "paidAt" | "paymentReference" | "paymentRemarks" | "paymentUpdatedBy" | "paymentUpdatedAt">;

export type SlipSort = "period" | "employee" | "net" | "processed" | "status";
export interface SlipSummaryRecord {
  slips: number;
  people: number;
  netPaise: Paise;
  paidPaise: Paise;
  outstandingPaise: Paise;
  byStatus: Record<PaymentStatus, number>;
  latest: { year: number; month: number } | null;
  /** The net pay of the `latest` month's slips (0 when there are none). */
  latestNetPaise: Paise;
  /** How many distinct months have slips. */
  periods: number;
}
/** A half-open instant range [from, to): one IST month of the advance / bonus lists. */
export interface InstantRange {
  from: Date;
  to: Date;
}

interface SalaryProcessingRepo {
  get(companyId: string, id: string, options?: { forUpdate?: boolean }): Promise<SalaryProcessingRecord | null>;
  /** Several of the company's (a bulk payment), locked for update when asked. */
  getMany(companyId: string, ids: readonly string[], options?: { forUpdate?: boolean }): Promise<SalaryProcessingRecord[]>;
  /** One month, every person (payments: unpaid first, then paid latest first, then by name; reports: by name). ONE query. */
  month(companyId: string, year: number, month: number, order: "payments" | "name", options?: { employeeId?: string; forUpdate?: boolean }): Promise<SalaryProcessingRecord[]>;
  /** The lines of these processings in ONE query (a page of slips, a month's report). */
  lines(processingIds: readonly string[]): Promise<SalaryLineRecord[]>;
  /**
   * Newest period first, then processed_at desc, id desc (SalarySlipController::index); within the accounting years on screen. `status` narrows
   * to one payment status; `sort` orders by one column first (ties keep the newest-first order). `total` counts what the filter keeps.
   */
  list(
    companyId: string,
    query: { from?: { year: number; month: number }; period?: { year: number; month: number }; words?: readonly string[]; status?: PaymentStatus; sort?: { key: SlipSort; dir: "asc" | "desc" } } & Page,
  ): Promise<ListResult<SalaryProcessingRecord>>;
  /** The Salary Slips summary in ONE aggregate: the month when given, else every slip of the company. */
  slipSummary(companyId: string, period?: { year: number; month: number }): Promise<SlipSummaryRecord>;
  /** The months processed, newest first (the month pickers), from ONE grouped query. */
  periods(companyId: string): Promise<{ year: number; month: number; people: number }[]>;
  /** The latest processed month, or null (SalaryReportController::resolveMonth). */
  latestPeriod(companyId: string): Promise<{ year: number; month: number } | null>;
  /** Whether a salary is processed for this person in this month (the advance and bonus locks). */
  processedFor(companyId: string, employeeId: string, year: number, month: number): Promise<boolean>;
  /** Which of these (employee, year, month) keys are processed, in ONE query (a page of advances or bonuses shows its locks). */
  processedKeys(companyId: string, keys: readonly { employeeId: string; year: number; month: number }[]): Promise<Set<string>>;
  /** The run's writes: the processing and its lines in one call (a batch insert of the month). */
  createMany(rows: readonly { fields: SalaryProcessingFields; lines: readonly NewSalaryLine[] }[]): Promise<SalaryProcessingRecord[]>;
  /** The run's last step per person: the totals after deductions and advances. */
  setTotals(id: string, totals: Pick<SalaryProcessingFields, "deductionAmountPaise" | "advanceDeductionPaise" | "pendingAdvanceAmountPaise" | "netSalaryPaise">): Promise<void>;
  /**
   * A payment change, version +1. `expectedVersion` makes it optimistic (UPDATE ... WHERE id = ? AND version = ?); `version` sets it outright
   * (a re-generate carries the old row's number on, one higher, so a stale form can never match the new row).
   */
  updatePayment(id: string, patch: PaymentPatch, options?: { expectedVersion?: number; version?: number }): Promise<VersionedResult<SalaryProcessingRecord>>;
  /** SalaryProcessor::reverse: the month's processings and their lines go (ON DELETE CASCADE). */
  removeMonth(companyId: string, year: number, month: number): Promise<number>;
  /** The dashboard's pay half in ONE aggregate: the latest month's net, paid, unpaid and count; open and failed payments overall. */
  figures(companyId: string): Promise<{ latest: { year: number; month: number } | null; netPaise: Paise; paidPaise: Paise; unpaid: number; count: number; open: number; failed: number }>;
}

/* ---------------------------------------------------------------- salary revisions (salary_update_histories) */

export interface RevisionRecord {
  id: string;
  employeeId: string;
  batchId: string;
  effectiveDate: string;
  /** Pallav's label ("Salary", "Account Number", ...). */
  fieldName: string;
  /** Plain text. */
  previousValue: string | null;
  newValue: string | null;
  changedBy: string | null;
  createdAt: Date;
}

interface RevisionRepo {
  /** Every change of one person, newest effective date first, then created_at desc, id desc (SalaryUpdateController::show). */
  forEmployee(employeeId: string): Promise<RevisionRecord[]>;
  /** The "Salary" revisions of these people dated inside the month, by effective date then id, in ONE query (the run's schedule). */
  salaryInMonth(employeeIds: readonly string[], from: string, to: string): Promise<RevisionRecord[]>;
  /** Count and latest effective date per person in ONE grouped query (the Salary Update list). */
  summary(employeeIds: readonly string[]): Promise<Map<string, { count: number; latest: string }>>;
  createBatch(rows: readonly Omit<RevisionRecord, "id" | "createdAt">[]): Promise<void>;
}

/* ---------------------------------------------------------------- advances (soft delete, entry numbers) */

export type RecoveryType = "One Time" | "Monthly";

export interface AdvanceFields {
  employeeId: string;
  /** DATETIME(6): the moment it was given (Pallav keeps the seconds). */
  advanceDate: Date;
  amountPaise: Paise;
  deductionType: RecoveryType;
  deductionAmountPaise: Paise;
  remarks: string | null;
}

export interface PayrollAdvanceRecord extends AdvanceFields {
  id: string;
  payrollCompanyId: string;
  entryNo: number;
  recoveredAmountPaise: Paise;
  isSettled: boolean;
  isCarryForward: boolean;
  parentAdvanceId: string | null;
  sourceSalaryProcessingId: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
  createdAt: Date;
}

interface PayrollAdvanceRepo {
  get(companyId: string, id: string, options?: { forUpdate?: boolean; deleted?: boolean }): Promise<PayrollAdvanceRecord | null>;
  getMany(ids: readonly string[], options?: { forUpdate?: boolean }): Promise<PayrollAdvanceRecord[]>;
  /**
   * Latest first (advance_date desc, id desc): the accounting years on screen, plus older advances still being recovered (index :16-21).
   * `viewFrom` null = everything. Words over the person's name and code, the remarks.
   */
  list(companyId: string, query: { viewFrom: Date | null; employeeId?: string; words?: readonly string[]; range?: InstantRange; deleted?: "no" | "only" } & Page): Promise<ListResult<PayrollAdvanceRecord & { employeeName: string | null; employeeCode: string | null }>>;
  /** The four figures over the same filter (index :34-46) in ONE aggregate: issued (not carry-forward), recovered less what moved on, outstanding, open. */
  summary(companyId: string, query: { viewFrom: Date | null; employeeId?: string; words?: readonly string[]; range?: InstantRange }): Promise<{ issuedPaise: Paise; recoveredPaise: Paise; outstandingPaise: Paise; open: number }>;
  /** Unsettled, live advances of these people (the run), by advance_date then id, in ONE query. */
  openFor(employeeIds: readonly string[], options?: { forUpdate?: boolean }): Promise<PayrollAdvanceRecord[]>;
  /** Carry-forwards made by these processings (SalaryProcessor::reverse). */
  carriedBy(processingIds: readonly string[]): Promise<PayrollAdvanceRecord[]>;
  /** The dashboard: outstanding and open of the company, ONE aggregate. */
  figures(companyId: string): Promise<{ outstandingPaise: Paise; open: number }>;
  create(companyId: string, fields: AdvanceFields & { isCarryForward?: boolean; parentAdvanceId?: string | null; sourceSalaryProcessingId?: string | null }, by: string | null): Promise<PayrollAdvanceRecord>;
  update(companyId: string, id: string, patch: Partial<AdvanceFields>, by: string): Promise<PayrollAdvanceRecord>;
  /** The run's and the reverse's writes on recovery (batched per month). */
  setRecovery(rows: readonly { id: string; recoveredAmountPaise: Paise; isSettled: boolean }[]): Promise<void>;
  /** Carry-forwards removed by a reverse: a hard delete (they are the run's own rows). */
  removeCarried(ids: readonly string[]): Promise<void>;
  softDelete(companyId: string, id: string, by: string): Promise<boolean>;
  restore(companyId: string, id: string): Promise<boolean>;
  purge(companyId: string, id: string): Promise<boolean>;
}

/* ---------------------------------------------------------------- bonuses and incentives (soft delete, entry numbers) */

export type BonusType = "Bonus" | "Incentive";

export interface BonusFields {
  employeeId: string;
  entryDate: Date;
  type: BonusType;
  amountPaise: Paise;
  remarks: string | null;
}

export interface BonusRecord extends BonusFields {
  id: string;
  payrollCompanyId: string;
  entryNo: number;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
  createdAt: Date;
}

interface BonusRepo {
  get(companyId: string, id: string, options?: { forUpdate?: boolean; deleted?: boolean }): Promise<BonusRecord | null>;
  /** Latest first (entry_date desc, id desc), the accounting years on screen. */
  list(companyId: string, query: { viewFrom: Date | null; employeeId?: string; words?: readonly string[]; range?: InstantRange; deleted?: "no" | "only" } & Page): Promise<ListResult<BonusRecord & { employeeName: string | null; employeeCode: string | null }>>;
  /** bonus, incentive, people over the same filter: ONE aggregate. */
  summary(companyId: string, query: { viewFrom: Date | null; employeeId?: string; words?: readonly string[]; range?: InstantRange }): Promise<{ bonusPaise: Paise; incentivePaise: Paise; people: number }>;
  /** Live entries of these people dated inside the month (the run), in ONE query. */
  inMonth(employeeIds: readonly string[], from: Date, to: Date): Promise<BonusRecord[]>;
  create(companyId: string, fields: BonusFields, by: string): Promise<BonusRecord>;
  update(companyId: string, id: string, patch: Partial<BonusFields>, by: string): Promise<BonusRecord>;
  softDelete(companyId: string, id: string, by: string): Promise<boolean>;
  restore(companyId: string, id: string): Promise<boolean>;
  purge(companyId: string, id: string): Promise<boolean>;
}

/* ---------------------------------------------------------------- the run's reads of payroll core */

interface RunAssignmentRecord {
  id: string;
  employeeId: string;
  deductionName: string | null;
  deductionType: "One Time" | "Monthly";
  amountPaise: Paise;
  isSettled: boolean;
}

interface PayrollRunRepo {
  /** Every assignment of these people with its deduction's name, in ONE query (applyDeductions). */
  assignments(employeeIds: readonly string[]): Promise<RunAssignmentRecord[]>;
  /** The run's and the reverse's writes on One Time assignments (batched). */
  setSettled(assignmentIds: readonly string[], settled: boolean): Promise<void>;
}


/* ================================================================ part b (task B6b): staff meals, letters, separations */

// Staff meals (Pallav FoodCharges, FoodPriceController, FoodChargeController): the provider company (PF01) keeps the monthly price; each company
// keeps who takes meals (soft-deleted periods). Letters (JoiningLetterController, ExperienceLetterController): one template per company and kind,
// hard-deleted. Separations (SeparationController): numbered, soft-deleted.

export interface MealPriceRecord {
  id: string;
  payrollCompanyId: string;
  monthlyAmountPaise: Paise;
  effectiveFrom: string;
  createdBy: string | null;
  createdAt: Date;
}

export interface MealPeriodRecord {
  id: string;
  payrollCompanyId: string;
  employeeId: string;
  startsOn: string;
  endsOn: string | null;
  createdBy: string | null;
  deletedAt: Date | null;
  createdAt: Date;
}

interface MealRepo {
  /** Every price of the provider, oldest first (effective_from, then id). */
  prices(providerId: string): Promise<MealPriceRecord[]>;
  priceOn(providerId: string, effectiveFrom: string): Promise<MealPriceRecord | null>;
  getPrice(providerId: string, id: string): Promise<MealPriceRecord | null>;
  createPrice(providerId: string, row: { monthlyAmountPaise: Paise; effectiveFrom: string }, by: string): Promise<MealPriceRecord>;
  setPrice(id: string, monthlyAmountPaise: Paise, by: string): Promise<MealPriceRecord>;
  /** Hard delete (Pallav deletes the rate). */
  removePrice(id: string): Promise<void>;
  /** Live periods of these people, in ONE query. */
  periodsOf(employeeIds: readonly string[]): Promise<MealPeriodRecord[]>;
  /** Live periods of the company that cover part of [from, to] (chargedStaff), in ONE query. */
  periodsIn(companyId: string, from: string, to: string): Promise<MealPeriodRecord[]>;
  getPeriod(companyId: string, id: string, options?: { forUpdate?: boolean }): Promise<MealPeriodRecord | null>;
  /** Another live period of the person overlapping [starts, ends ?? forever], except one. */
  overlapping(employeeId: string, starts: string, ends: string | null, except?: string): Promise<MealPeriodRecord | null>;
  createPeriod(companyId: string, row: { employeeId: string; startsOn: string; endsOn: string | null }, by: string): Promise<MealPeriodRecord>;
  setEnd(id: string, endsOn: string, by: string): Promise<MealPeriodRecord>;
  /** To the recycle bin (Pallav Recyclable). */
  softDeletePeriod(companyId: string, id: string, by: string): Promise<boolean>;
  /** The recycle bin: the company's soft-deleted periods, newest deletion first. */
  deletedPeriods(companyId: string): Promise<MealPeriodRecord[]>;
  /** Takes a period out of the recycle bin; false when it is not there. */
  restorePeriod(companyId: string, id: string): Promise<boolean>;
  /** Removes a recycle-bin period for good (employee_meal_periods is a hard-delete table); a live period is never purged. */
  purgePeriod(companyId: string, id: string): Promise<boolean>;
  /** Days marked with a status that leaves meals out, per person, for one company's month (ONE query over attendance_entries.skips_food). */
  skippedDays(companyId: string, year: number, month: number): Promise<Map<string, number[]>>;
  /** The latest month any company has generated salary for (FoodCharges::lockedThrough, the price lock). */
  lockedThrough(): Promise<{ year: number; month: number } | null>;
}

export type LetterKind = "joining" | "experience";

export interface LetterFields {
  subject: string | null;
  /** joining: introduction_content, roles_responsibilities, terms_conditions; experience: body_content, conduct_remarks. */
  sections: Record<string, string | null>;
  closingMessage: string | null;
  useCompanySignatory: boolean;
  authorizedName: string | null;
  authorizedDesignation: string | null;
  authorizedClosingText: string | null;
  /** joining only */
  acceptanceHeading: string | null;
  acceptanceContent: string | null;
  acceptanceClosingText: string | null;
}

export interface LetterRecord extends LetterFields {
  id: string;
  payrollCompanyId: string;
  kind: LetterKind;
  isActive: boolean;
  signatureImagePath: string | null;
  updatedAt: Date;
}

interface LetterRepo {
  get(companyId: string, kind: LetterKind): Promise<LetterRecord | null>;
  /** updateOrCreate on the company (one template per company and kind). */
  save(companyId: string, kind: LetterKind, fields: LetterFields, by: string): Promise<LetterRecord>;
  setActive(companyId: string, kind: LetterKind, active: boolean, by: string): Promise<LetterRecord>;
  remove(companyId: string, kind: LetterKind): Promise<boolean>;
}

export type SeparationStatus = "Pending" | "Accepted" | "Relieved";

export interface SeparationFields {
  employeeId: string;
  separationType: string;
  resignationDate: string;
  lastWorkingDate: string;
  reason: string;
  remarks: string | null;
  status: SeparationStatus;
  documentPath: string | null;
}

export interface SeparationRecord extends SeparationFields {
  id: string;
  payrollCompanyId: string;
  entryNo: number;
  rejoinedAt: string | null;
  createdBy: string | null;
  deletedAt: Date | null;
  createdAt: Date;
}

interface SeparationRepo {
  get(companyId: string, id: string, options?: { forUpdate?: boolean; deleted?: boolean }): Promise<SeparationRecord | null>;
  /** Latest leaver first (last_working_date desc, id desc), with the person's name and designation. */
  /** `lastDay` narrows to last working days inside [from, to] ("YYYY-MM-DD", both included). */
  list(
    companyId: string,
    query: { words?: readonly string[]; lastDay?: { from: string; to: string }; deleted?: "no" | "only" } & Page,
  ): Promise<ListResult<SeparationRecord & { employeeName: string | null; designation: string | null }>>;
  /** in notice (not Relieved, not rejoined), relieved (Relieved, not rejoined), rejoined, all, and each status: ONE aggregate over the live records. */
  counts(companyId: string, lastDay?: { from: string; to: string }): Promise<{ inNotice: number; relieved: number; rejoined: number; all: number; byStatus: Record<SeparationStatus, number> }>;
  /** A live record of the person not rejoined (the "already open" rule). */
  openFor(employeeId: string, except?: string): Promise<SeparationRecord | null>;
  /** Relieved and not rejoined: the last working day of each of these people (meals stop there), ONE query. */
  lastDays(employeeIds: readonly string[]): Promise<Map<string, string>>;
  create(companyId: string, fields: SeparationFields, by: string): Promise<SeparationRecord>;
  update(companyId: string, id: string, patch: Partial<SeparationFields> & { rejoinedAt?: string | null }, by: string): Promise<SeparationRecord>;
  softDelete(companyId: string, id: string, by: string): Promise<boolean>;
  restore(companyId: string, id: string): Promise<boolean>;
  purge(companyId: string, id: string): Promise<boolean>;
}

/* ---------------------------------------------------------------- the unit */

export interface PayrollPayRepos {
  salaryProcessings: SalaryProcessingRepo;
  revisions: RevisionRepo;
  payrollAdvances: PayrollAdvanceRepo;
  bonuses: BonusRepo;
  payrollRun: PayrollRunRepo;
  meals: MealRepo;
  letters: LetterRepo;
  separations: SeparationRepo;
}
