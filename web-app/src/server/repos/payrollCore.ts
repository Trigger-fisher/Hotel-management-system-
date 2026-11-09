import "server-only";
import type { Paise } from "../money/paise";
import type { ListResult, Page } from "./types";

// Payroll core (Pallav "Payroll": fixed companies, Staff, Attendance, Attendance Marks, Deduction Types, Staff Emails, the payroll dashboard),
// in the hotel's own database (hotel migration 0007_payroll_core). Plain records, no SQL. Spec: docs/specs/payroll-core.md.
// Rules every implementation keeps:
// - EVERY read and write is scoped to ONE payroll company (Pallav PayrollScope): a row of another company reads as absent, never as forbidden.
// - Bank, ID and emergency numbers are plain text columns (MJ: plain data, no field encryption): employees.account_number, ifsc_code,
//   id_proof_number, emergency_contact_number; payroll_companies.account_number, ifsc_code. They are never logged.
// - employees are soft-deleted (recycle bin, Pallav Recyclable); attendance_statuses, attendance_entries, deductions and employee_deductions
//   are HARD-deleted (marked in the template); payroll_companies are fixed (never added, deleted or renamed: FixedCompaniesTest).
// - The attendance GRID is read in ONE query per page (entries of the month for a list of employees), never per employee; every count on
//   a screen (used, assigned, filled, incomplete, staff, email stats) is an aggregate, never rows counted in code.
// - None of these tables carry a version (not in MJ's version list); the attendance month is locked with SELECT ... FOR UPDATE instead.

/* ---------------------------------------------------------------- payroll companies (fixed) */

export interface PayrollCompanyFields {
  ownerName: string | null;
  mobileNumber: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  panNumber: string | null;
  tanNumber: string | null;
  pfRegistrationNumber: string | null;
  esicRegistrationNumber: string | null;
  professionalTaxRegistrationNumber: string | null;
  authorizedPersonName: string | null;
  authorizedDesignation: string | null;
  authorizedMobile: string | null;
  authorizedEmail: string | null;
  bankName: string | null;
  /** Plain text. */
  accountNumber: string | null;
  /** Plain text. */
  ifscCode: string | null;
  branchName: string | null;
}

export interface PayrollCompanyRecord extends PayrollCompanyFields {
  id: string;
  /** Fixed at provisioning; never changed by any write here. */
  name: string;
  code: string;
  isActive: boolean;
  logoPath: string | null;
  signatureImagePath: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PayrollCompanyRow extends PayrollCompanyRecord {
  /** Live employees (aggregate). */
  staffCount: number;
  activeStaffCount: number;
}

interface PayrollCompanyRepo {
  get(id: string, options?: { forUpdate?: boolean }): Promise<PayrollCompanyRecord | null>;
  /** In the FIXED order (PayrollCompany::inFixedOrder: by the fixed code list, then name), with staff counts from ONE grouped count. */
  list(query: { words?: readonly string[]; active?: boolean }): Promise<PayrollCompanyRow[]>;
  row(id: string): Promise<PayrollCompanyRow | null>;
  /** Details only: name and code are never written (PayrollCompanyController::update unsets them). */
  update(id: string, patch: Partial<PayrollCompanyFields>, by: string): Promise<PayrollCompanyRecord>;
}

/* ---------------------------------------------------------------- employees */

export interface EmployeeFields {
  employeeCode: string;
  name: string;
  designation: string;
  department: string | null;
  shift: string | null;
  responsibilities: string | null;
  joiningDate: string;
  salaryPaise: Paise;
  /** decimal(5,2) as text ("8.00"), 0.5 to 24. */
  dailyWorkingHours: string;
  /** Dial code without "+" ("91"); national digits apart (PhoneCountries). */
  contactCountry: string;
  contactNumber: string;
  address: string | null;
  emergencyContactName: string | null;
  emergencyContactRelation: string | null;
  emergencyContactCountry: string;
  /** Plain text. */
  emergencyContactNumber: string | null;
  paymentMode: string;
  bankName: string | null;
  accountHolderName: string | null;
  /** Plain text. */
  accountNumber: string | null;
  /** Plain text. */
  ifscCode: string | null;
  branchName: string | null;
  idProofType: string | null;
  /** Plain text. */
  idProofNumber: string | null;
  /** Lower-cased and trimmed by the service; unique per company among live rows. */
  email: string;
  dateOfBirth: string | null;
  gender: string | null;
  nationality: string | null;
  countryAndPincode: string | null;
  qualification: string | null;
  qualificationInstitution: string | null;
  skills: string | null;
  photoPath: string | null;
  idProofImagePath: string | null;
  idProofBackImagePath: string | null;
  resumePath: string | null;
}

export interface EmployeeRecord extends EmployeeFields {
  id: string;
  payrollCompanyId: string;
  isActive: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A row a page or lookup needs (the lists carry no bank or ID number). */
export type EmployeeListRow = EmployeeRecord;

/** "updated": updated_at desc, id desc (the Salary Update list); "active": active first, then by name (the Staff Meals list). */
type EmployeeSort = "joining" | "name" | "updated" | "active";

interface EmployeeRepo {
  get(companyId: string, id: string, options?: { forUpdate?: boolean; deleted?: boolean }): Promise<EmployeeRecord | null>;
  /** Ids of THIS company among `ids` (PayrollScope::belongsToCompany for a posted list), live rows. */
  ownIds(companyId: string, ids: readonly string[]): Promise<string[]>;
  getMany(companyId: string, ids: readonly string[]): Promise<EmployeeRecord[]>;
  /**
   * One page. "joining": most recent joiner first (joining_date desc, id desc: EmployeeController::index); "name": by name (the attendance
   * grid's order, AttendanceController::index). Every word in name, code, designation, department, email or mobile (never the bank or ID numbers).
   */
  list(companyId: string, query: { words?: readonly string[]; active?: boolean; deleted?: "no" | "only"; sort: EmployeeSort } & Page): Promise<ListResult<EmployeeListRow>>;
  /** The picker: code or name prefix, at most `limit` (50). Live rows; active first, then by name (StaffEmailController::index order). */
  lookup(companyId: string, query: { prefix: string; limit: number; active?: boolean }): Promise<EmployeeListRow[]>;
  /** (payroll_company_id, employee_code) among live rows, except one. */
  codeTaken(companyId: string, code: string, except?: string): Promise<boolean>;
  /** (payroll_company_id, email) among live rows, except one. Needs the index asked of Worker A. */
  emailTaken(companyId: string, email: string, except?: string): Promise<boolean>;
  /** Live and active / live in all (the dashboard's staff and former staff): ONE grouped count. */
  counts(companyId: string): Promise<{ active: number; all: number }>;
  /**
   * Employee::blockingDependency in Pallav's order, from ONE query of EXISTS sub-selects: "Attendance Management", "Advance Management",
   * "Bonus & Incentive Management", "Salary Processing", "Staff Advance Salaries"; null when nothing names the person.
   * With `{ purge: true }` (removal for good) it also names "Separation Management" and "Meals Management": a separation or meal period (deleted
   * or not) points at the person ON DELETE RESTRICT, so the DELETE would fail. A soft delete keeps Pallav's five (it never hits the foreign key).
   */
  blockingDependency(id: string, opts?: { purge?: boolean }): Promise<string | null>;
  create(companyId: string, fields: EmployeeFields, by: string): Promise<EmployeeRecord>;
  update(companyId: string, id: string, patch: Partial<EmployeeFields>, by: string): Promise<EmployeeRecord>;
  setActive(companyId: string, id: string, active: boolean, by: string): Promise<EmployeeRecord>;
  softDelete(companyId: string, id: string, by: string): Promise<boolean>;
  restore(companyId: string, id: string): Promise<boolean>;
  /** Recycle bin only; never one blockingDependency names (the foreign keys would cascade attendance away). */
  purge(companyId: string, id: string): Promise<boolean>;
}

/* ---------------------------------------------------------------- employee deductions (hard delete) */

export type DeductionKind = "One Time" | "Monthly";

export interface EmployeeDeductionRecord {
  id: string;
  employeeId: string;
  deductionId: string;
  deductionType: DeductionKind;
  amountPaise: Paise;
  isSettled: boolean;
}

interface EmployeeDeductionRepo {
  /** Every assignment of these employees in ONE query (a page of staff never reads per person). */
  forEmployees(employeeIds: readonly string[]): Promise<EmployeeDeductionRecord[]>;
  /**
   * EmployeeController::syncDeductions: deletes the employee's rows whose id is not kept, updates the kept ones (by id, the employee's own
   * only), inserts the new ones. One statement per kind, never per row.
   */
  sync(employeeId: string, rows: readonly { id?: string; deductionId: string; deductionType: DeductionKind; amountPaise: Paise }[], by: string): Promise<void>;
}

/* ---------------------------------------------------------------- deduction types (hard delete) */

export interface DeductionRecord {
  id: string;
  payrollCompanyId: string;
  name: string;
  amountPaise: Paise;
  isActive: boolean;
  createdAt: Date;
}

interface DeductionRepo {
  get(companyId: string, id: string): Promise<DeductionRecord | null>;
  /** Newest first (created_at desc, id desc), each with its assignment count from ONE grouped count (withCount('assignments')). */
  list(companyId: string, query?: { activeOnly?: boolean }): Promise<(DeductionRecord & { assignedCount: number })[]>;
  /** Ids of THIS company among `ids` (PayrollScope::belongsToCompany('deductions')). */
  ownIds(companyId: string, ids: readonly string[]): Promise<string[]>;
  /** (payroll_company_id, name) except one; the column collation is case-insensitive, as Pallav's unique rule is. */
  nameTaken(companyId: string, name: string, except?: string): Promise<boolean>;
  isAssigned(id: string): Promise<boolean>;
  /** Whether the company has any deduction at all (the dashboard's attention list). */
  any(companyId: string): Promise<boolean>;
  create(companyId: string, fields: { name: string; amountPaise: Paise }, by: string): Promise<DeductionRecord>;
  update(companyId: string, id: string, patch: { name?: string; amountPaise?: Paise; isActive?: boolean }, by: string): Promise<DeductionRecord>;
  remove(companyId: string, id: string): Promise<boolean>;
}

/* ---------------------------------------------------------------- attendance statuses (hard delete) */

export type StatusType = "Paid" | "Unpaid";

export interface AttendanceStatusFields {
  name: string;
  /** Upper-cased by the service; unique per company. */
  shortcutKey: string;
  /** Unique per company. */
  color: string;
  attendancePercentage: 0 | 25 | 50 | 75 | 100;
  statusType: StatusType;
  skipsFood: boolean;
}

export interface AttendanceStatusRecord extends AttendanceStatusFields {
  id: string;
  payrollCompanyId: string;
  isActive: boolean;
  createdAt: Date;
}

interface AttendanceStatusRepo {
  get(companyId: string, id: string): Promise<AttendanceStatusRecord | null>;
  /** Newest first (AttendanceStatusController::index), or active only by name (the grid's legend, AttendanceController::index). */
  list(companyId: string, query: { activeOnly: boolean; order: "newest" | "name" }): Promise<AttendanceStatusRecord[]>;
  /** Days marked with each status (ONE grouped count over attendance_entries.attendance_status_id). */
  usedCounts(companyId: string): Promise<Map<string, number>>;
  shortcutTaken(companyId: string, key: string, except?: string): Promise<boolean>;
  colorTaken(companyId: string, color: string, except?: string): Promise<boolean>;
  isUsed(id: string): Promise<boolean>;
  create(companyId: string, fields: AttendanceStatusFields): Promise<AttendanceStatusRecord>;
  update(companyId: string, id: string, patch: Partial<AttendanceStatusFields> & { isActive?: boolean }): Promise<AttendanceStatusRecord>;
  remove(companyId: string, id: string): Promise<boolean>;
}

/* ---------------------------------------------------------------- attendance months and entries */

export interface AttendanceMonthRecord {
  id: string;
  payrollCompanyId: string;
  year: number;
  month: number;
  isLocked: boolean;
  lockedAt: Date | null;
  salaryGeneratedAt: Date | null;
  salaryGeneratedBy: string | null;
  generationCount: number;
  unlockedBy: string | null;
  unlockedAt: Date | null;
  /** The HMS session id that unlocked it (AttendanceMonth::revertStaleUnlock). */
  unlockSessionId: string | null;
}

type AttendanceMonthPatch = Partial<Omit<AttendanceMonthRecord, "id" | "payrollCompanyId" | "year" | "month">>;

export interface AttendanceEntryRecord {
  employeeId: string;
  day: number;
  attendanceStatusId: string | null;
  shortcutKey: string | null;
  attendancePercentage: number;
  /** decimal(6,2) as text. */
  overtimeHours: string;
  skipsFood: boolean;
}

/** One cell to write: a status copied onto the day (key, percentage and skips_food), or only overtime. */
export type AttendanceCellWrite = AttendanceEntryRecord;

interface AttendanceRepo {
  /** firstOrCreate on (company, year, month): INSERT IGNORE then SELECT (FOR UPDATE when asked), so two first opens make one row. */
  month(companyId: string, year: number, month: number, options?: { forUpdate?: boolean }): Promise<AttendanceMonthRecord>;
  /** The month only when it exists (a read never creates one for a figure). */
  findMonth(companyId: string, year: number, month: number): Promise<AttendanceMonthRecord | null>;
  updateMonth(id: string, patch: AttendanceMonthPatch): Promise<AttendanceMonthRecord>;
  /** THE GRID: every entry of the month for these employees in ONE query (attendance_month_id, employee_id IN (...)). */
  entries(monthId: string, employeeIds: readonly string[]): Promise<AttendanceEntryRecord[]>;
  /** Filled days (a status set) in the month, every employee: ONE count (the progress bar and the dashboard). */
  filledCount(monthId: string): Promise<number>;
  /**
   * SalaryProcessor::employeesWithIncompleteAttendance: names of ACTIVE live employees of the company with fewer than `daysInMonth`
   * filled days, by name. ONE query (employees LEFT JOIN a grouped count).
   */
  incomplete(companyId: string, monthId: string, daysInMonth: number): Promise<string[]>;
  /** Batched writes of a save: upserts on (month, employee, day) and deletes of emptied cells, a statement per kind (never per cell). */
  write(monthId: string, cells: { upsert: readonly AttendanceCellWrite[]; clear: readonly { employeeId: string; day: number }[] }): Promise<void>;
  /** AttendanceStatusController::update: days with this status in an UNLOCKED month follow its new skips_food. */
  followSkipsFood(statusId: string, skipsFood: boolean): Promise<number>;
}

/* ---------------------------------------------------------------- payroll master lists (read here; managed by the admin task) */

export type PayrollMasterList = "share_emails" | "designations" | "departments" | "gender" | "separation_type" | "id_proofs" | "salary_payment_mode";

export interface PayrollMasterItemRecord {
  id: string;
  payrollCompanyId: string | null;
  list: PayrollMasterList;
  label: string;
  value: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface PayrollMasterRepo {
  /** PayrollMasters::active: the shared items (no company) then this company's, by sort order then label; active only. */
  active(list: PayrollMasterList, companyId: string): Promise<PayrollMasterItemRecord[]>;
  /** Several lists at once (the staff form's options): ONE query. */
  activeMany(lists: readonly PayrollMasterList[], companyId: string): Promise<PayrollMasterItemRecord[]>;
}

/* ---------------------------------------------------------------- staff emails */

type StaffEmailStatus = "sending" | "sent" | "failed";

export interface StaffEmailRecord {
  id: string;
  payrollCompanyId: string;
  employeeId: string | null;
  employeeName: string;
  employeeCode: string | null;
  designation: string | null;
  recipientId: string | null;
  recipientName: string | null;
  recipientEmail: string | null;
  subject: string | null;
  attachment: string | null;
  attachmentBytes: number | null;
  status: StaffEmailStatus;
  message: string | null;
  error: string | null;
  durationMs: number | null;
  sentBy: string | null;
  sentByName: string | null;
  ipAddress: string | null;
  finishedAt: Date | null;
  createdAt: Date;
}

/** `createdAt` is the service clock (the record's age decides "stalled" and "today" against the same clock). */
type NewStaffEmail = Omit<StaffEmailRecord, "id" | "status" | "message" | "error" | "durationMs" | "attachmentBytes" | "finishedAt">;

export interface StaffEmailFilter {
  words?: readonly string[];
  /** "sending" = still sending and newer than staleBefore; "failed" = failed, or still sending and older (StaffEmailController::query). */
  status?: "sent" | "sending" | "failed";
  from?: string;
  to?: string;
}

interface StaffEmailRepo {
  /** One record by id (the outbox worker finishing a send; it carries the hotel, not the company). */
  get(id: string): Promise<StaffEmailRecord | null>;
  /** Newest first (created_at desc, id desc), words over employee name and code, recipient name and email, sender name. */
  list(companyId: string, query: StaffEmailFilter & Page & { staleBefore: Date }): Promise<ListResult<StaffEmailRecord>>;
  /** Records created after `after` matching the filter (at most 50) plus the watched ones (at most 200): the live feed. */
  feed(companyId: string, query: StaffEmailFilter & { staleBefore: Date; after: Date | null; watch: readonly string[] }): Promise<StaffEmailRecord[]>;
  /** total, sent, failed (failed or stale), today: ONE aggregate (SUM(CASE ...)). */
  stats(companyId: string, query: { staleBefore: Date; todayFrom: Date; todayTo: Date }): Promise<{ total: number; sent: number; failed: number; today: number }>;
  /** Written "sending" before the mail is queued (StaffShareMailer::open). */
  open(companyId: string, row: NewStaffEmail): Promise<StaffEmailRecord>;
  finish(id: string, result: { status: "sent" | "failed"; message: string; error: string | null; attachmentBytes: number | null; durationMs: number }): Promise<StaffEmailRecord>;
}

/* ---------------------------------------------------------------- payroll log */

export interface PayrollLogEntry {
  payrollCompanyId: string | null;
  companyName: string | null;
  userId: string | null;
  userName: string | null;
  action: "created" | "updated" | "deleted" | "emailed" | "error";
  status: "success" | "failed";
  entity: string;
  subjectId: string | null;
  subjectLabel: string | null;
  summary: string;
  /** Never a password, token, bank or ID number (PayrollLogTest). */
  details: Record<string, string | number | boolean | null> | null;
  ipAddress: string | null;
}

interface PayrollLogRepo {
  record(entry: PayrollLogEntry): Promise<void>;
}

/* ---------------------------------------------------------------- the dashboard's setup checks */

interface PayrollSetupRepo {
  /**
   * The setup half of PayrollDashboardController::attention in ONE query of EXISTS sub-selects: an active attendance status, an active
   * employee, any deduction, a joining letter, an experience letter. (The pay half comes from the PayrollPayFigures port, task B6.)
   */
  setup(companyId: string): Promise<{ hasActiveStatus: boolean; hasActiveStaff: boolean; hasDeduction: boolean; hasJoiningLetter: boolean; hasExperienceLetter: boolean }>;
  /** The joining letter template's state (the Add form offers the appointment letter only when one is active). */
  joiningTemplateActive(companyId: string): Promise<boolean>;
}

/* ---------------------------------------------------------------- the unit */

export interface PayrollCoreRepos {
  payrollCompanies: PayrollCompanyRepo;
  employees: EmployeeRepo;
  employeeDeductions: EmployeeDeductionRepo;
  deductions: DeductionRepo;
  attendanceStatuses: AttendanceStatusRepo;
  attendance: AttendanceRepo;
  payrollMasters: PayrollMasterRepo;
  staffEmails: StaffEmailRepo;
  payrollLog: PayrollLogRepo;
  payrollSetup: PayrollSetupRepo;
}
