// Payroll (pay side) module contract: salary update, payments, slips, advances, bonus,
// staff meals, reports, joining / experience letters, resignations, payroll master and log.
// Pure TypeScript (no React). Mock API with an in-memory store; every call resolves DashResult.
// Source: Hotel Pallav payroll (screens, fields and rules only).

import { serverSentence, type DashError, type ListQuery, type Page } from './common';import type { createPayrollPayApi } from './payrollPay.mock';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PayrollCompanyRef {
  id: string;
  name: string;
  code: string;
  /** Pallav Food sets the staff meal price; the other company only sees it. */
  providesFood: boolean;
  address: string;
  gstin: string;
  /** Company Setup's mobile number (printed on letters). Optional until the backend sends it. */
  mobile?: string;
  /** Company Setup's email address. Optional until the backend sends it. */
  email?: string;
}

export interface PayEmployee {
  id: string;
  code: string;
  name: string;
  designation: string;
  department: string;
  companyId: string;
  joiningDate: string;
  isActive: boolean;
  salaryPaise: number;
  dailyWorkingHours: number;
  paymentMode: string;
  bankName: string;
  accountHolderName: string;
  /** Plain text, shown in full. null = none on file. */
  /** Plain text, shown in full (MJ: no encryption). null = none on file. */
  accountNumber: string | null;
  ifscCode: string;
  branchName: string;
  phone: string;
}

/** Salary Update list row. */
export interface SalaryProfile {
  employee: PayEmployee;
  lastRevisedOn: string | null;
  revisionCount: number;
}

/** Account Number and IFSC Code values are shown as they really are (plain text). */
export interface SalaryChange {
  id: string;
  field: string;
  previous: string | null;
  next: string | null;
}

/** One revision = one batch of field changes with one effective date. */
export interface SalaryRevision {
  batchId: string;
  effectiveDate: string;
  changedAt: string;
  changedBy: string;
  changes: SalaryChange[];
}

export interface SalaryRevisionInput {
  effectiveDate: string;
  salaryPaise: number | null;
  designation: string;
  department: string;
  dailyWorkingHours: string;
  paymentMode: string;
  bankName: string;
  accountHolderName: string;
  /** Plain text: absent = keep the stored number. */
  accountNumber?: string;
  ifscCode: string;
  branchName: string;
}

export type PaymentStatus = 'Pending' | 'Processing' | 'On Hold' | 'Partially Paid' | 'Paid' | 'Failed';
export const paymentStatuses: PaymentStatus[] = ['Pending', 'Processing', 'On Hold', 'Partially Paid', 'Paid', 'Failed'];
/** The words on screen for each stored status (the stored values stay as they are; MJ, 26 Oct 2026: plain sentence case). */
export const paymentStatusLabel: Record<PaymentStatus, string> = { Pending: 'Pending', Processing: 'Processing', 'On Hold': 'On hold', 'Partially Paid': 'Partly paid', Paid: 'Paid', Failed: 'Failed' };
/** Bulk update can't set a partial amount (each salary differs). */
export const bulkPaymentStatuses: PaymentStatus[] = ['Pending', 'Processing', 'On Hold', 'Paid', 'Failed'];

export interface PayLine { label: string; paise: number }

export type SalaryLineCategory = 'Deduction' | 'Advance' | 'Bonus' | 'Incentive';

/** What the slip itemises. */
export interface SalaryLine {
  category: SalaryLineCategory;
  label: string;
  /** e.g. "One Time" / "Monthly"; null when it does not apply. */
  type: string | null;
  paise: number;
  /** Still to recover after this month (advances); 0 otherwise. */
  pendingPaise: number;
}

/** Pallav keeps five attendance counts: days that counted as 0, 25, 50, 75 and 100 per cent. */
export interface SalaryDays {
  p0: number;
  p25: number;
  p50: number;
  p75: number;
  p100: number;
}

/** One processed salary (one employee, one month). Used by payments, slips and reports. */
export interface SalaryRecord {
  id: string;
  companyId: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  designation: string;
  /** The employee's department at processing (shown under the designation on Salary Slips). Optional until the backend sends it. */
  department?: string;
  /** "YYYY-MM" */
  period: string;
  processedAt: string;
  monthlySalaryPaise: number;
  dailyWorkingHours: number;
  daysInMonth: number;
  days: SalaryDays;
  /** 2 decimals. */
  payableDays: number;
  otHours: number;
  dailySalaryPaise: number;
  hourlyRatePaise: number;
  attendanceSalaryPaise: number;
  otAmountPaise: number;
  bonusPaise: number;
  incentivePaise: number;
  /** The Deduction lines (same as lines with category "Deduction"). */
  deductions: PayLine[];
  /** Everything the slip itemises: deductions, advances, bonus, incentive. */
  lines: SalaryLine[];
  advanceRecoveryPaise: number;
  pendingAdvancePaise: number;
  netPaise: number;
  paymentMode: string;
  bankName: string;
  /** Copied from the employee (plain text). */
  accountNumber: string | null;
  /** A branch code, printed on the slip. */
  ifscCode: string;
  branchName: string;
  paymentStatus: PaymentStatus;
  paidPaise: number;
  paidOn: string | null;
  reference: string;
  remarks: string;
  /** From the session; null until a payment is recorded. */
  paymentUpdatedBy: string | null;
  /** 1 for the first run; +1 each re-generate. */
  generationCount: number;
  /** +1 on every payment change; send it back in PaymentUpdateInput.version (MJ #23). */
  version: number;
}

export interface PaymentSummary {
  netPaise: number;
  paidPaise: number;
  outstandingPaise: number;
  fullyPaid: number;
  total: number;
  byStatus: Record<PaymentStatus, number>;
}

export interface PaymentMonth {
  period: string;
  rows: SalaryRecord[];
  /** Always counts the WHOLE month, whatever the filter or page. */
  summary: PaymentSummary;
  /** Present when the list was asked a page at a time: that page's position and the number of rows that match the filter. */
  page?: { page: number; pageSize: number; total: number };
}

/** What the Salary Payments list can ask the server: a page, a status, a search, an order. Without `page` every row of the month comes back. */
export interface PaymentListQuery {
  page?: number;
  /** 10, 25, 50 or 100. */
  pageSize?: number;
  status?: PaymentStatus;
  /** Contains, case-insensitive: name, code, designation, reference. */
  search?: string;
  sort?: 'employee' | 'net' | 'paid' | 'balance' | 'paidOn' | 'status';
  dir?: 'asc' | 'desc';
}

/**
 * The paging query the pay lists share (Slips, Advances, Bonus, Resignations; docs/BACKEND.md 7.6 "Pay lists"). The server works in this order:
 * period, search, status, sort, page. `page.total` counts the rows left after period, search and status; the summary never follows search,
 * status, sort or page. Unknown status or sort values answer 422.
 */
export interface PayListQuery<Status extends string, Sort extends string> {
  /** 1 or more (default 1). A page past the end answers no items and the same total. */
  page?: number;
  /** 10, 25, 50 or 100 (default 25). */
  pageSize?: number;
  /** "YYYY-MM": only that month (each list by its own date). The summary then covers that month too. */
  period?: string;
  status?: Status;
  /** Contains, case-insensitive, at most 100 characters; every word must match. */
  search?: string;
  /** Without it each list keeps its own order. Ties keep that order too. */
  sort?: Sort;
  /** Used only with `sort`; default asc. */
  dir?: 'asc' | 'desc';
}

/** Salary Slips sort ids (without one: newest period first, newest processing within it). */
export type SlipSort = 'period' | 'employee' | 'net' | 'processed' | 'status';
export const slipSorts: SlipSort[] = ['period', 'employee', 'net', 'processed', 'status'];

/** Salary Slips: status is the payment status; search over name, code, designation; `period` is the salary month. */
export type SlipListQuery = PayListQuery<PaymentStatus, SlipSort>;

/** Salary Slips summary: the `period` month when one is asked for, else every slip of the company. */
export interface SlipSummary {
  /** The month asked for, null for every slip. */
  period: string | null;
  slips: number;
  /** Different employees among those slips. */
  people: number;
  netPaise: number;
  paidPaise: number;
  outstandingPaise: number;
  byStatus: Record<PaymentStatus, number>;
  /** The newest month with slips ("YYYY-MM"), null when none. */
  latestPeriod: string | null;
}

/** GET /payroll/companies/{id}/slips: the page fields at the top level, plus the summary. */
export interface SlipList extends Page<SalaryRecord> {
  summary: SlipSummary;
}

/** One line of the lean staff picker (GET /payroll/companies/{id}/staff/lookup): enough to choose a person, nothing else. */
export interface PayStaffItem {
  id: string;
  name: string;
  code: string;
  designation: string;
}

/** The staff picker query: matches the name or employee code by prefix, at most 50. */
export interface PayStaffLookupQuery {
  q?: string;
  /** 1 to 50, default 20. */
  limit?: number;
  /** Default true. */
  activeOnly?: boolean;
}

export interface PaymentUpdateInput {
  /** The record's version when the form opened; a stale one answers CONFLICT with details.currentVersion (MJ #14, #23). */
  version?: number;
  status: PaymentStatus;
  paidPaise: number | null;
  paidOn: string;
  reference: string;
  remarks: string;
}

export interface BulkPaymentInput {
  ids: string[];
  /** Optional versions per id; any stale one refuses the whole update (CONFLICT). */
  versions?: Record<string, number>;
  status: PaymentStatus;
  paidOn: string;
  reference: string;
}

export type RecoveryType = 'One Time' | 'Monthly';

export interface Advance {
  id: string;
  /** The entry number as text ("12"); show it as "#12", never as the employee's code. */
  entryNo: string;
  companyId: string;
  employeeId: string;
  employeeName: string;
  /** The employee's code ("HSP-003"), shown under the name in lists. "" for a removed employee. */
  employeeCode: string;
  /** ISO date-time (Pallav keeps the second). */
  date: string;
  amountPaise: number;
  recoveryType: RecoveryType;
  instalmentPaise: number;
  recoveredPaise: number;
  outstandingPaise: number;
  isSettled: boolean;
  isCarryForward: boolean;
  /** Salary for that month is already processed (no edit / delete). */
  locked: boolean;
  /** Admin only, from the session (as Pallav): show or hide Edit / Delete. */
  canEdit: boolean;
  canDelete: boolean;
  remarks: string;
  createdBy: string;
}

export interface AdvanceInput {
  employeeId: string;
  /** "YYYY-MM-DD" or ISO; a new advance left at today is stamped with the moment it is saved. */
  date: string;
  amountPaise: number | null;
  recoveryType: RecoveryType;
  instalmentPaise: number | null;
  remarks: string;
}

export interface AdvanceSummary { issuedPaise: number; recoveredPaise: number; outstandingPaise: number; open: number }

/** Advances: `open` = money still to recover, `settled` = fully recovered (same as the old `tab`). */
export type AdvanceStatus = 'open' | 'settled';
export const advanceStatuses: AdvanceStatus[] = ['open', 'settled'];
/** Advances sort ids (without one: newest date first, then the higher entry number). */
export type AdvanceSort = 'date' | 'entryNo' | 'employee' | 'amount' | 'outstanding';
export const advanceSorts: AdvanceSort[] = ['date', 'entryNo', 'employee', 'amount', 'outstanding'];

/** Search over name, code, remarks, entry no; `period` is the advance date's IST month. The summary is always the live rows (also in the bin). */
export interface AdvanceListQuery extends PayListQuery<AdvanceStatus, AdvanceSort> {
  tab?: 'all' | AdvanceStatus;
  /** The recycle bin. */
  deleted?: boolean;
}

export type BonusType = 'Bonus' | 'Incentive';

export interface BonusEntry {
  id: string;
  /** The entry number as text ("12"); show it as "#12". */
  entryNo: string;
  companyId: string;
  employeeId: string;
  employeeName: string;
  /** The employee's code ("HSP-003"). "" for a removed employee. */
  employeeCode: string;
  /** ISO date-time. */
  date: string;
  type: BonusType;
  amountPaise: number;
  remarks: string;
  locked: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export interface BonusInput {
  employeeId: string;
  /** "YYYY-MM-DD" or ISO. */
  date: string;
  type: BonusType;
  amountPaise: number | null;
  remarks: string;
}

export interface BonusSummary { bonusPaise: number; incentivePaise: number; people: number }

export const bonusTypes: BonusType[] = ['Bonus', 'Incentive'];
/** Bonus sort ids (without one: newest date first, then the higher entry number). */
export type BonusSort = 'date' | 'entryNo' | 'employee' | 'amount' | 'type';
export const bonusSorts: BonusSort[] = ['date', 'entryNo', 'employee', 'amount', 'type'];

/** Status is the entry type; search over name, code, remarks, type, entry no; `period` is the entry date's IST month. Summary always live rows. */
export interface BonusListQuery extends PayListQuery<BonusType, BonusSort> {
  tab?: 'all' | BonusType;
  deleted?: boolean;
}

export interface MealPrice {
  id: string;
  effectiveFrom: string;
  monthlyPaise: number;
  previousPaise: number | null;
  inForce: boolean;
  locked: boolean;
  /** When the price was entered (ISO), shown as "Entered 01 Oct 2026". Optional until the backend sends it. */
  createdAt?: string;
}

export interface MealPeriod {
  id: string;
  employeeId: string;
  startsOn: string;
  endsOn: string | null;
  createdBy: string;
}

export interface MealStaffRow {
  employee: PayEmployee;
  periods: MealPeriod[];
  onMealsToday: boolean;
}

export interface MealBillRow {
  employeeId: string;
  employeeName: string;
  designation: string;
  days: number;
  amountPaise: number;
}

export interface MealsOverview {
  period: string;
  today: string;
  canSetPrice: boolean;
  currentPricePaise: number | null;
  /** Last month whose salary is generated ("YYYY-MM"); days up to its end are closed. */
  closedThrough: string | null;
  firstOpenMonth: string;
  /**
   * The PRICE is closed by ANY company's salary run; a person's meals records only by their OWN company's (Pallav).
   * The price form uses these two; the records use the two above.
   */
  priceClosedThrough: string | null;
  firstOpenPriceMonth: string;
  prices: MealPrice[];
  staff: MealStaffRow[];
  bill: MealBillRow[];
  billTotalPaise: number;
  /** True once the month's salary has been generated. */
  billFinal: boolean;
}

export interface ReportResult {
  rows: SalaryRecord[];
  totals: {
    salaryPaise: number; attendancePaise: number; otHours: number; otPaise: number; bonusPaise: number;
    incentivePaise: number; deductionsPaise: number; advancePaise: number; netPaise: number; payableDays: number;
  };
  /** The meals bill, filled once the month's salary is generated; null otherwise. */
  mealsBillPaise: number | null;
}

export interface AdvanceList { page: Page<Advance>; summary: AdvanceSummary; counts: { all: number; open: number; settled: number } }
export interface BonusList { page: Page<BonusEntry>; summary: BonusSummary; counts: { all: number; Bonus: number; Incentive: number } }

export type LetterKind = 'joining' | 'experience';

export interface LetterSection { id: string; label: string; text: string }

export interface LetterTemplate {
  companyId: string;
  kind: LetterKind;
  subject: string;
  sections: LetterSection[];
  signatoryName: string;
  signatoryDesignation: string;
  /** Pallav: use the company's own authorised signatory (default true). Optional until the backend. */
  useCompanySignatory?: boolean;
  /** File name only (UI-only upload). */
  signatureImageName?: string | null;
  /** Joining letter: the heading of the part the employee signs (the text is the "acceptance" section). */
  acceptanceHeading?: string;
  /** Pallav authorized_closing_text: the line above the signatory ("For Hotel Sunrise Pvt Ltd"). Optional until the backend. */
  signatoryClosingText?: string;
  /** Joining letter only, Pallav acceptance_closing_text: the small line under the acceptance text. Optional until the backend. */
  acceptanceClosingText?: string;
  isActive: boolean;
  updatedAt: string;
}

export interface LetterTemplateInput {
  subject: string;
  sections: LetterSection[];
  signatoryName: string;
  signatoryDesignation: string;
  useCompanySignatory?: boolean;
  signatureImageName?: string | null;
  acceptanceHeading?: string;
  signatoryClosingText?: string;
  acceptanceClosingText?: string;
}

export type SeparationStatus = 'Pending' | 'Accepted' | 'Relieved';
export const separationStatuses: SeparationStatus[] = ['Pending', 'Accepted', 'Relieved'];

export interface Separation {
  id: string;
  entryNo: string;
  companyId: string;
  employeeId: string;
  employeeName: string;
  designation: string;
  /** The employee's code and joining date (the experience letter picker's preview). Optional until the backend sends them. */
  employeeCode?: string;
  joiningDate?: string;
  type: string;
  resignationDate: string;
  lastWorkingDate: string;
  reason: string;
  remarks: string;
  status: SeparationStatus;
  documentName: string | null;
  rejoinedOn: string | null;
  createdBy: string;
  /** An Admin or whoever recorded it. */
  canEdit: boolean;
  /** Admins. */
  canDelete: boolean;
}

export interface SeparationInput {
  employeeId: string;
  type: string;
  resignationDate: string;
  lastWorkingDate: string;
  reason: string;
  remarks: string;
  status: SeparationStatus;
  /** Ignored until the media store (the acceptance document upload). */
  documentName?: string | null;
}

export interface SeparationSummary {
  inNotice: number;
  relieved: number;
  rejoined: number;
  all: number;
  /** Records by their own status (a rejoined person's record counts under its status too). */
  byStatus: Record<SeparationStatus, number>;
}

/** Resignations sort ids (without one: latest last working day first, then the higher entry number). `employee` compares the name only. */
export type SeparationSort = 'lastWorkingDate' | 'resignationDate' | 'employee' | 'entryNo' | 'status';
export const separationSorts: SeparationSort[] = ['lastWorkingDate', 'resignationDate', 'employee', 'entryNo', 'status'];

/** Status is the record's status (the old `tab` still works); search over name, code, reason, type, entry no; `period` is the last working day's month. */
export interface SeparationListQuery extends PayListQuery<SeparationStatus, SeparationSort> {
  tab?: 'all' | 'notice' | 'relieved' | 'rejoined';
  deleted?: boolean;
}

export interface RejoinInput {
  joiningDate: string;
  designation: string;
  department: string;
  salaryPaise: number | null;
  dailyWorkingHours: string;
  /** Any way of typing; the server normalises it ("+" names the country) and checks that country's rule. */
  phone: string;
  contactCountry?: string;
  address?: string;
  branchName?: string;
  paymentMode: string;
  bankName: string;
  accountHolderName: string;
  /** Plain text: absent = keep the stored number. */
  accountNumber?: string;
  ifscCode: string;
}

export type MasterListKey = 'designations' | 'departments' | 'gender' | 'separation_type' | 'id_proofs' | 'salary_payment_mode' | 'share_emails';

export interface MasterListDef { key: MasterListKey; name: string; description: string; icon: string; isEmail: boolean; defaults: string[] }

export const masterLists: MasterListDef[] = [
  { key: 'designations', name: 'Designations', description: 'Suggested when choosing a designation for a member of staff.', icon: 'briefcase', isEmail: false, defaults: [] },
  { key: 'departments', name: 'Departments', description: 'Suggested when choosing a department for a member of staff.', icon: 'building', isEmail: false, defaults: [] },
  { key: 'gender', name: 'Gender', description: 'Choices on the staff record.', icon: 'users', isEmail: false, defaults: ['Male', 'Female', 'Other'] },
  { key: 'separation_type', name: 'Exit types', description: 'Reasons a member of staff can leave, used on Resignations.', icon: 'logout', isEmail: false, defaults: ['Resignation', 'Termination', 'Retirement', 'End of Contract'] },
  { key: 'id_proofs', name: 'ID proof types', description: 'Documents a member of staff can give as ID proof.', icon: 'file', isEmail: false, defaults: ['Aadhaar Card', 'PAN Card', 'Passport', 'Driving Licence', 'Voter ID'] },
  { key: 'salary_payment_mode', name: 'Salary payment modes', description: 'How staff salary is paid. A mode named Bank asks for account details.', icon: 'wallet', isEmail: false, defaults: ['Cash', 'Bank'] },
  { key: 'share_emails', name: 'Share recipients', description: 'Email addresses staff details can be sent to from Staff Emails.', icon: 'mail', isEmail: true, defaults: [] },
];

/** "all" = shared by every payroll company; otherwise a company id. */
export type MasterScope = 'all' | string;

export interface MasterItem {
  id: string;
  list: MasterListKey;
  scope: MasterScope;
  label: string;
  value: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface MasterView {
  own: MasterItem[];
  inherited: MasterItem[];
  counts: Record<MasterListKey, number>;
}

export interface MasterItemInput { label: string; value: string }

export type LogAction = 'created' | 'updated' | 'deleted' | 'emailed' | 'error';
export const logActionLabel: Record<LogAction, string> = { created: 'Created', updated: 'Updated', deleted: 'Deleted', emailed: 'Emailed', error: 'Error' };
export type LogStatus = 'success' | 'failed';
export type LogView = 'today' | 'week' | 'emails' | 'money' | 'deletions' | 'problems';
export const logViews: { id: LogView; label: string }[] = [
  { id: 'today', label: 'Today' }, { id: 'week', label: 'Last 7 days' }, { id: 'emails', label: 'Emails' },
  { id: 'money', label: 'Money' }, { id: 'deletions', label: 'Deletions' }, { id: 'problems', label: 'Problems' },
];

export interface PayrollLogEntry {
  id: string;
  at: string;
  companyId: string | null;
  companyName: string;
  userName: string;
  action: LogAction;
  entity: string;
  subject: string;
  summary: string;
  details: string;
  status: LogStatus;
}

export interface LogQuery extends ListQuery {
  view?: LogView | '';
  action?: LogAction | '';
  entity?: string;
  status?: LogStatus | '';
  user?: string;
}

export interface LogResult {
  page: Page<PayrollLogEntry>;
  stats: { total: number; today: number; emails: number; failed: number };
  entities: string[];
  people: string[];
}

/** A document preview (salary slip, register, voucher, report, letter). Real PDFs come with the backend. */
export type DocBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'kv'; title?: string; items: { label: string; value: string }[] }
  | { kind: 'table'; title?: string; columns: { header: string; align: 'left' | 'right' }[]; rows: string[][]; footer?: string[] }
  | { kind: 'total'; label: string; value: string; words?: string }
  | { kind: 'signatures'; items: { name: string; role: string }[] };

export interface PayrollDoc {
  companyName: string;
  companyLine: string;
  title: string;
  subtitle?: string;
  blocks: DocBlock[];
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

export const payrollPayCopy = {
  companySwitch: { label: 'Payroll company', hint: 'Every screen here works for the company you pick.' },
  common: {
    add: 'Add', edit: 'Edit', delete: 'Delete', save: 'Save', cancel: 'Cancel', close: 'Close', preview: 'Preview',
    download: 'Download PDF', downloadSoon: 'The PDF download arrives with the backend. This is the preview.',
    employee: 'Employee', date: 'Date', amount: 'Amount', remarks: 'Instruction', status: 'Status', all: 'All',
    adminOnly: 'Only an admin can change this.', locked: 'Salary is processed for this month', retry: 'Retry',
    search: 'Search by employee', pickEmployee: 'Choose an employee', saved: 'Saved.', deleted: 'Deleted.',
    previousMonth: 'Previous month', nextMonth: 'Next month',
    bin: {
      open: 'Recycle bin', back: 'Back',
      advanceTitle: 'Advances recycle bin', bonusTitle: 'Bonus and incentive recycle bin', separationTitle: 'Resignations recycle bin',
      subtitle: 'Deleted entries. Restore one to bring it back, or delete it for ever.',
      emptyTitle: 'The recycle bin is empty', emptyBody: 'Deleted entries wait here until you restore them or delete them for ever.',
      restore: 'Restore', purge: 'Delete for ever',
      restored: (no: string) => `Entry ${no} restored.`, purged: (no: string) => `Entry ${no} deleted for ever.`,
      purgeTitle: (no: string) => `Delete entry ${no} for ever?`, purgeBody: 'This cannot be undone.',
    },
    on: 'On',
    loading: 'Loading…',
    failed: 'Failed',
    noPeople: 'Nobody to show',
    switchOn: 'Switch on', switchOff: 'Switch off', manage: 'Manage', selectAll: 'Select all', clear: 'Clear',
    /** Delete-confirm dialogs (use with ConfirmDialog). */
    deleteConfirm: {
      advance: { title: 'Delete this advance?', body: 'The advance will be removed from the employee record. This cannot be undone.' },
      bonus: { title: 'Delete this bonus or incentive?', body: 'It will be removed from the employee record and from the next salary. This cannot be undone.' },
      mealPrice: { title: 'Delete this meal price?', body: 'Staff meals charged at this price keep their amounts. This cannot be undone.' },
      resignation: { title: 'Delete this resignation?', body: 'The resignation record and its letter will be removed. This cannot be undone.' },
      masterItem: { title: 'Delete this item?', body: 'It will no longer appear in the payroll lists. Records that already use it are not changed.' },
    },
  },
  salaryUpdate: {
    title: 'Salary changes', subtitle: 'Revise salary and payment details. Every change is kept in the history.',
    kpi: { employees: 'Employees', monthly: 'Monthly salary', revisedYear: 'Revised this year', never: 'Never revised' },
    columns: { employee: 'Employee', designation: 'Designation', salary: 'Current salary', mode: 'Payment mode', revised: 'Last revised' },
    empty: { title: 'No active staff', body: 'Add staff in Payroll > Staff, then revise their salary here.' },
    detailTitle: 'Salary details', revise: 'Revise salary', history: 'Update history',
    historyEmpty: { title: 'No changes yet', body: 'Changes you save are recorded here with their effective date.' },
    form: {
      effectiveDate: 'Effective date', salary: 'New salary (per month)', hours: 'Working hours per day', mode: 'Payment mode',
      designation: 'Designation', department: 'Department', bank: 'Bank name', holder: 'Account holder', account: 'Account number', accountReplace: 'Replace account number', accountStored: (masked: string) => `Stored: ${masked}. Leave empty to keep it.`,
      ifsc: 'IFSC code', branch: 'Branch',
    },
    noChange: 'Nothing changed. Edit at least one field.',
  },
  payments: {
    title: 'Salary Payments', subtitle: 'Track what each person was paid for the month.',
    kpi: { net: 'Net salary', paid: 'Paid', balance: 'Balance', settled: 'Fully paid' },
    columns: { employee: 'Employee', net: 'Net salary', paid: 'Paid', balance: 'Balance', paidOn: 'Paid on', status: 'Status' },
    empty: { title: 'No salary processed', body: 'Salary for this month has not been generated yet. Pick another month.' },
    bulk: 'Bulk update', register: 'Payment register', edit: 'Update payment',
    form: { status: 'Payment status', amount: 'Amount paid', paidOn: 'Paid on', reference: 'Reference', remarks: 'Remarks', pick: 'Employees' },
    bulkHint: 'A partial amount can only be set one person at a time.',
  },
  slips: {
    title: 'Salary Slips', subtitle: 'Every processed salary, ready to preview.',
    kpi: { slips: 'Slips', latest: 'Latest period', latestNet: 'Latest net pay', periods: 'Periods' },
    columns: { period: 'Period', employee: 'Employee', designation: 'Designation', net: 'Net salary', processed: 'Processed' },
    empty: { title: 'No salary slips yet', body: 'Slips appear here once salary is processed for a month.' },
  },
  advances: {
    title: 'Advances', subtitle: 'Money given ahead of salary and how it is recovered.',
    kpi: { issued: 'Issued', recovered: 'Recovered', outstanding: 'Outstanding', open: 'Open advances' },
    columns: { date: 'Date', employee: 'Employee', amount: 'Amount', recovery: 'Recovery', recovered: 'Recovered', outstanding: 'Outstanding' },
    perMonth: (amount: string) => `${amount} a month`,
    empty: { title: 'No advances', body: 'Record an advance when money is given ahead of salary.' },
    add: 'New advance', editTitle: 'Edit advance',
    form: { date: 'Advance date', amount: 'Advance amount', recovery: 'Recovery', instalment: 'Recovery per month' },
    carryForward: 'Carried forward', settled: 'Settled', open: 'Open',
    carryHint: 'Carried-forward advances are created by salary processing and cannot be changed.',
  },
  bonus: {
    title: 'Bonus / Incentives', subtitle: 'Extra pay added to the month’s salary.',
    kpi: { bonus: 'Bonus', incentive: 'Incentive', people: 'People' },
    columns: { date: 'Date', employee: 'Employee', type: 'Type', amount: 'Amount', remarks: 'Instruction' },
    empty: { title: 'No bonus or incentive entries', body: 'Entries can be added for the current month.' },
    add: 'New entry', editTitle: 'Edit entry',
    hint: 'New entries can only be dated in the current month.',
  },
  meals: {
    title: 'Staff Meals', subtitle: 'Who takes staff meals and the month’s meal bill.',
    kpi: { price: 'Price per month', onMeals: 'On meals today', bill: 'Bill this month', closed: 'Closed through' },
    price: 'Meal price', priceHint: 'The food company sets the meal price. A new price starts on the day you choose; older prices stay on record.',
    priceReadOnly: 'The meal price is set by the food company. Switch to that company to change it.',
    priceColumns: { from: 'Starts on', price: 'Price per month', was: 'Was', status: 'Status' },
    staffColumns: { employee: 'Employee', designation: 'Designation', meals: 'Meals' },
    billColumns: { employee: 'Employee', designation: 'Designation', days: 'Days counted', amount: 'Amount' },
    start: 'Start meals', stop: 'Stop meals', newPrice: 'New price', bill: 'Meal bill',
    form: { openEnded: 'ongoing', startsOn: 'Meals start on', endsOn: 'Meals end on (optional)', lastDay: 'Last day of meals', price: 'New price per employee', from: 'Starts on' },
    empty: { title: 'No staff', body: 'Add staff to this company first.' },
    billEmpty: { title: 'No meals this month', body: 'Nobody took staff meals in this month.' },
    deletePeriodTitle: 'Remove this meals record?',
    deletePeriodBody: 'The days it covered will no longer count towards the meal bill. To stop meals from a later day instead, end the record.',
    billLive: 'Worked out live. It becomes final when the month’s salary is generated.',
  },
  reports: {
    title: 'Payroll Reports', subtitle: 'Period and monthly salary reports.',
    tabs: { period: 'Period report', monthly: 'Monthly report' },
    columns: {
      code: 'Employee ID', name: 'Name', designation: 'Designation', salary: 'Salary', payable: 'Payable days', attendance: 'Attendance salary',
      otHours: 'OT (hrs)', otAmount: 'OT amount', bonus: 'Bonus', incentive: 'Incentive', deductions: 'Deductions', advance: 'Advance',
      net: 'Net salary', status: 'Status',
    },
    kpi: { employees: 'Employees', net: 'Net salary', meals: 'Staff meals', total: 'Grand total', days: 'Days' },
    form: { from: 'From date', to: 'To date', employee: 'Employee (optional)', run: 'Show report' },
    pickRange: { title: 'Pick a date range', body: 'Choose a from and to date in the same month, then show the report.' },
    empty: { title: 'Nothing to report', body: 'No processed salary for this selection.' },
  },
  letters: {
    joining: {
      title: 'Joining Letter', subtitle: 'One template per company. Placeholders are filled in for each employee.',
      generateFor: 'Generate for an employee', pickHint: 'Active staff, newest joiner first.',
    },
    experience: {
      title: 'Experience Letter', subtitle: 'One template per company. Issued to staff marked Relieved.',
      generateFor: 'Generate for a leaver', pickHint: 'Only relieved staff can get an experience letter.',
    },
    placeholders: 'Placeholders', placeholderHint: 'Tap a placeholder to add it to the end of the last field you edited.',
    subject: 'Subject', signatoryName: 'Signed by', signatoryDesignation: 'Signatory designation',
    noTemplate: { title: 'No template yet', body: 'Create the template once. It is then used for every letter.' },
    create: 'Create template', generate: 'Generate preview', deleteTitle: 'Delete this template?',
    deleteBody: 'Letters cannot be generated until a new template is saved.', active: 'Template active',
  },
  resignations: {
    title: 'Resignations', subtitle: 'Staff who are leaving, have left or have come back.',
    kpi: { inNotice: 'In notice', relieved: 'Relieved', rejoined: 'Rejoined', all: 'All exits' },
    columns: { employee: 'Employee', type: 'Type', resigned: 'Resigned', lwd: 'Last working day', reason: 'Reason', status: 'Status', next: 'Next step' },
    empty: { title: 'No resignations', body: 'Record a resignation when someone gives notice.' },
    add: 'New resignation', editTitle: 'Edit resignation', rejoin: 'Rejoin', experience: 'Experience letter',
    form: {
      type: 'Exit type', resignationDate: 'Resignation / notice date', lwd: 'Last working day', reason: 'Reason', remarks: 'HR remarks',
      status: 'Status', document: 'Acceptance document', documentHint: 'PDF or image. Upload comes with the backend; the file name is kept for now.',
      attach: 'Choose file', remove: 'Remove file',
    },
    rejoinForm: {
      joiningDate: 'New joining date', designation: 'Designation', department: 'Department', salary: 'Monthly salary',
      hours: 'Daily working hours', phone: 'Mobile number', mode: 'Payment mode', bank: 'Bank name', holder: 'Account holder',
      account: 'Account number', ifsc: 'IFSC code', accountReplace: 'Replace account number',
      accountKeep: 'Leave empty to keep the stored number.', country: 'Country code', address: 'Address', branch: 'Branch name',
    },
    rejoined: 'Rejoined', relievedNote: 'Relieved staff drop out of attendance and payroll.',
  },
  master: {
    title: 'Payroll Master', subtitle: 'The lists payroll forms use. Admin only.',
    scope: 'Applies to', allCompanies: 'All companies',
    columns: { name: 'Name', value: 'Email address', scope: 'Applies to', status: 'Status' },
    empty: { title: 'Nothing in this list', body: 'Built-in choices are used until you add your own.' },
    builtIn: 'Built-in choices in use', inherited: 'Shared with every company (change them under All companies)',
    add: 'Add item', editTitle: 'Edit item', on: 'On', off: 'Off',
  },
  log: {
    title: 'Payroll Log', subtitle: 'Everything done in payroll, newest first. Admin only.',
    kpi: { total: 'All entries', today: 'Today', emails: 'Emails sent', failed: 'Failed' },
    columns: { when: 'When', who: 'Who', action: 'Action', what: 'What', summary: 'Summary', outcome: 'Outcome' },
    filters: { action: 'Action', entity: 'What', status: 'Outcome', user: 'Who', from: 'From', to: 'To' },
    empty: { title: 'No log entries', body: 'Nothing matches these filters. Try clearing them.' },
    detail: 'Log entry',
  },
  adminOnly: { title: 'Admins only', body: 'Ask your hotel admin for access to this screen.' },
  /** The filter rows of the server-paged pay lists (Slips, Advances, Bonus, Resignations). */
  lists: {
    all: 'All',
    showing: 'Showing',
    of: 'of',
    slips: {
      tabsLabel: 'Payment status', noun: 'slip', nouns: 'slips',
      search: 'Search employee, ID or designation…',
      kpiNet: 'Net salary', kpiNetChip: (paid: string) => `${paid} paid`,
      kpiOutstanding: 'Outstanding', kpiOutstandingChip: (n: number) => `${n} fully paid`,
      kpiLatestChip: 'Newest month with slips',
    },
    advances: { tabsLabel: 'Advance status', noun: 'advance', nouns: 'advances', open: 'Open', settled: 'Settled' },
    bonus: { tabsLabel: 'Entry type', noun: 'entry', nouns: 'entries' },
    resignations: { tabsLabel: 'Exit status', noun: 'exit', nouns: 'exits' },
  },
} as const;

// ---------------------------------------------------------------------------
// Helpers (pure)
// ---------------------------------------------------------------------------

/** Mock "today" so the seed data and rules line up; the same day as the rest of the demo. */
export const MOCK_TODAY = '2026-11-05';

export function monthOf(date: string): string { return date.slice(0, 7); }

export function daysInMonth(period: string): number {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y ?? 2026, m ?? 1, 0)).getUTCDate();
}

export function addMonths(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** "1 year, 3 months" style service length. */
export function serviceLength(from: string, to: string): string {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  let months = ((ty ?? 0) - (fy ?? 0)) * 12 + ((tm ?? 0) - (fm ?? 0));
  if ((td ?? 0) < (fd ?? 0)) months -= 1;
  const years = Math.floor(Math.max(0, months) / 12);
  const rest = Math.max(0, months) % 12;
  const parts: string[] = [];
  if (years) parts.push(`${years} year${years > 1 ? 's' : ''}`);
  if (rest) parts.push(`${rest} month${rest > 1 ? 's' : ''}`);
  return parts.length ? parts.join(', ') : 'Less than a month';
}

/** Shows only the last 4 digits of an account number. */
/** The account number as stored (shown in full; kept as a function so screens need no change). */
export function maskAccount(n: string | null): string { return n ?? ''; }

export function isPayrollAdmin(role: string): boolean {
  return role === 'hotel_admin' || role === 'super_admin' || role === 'platform_admin' || role === 'group_hotel_admin';
}

/**
 * Friendly text for a failed call. One rule (server and mock): the sentence is in error.message
 * (422 form rules, 403 "Only Admin users can …", 409 state). Else the first field message, else the shared text.
 */
export function payErrorText(error: DashError, fallback: Record<string, string>): string {
  const sentence = serverSentence(error);
  if (sentence) return sentence;
  const first = Object.values(error.details?.fields ?? {})[0];
  if (first) return first;
  return fallback[error.code] ?? 'Something went wrong. Please try again.';
}

export function balanceOf(r: SalaryRecord): number { return Math.max(0, r.netPaise - r.paidPaise); }

export function grossOf(r: SalaryRecord): number {
  return r.attendanceSalaryPaise + r.otAmountPaise + r.bonusPaise + r.incentivePaise;
}

export function totalDeductionsOf(r: SalaryRecord): number {
  return r.deductions.reduce((s, d) => s + d.paise, 0) + r.advanceRecoveryPaise;
}

export const letterPlaceholders: Record<LetterKind, string[]> = {
  joining: ['{EMPLOYEE_NAME}', '{DESIGNATION}', '{DEPARTMENT}', '{RESPONSIBILITIES}', '{JOINING_DATE}', '{CURRENT_DATE}'],
  experience: ['{EMPLOYEE_NAME}', '{DESIGNATION}', '{DEPARTMENT}', '{JOINING_DATE}', '{LAST_WORKING_DATE}', '{DURATION}', '{CURRENT_DATE}'],
};

export const letterSectionDefs: Record<LetterKind, { id: string; label: string; rows: number }[]> = {
  joining: [
    { id: 'introduction', label: 'Introduction', rows: 4 },
    { id: 'responsibilities', label: 'Roles and responsibilities', rows: 4 },
    { id: 'terms', label: 'Terms and conditions', rows: 5 },
    { id: 'closing', label: 'Closing message', rows: 2 },
    { id: 'acceptance', label: 'Acceptance by employee', rows: 3 },
  ],
  experience: [
    { id: 'body', label: 'Body', rows: 4 },
    { id: 'conduct', label: 'Conduct remarks', rows: 3 },
    { id: 'closing', label: 'Closing message', rows: 2 },
  ],
};

export interface SeparationSeed extends Omit<Separation, 'employeeName' | 'designation' | 'employeeCode' | 'joiningDate' | 'companyId' | 'canEdit' | 'canDelete'> { }

// ---------------------------------------------------------------------------
// Store + API
// ---------------------------------------------------------------------------

export interface Store {
  employees: PayEmployee[];
  history: (SalaryRevision & { employeeId: string })[];
  records: SalaryRecord[];
  advances: (Omit<Advance, 'employeeName' | 'employeeCode' | 'outstandingPaise' | 'locked' | 'canEdit' | 'canDelete'>)[];
  bonus: (Omit<BonusEntry, 'employeeName' | 'employeeCode' | 'locked' | 'canEdit' | 'canDelete'>)[];
  /** Recycle bins (soft-deleted). */
  separationBin: SeparationSeed[];
  advanceBin: Store['advances'];
  bonusBin: Store['bonus'];
  /** createdAt: when the price was entered (ISO); optional so older seeds stay valid. */
  prices: { id: string; effectiveFrom: string; monthlyPaise: number; createdAt?: string }[];
  meals: MealPeriod[];
  templates: LetterTemplate[];
  separations: SeparationSeed[];
  master: MasterItem[];
  log: PayrollLogEntry[];
  seq: number;
}

/** Starting rows for the mock instead of its own made-up ones (dev preview `?data=s08`, see payroll.fixtures.ts). */
export type PayrollPaySeed = Omit<Store, 'seq'> & { companies: PayrollCompanyRef[] };

/** Selected payroll company shared by every payrollPay screen during the session. */
export const payrollPayCompanyStore = (() => {
  let current = 'pc1';
  const listeners = new Set<() => void>();
  return {
    get: (): string => current,
    set: (id: string): void => { current = id; listeners.forEach((l) => l()); },
    subscribe: (l: () => void): (() => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
  };
})();

// ---------------------------------------------------------------------------
// Mock link: ONE set of payroll data for the core mock (staff, attendance, dashboard, options) and this pay mock.
// Mock only; the real server keeps one database, so the real adapters need nothing of this.
// ---------------------------------------------------------------------------

/** The staff record fields the pay side reads and writes (payrollCore's Employee has every one of them). */
export interface LinkedEmployee {
  id: string; companyId: string; name: string; employeeCode: string; designation: string; department: string; joiningDate: string;
  isActive: boolean; salaryPaise: number; dailyWorkingHours: number; paymentMode: string; bankName: string; accountHolderName: string;
  accountNumber: string | null; ifscCode: string; branchName: string; contactCountry: string; contactNumber: string;
  display: { contact: string; emergency: string };
}

/** One employee's month for salary generation (Pallav SalaryProcessor input). */
export interface GenerateRow {
  employeeId: string;
  /** Each day's paid share 0 / 25 / 50 / 75 / 100 (index 0 = the 1st); null = not marked. */
  percents: (number | null)[];
  /** Overtime hours per day. */
  overtime: number[];
  /** The employee's assigned deductions; `key` is stable per assignment (a One Time one is taken once). */
  deductions: { key: string; label: string; type: string; paise: number }[];
}

/** What the payroll dashboard shows from the pay side (the same figures as Salary Payments and Advances). */
export interface PayOverview {
  /** The latest processed month, null when none. */
  period: string | null;
  netPaise: number;
  paidPaise: number;
  outstandingPaise: number;
  /** Records of that month not fully paid. */
  openPayments: number;
  processed: number;
  advanceOutPaise: number;
  inNotice: number;
  recent: PayrollLogEntry[];
}

export interface PayrollPayLink {
  /** The staff list is the core mock's: the pay side reads and writes the same records. */
  useEmployees(source: () => LinkedEmployee[]): void;
  /** Call after the core list changed (new staff, recycle bin). */
  syncEmployees(): void;
  /** Builds (or rebuilds) the month's salary records from attendance; returns how many were made. */
  generate(companyId: string, period: string, rows: GenerateRow[], by?: string): number;
  /** Salary records, advances, bonus or meals point at this employee. */
  isUsed(employeeId: string): boolean;
  /** Payroll Master's active items for a company (else Pallav's defaults). */
  choices(companyId: string, list: MasterListKey): string[];
  overview(companyId: string): PayOverview;
}

/** Pass the same object to createPayrollPayApi and createPayrollCoreApi (payrollCore's createPayrollMocks does it). */
export interface PayrollMockLink { pay?: PayrollPayLink }

export type PayrollPayApi = ReturnType<typeof createPayrollPayApi>;
