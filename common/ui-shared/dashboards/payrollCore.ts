// Payroll (core half) contract: companies, payroll dashboard, staff, attendance,
// attendance statuses, deductions and staff emails. Source: Hotel Pallav payroll
// (screens, fields and behaviour only). Pure TypeScript, mock in-memory store.
//
// SHARED SEED with payrollPay (keep identical): payroll companies pc1/pc2 and employees e01-e15.
// ONE mock store: createPayrollMocks() links this mock and payrollPay's (staff records, salary generation, dashboard figures,
// Payroll Master lists), so every Payroll screen reads and writes the same data. createPayrollCoreApi alone still works (tests).
// Payroll is multi-company: every screen works on the company picked in the switcher
// (`payrollCompanyStore` below; payrollPay may import it so both halves share one choice).

import type { DashResult, ListQuery, LookupItem, LookupQuery, Page, Tone, Kpi } from './common';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PayrollCompany {
  id: string;
  name: string;
  code: string;
  ownerName: string;
  mobileNumber: string;
  email: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  panNumber: string;
  tanNumber: string;
  pfRegistrationNumber: string;
  esicRegistrationNumber: string;
  professionalTaxRegistrationNumber: string;
  authorizedPersonName: string;
  authorizedDesignation: string;
  authorizedMobile: string;
  authorizedEmail: string;
  bankName: string;
  branchName: string;
  /** Plain text, shown in full (MJ: no encryption). null = none on file. */
  accountNumber: string | null;
  ifscCode: string;
  isActive: boolean;
  /** File names only until the media store exists (uploads are mocked: the name is kept). */
  logoName?: string | null;
  signatureName?: string | null;
}

/**
 * The details only (Pallav FixedCompaniesTest: a hotel's two payroll companies are fixed).
 * `name`, `code` and `isActive` may be sent but are ignored: they never change.
 */
export type PayrollCompanyInput = Omit<PayrollCompany, 'id' | 'name' | 'code' | 'isActive' | 'accountNumber'> &
  Partial<Pick<PayrollCompany, 'name' | 'code' | 'isActive'>> & {
    /** Plain text (MJ: no encryption). Absent = keep, "" = remove. */
    accountNumber?: string;
  };

export interface PayrollCompanyRow extends PayrollCompany {
  staffCount: number;
  activeStaffCount: number;
}

/** Text from PayrollOptions.genders (Payroll Master; defaults Male / Female / Other). */
export type Gender = string;
/** Text from PayrollOptions.paymentModes (Payroll Master `salary_payment_mode`; defaults Cash / Bank). */
export type PaymentMode = string;
/** The payment mode named exactly this makes bank name, holder, account number and IFSC required. */
export const BANK_PAYMENT_MODE = 'Bank';
export type DeductionType = 'One Time' | 'Monthly';

export interface EmployeeDeductionAssignment {
  /** The assignment being kept. Rows without it are new; rows left out are removed (Pallav syncDeductions). */
  id?: string;
  deductionId: string;
  type: DeductionType;
  amountPaise: number;
}

export interface Employee {
  id: string;
  companyId: string;
  // Personal
  name: string;
  dateOfBirth: string;
  gender: Gender;
  /** National digits only; the dial code is contactCountry. */
  contactNumber: string;
  /** Dial code without "+", default "91". */
  contactCountry: string;
  email: string;
  address: string;
  nationality: string;
  countryAndPincode: string;
  emergencyContactName: string;
  /** Free text (max 60), not a Pallav list. */
  emergencyContactRelation: string;
  /** Read in full on getEmployee only; the list gives "". */
  emergencyContactNumber: string;
  emergencyContactCountry: string;
  // Job
  employeeCode: string;
  designation: string;
  department: string;
  shift: string;
  joiningDate: string;
  dailyWorkingHours: number;
  qualification: string;
  qualificationInstitution: string;
  skills: string;
  responsibilities: string;
  // Salary + bank
  salaryPaise: number;
  paymentMode: PaymentMode;
  bankName: string;
  accountHolderName: string;
  /** Plain text, shown in full. null = none on file. */
  accountNumber: string | null;
  ifscCode: string;
  branchName: string;
  // Deductions
  deductions: EmployeeDeductionAssignment[];
  // ID proof (plain text, shown in full)
  idProofType: string;
  idProofNumber: string | null;
  // Resume (file name only; upload comes with the backend)
  resumeFileName: string | null;
  /** File names only until the media store exists (uploads are mocked: the name is kept). */
  photoName?: string | null;
  idProofImageName?: string | null;
  isActive: boolean;
  /** PayrollRules for the signed-in viewer: show or hide Edit / Delete. */
  canEdit: boolean;
  canDelete: boolean;
  createdAt: string;
  /** Pallav's formatted numbers, e.g. "+91 98765 43210". */
  display: { contact: string; emergency: string };
}

/**
 * What the staff form sends. The server normalises it.
 * Numbers are plain text. Absent = keep the stored one, "" = remove it.
 * Not in the input (the server ignores them): resumeFileName, isActive (use toggleEmployee).
 */
export type EmployeeInput = Omit<
  Employee,
  'id' | 'companyId' | 'accountNumber' | 'idProofNumber' | 'resumeFileName' | 'isActive' | 'canEdit' | 'canDelete' | 'createdAt' | 'display'
> & {
  accountNumber?: string;
  idProofNumber?: string;
  /** Create only: email the offer letter after saving (editing never sends). */
  sendOfferLetter?: boolean;
};

export interface CreateEmployeeResult {
  employee: Employee;
  /** The record is saved whatever the letter does. null = no letter was asked for. */
  letter: null | { sent: boolean; message: string };
}

export type StatusType = 'Paid' | 'Unpaid';
export const attendancePercentages = [0, 25, 50, 75, 100] as const;
export type AttendancePercentage = (typeof attendancePercentages)[number];
/** How a mark reads in the monochrome look (MJ, 26 Oct 2026: no colour): by what the day pays, not by the mark's own colour. 0% none, 25-75% part, 100% full. */
export const markTone = (pct: number): 'none' | 'part' | 'full' => (pct <= 0 ? 'none' : pct >= 100 ? 'full' : 'part');

export interface AttendanceStatus {
  id: string;
  companyId: string;
  name: string;
  shortcutKey: string;
  /** Hex colour shown on the sheet. */
  color: string;
  attendancePercentage: AttendancePercentage;
  statusType: StatusType;
  skipsFood: boolean;
  isActive: boolean;
  /** Days on the sheet marked with this status (read only). */
  usedCount: number;
}

/** `isActive` is ignored (use toggleStatus, as Pallav); the server upper-cases the shortcut key. */
export type AttendanceStatusInput = Pick<AttendanceStatus, 'name' | 'shortcutKey' | 'color' | 'attendancePercentage' | 'statusType' | 'skipsFood'> & { isActive?: boolean };

export interface Deduction {
  id: string;
  companyId: string;
  name: string;
  standardAmountPaise: number;
  isActive: boolean;
  /** Employees this deduction is assigned to (read only). */
  assignedCount: number;
}

/** `isActive` is ignored (use toggleDeduction, as Pallav). */
export type DeductionInput = Pick<Deduction, 'name' | 'standardAmountPaise'> & { isActive?: boolean };

export interface AttendanceRow {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  designation: string;
  /** One entry per day of the month: status id or null (not filled). */
  days: (string | null)[];
  /** Same days as shortcut keys ("P", "HD"), what the clerk types. */
  keys: (string | null)[];
  /** Overtime hours per day (Pallav keeps overtime on each day). */
  overtime: number[];
  /** Sum of `overtime` (read only). */
  overtimeHours: number;
}

export type AttendanceLock = 'editable' | 'locked' | 'unlocked';

export interface AttendanceSheet {
  companyId: string;
  /** "2026-10" */
  month: string;
  daysInMonth: number;
  /** Day of month the sheet runs to today (whole month when the month is over). */
  daysElapsed: number;
  monthOver: boolean;
  lock: AttendanceLock;
  salaryGeneratedAt: string | null;
  statuses: AttendanceStatus[];
  /** This page of people, by name. */
  rows: AttendanceRow[];
  page: { total: number; page: number; pageSize: number };
  /** Whole month, all people: days filled, days expected so far, days needed for salary. */
  progress: { filled: number; expected: number; required: number };
  /** Names of people whose attendance blocks salary generation. */
  incomplete: string[];
}

/** Rows are paged by name, at most 100 people a page. */
export interface AttendanceQuery {
  page?: number;
  pageSize?: number;
}

export const ATTENDANCE_PAGE_MAX = 100;

/** One entry per day of the month. Only the rows sent are touched; an unknown key fails the whole save. */
export interface AttendanceSaveRow {
  employeeId: string;
  /** Shortcut KEYS as typed ("P", "hd"), Pallav's rule; null = clear the day. */
  days: (string | null)[];
  /** Overtime hours per day; omit to keep. */
  overtime?: (number | null)[];
}

/** "failed" also covers sends that never finished within 5 minutes ("stalled" kept for old rows). */
export type StaffEmailState = 'sent' | 'failed' | 'sending' | 'stalled';

export interface StaffEmailQuery extends ListQuery {
  status?: 'sent' | 'sending' | 'failed';
  /** YYYY-MM-DD, inclusive. */
  from?: string;
  to?: string;
}

export interface StaffEmailFeedQuery {
  /** ISO time of the newest card on screen. */
  after: string;
  /** Ids still "sending" (at most 200). */
  watch: string[];
}

export const STAFF_EMAIL_WATCH_MAX = 200;
export const STAFF_EMAIL_SEND_MAX = 100;

export interface StaffEmail {
  id: string;
  companyId: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  designation: string;
  recipientName: string | null;
  recipientEmail: string;
  subject: string;
  /** The email's body line, shown on the card. */
  message: string;
  state: StaffEmailState;
  error: string | null;
  /** Recorded from the session (never sent by the app). */
  sentBy: string;
  createdAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  attachmentKb: number | null;
}

export interface StaffEmailSummary {
  total: number;
  sent: number;
  failed: number;
  today: number;
}

export interface EmailRecipient {
  id: string;
  name: string;
  email: string;
}

export interface AttentionItem {
  id: string;
  tone: Tone;
  icon: string;
  text: string;
  action: string;
  viewId: string;
}

export interface RecentItem {
  id: string;
  at: string;
  icon: string;
  title: string;
  detail: string;
}

export interface PayrollDashboard {
  company: PayrollCompany;
  kpis: Kpi[];
  attendance: { filled: number; expected: number; percent: number; locked: boolean };
  payrollMonth: string | null;
  netPaise: number;
  paidPaise: number;
  attention: AttentionItem[];
  recent: RecentItem[];
}

export interface SendStaffEmailsResult {
  queued: number;
  failed: number;
  message: string;
  /** Each send recorded "sending"; the feed shows it become sent or failed. */
  items: StaffEmail[];
}

export interface StaffEmailFeed {
  /** New ones (at most 50) and the watched, by time. */
  items: StaffEmail[];
  summary: StaffEmailSummary;
}

/** A phone country for the contact fields (dial without "+"). */
export interface PhoneCountry {
  iso: string;
  name: string;
  dial: string;
  min: number;
  max: number;
  /** Required first digits pattern (e.g. "[6-9]" for India), null = any. */
  lead: string | null;
  sample: string;
  /** Regex source for the national number. */
  pattern: string;
  /** The error sentence when the number does not fit. */
  message: string;
}

/**
 * GET /companies/{cid}/options. Lists from Payroll Master (shared + this company's, active), else Pallav's defaults.
 * Emergency relation is free text (no list).
 */
export interface PayrollOptions {
  genders: string[];
  designations: string[];
  departments: string[];
  shifts: string[];
  paymentModes: string[];
  idProofTypes: string[];
  deductions: Deduction[];
  phoneCountries: PhoneCountry[];
  hasJoiningTemplate: boolean;
}

// ---------------------------------------------------------------------------
// Current payroll company (Pallav "payroll.company" middleware)
// ---------------------------------------------------------------------------

type Listener = () => void;
let currentCompanyId: string | null = null;
const companyListeners = new Set<Listener>();

/** The payroll company picked in the switcher. Shared by all payroll screens (both groups). */
export const payrollCompanyStore = {
  get: (): string | null => currentCompanyId,
  set: (id: string | null): void => {
    currentCompanyId = id;
    companyListeners.forEach((l) => l());
  },
  subscribe: (l: Listener): (() => void) => {
    companyListeners.add(l);
    return () => {
      companyListeners.delete(l);
    };
  },
};

// ---------------------------------------------------------------------------
// Helpers shared by web and mobile screens
// ---------------------------------------------------------------------------

/** Mock "today" in IST. */
export const PAYROLL_TODAY = '2026-11-05';

export function daysIn(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y ?? 2026, m ?? 1, 0)).getUTCDate();
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 0 = Sunday. */
export function weekdayOf(month: string, day: number): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, day)).getUTCDay();
}

export const weekdayShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[6-9]\d{9}$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function emptyEmployeeInput(): EmployeeInput {
  return {
    name: '', dateOfBirth: '', gender: '', contactNumber: '', contactCountry: '91', email: '', address: '', nationality: 'Indian',
    countryAndPincode: 'India - ', emergencyContactName: '', emergencyContactRelation: '', emergencyContactNumber: '', emergencyContactCountry: '91',
    employeeCode: '', designation: '', department: '', shift: '', joiningDate: PAYROLL_TODAY, dailyWorkingHours: 8,
    qualification: '', qualificationInstitution: '', skills: '', responsibilities: '',
    salaryPaise: 0, paymentMode: 'Cash', bankName: '', accountHolderName: '', accountNumber: '', ifscCode: '', branchName: '',
    deductions: [], idProofType: '', idProofNumber: '', sendOfferLetter: false,
  };
}

/** Edit form start: the stored plain numbers are filled in. */
export function employeeToInput(e: Employee): EmployeeInput {
  const {
    id: _id, companyId: _c, accountNumber: _a, idProofNumber: _p, resumeFileName: _r, isActive: _i,
    canEdit: _ce, canDelete: _cd, createdAt: _at, display: _d, ...rest
  } = e;
  void [_id, _c, _a, _p, _r, _i, _ce, _cd, _at, _d];
  return { ...rest, accountNumber: e.accountNumber ?? '', idProofNumber: e.idProofNumber ?? '', deductions: e.deductions.map((d) => ({ ...d })) };
}

function phoneError(country: string, digits: string): string | null {
  if (!digits) return null;
  if (country === '91') return PHONE_RE.test(digits) ? null : 'Enter a 10-digit mobile number.';
  return /^\d{6,15}$/.test(digits) ? null : 'Enter 6 to 15 digits.';
}

/**
 * Field errors for the staff form (keys = EmployeeInput keys). Quick checks only; the server is the judge.
 * `stored` = the employee being edited (a Bank employee with an account on file need not retype it).
 */
export function validateEmployee(i: EmployeeInput, stored?: Pick<Employee, 'accountNumber'> | null): Record<string, string> {
  const e: Record<string, string> = {};
  if (!i.name.trim()) e.name = 'Enter the full name.';
  if (!i.employeeCode.trim()) e.employeeCode = 'Enter an employee ID.';
  if (!i.designation.trim()) e.designation = 'Enter a designation.';
  if (!DATE_RE.test(i.joiningDate)) e.joiningDate = 'Enter the joining date.';
  if (i.dateOfBirth && !DATE_RE.test(i.dateOfBirth)) e.dateOfBirth = 'Enter a valid date.';
  const contact = phoneError(i.contactCountry || '91', i.contactNumber);
  if (contact) e.contactNumber = contact;
  const emergency = phoneError(i.emergencyContactCountry || '91', i.emergencyContactNumber);
  if (emergency) e.emergencyContactNumber = emergency;
  if (i.emergencyContactRelation.length > 60) e.emergencyContactRelation = 'Keep the relation to 60 characters.';
  if (i.email && !EMAIL_RE.test(i.email)) e.email = 'Enter a valid email address.';
  if (i.salaryPaise <= 0) e.salaryPaise = 'Enter the monthly salary.';
  if (!(i.dailyWorkingHours > 0 && i.dailyWorkingHours <= 24)) e.dailyWorkingHours = 'Enter hours between 1 and 24.';
  const account = (i.accountNumber ?? '').replace(/\s+/g, '');
  if (account && !/^\d{6,18}$/.test(account)) e.accountNumber = 'Enter the account number: 6 to 18 digits.';
  if (i.paymentMode === BANK_PAYMENT_MODE) {
    if (!i.bankName.trim()) e.bankName = 'Enter the bank name.';
    if (!i.accountHolderName.trim()) e.accountHolderName = 'Enter the account holder name.';
    const onFile = !!stored?.accountNumber && i.accountNumber === undefined;
    if (!account && !onFile) e.accountNumber = 'Enter the account number.';
    if (!IFSC_RE.test(i.ifscCode)) e.ifscCode = 'Enter an 11-character IFSC, like SBIN0001234.';
  } else if (i.ifscCode && !IFSC_RE.test(i.ifscCode)) {
    e.ifscCode = 'Enter an 11-character IFSC, like SBIN0001234.';
  }
  const idNo = (i.idProofNumber ?? '').trim();
  if (idNo.length > 50) e.idProofNumber = 'Keep the ID number to 50 characters.';
  if (idNo && !i.idProofType) e.idProofType = 'Choose the ID proof type.';
  i.deductions.forEach((d, n) => {
    if (!d.deductionId) e[`deductions.${n}`] = 'Choose a deduction.';
    else if (d.amountPaise <= 0) e[`deductions.${n}`] = 'Enter an amount.';
  });
  return e;
}

export function validateCompany(i: PayrollCompanyInput): Record<string, string> {
  const e: Record<string, string> = {};
  if (i.email && !EMAIL_RE.test(i.email)) e.email = 'Enter a valid email address.';
  if (i.authorizedEmail && !EMAIL_RE.test(i.authorizedEmail)) e.authorizedEmail = 'Enter a valid email address.';
  if (i.mobileNumber && !PHONE_RE.test(i.mobileNumber)) e.mobileNumber = 'Enter a 10-digit mobile number.';
  if (i.authorizedMobile && !PHONE_RE.test(i.authorizedMobile)) e.authorizedMobile = 'Enter a 10-digit mobile number.';
  if (i.pincode && !/^\d{6}$/.test(i.pincode)) e.pincode = 'Enter a 6-digit pincode.';
  if (i.panNumber && !/^[A-Z]{5}\d{4}[A-Z]$/.test(i.panNumber)) e.panNumber = 'Enter a PAN like ABCDE1234F.';
  if (i.ifscCode && !IFSC_RE.test(i.ifscCode)) e.ifscCode = 'Enter an 11-character IFSC.';
  const account = (i.accountNumber ?? '').replace(/\s+/g, '');
  if (account && !/^\d{6,18}$/.test(account)) e.accountNumber = 'Enter the account number: 6 to 18 digits.';
  return e;
}

export function validateStatus(i: AttendanceStatusInput): Record<string, string> {
  const e: Record<string, string> = {};
  if (!i.name.trim()) e.name = 'Enter a status name.';
  if (!/^[A-Z]{1,3}$/i.test(i.shortcutKey)) e.shortcutKey = 'Use 1-3 capital letters, like P or HD.';
  if (!/^#[0-9A-Fa-f]{6}$/.test(i.color)) e.color = 'Pick a colour.';
  return e;
}

export function validateDeduction(i: DeductionInput): Record<string, string> {
  const e: Record<string, string> = {};
  if (!i.name.trim()) e.name = 'Enter a deduction name.';
  if (i.standardAmountPaise < 0) e.standardAmountPaise = 'Amount cannot be negative.';
  return e;
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

export const payrollCoreCopy = {
  switcher: {
    label: 'Payroll company',
    placeholder: 'Choose a company',
    gateTitle: 'Choose a payroll company',
    gateBody: 'Payroll is kept per company. Pick the company you want to work on.',
    inactive: 'Inactive',
  },
  home: {
    title: 'Payroll',
    subtitle: 'Pick a company, then open a module.',
    companies: 'Companies',
    shortcuts: 'Modules',
    open: 'Open',
    current: 'Working on',
    activateFirst: 'Activate this company before you can open it.',
  },
  companies: {
    title: 'Companies',
    subtitle: 'The companies that run payroll',
    search: 'Search name, code or owner',
    cols: { company: 'Company', code: 'Code', owner: 'Owner', staff: 'Staff', status: 'Status' },
    tabs: { all: 'All', active: 'Active', inactive: 'Inactive' },
    emptyTitle: 'No matching companies',
    emptyBody: 'Try a different name, code or owner.',
    edit: 'Edit company',
    accountStored: (number: string) => `Stored: ${number}. Leave empty to keep it.`,
    readOnlyNote: 'The name and code are fixed. Everything else can be changed.',
    preview: 'Company details',
    open: 'Open payroll',
    saved: 'Company updated.',
    sections: { basic: 'Company', statutory: 'Statutory numbers', authorized: 'Authorised person', bank: 'Bank account' },
    logoNote: 'Logo and signature upload comes with the backend.',
    staffLine: (active: number, total: number) => `${active} active of ${total}`,
    fields: {
      name: 'Company name',
      code: 'Company code',
      ownerName: 'Owner name',
      mobile: 'Mobile number',
      email: 'Email address',
      address: 'Address',
      city: 'City',
      state: 'State',
      pincode: 'Pincode',
      pan: 'PAN number',
      panShort: 'PAN',
      tan: 'TAN number',
      pf: 'PF registration number',
      esic: 'ESIC registration number',
      pt: 'Professional tax registration number',
      authName: 'Name',
      authDesignation: 'Designation',
      bank: 'Bank name',
      branch: 'Branch name',
      accountLast4: 'Account number',
      accountNumber: 'Account number',
      accountReplace: 'Replace account number',
      ifsc: 'IFSC code',
    },
  },
  dashboard: {
    title: 'Payroll Dashboard',
    attention: 'Needs attention',
    allClearTitle: 'All clear',
    allClearBody: 'Setup is complete and every processed salary is settled.',
    recent: 'Recent activity',
    recentEmptyTitle: 'Nothing yet',
    recentEmptyBody: 'Advances, bonuses and exits appear here as they happen.',
    attendance: 'Attendance this month',
    salary: 'Salary',
    net: 'Net salary',
    paid: 'Paid so far',
  },
  staff: {
    title: 'Staff',
    search: 'Search name, ID, mobile, email',
    add: 'Add employee',
    cols: { employee: 'Employee', designation: 'Designation', joined: 'Joined', salary: 'Salary', mode: 'Mode', status: 'Status' },
    tabs: { all: 'All', active: 'Active', inactive: 'Inactive' },
    emptyTitle: 'No staff yet',
    emptyBody: 'Add the first employee to start payroll for this company.',
    noMatchTitle: 'No matching staff',
    noMatchBody: 'Try a different name, employee ID, designation or department.',
    added: 'Employee added.',
    updated: 'Employee updated.',
    deleted: 'Employee deleted.',
    toggled: 'Employee status updated.',
    deleteTitle: 'Delete this employee?',
    deleteBody: 'This removes the employee for good. If they have attendance or salary records, mark them Inactive instead.',
    offerLetter: 'Email offer letter',
    offerSent: (to: string) => `Offer letter sent to ${to}.`,
    share: 'Share details',
    preview: 'Staff record',
    noEmail: 'Add an email address first.',
    bin: {
      open: 'Recycle bin',
      back: 'Back to staff',
      title: 'Staff recycle bin',
      subtitle: 'Deleted staff. Restore one to bring it back, or delete it for ever.',
      emptyTitle: 'The recycle bin is empty',
      emptyBody: 'Deleted employees wait here until you restore them or delete them for ever.',
      restore: 'Restore',
      purge: 'Delete for ever',
      restored: (name: string) => `${name} restored.`,
      purged: (name: string) => `${name} deleted for ever.`,
      purgeTitle: (name: string) => `Delete ${name} for ever?`,
      purgeBody: 'This cannot be undone.',
    },
  },
  staffForm: {
    addTitle: 'Add employee',
    editTitle: 'Edit employee',
    save: 'Save changes',
    create: 'Add employee',
    sections: {
      personal: 'Personal',
      emergency: 'Emergency contact',
      job: 'Job',
      salary: 'Salary',
      bank: 'Bank account',
      deductions: 'Deductions',
      idProof: 'ID proof',
      resume: 'Resume',
    },
    addDeduction: 'Add deduction',
    noDeductions: 'No deductions for this employee.',
    deductionsOn: (n: number) => `${n} ${n === 1 ? 'deduction' : 'deductions'} assigned`,
    backendNote: 'File upload comes with the backend.',
    idProofHint: 'The full ID number, as on the document.',
    accountHint: 'The full bank account number.',
    uploadFront: 'Upload front',
    uploadBack: 'Upload back',
    uploadResume: 'Upload resume',
    activeLabel: 'Active on payroll',
    sendOffer: 'Email the offer letter after saving',
    sendOfferNoEmail: 'Add an email address to send the letter.',
    accountNumber: 'Account number',
    accountReplace: 'Replace account number',
    accountStored: (number: string) => `Stored: ${number}. Leave empty to keep it.`,
    idNumber: 'ID number',
    idReplace: 'Replace ID number',
    idStored: (masked: string) => `Stored: ${masked}. Leave empty to keep it.`,
    dialCode: 'Country code',
    fields: {
      name: 'Full name',
      dob: 'Date of birth',
      gender: 'Gender',
      mobile: 'Mobile number',
      email: 'Email address',
      address: 'Address',
      nationality: 'Nationality',
      relation: 'Relation',
      employeeId: 'Employee ID',
      designation: 'Designation',
      department: 'Department',
      shift: 'Shift',
      joining: 'Joining date',
      hours: 'Daily working hours',
      qualification: 'Qualification',
      institution: 'Institution',
      skills: 'Skills',
      responsibilities: 'Responsibilities',
      salary: 'Monthly salary',
      mode: 'Payment mode',
      bank: 'Bank name',
      holder: 'Account holder name',
      accountLast4: 'Account number',
      ifsc: 'IFSC code',
      branch: 'Branch name',
      deduction: 'Deduction',
      type: 'Type',
      amount: 'Amount',
      removeDeduction: 'Remove deduction',
      idType: 'ID proof type',
      idLast4: 'ID number',
      choose: 'Choose',
    },
  },
  attendance: {
    title: 'Attendance',
    save: 'Save attendance',
    saved: 'Attendance saved.',
    generate: 'Generate salary',
    regenerate: 'Re-generate salary',
    unlock: 'Unlock month',
    generated: 'Salary generated. Attendance for this month is now locked.',
    regenerated: 'Salary re-generated. All related payroll records for this month have been replaced.',
    unlocked: 'Attendance unlocked. Make your corrections and run Re-generate salary.',
    lockLabel: { editable: 'Editable', locked: 'Locked', unlocked: 'Unlocked for correction' } as Record<AttendanceLock, string>,
    generateTitle: 'Generate salary for this month?',
    generateBody: 'Salary is worked out from this attendance and the month is locked.',
    regenerateTitle: 'Re-generate salary?',
    regenerateBody: 'All payroll records for this month are replaced with fresh ones from this attendance.',
    unlockTitle: 'Unlock this month?',
    unlockBody: 'You can correct attendance, then run Re-generate salary. Only admins can do this.',
    noStatusesTitle: 'No attendance statuses configured',
    noStatusesBody: 'Attendance is entered with shortcut keys like P, HD or WO. Set those up before recording a month.',
    noStaffTitle: 'No active employees',
    noStaffBody: 'Add staff and they appear here, ready for attendance entry.',
    cols: { name: 'Name', ot: 'OT hrs', total: 'Total' },
    unknownKey: 'Unknown key',
    previous: 'Previous month',
    next: 'Next month',
    legend: 'Status keys',
    hint: 'Type a status key in a day. Enter moves to the next employee.',
    unsaved: 'You have unsaved changes.',
    employee: 'Employee',
    pick: 'Tap a status, then tap days to mark them.',
    clearDay: 'Clear',
    progress: (filled: number, expected: number) => `${filled} of ${expected} days filled`,
    progressNeeded: (required: number) => `${required} days are needed before salary can be generated`,
    incompleteTitle: 'Attendance still missing for',
    pageOf: (page: number, pages: number) => `Page ${page} of ${pages}`,
    prevPage: 'Previous page',
    nextPage: 'Next page',
    overtime: {
      open: 'Edit overtime',
      title: (name: string) => `Overtime for ${name}`,
      hint: 'Hours worked beyond the shift, for each day.',
      day: (d: number) => `Day ${d}`,
      total: (hours: string) => `Total: ${hours} hours`,
      apply: 'Apply',
    },
  },
  statuses: {
    title: 'Attendance Statuses',
    add: 'Add status',
    cols: { status: 'Status', shortcut: 'Shortcut', colour: 'Colour', countsAs: 'Counts as', type: 'Type', active: 'Active' },
    emptyTitle: 'No attendance statuses yet',
    emptyBody: 'Attendance cannot be recorded until there is at least one status, like Present, Absent or Half Day.',
    addTitle: 'Add attendance status',
    editTitle: 'Edit attendance status',
    added: 'Attendance status added.',
    updated: 'Attendance status updated.',
    deleted: 'Attendance status deleted.',
    toggled: 'Status updated.',
    deleteTitle: 'Delete this status?',
    deleteBody: 'The status is removed from this company.',
    skipsFood: 'Meals are not counted on this status',
    ofDay: 'of a working day',
  },
  deductions: {
    title: 'Deductions',
    add: 'Add deduction',
    cols: { deduction: 'Deduction', amount: 'Standard amount', assigned: 'Assigned to', active: 'Active' },
    emptyTitle: 'No deductions configured',
    emptyBody: 'Define a deduction here; you can then assign it, with its own amount, to any employee on their staff record.',
    addTitle: 'Add deduction',
    editTitle: 'Edit deduction',
    added: 'Deduction added.',
    updated: 'Deduction updated.',
    deleted: 'Deduction deleted.',
    toggled: 'Status updated.',
    deleteTitle: 'Delete this deduction?',
    deleteBody: 'The deduction is removed from this company.',
    nobody: 'Nobody yet',
  },
  emails: {
    title: 'Staff Emails',
    subtitle: 'Staff details sent by email, kept as a log',
    send: 'Send staff details',
    search: 'Search staff, recipient, sender',
    tabs: { all: 'All', sent: 'Sent', failed: 'Not sent' },
    cols: { when: 'When', employee: 'Staff', recipient: 'Sent to', by: 'Sent by', status: 'Status' },
    kpi: { total: 'Emails on record', sent: 'Sent', failed: 'Not sent', today: 'Today' },
    emptyTitle: 'No emails yet',
    emptyBody: "Nobody has emailed staff details from this company's payroll yet.",
    noMatchTitle: 'Nobody matches that search',
    noMatchBody: 'Try a different name or clear the filter.',
    sendTitle: 'Send staff details',
    sendBody: 'The full staff record goes as a PDF attachment. Each person is sent as its own email.',
    recipient: 'Send to',
    recipientHint: 'Only addresses approved in Payroll Master can be chosen.',
    pickStaff: 'Choose staff to send',
    selectShown: 'Select shown',
    clear: 'Clear',
    sent: (n: number) => (n === 1 ? '1 email sent.' : `${n} emails sent.`),
    detail: 'Email details',
    subject: 'Subject',
    messageLabel: 'Message',
    attachment: 'Attachment',
    stateLabel: { sent: 'Sent', failed: 'Not sent', sending: 'Sending', stalled: 'Did not finish' } as Record<StaffEmailState, string>,
    stateTone: { sent: 'success', failed: 'danger', sending: 'info', stalled: 'warning' } as Record<StaffEmailState, Tone>,
  },
  common: {
    edit: 'Edit',
    delete: 'Delete',
    preview: 'Preview',
    cancel: 'Cancel',
    save: 'Save',
    active: 'Active',
    inactive: 'Inactive',
    activate: 'Activate',
    deactivate: 'Deactivate',
    print: 'Print / PDF',
    printNote: 'This is a preview. The PDF comes with the backend.',
    backendNote: 'Comes with the backend.',
    noData: 'Not run yet',
  },
} as const;

/** Pallav's display form: "+91 98765 43210" (10-digit numbers split 5 + 5). "" when there is no number. */
export function formatPhone(dial: string, digits: string): string {
  if (!digits) return '';
  const body = digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
  return `+${dial || '91'} ${body}`;
}

export interface MonthRecord {
  companyId: string;
  month: string;
  lock: AttendanceLock;
  salaryGeneratedAt: string | null;
  entries: Map<string, { days: (string | null)[]; overtime: number[] }>;
}

// ---------------------------------------------------------------------------
// Mock API
// ---------------------------------------------------------------------------

/**
 * Every call is company-scoped (company id first) except listCompanies.
 * Server routes: /api/v1/payroll/companies/{companyId}/... (docs/API.md "Payroll core").
 * A company not in this hotel, or not active, answers NOT_FOUND "Select a company first."
 * Admin-only calls (regenerate, unlock) and "sent by" are decided by the server from the session.
 */
export interface PayrollCoreApi {
  /** The hotel's fixed payroll companies, in the fixed order (no paging: a hotel has two). */
  listCompanies(): Promise<DashResult<PayrollCompanyRow[]>>;
  getCompany(companyId: string): Promise<DashResult<PayrollCompanyRow>>;
  updateCompany(companyId: string, input: PayrollCompanyInput): Promise<DashResult<PayrollCompanyRow>>;
  getDashboard(companyId: string): Promise<DashResult<PayrollDashboard>>;
  getOptions(companyId: string): Promise<DashResult<PayrollOptions>>;
  /** q.tab: all | active | inactive; q.deleted = the recycle bin. */
  listEmployees(companyId: string, q?: ListQuery & { deleted?: boolean }): Promise<DashResult<Page<Employee>>>;
  /** Picker: ACTIVE staff only, by name or employee code (hint = employee code), at most 50 (advance, bonus and meals refuse inactive people). */
  lookupEmployees(companyId: string, q?: LookupQuery): Promise<DashResult<LookupItem[]>>;
  getEmployee(companyId: string, id: string): Promise<DashResult<Employee>>;
  createEmployee(companyId: string, input: EmployeeInput): Promise<DashResult<CreateEmployeeResult>>;
  updateEmployee(companyId: string, id: string, input: EmployeeInput): Promise<DashResult<Employee>>;
  /** To the recycle bin. CONFLICT when the employee is used in Attendance (mark them inactive instead). */
  deleteEmployee(companyId: string, id: string): Promise<DashResult<{ id: string }>>;
  restoreEmployee(companyId: string, id: string): Promise<DashResult<Employee>>;
  purgeEmployee(companyId: string, id: string): Promise<DashResult<{ id: string }>>;
  toggleEmployee(companyId: string, id: string): Promise<DashResult<Employee>>;
  sendOfferLetter(companyId: string, id: string): Promise<DashResult<{ sent: boolean; message: string }>>;
  getAttendance(companyId: string, month: string, q?: AttendanceQuery): Promise<DashResult<AttendanceSheet>>;
  /** Returns the sheet (same page as `q`). */
  saveAttendance(companyId: string, month: string, rows: AttendanceSaveRow[], q?: AttendanceQuery): Promise<DashResult<AttendanceSheet>>;
  /**
   * Refusals carry Pallav's sentence in error.message (show `serverSentence(error)`): 409 CONFLICT for month not over,
   * already generated, complete attendance first, locked / not locked; 403 FORBIDDEN "Only Admin users can …".
   * Until task B6 the server answers 422 VALIDATION_FAILED, fields.reason "Salary generation arrives with Payroll Pay."
   * (the mock still generates, for the demo).
   */
  generateSalary(companyId: string, month: string): Promise<DashResult<AttendanceSheet>>;
  regenerateSalary(companyId: string, month: string): Promise<DashResult<AttendanceSheet>>;
  unlockAttendance(companyId: string, month: string): Promise<DashResult<AttendanceSheet>>;
  listStatuses(companyId: string): Promise<DashResult<AttendanceStatus[]>>;
  createStatus(companyId: string, input: AttendanceStatusInput): Promise<DashResult<AttendanceStatus>>;
  updateStatus(companyId: string, id: string, input: AttendanceStatusInput): Promise<DashResult<AttendanceStatus>>;
  deleteStatus(companyId: string, id: string): Promise<DashResult<{ id: string }>>;
  toggleStatus(companyId: string, id: string): Promise<DashResult<AttendanceStatus>>;
  listDeductions(companyId: string): Promise<DashResult<Deduction[]>>;
  createDeduction(companyId: string, input: DeductionInput): Promise<DashResult<Deduction>>;
  updateDeduction(companyId: string, id: string, input: DeductionInput): Promise<DashResult<Deduction>>;
  deleteDeduction(companyId: string, id: string): Promise<DashResult<{ id: string }>>;
  toggleDeduction(companyId: string, id: string): Promise<DashResult<Deduction>>;
  listStaffEmails(companyId: string, q?: StaffEmailQuery): Promise<DashResult<{ page: Page<StaffEmail>; summary: StaffEmailSummary }>>;
  /** Poll while anything is "sending": new cards since `after` plus the watched ids. */
  staffEmailFeed(companyId: string, q: StaffEmailFeedQuery): Promise<DashResult<StaffEmailFeed>>;
  listRecipients(companyId: string): Promise<DashResult<EmailRecipient[]>>;
  /** 1 to 100 people. */
  sendStaffEmails(companyId: string, employeeIds: string[], recipientId: string): Promise<DashResult<SendStaffEmailsResult>>;
}

/**
 * Starting rows for the mock instead of its own made-up ones (used by the dev preview with `?data=s08`, see payroll.fixtures.ts).
 * Optional lists replace the option lists (designations, departments, ...) when given and not empty.
 */
export interface PayrollCoreSeed {
  companies: PayrollCompany[];
  employees: Employee[];
  statuses: AttendanceStatus[];
  deductions: Deduction[];
  months: MonthRecord[];
  options?: Partial<Pick<PayrollOptions, 'genders' | 'designations' | 'departments' | 'shifts' | 'paymentModes' | 'idProofTypes'>>;
}
