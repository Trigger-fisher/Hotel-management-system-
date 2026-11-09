// The in-memory mock of payrollCore.ts (dev and local-demo builds only): loaded through ui-shared/mocks (web-app/src/lib/api/mockLoader.ts), never by app code.
import type { MockClock, DashResult, Kpi } from './common';
import type { PayrollMockLink, GenerateRow, PayrollPaySeed, PayrollPayApi } from './payrollPay';
import { mockCall, mockError, ok, pageOf, LOOKUP_LIMIT_MAX } from './common';
import { formatMonth } from './format';
import { payrollPayEmployeeSeed, createPayrollPayApi } from './payrollPay.mock';
import { ATTENDANCE_PAGE_MAX, BANK_PAYMENT_MODE, PAYROLL_TODAY, STAFF_EMAIL_SEND_MAX, STAFF_EMAIL_WATCH_MAX, daysIn, emptyEmployeeInput, formatPhone, payrollCoreCopy, validateCompany, validateDeduction, validateEmployee, validateStatus, weekdayOf, type AttendanceLock, type AttendancePercentage, type AttendanceQuery, type AttendanceRow, type AttendanceSheet, type AttendanceStatus, type AttentionItem, type Deduction, type EmailRecipient, type Employee, type EmployeeDeductionAssignment, type EmployeeInput, type MonthRecord, type PaymentMode, type PayrollCompany, type PayrollCompanyRow, type PayrollCoreApi, type PayrollCoreSeed, type PhoneCountry, type RecentItem, type StaffEmail, type StaffEmailState, type StaffEmailSummary, type StatusType } from './payrollCore';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const companiesSeed: PayrollCompany[] = [
  {
    id: 'pc1', name: 'Hotel Sunrise Pvt Ltd', code: 'HSP', ownerName: 'Mahesh Jadeja', mobileNumber: '9824011000',
    email: 'accounts@hotelsunrise.in', address: '150 Feet Ring Road, Near Raiya Circle', city: 'Rajkot', state: 'Gujarat',
    pincode: '360007', panNumber: 'ABCDE1234F', tanNumber: 'RKTH01234A', pfRegistrationNumber: 'GJRAJ0012345000',
    esicRegistrationNumber: '37000123450001001', professionalTaxRegistrationNumber: 'PT/RJT/2019/04512',
    authorizedPersonName: 'Mahesh Jadeja', authorizedDesignation: 'Director', authorizedMobile: '9824011000',
    authorizedEmail: 'mahesh@hotelsunrise.in', bankName: 'State Bank of India', branchName: 'Kalawad Road, Rajkot',
    accountNumber: '30112345674321', ifscCode: 'SBIN0003456', isActive: true,
  },
  {
    id: 'pc2', name: 'Sunrise Foods LLP', code: 'SFL', ownerName: 'Kavita Jadeja', mobileNumber: '9825098765',
    email: 'foods@hotelsunrise.in', address: '150 Feet Ring Road, Near Raiya Circle', city: 'Rajkot', state: 'Gujarat',
    pincode: '360007', panNumber: 'AAKFS5678K', tanNumber: '', pfRegistrationNumber: 'GJRAJ0067890000',
    esicRegistrationNumber: '', professionalTaxRegistrationNumber: 'PT/RJT/2021/07788',
    authorizedPersonName: 'Kavita Jadeja', authorizedDesignation: 'Designated Partner', authorizedMobile: '9825098765',
    authorizedEmail: 'kavita@hotelsunrise.in', bankName: 'HDFC Bank', branchName: 'Yagnik Road, Rajkot',
    accountNumber: '50100123458890', ifscCode: 'HDFC0001234', isActive: true,
  },
];

const employeeBase: [string, string, string, string, number, string][] = [
  // id, name, designation, company, monthly salary (rupees), department
  ['e01', 'Ramesh Patel', 'Front Office Executive', 'pc1', 22000, 'Front Office'],
  ['e02', 'Sunita Sharma', 'Housekeeping Supervisor', 'pc1', 26500, 'Housekeeping'],
  ['e03', 'Imran Shaikh', 'Chef', 'pc2', 38000, 'Kitchen'],
  ['e04', 'Pooja Desai', 'Accountant', 'pc1', 32000, 'Accounts'],
  ['e05', 'Vikram Singh', 'Security', 'pc1', 15500, 'Security'],
  ['e06', 'Neha Joshi', 'Receptionist', 'pc1', 18000, 'Front Office'],
  ['e07', 'Kiran Parmar', 'Waiter', 'pc2', 14000, 'Restaurant'],
  ['e08', 'Manoj Yadav', 'Room Attendant', 'pc1', 13500, 'Housekeeping'],
  ['e09', 'Farhan Qureshi', 'Steward', 'pc2', 12500, 'Restaurant'],
  ['e10', 'Divya Nair', 'F&B Manager', 'pc2', 55000, 'Food & Beverage'],
  ['e11', 'Ajay Chauhan', 'Maintenance', 'pc1', 17000, 'Engineering'],
  ['e12', 'Meera Iyer', 'HR Executive', 'pc1', 28000, 'Human Resources'],
  ['e13', 'Bhavesh Rathod', 'Commis Chef', 'pc2', 16000, 'Kitchen'],
  ['e14', 'Jyoti Makwana', 'Laundry Attendant', 'pc1', 12500, 'Housekeeping'],
  ['e15', 'Hitesh Gohil', 'Night Auditor', 'pc1', 21000, 'Front Office'],
];

/** Joining date and mobile, the same as the pay half (payrollPay.ts empSeed), so Staff, Salary and Letters agree. */
const staffFacts: Record<string, [joining: string, mobile: string, hours: number]> = {
  e01: ['2023-04-10', '9825011223', 9], e02: ['2021-11-01', '9879344556', 9], e03: ['2022-06-15', '9909912345', 10], e04: ['2024-01-08', '9727767890', 8],
  e05: ['2025-03-20', '9099055443', 12], e06: ['2025-08-01', '9898022110', 9], e07: ['2024-09-12', '9327033221', 10], e08: ['2026-02-10', '8866077889', 9],
  e09: ['2025-06-05', '7016044332', 10], e10: ['2020-08-17', '9824490011', 9], e11: ['2022-03-03', '9601012121', 9], e12: ['2023-10-23', '9825130303', 8],
  e13: ['2026-07-15', '9714456781', 10], e14: ['2026-01-01', '9638021457', 9], e15: ['2026-11-01', '9974310862', 8],
};

const females = new Set(['e02', 'e04', 'e06', 'e10', 'e12', 'e14']);
const shifts = ['Morning (7:00 am - 3:00 pm)', 'Evening (3:00 pm - 11:00 pm)', 'Night (11:00 pm - 7:00 am)', 'General (10:00 am - 6:00 pm)'];

function buildEmployees(): Employee[] {
  const codeCounter: Record<string, number> = {};
  // Payment mode and bank details come from the pay half's seed, so Staff, Salary Update and Salary Payments show the same.
  const payFacts = new Map(payrollPayEmployeeSeed().map((p) => [p.id, p]));
  return employeeBase.map(([id, name, designation, companyId, rupees, department], n) => {
    const company = companiesSeed.find((c) => c.id === companyId);
    codeCounter[companyId] = (codeCounter[companyId] ?? 0) + 1;
    const first = name.split(' ')[0]?.toLowerCase() ?? 'staff';
    const pay = payFacts.get(id);
    const mode: PaymentMode = pay?.paymentMode ?? 'Cash';
    const isBank = mode === BANK_PAYMENT_MODE;
    const contactNumber = staffFacts[id]?.[1] ?? `98${String(25010000 + n * 13579).slice(0, 8)}`;
    const emergencyNumber = n === 11 ? '' : `97${String(24020000 + n * 24681).slice(0, 8)}`;
    return {
      id, companyId, name, contactCountry: '91', emergencyContactCountry: '91',
      canEdit: true, canDelete: true,
      createdAt: `${2018 + (n % 8)}-01-01T04:30:00Z`,
      display: { contact: formatPhone('91', contactNumber), emergency: formatPhone('91', emergencyNumber) },
      dateOfBirth: `${1984 + (n * 3) % 17}-${String((n % 12) + 1).padStart(2, '0')}-${String(((n * 7) % 27) + 1).padStart(2, '0')}`,
      gender: females.has(id) ? 'Female' : 'Male',
      contactNumber,
      email: n === 8 ? '' : `${first}.${id}@hotelsunrise.in`,
      address: `${12 + n * 7}, ${['Kalawad Road', 'Gondal Road', 'University Road', 'Mavdi Main Road', 'Amin Marg', '150 Feet Ring Road'][n % 6]}, Rajkot`,
      nationality: 'Indian',
      countryAndPincode: `India - 36000${(n % 9) + 1}`,
      emergencyContactName: n === 11 ? '' : `${['Suresh', 'Anita', 'Salim', 'Rakesh', 'Harpreet', 'Ravi', 'Jayesh', 'Sita', 'Ayesha', 'Prakash', 'Bhavna', 'Lakshmi', 'Kanji', 'Dinesh', 'Rekha'][n] ?? 'Ramesh'} ${name.split(' ')[1] ?? ''}`.trim(),
      emergencyContactRelation: n === 11 ? '' : ['Father', 'Husband', 'Brother', 'Father', 'Wife', 'Husband', 'Father', 'Wife', 'Wife', 'Husband', 'Wife', 'Mother', 'Father', 'Husband', 'Wife'][n] ?? 'Father',
      emergencyContactNumber: emergencyNumber,
      employeeCode: `${company?.code ?? 'EMP'}-${String(codeCounter[companyId]).padStart(3, '0')}`,
      designation, department,
      shift: designation === 'Security' || designation === 'Night Auditor' ? shifts[2] ?? '' : designation === 'Accountant' || designation === 'HR Executive' ? shifts[3] ?? '' : shifts[n % 2] ?? '',
      joiningDate: staffFacts[id]?.[0] ?? `${2018 + (n % 8)}-${String(((n * 5) % 12) + 1).padStart(2, '0')}-${String(((n * 3) % 27) + 1).padStart(2, '0')}`,
      dailyWorkingHours: staffFacts[id]?.[2] ?? (designation === 'Security' ? 12 : 8),
      qualification: ['B.Com', 'Diploma in Hotel Management', 'Diploma in Culinary Arts', 'M.Com', 'HSC', 'BA', 'SSC', 'SSC', 'HSC', 'MBA (Hospitality)', 'ITI (Electrician)', 'MBA (HR)', 'Diploma in Food Production', 'SSC', 'B.Com'][n] ?? '',
      qualificationInstitution: n % 4 === 0 ? 'Saurashtra University, Rajkot' : n % 4 === 1 ? 'IHM Ahmedabad' : '',
      skills: ['Opera PMS, guest handling', 'Team rostering, linen control', 'Gujarati and Mughlai cuisine', 'Tally, GST returns', 'CCTV, fire safety', 'Telephone, Hindi/English/Gujarati', 'Table service', 'Room cleaning', 'Dish washing', 'Menu costing, team leading', 'Electrical, plumbing', 'Recruitment, payroll', 'Tandoor, prep and mise en place', 'Washing, ironing, linen count', 'Night audit, Opera PMS, cash tally'][n] ?? '',
      responsibilities: n === 9 ? 'Runs the restaurant, banquet and room service: menus, costing, vendor orders, staff rosters and the monthly food cost report for the management.' : '',
      salaryPaise: rupees * 100,
      paymentMode: mode,
      bankName: isBank ? pay?.bankName ?? '' : '',
      accountHolderName: isBank ? pay?.accountHolderName || name : '',
      accountNumber: isBank ? pay?.accountNumber ?? null : null,
      ifscCode: isBank ? pay?.ifscCode ?? '' : '',
      branchName: isBank ? pay?.branchName ?? '' : '',
      deductions: [],
      idProofType: n === 8 ? '' : n % 2 ? 'Aadhaar Card' : 'PAN Card',
      idProofNumber: n === 8 ? null : n % 2 ? String(234100000000 + n * 611) : `ABCDE${String(1000 + n * 97)}K`,
      resumeFileName: n % 3 === 0 ? `${first}-resume.pdf` : null,
      isActive: id !== 'e11',
    };
  });
}

function buildStatuses(): AttendanceStatus[] {
  const rows: [string, string, string, AttendancePercentage, StatusType, boolean, boolean][] = [
    ['Present', 'P', '#22C55E', 100, 'Paid', false, true],
    ['Absent', 'A', '#EF4444', 0, 'Unpaid', true, true],
    ['Half Day', 'HD', '#F59E0B', 50, 'Paid', false, true],
    ['Week Off', 'WO', '#3B82F6', 100, 'Paid', true, true],
    ['Paid Leave', 'PL', '#6B7080', 100, 'Paid', true, true],
    ['Quarter Day', 'QD', '#14B8A6', 25, 'Paid', false, true],
    ['Sick Leave', 'SL', '#EC4899', 100, 'Paid', true, true],
    ['Three Quarter Day', 'TQ', '#64748B', 75, 'Paid', false, false],
  ];
  const out: AttendanceStatus[] = [];
  for (const companyId of ['pc1', 'pc2']) {
    rows.forEach(([name, key, colour, pct, type, skips, active], n) => {
      if (companyId === 'pc2' && n >= 6) return;
      out.push({ id: `${companyId}-as${n + 1}`, companyId, name, shortcutKey: key, color: colour, attendancePercentage: pct, statusType: type, skipsFood: skips, isActive: active, usedCount: 0 });
    });
  }
  return out;
}

function buildDeductions(): Deduction[] {
  const rows: [string, string, number, boolean][] = [
    ['pc1', 'Provident Fund (employee share)', 180000, true],
    ['pc1', 'Professional Tax', 20000, true],
    ['pc1', 'ESIC (employee share)', 0, true],
    ['pc1', 'Uniform recovery', 50000, true],
    ['pc1', 'Loan EMI', 250000, true],
    ['pc1', 'Staff hostel rent', 120000, false],
    ['pc1', 'Damage and breakage recovery (room linen, glassware and crockery)', 35000, true],
    ['pc1', 'Mobile phone recovery', 99900, true],
    ['pc2', 'Provident Fund (employee share)', 180000, true],
    ['pc2', 'Professional Tax', 20000, true],
    ['pc2', 'Kitchen uniform recovery', 40000, true],
  ];
  return rows.map(([companyId, name, amt, active], n) => ({ id: `d${String(n + 1).padStart(2, '0')}`, companyId, name, standardAmountPaise: amt, isActive: active, assignedCount: 0 }));
}

function assignDeductions(emps: Employee[]): void {
  const plan: Record<string, EmployeeDeductionAssignment[]> = {
    e01: [{ deductionId: 'd01', type: 'Monthly', amountPaise: 180000 }, { deductionId: 'd02', type: 'Monthly', amountPaise: 20000 }],
    e02: [{ deductionId: 'd01', type: 'Monthly', amountPaise: 180000 }, { deductionId: 'd05', type: 'Monthly', amountPaise: 250000 }],
    e04: [{ deductionId: 'd01', type: 'Monthly', amountPaise: 180000 }, { deductionId: 'd02', type: 'Monthly', amountPaise: 20000 }],
    e05: [{ deductionId: 'd04', type: 'One Time', amountPaise: 50000 }],
    e08: [{ deductionId: 'd07', type: 'One Time', amountPaise: 35000 }],
    e03: [{ deductionId: 'd09', type: 'Monthly', amountPaise: 180000 }],
    e10: [{ deductionId: 'd09', type: 'Monthly', amountPaise: 180000 }, { deductionId: 'd10', type: 'Monthly', amountPaise: 20000 }],
    e07: [{ deductionId: 'd11', type: 'One Time', amountPaise: 40000 }],
    e13: [{ deductionId: 'd10', type: 'Monthly', amountPaise: 20000 }, { deductionId: 'd11', type: 'One Time', amountPaise: 40000 }],
    e15: [{ deductionId: 'd02', type: 'Monthly', amountPaise: 20000 }, { deductionId: 'd04', type: 'One Time', amountPaise: 50000 }],
  };
  for (const e of emps) e.deductions = plan[e.id] ?? [];
}

/** Deterministic pseudo-random 0..1 from a string. */
function rand(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

function buildMonths(emps: Employee[]): MonthRecord[] {
  const out: MonthRecord[] = [];
  const plan: { month: string; upTo: number; lock: AttendanceLock; generatedAt: string | null }[] = [
    { month: '2026-09', upTo: 30, lock: 'locked', generatedAt: '2026-10-01T06:10:00Z' },
    { month: '2026-10', upTo: 31, lock: 'locked', generatedAt: '2026-11-01T05:45:00Z' },
    { month: '2026-11', upTo: 5, lock: 'editable', generatedAt: null },
  ];
  for (const companyId of ['pc1', 'pc2']) {
    for (const p of plan) {
      const entries = new Map<string, { days: (string | null)[]; overtime: number[] }>();
      const total = daysIn(p.month);
      // Ajay Chauhan (e11) was relieved on 30 Sep 2026 (payrollPay separation sep3): no attendance after that month.
      const lastMonth: Record<string, string> = { e11: '2026-09' };
      for (const e of emps.filter((x) => x.companyId === companyId && (x.isActive || p.month !== '2026-11') && x.joiningDate <= `${p.month}-31` && !(lastMonth[x.id] && p.month > (lastMonth[x.id] ?? '')))) {
        const days: (string | null)[] = [];
        for (let d = 1; d <= total; d += 1) {
          if (d > p.upTo) { days.push(null); continue; }
          // In the running month one employee has not been marked for today yet.
          if (p.month === '2026-11' && d === 5 && (e.id === 'e06' || e.id === 'e09')) { days.push(null); continue; }
          const r = rand(`${e.id}${p.month}${d}`);
          let n = 1; // Present
          if (weekdayOf(p.month, d) === 0) n = 4; // Week Off
          else if (r < 0.05) n = 2; // Absent
          else if (r < 0.1) n = 3; // Half Day
          else if (r < 0.12) n = 5; // Paid Leave
          else if (r < 0.13 && companyId === 'pc1') n = 7; // Sick Leave
          days.push(`${companyId}-as${n}`);
        }
        const overtime = days.map((s, i) => (s && rand(`${e.id}${p.month}ot${i}`) < 0.12 ? (e.designation === 'Security' ? 2 : 1) : 0));
        entries.set(e.id, { days, overtime });
      }
      out.push({ companyId, month: p.month, lock: p.lock, salaryGeneratedAt: p.generatedAt, entries });
    }
  }
  return out;
}

const recipientsSeed: EmailRecipient[] = [
  { id: 'r1', name: 'Accounts, Hotel Sunrise', email: 'accounts@hotelsunrise.in' },
  { id: 'r2', name: 'Mehta & Associates (CA)', email: 'office@mehtaassociates.in' },
  { id: 'r3', name: 'HR Head', email: 'hr@hotelsunrise.in' },
];

function buildEmails(emps: Employee[]): StaffEmail[] {
  const plan: [string, string, StaffEmailState, string, string | null][] = [
    ['e01', 'r1', 'sent', '2026-11-05T04:12:00Z', null],
    ['e06', 'r3', 'sent', '2026-11-05T04:10:00Z', null],
    ['e12', 'r2', 'failed', '2026-11-04T11:40:00Z', 'Mailbox unavailable: office@mehtaassociates.in is over its storage limit.'],
    ['e04', 'r2', 'sent', '2026-11-04T11:38:00Z', null],
    ['e02', 'r1', 'stalled', '2026-11-03T09:05:00Z', null],
    ['e08', 'r3', 'sent', '2026-10-30T07:22:00Z', null],
    ['e05', 'r1', 'sent', '2026-10-28T12:01:00Z', null],
    ['e03', 'r1', 'sent', '2026-11-02T06:30:00Z', null],
    ['e10', 'r2', 'sent', '2026-11-02T06:31:00Z', null],
    ['e07', 'r3', 'failed', '2026-10-29T10:15:00Z', 'Connection to the mail server timed out.'],
    ['e09', 'r3', 'sent', '2026-10-20T08:45:00Z', null],
  ];
  const senders = ['Meera Iyer', 'Pooja Desai', 'Mahesh Jadeja'];
  return plan.map(([eid, rid, state, at, error], n) => {
    const e = emps.find((x) => x.id === eid);
    const r = recipientsSeed.find((x) => x.id === rid);
    const ms = state === 'sent' ? 900 + n * 310 : state === 'failed' ? 30000 : null;
    return {
      id: `se${String(n + 1).padStart(2, '0')}`,
      companyId: e?.companyId ?? 'pc1',
      employeeId: eid,
      employeeName: e?.name ?? 'Removed employee',
      employeeCode: e?.employeeCode ?? '',
      designation: e?.designation ?? '',
      recipientName: r?.name ?? null,
      recipientEmail: r?.email ?? '',
      subject: `Staff details: ${e?.name ?? ''} (${e?.employeeCode ?? ''})`,
      message: `Please find the staff details of ${e?.name ?? 'the employee'} attached.`,
      state,
      error,
      sentBy: senders[n % 3] ?? 'Hotel Admin',
      createdAt: at,
      finishedAt: ms === null ? null : new Date(new Date(at).getTime() + ms).toISOString(),
      durationMs: ms,
      attachmentKb: state === 'sent' ? 180 + n * 7 : null,
    };
  });
}

/** Same seed in the mock's phone list (the server sends the full list). */
const phoneCountriesSeed: PhoneCountry[] = [
  { iso: 'IN', name: 'India', dial: '91', min: 10, max: 10, lead: '[6-9]', sample: '98765 43210', pattern: '^[6-9]\\d{9}$', message: 'Enter a 10-digit mobile number.' },
  { iso: 'AE', name: 'United Arab Emirates', dial: '971', min: 9, max: 9, lead: '5', sample: '50 123 4567', pattern: '^5\\d{8}$', message: 'Enter a 9-digit UAE mobile number starting with 5.' },
  { iso: 'NP', name: 'Nepal', dial: '977', min: 10, max: 10, lead: '9', sample: '984 1234567', pattern: '^9\\d{9}$', message: 'Enter a 10-digit Nepal mobile number starting with 9.' },
];

/**
 * Both payroll mocks over ONE set of data: the pay mock reads and writes this mock's staff records, salary is generated
 * from this mock's attendance into the pay mock's salary records, and the dashboard and the staff form's lists read the pay side
 * (Salary Payments, Advances, Resignations, Payroll Master). Use one pair per browser session.
 */
export function createPayrollMocks(clock: MockClock = {}, seeds?: { core: PayrollCoreSeed; pay: PayrollPaySeed }): { core: PayrollCoreApi; pay: PayrollPayApi } {
  const link: PayrollMockLink = {};
  const pay = createPayrollPayApi(clock, seeds?.pay, link);
  const core = createPayrollCoreApi(clock, seeds?.core, link);
  return { core, pay };
}

export function createPayrollCoreApi(clock: MockClock = {}, seed?: PayrollCoreSeed, link?: PayrollMockLink): PayrollCoreApi {
  const companies = (seed ? seed.companies : companiesSeed).map((c) => ({ ...c }));
  const employees = seed ? seed.employees.map((e) => ({ ...e, deductions: e.deductions.map((d) => ({ ...d })), display: { ...e.display } })) : buildEmployees();
  if (!seed) assignDeductions(employees);
  /** The pay side when the two mocks are linked (createPayrollMocks); undefined for a core mock on its own. */
  const pay = link?.pay;
  pay?.useEmployees(() => employees);
  const binned: Employee[] = [];
  const statuses = seed ? seed.statuses.map((x) => ({ ...x })) : buildStatuses();
  const deductions = seed ? seed.deductions.map((x) => ({ ...x })) : buildDeductions();
  const months = seed
    ? seed.months.map((m) => ({ ...m, entries: new Map([...m.entries].map(([k, v]) => [k, { days: [...v.days], overtime: [...v.overtime] }])) }))
    : buildMonths(employees);
  const emails = seed ? [] : buildEmails(employees);
  const demo = !seed;
  let seq = 100;
  const nextId = (p: string) => `${p}${++seq}`;
  const call = <T>(fn: () => DashResult<T>) => mockCall(fn, clock);
  const selectFirst = () => mockError('NOT_FOUND', { company: 'Select a company first.' }, { message: 'Select a company first.' });
  /** 409 with Pallav's sentence in error.message (the server's shape); fields.reason kept for older screens. */
  const refuse = (s: string) => mockError('CONFLICT', { reason: s }, { message: s });

  const companyRow = (c: PayrollCompany): PayrollCompanyRow => {
    const staff = employees.filter((e) => e.companyId === c.id);
    return { ...c, staffCount: staff.length, activeStaffCount: staff.filter((e) => e.isActive).length };
  };

  const statusWithUse = (s: AttendanceStatus): AttendanceStatus => {
    let used = 0;
    for (const m of months) {
      if (m.companyId !== s.companyId) continue;
      for (const en of m.entries.values()) used += en.days.filter((d) => d === s.id).length;
    }
    return { ...s, usedCount: used };
  };

  const deductionWithUse = (d: Deduction): Deduction => ({
    ...d,
    assignedCount: employees.filter((e) => e.deductions.some((x) => x.deductionId === d.id)).length,
  });

  const getMonth = (companyId: string, month: string): MonthRecord => {
    let m = months.find((x) => x.companyId === companyId && x.month === month);
    if (!m) {
      m = { companyId, month, lock: 'editable', salaryGeneratedAt: null, entries: new Map() };
      months.push(m);
    }
    return m;
  };

  const sheet = (companyId: string, month: string, q: AttendanceQuery = {}): AttendanceSheet => {
    const m = getMonth(companyId, month);
    const total = daysIn(month);
    const today = PAYROLL_TODAY.slice(0, 7);
    const monthOver = month < today;
    const daysElapsed = month < today ? total : month === today ? Number(PAYROLL_TODAY.slice(8)) : 0;
    const companyStatuses = statuses.filter((s) => s.companyId === companyId);
    const keyOf = new Map(companyStatuses.map((s) => [s.id, s.shortcutKey]));
    // Only staff who had joined by the month's last day (an October sheet does not list someone who joins in November).
    const monthEnd = `${month}-${String(total).padStart(2, '0')}`;
    const staff = employees
      .filter((e) => e.companyId === companyId && (m.entries.has(e.id) || (e.isActive && e.joiningDate <= monthEnd)))
      .sort((a, b) => a.name.localeCompare(b.name));
    const all: AttendanceRow[] = staff.map((e) => {
      const en = m.entries.get(e.id);
      const days = Array.from({ length: total }, (_, i) => en?.days[i] ?? null);
      const overtime = Array.from({ length: total }, (_, i) => en?.overtime[i] ?? 0);
      return {
        employeeId: e.id, employeeName: e.name, employeeCode: e.employeeCode, designation: e.designation,
        days, keys: days.map((d) => (d ? keyOf.get(d) ?? null : null)), overtime, overtimeHours: overtime.reduce((s, h) => s + h, 0),
      };
    });
    let filled = 0;
    for (const r of all) filled += r.days.slice(0, daysElapsed).filter(Boolean).length;
    const pageSize = Math.min(ATTENDANCE_PAGE_MAX, Math.max(1, q.pageSize ?? ATTENDANCE_PAGE_MAX));
    const page = Math.max(1, q.page ?? 1);
    return {
      companyId, month, daysInMonth: total, daysElapsed, monthOver, lock: m.lock, salaryGeneratedAt: m.salaryGeneratedAt,
      statuses: companyStatuses.map(statusWithUse),
      rows: all.slice((page - 1) * pageSize, page * pageSize),
      page: { total: all.length, page, pageSize },
      progress: { filled, expected: all.length * daysElapsed, required: all.length * total },
      incomplete: all.filter((r) => r.days.some((d) => d === null)).map((r) => r.employeeName),
    };
  };

  const companyOf = (id: string) => companies.find((c) => c.id === id && c.isActive);
  const employeeOf = (companyId: string, id: string) => employees.find((x) => x.id === id && x.companyId === companyId);
  const statusOf = (companyId: string, id: string) => statuses.find((x) => x.id === id && x.companyId === companyId);
  const deductionOf = (companyId: string, id: string) => deductions.find((x) => x.id === id && x.companyId === companyId);
  const copyEmployee = (e: Employee): Employee => ({ ...e, deductions: e.deductions.map((d) => ({ ...d })), display: { ...e.display } });
  /** The list leaves out the full emergency number and IFSC (getEmployee has them). */
  const listForm = (e: Employee): Employee => ({ ...copyEmployee(e), emergencyContactNumber: '', ifscCode: '' });
  /** Plain value: absent = keep, empty = none. */
  const plainOr = (v: string | undefined, keep: string | null): string | null => {
    if (v === undefined) return keep;
    const t = v.trim();
    return t || null;
  };

  const checkEmployee = (companyId: string, input: EmployeeInput, self: Employee | null): Record<string, string> => {
    const errs = validateEmployee(input, self);
    const code = input.employeeCode.trim().toLowerCase();
    if (code && employees.some((e) => e.id !== self?.id && e.companyId === companyId && e.employeeCode.toLowerCase() === code)) {
      errs.employeeCode = 'This employee ID is already used.';
    }
    const mail = input.email.trim().toLowerCase();
    if (mail && employees.some((e) => e.id !== self?.id && e.email.toLowerCase() === mail)) errs.email = 'This email belongs to another employee.';
    return errs;
  };

  /** Apply the form to a record (plain numbers: absent = keep, "" = remove). */
  const applyInput = (e: Employee, input: EmployeeInput): void => {
    const { accountNumber, idProofNumber, sendOfferLetter: _s, deductions: rows, ...plain } = input;
    void _s;
    Object.assign(e, plain);
    e.accountNumber = plainOr(accountNumber, e.accountNumber);
    e.idProofNumber = plainOr(idProofNumber, e.idProofNumber);
    e.deductions = rows.map((d) => ({ ...d, id: d.id ?? nextId('ed') }));
    e.display = { contact: formatPhone(e.contactCountry, e.contactNumber), emergency: formatPhone(e.emergencyContactCountry, e.emergencyContactNumber) };
  };

  /** Mock outbox: a "sending" card becomes sent after 2 seconds. */
  const settleEmails = () => {
    const now = Date.now();
    for (const m of emails) {
      if (m.state === 'sending' && now - new Date(m.createdAt).getTime() > 2000) {
        m.state = 'sent';
        m.finishedAt = new Date().toISOString();
        m.durationMs = now - new Date(m.createdAt).getTime();
        m.attachmentKb = 190;
      }
    }
  };
  const summaryOf = (mine: StaffEmail[]): StaffEmailSummary => ({
    total: mine.length,
    sent: mine.filter((e) => e.state === 'sent').length,
    failed: mine.filter((e) => e.state === 'failed' || e.state === 'stalled').length,
    today: mine.filter((e) => e.createdAt.slice(0, 10) === PAYROLL_TODAY).length,
  });

  const letterFor = (e: Employee): { sent: boolean; message: string } =>
    e.email ? { sent: true, message: `The offer letter was emailed to ${e.email}.` } : { sent: false, message: payrollCoreCopy.staff.noEmail };

  /**
   * Linked: the month's salary records (Salary Payments, Slips, Reports) are built from this attendance, the staff's current
   * salary and assigned deductions, the month's bonus / incentive and open advances. Everyone on the month's sheet is processed.
   */
  const makeSalary = (companyId: string, month: string): void => {
    if (!pay) return;
    const m = getMonth(companyId, month);
    const total = daysIn(month);
    const statusById = new Map(statuses.filter((x) => x.companyId === companyId).map((x) => [x.id, x]));
    const all = sheet(companyId, month, { pageSize: ATTENDANCE_PAGE_MAX });
    const ids = new Set(all.rows.map((r) => r.employeeId));
    // The sheet pages at 100 people; take the rest of the month's people too.
    for (const e of employees) if (e.companyId === companyId && m.entries.has(e.id)) ids.add(e.id);
    const rows: GenerateRow[] = [...ids].map((id) => {
      const e = employeeOf(companyId, id);
      const en = m.entries.get(id);
      return {
        employeeId: id,
        percents: Array.from({ length: total }, (_, i) => {
          const st = statusById.get(en?.days[i] ?? '');
          if (!st) return null;
          return st.statusType === 'Unpaid' ? 0 : st.attendancePercentage;
        }),
        overtime: Array.from({ length: total }, (_, i) => en?.overtime[i] ?? 0),
        deductions: (e?.deductions ?? []).map((d) => ({
          key: `${id}:${d.deductionId}:${d.type}`,
          label: deductions.find((x) => x.id === d.deductionId)?.name ?? 'Deduction',
          type: d.type,
          paise: d.amountPaise,
        })),
      };
    });
    pay.generate(companyId, month, rows);
  };

  return {
    listCompanies: () => call(() => ok(companies.map(companyRow))),

    getCompany: (companyId) => call(() => {
      const c = companyOf(companyId);
      return c ? ok(companyRow(c)) : selectFirst();
    }),

    updateCompany: (companyId, input) => call(() => {
      const c = companyOf(companyId);
      if (!c) return selectFirst();
      const errs = validateCompany(input);
      if (Object.keys(errs).length) return mockError('VALIDATION_FAILED', errs);
      const { name: _n, code: _c, isActive: _a, accountNumber, ...details } = input;
      void [_n, _c, _a];
      Object.assign(c, details);
      c.accountNumber = plainOr(accountNumber, c.accountNumber);
      return ok(companyRow(c));
    }),

    getDashboard: (companyId) => call(() => {
      const c = companyOf(companyId);
      if (!c) return selectFirst();
      const staff = employees.filter((e) => e.companyId === companyId);
      const active = staff.filter((e) => e.isActive);
      const sh = sheet(companyId, PAYROLL_TODAY.slice(0, 7));
      const { filled, expected } = sh.progress;
      const percent = expected ? Math.min(100, Math.round((filled / expected) * 100)) : 0;
      // Salary figures belong to the pay half: linked, they are Salary Payments' and Advances' own figures.
      const ov = pay?.overview(companyId);
      const net = ov ? ov.netPaise : active.reduce((sum, e) => sum + e.salaryPaise, 0);
      const paid = ov ? ov.paidPaise : demo && companyId === 'pc1' ? Math.round(net * 0.72) : net;
      const due = ov ? ov.outstandingPaise : Math.max(0, net - paid);
      const advanceOut = ov ? ov.advanceOutPaise : !demo ? 0 : companyId === 'pc1' ? 3250000 : 950000;
      const payMonth = ov ? ov.period : '2026-10';
      const payMonthLabel = payMonth ? formatMonth(payMonth) : '';
      const attention: AttentionItem[] = [];
      if (!statuses.some((s) => s.companyId === companyId && s.isActive)) {
        attention.push({ id: 'a1', tone: 'danger', icon: 'tag', text: 'No attendance statuses yet. Attendance cannot be recorded until there is at least one.', action: 'Set them up', viewId: 'hotel.payroll.attendanceStatuses' });
      }
      if (!active.length) attention.push({ id: 'a2', tone: 'danger', icon: 'users', text: 'No staff on the payroll yet.', action: 'Add someone', viewId: 'hotel.payroll.staff' });
      if (!deductions.some((d) => d.companyId === companyId)) attention.push({ id: 'a3', tone: 'warning', icon: 'minus', text: 'No deductions are set up, so none can be assigned to staff.', action: 'Set up', viewId: 'hotel.payroll.deductions' });
      if (ov ? ov.openPayments > 0 : paid < net) {
        const open = ov ? ov.openPayments : Math.max(1, Math.round(active.length * 0.28));
        attention.push({ id: 'a4', tone: 'warning', icon: 'wallet', text: `${open} salary ${open === 1 ? 'payment is' : 'payments are'} still open for ${payMonthLabel}.`, action: 'Settle them', viewId: 'hotel.payroll.salaryPayments' });
      }
      if (filled < expected) {
        const missing = expected - filled;
        attention.push({ id: 'a5', tone: 'info', icon: 'calendar', text: `${missing} attendance ${missing === 1 ? 'day is' : 'days are'} not marked yet this month.`, action: 'Fill in', viewId: 'hotel.payroll.attendance' });
      }
      // Notice period, recent activity and advances match the pay half's seed (payrollPay.ts advances, bonus, separations).
      if (ov ? ov.inNotice > 0 : demo) {
        const n = ov ? ov.inNotice : 1;
        attention.push({ id: 'a6', tone: 'info', icon: 'logout', text: `${n} ${n === 1 ? 'person is' : 'people are'} working their notice period.`, action: 'Open', viewId: 'hotel.payroll.resignations' });
      }
      // Linked: the latest entries of the Payroll log (the same rows the Log screen lists).
      const iconOf: Record<string, string> = { Advance: 'arrowUp', 'Bonus / incentive': 'gift', 'Salary slip': 'file', Resignation: 'logout' };
      const recent: RecentItem[] = ov
        ? ov.recent.map((l) => ({ id: l.id, at: l.at, icon: iconOf[l.entity] ?? 'activity', title: l.subject, detail: l.summary }))
        : !demo ? [] : companyId === 'pc1'
        ? [
            { id: 'r1', at: '2026-11-03T09:30:00Z', icon: 'arrowUp', title: 'Hitesh Gohil', detail: 'Advance of ₹5,000.00' },
            { id: 'r2', at: '2026-11-02T08:45:00Z', icon: 'arrowUp', title: 'Sunita Sharma', detail: 'Advance of ₹6,000.00' },
            { id: 'r3', at: '2026-11-01T06:00:00Z', icon: 'gift', title: 'Meera Iyer', detail: 'Bonus of ₹2,500.00' },
            { id: 'r4', at: '2026-11-01T05:45:00Z', icon: 'file', title: 'Salary generated', detail: 'Oct 2026, 8 staff' },
            { id: 'r5', at: '2026-10-28T07:00:00Z', icon: 'logout', title: 'Neha Joshi', detail: 'Resigned, last day 27 Nov 2026' },
          ]
        : [
            { id: 'r6', at: '2026-11-05T08:15:00Z', icon: 'arrowUp', title: 'Imran Shaikh', detail: 'Advance of ₹2,500.00' },
            { id: 'r7', at: '2026-11-04T07:30:00Z', icon: 'gift', title: 'Farhan Qureshi', detail: 'Bonus of ₹1,000.00' },
            { id: 'r8', at: '2026-11-01T05:45:00Z', icon: 'file', title: 'Salary generated', detail: 'Oct 2026, 5 staff' },
          ];
      const kpis: Kpi[] = [
        { id: 'staff', label: 'Active staff', value: active.length, kind: 'count', trend: null, tone: 'graphite', icon: 'users' },
        { id: 'attendance', label: 'Attendance filled', value: percent, kind: 'percent', trend: null, tone: percent === 100 ? 'success' : 'info', icon: 'calendar' },
        { id: 'due', label: payMonthLabel ? `Salary due, ${payMonthLabel}` : 'Salary due', value: due, kind: 'money', trend: null, tone: due > 0 ? 'warning' : 'success', icon: 'wallet' },
        { id: 'advances', label: 'Advances out', value: advanceOut, kind: 'money', trend: null, tone: 'danger', icon: 'arrowUp' },
      ];
      return ok({
        company: { ...c }, kpis,
        attendance: { filled, expected, percent, locked: sh.lock === 'locked' },
        payrollMonth: payMonth, netPaise: net, paidPaise: paid, attention, recent,
      });
    }),

    getOptions: (companyId) => call(() => {
      if (!companyOf(companyId)) return selectFirst();
      // Linked: Payroll Master's lists (an edit on the Master screen shows in the staff form at once).
      const o = pay
        ? {
            genders: pay.choices(companyId, 'gender'), designations: pay.choices(companyId, 'designations'), departments: pay.choices(companyId, 'departments'),
            paymentModes: pay.choices(companyId, 'salary_payment_mode'), idProofTypes: pay.choices(companyId, 'id_proofs'), shifts: seed?.options?.shifts,
          }
        : seed?.options ?? {};
      const pick = (v: string[] | undefined, d: string[]) => (v && v.length ? [...v] : d);
      const designations = pick(o.designations, Array.from(new Set([...employeeBase.map((b) => b[2]), 'Bell Captain', 'Night Auditor', 'Commis Chef'])).sort());
      return ok({
        genders: pick(o.genders, ['Male', 'Female', 'Other']),
        designations,
        departments: pick(o.departments, ['Accounts', 'Engineering', 'Food & Beverage', 'Front Office', 'Housekeeping', 'Human Resources', 'Kitchen', 'Restaurant', 'Security']),
        shifts: pick(o.shifts, [...shifts]),
        paymentModes: pick(o.paymentModes, ['Cash', BANK_PAYMENT_MODE]),
        idProofTypes: pick(o.idProofTypes, ['Aadhaar Card', 'PAN Card', 'Passport', 'Driving Licence', 'Voter ID']),
        deductions: deductions.filter((d) => d.companyId === companyId && d.isActive).map(deductionWithUse),
        phoneCountries: phoneCountriesSeed.map((p) => ({ ...p })),
        hasJoiningTemplate: true,
      });
    }),

    listEmployees: (companyId, q = {}) => call(() => {
      if (!companyOf(companyId)) return selectFirst();
      const tab = q.tab ?? 'all';
      const pool = q.deleted ? binned : employees;
      const rows = pool
        .filter((e) => e.companyId === companyId)
        .filter((e) => q.deleted || tab === 'all' || (tab === 'active' ? e.isActive : !e.isActive))
        .sort((a, b) => a.employeeCode.localeCompare(b.employeeCode))
        .map(listForm);
      return ok(pageOf(rows, q, (e, s) =>
        `${e.name} ${e.employeeCode} ${e.contactNumber} ${e.email} ${e.designation} ${e.department}`.toLowerCase().includes(s)));
    }),

    lookupEmployees: (companyId, q = {}) => call(() => {
      if (!companyOf(companyId)) return selectFirst();
      const s = (q.q ?? '').trim().toLowerCase();
      const limit = Math.min(LOOKUP_LIMIT_MAX, Math.max(1, q.limit ?? LOOKUP_LIMIT_MAX));
      return ok(employees
        .filter((e) => e.companyId === companyId && e.isActive && (!s || e.name.toLowerCase().includes(s) || e.employeeCode.toLowerCase().includes(s)))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, limit)
        .map((e) => ({ id: e.id, label: e.name, hint: e.employeeCode })));
    }),

    getEmployee: (companyId, id) => call(() => {
      const e = employeeOf(companyId, id);
      return e ? ok(copyEmployee(e)) : mockError('NOT_FOUND');
    }),

    createEmployee: (companyId, input) => call(() => {
      if (!companyOf(companyId)) return selectFirst();
      const errs = checkEmployee(companyId, input, null);
      if (Object.keys(errs).length) return mockError('VALIDATION_FAILED', errs);
      const { accountNumber: _an, idProofNumber: _ip, sendOfferLetter: _so, ...blank } = emptyEmployeeInput();
      void [_an, _ip, _so];
      const e: Employee = {
        ...blank, id: nextId('e'), companyId, accountNumber: null, idProofNumber: null, resumeFileName: null,
        isActive: true, canEdit: true, canDelete: true, createdAt: new Date().toISOString(), display: { contact: '', emergency: '' },
      } as Employee;
      applyInput(e, input);
      employees.push(e);
      pay?.syncEmployees();
      return ok({ employee: copyEmployee(e), letter: input.sendOfferLetter ? letterFor(e) : null });
    }),

    updateEmployee: (companyId, id, input) => call(() => {
      const e = employeeOf(companyId, id);
      if (!e) return mockError('NOT_FOUND');
      const errs = checkEmployee(companyId, input, e);
      if (Object.keys(errs).length) return mockError('VALIDATION_FAILED', errs);
      applyInput(e, input);
      return ok(copyEmployee(e));
    }),

    deleteEmployee: (companyId, id) => call(() => {
      const n = employees.findIndex((x) => x.id === id && x.companyId === companyId);
      const e = employees[n];
      if (!e) return mockError('NOT_FOUND');
      const used = months.some((m) => m.entries.get(id)?.days.some(Boolean));
      if (used) return refuse('This employee is already used in Attendance and cannot be deleted. Mark them Inactive instead.');
      if (pay?.isUsed(id)) return refuse('This employee already has salary, advance, bonus, meals or exit records and cannot be deleted. Mark them Inactive instead.');
      employees.splice(n, 1);
      binned.push(e);
      pay?.syncEmployees();
      return ok({ id });
    }),

    restoreEmployee: (companyId, id) => call(() => {
      const n = binned.findIndex((x) => x.id === id && x.companyId === companyId);
      const e = binned[n];
      if (!e) return mockError('NOT_FOUND');
      binned.splice(n, 1);
      employees.push(e);
      pay?.syncEmployees();
      return ok(copyEmployee(e));
    }),

    purgeEmployee: (companyId, id) => call(() => {
      const n = binned.findIndex((x) => x.id === id && x.companyId === companyId);
      if (n < 0) return mockError('NOT_FOUND');
      binned.splice(n, 1);
      return ok({ id });
    }),

    toggleEmployee: (companyId, id) => call(() => {
      const e = employeeOf(companyId, id);
      if (!e) return mockError('NOT_FOUND');
      e.isActive = !e.isActive;
      return ok(copyEmployee(e));
    }),

    sendOfferLetter: (companyId, id) => call(() => {
      const e = employeeOf(companyId, id);
      if (!e) return mockError('NOT_FOUND');
      if (!e.email) return mockError('VALIDATION_FAILED', { email: payrollCoreCopy.staff.noEmail });
      return ok(letterFor(e));
    }),

    getAttendance: (companyId, month, q = {}) => call(() => (companyOf(companyId) ? ok(sheet(companyId, month, q)) : selectFirst())),

    saveAttendance: (companyId, month, rows, q = {}) => call(() => {
      if (!companyOf(companyId)) return selectFirst();
      const m = getMonth(companyId, month);
      if (m.lock === 'locked') return refuse('This attendance month is locked. An admin must unlock it first.');
      const byKey = new Map(statuses.filter((s) => s.companyId === companyId && s.isActive).map((s) => [s.shortcutKey.toUpperCase(), s.id]));
      const total = daysIn(month);
      const next: [string, { days: (string | null)[]; overtime: number[] }][] = [];
      for (const r of rows) {
        const days: (string | null)[] = [];
        for (let i = 0; i < total; i += 1) {
          const key = (r.days[i] ?? '').trim().toUpperCase();
          if (!key) { days.push(null); continue; }
          const sid = byKey.get(key);
          if (!sid) return mockError('VALIDATION_FAILED', { [r.employeeId]: `"${key}" is not an attendance status key. Use one of: ${[...byKey.keys()].join(', ')}.` });
          days.push(sid);
        }
        const old = m.entries.get(r.employeeId)?.overtime ?? [];
        const overtime = Array.from({ length: total }, (_, i) => (r.overtime ? r.overtime[i] ?? 0 : old[i] ?? 0));
        if (overtime.some((h) => !(h >= 0 && h <= 24))) return mockError('VALIDATION_FAILED', { [r.employeeId]: 'Overtime must be 0 to 24 hours a day.' });
        next.push([r.employeeId, { days, overtime }]);
      }
      for (const [id, en] of next) m.entries.set(id, en);
      return ok(sheet(companyId, month, q));
    }),

    generateSalary: (companyId, month) => call(() => {
      if (!companyOf(companyId)) return selectFirst();
      const m = getMonth(companyId, month);
      const sh = sheet(companyId, month);
      if (!sh.monthOver) return refuse('Salary can only be generated once the month is over.');
      if (m.salaryGeneratedAt) return refuse('Salary is already generated for this month. An admin must unlock attendance to re-generate.');
      if (sh.incomplete.length) return refuse(`Complete attendance for every employee first: ${sh.incomplete.join(', ')}.`);
      makeSalary(companyId, month);
      m.lock = 'locked';
      m.salaryGeneratedAt = new Date().toISOString();
      return ok(sheet(companyId, month));
    }),

    regenerateSalary: (companyId, month) => call(() => {
      if (!companyOf(companyId)) return selectFirst();
      const m = getMonth(companyId, month);
      const sh = sheet(companyId, month);
      if (sh.incomplete.length) return refuse(`Complete attendance for every employee first: ${sh.incomplete.join(', ')}.`);
      makeSalary(companyId, month);
      m.lock = 'locked';
      m.salaryGeneratedAt = new Date().toISOString();
      return ok(sheet(companyId, month));
    }),

    unlockAttendance: (companyId, month) => call(() => {
      if (!companyOf(companyId)) return selectFirst();
      const m = getMonth(companyId, month);
      if (m.lock !== 'locked') return refuse('This attendance month is not locked.');
      m.lock = 'unlocked';
      return ok(sheet(companyId, month));
    }),

    listStatuses: (companyId) => call(() => ok(statuses.filter((s) => s.companyId === companyId).map(statusWithUse))),

    createStatus: (companyId, input) => call(() => {
      const errs = validateStatus(input);
      const key = input.shortcutKey.trim().toUpperCase();
      if (statuses.some((s) => s.companyId === companyId && s.shortcutKey === key)) errs.shortcutKey = 'This key is already used.';
      if (Object.keys(errs).length) return mockError('VALIDATION_FAILED', errs);
      const { isActive: _a, ...fields } = input;
      void _a;
      const s: AttendanceStatus = { ...fields, shortcutKey: key, isActive: true, id: nextId(`${companyId}-as`), companyId, usedCount: 0 };
      statuses.push(s);
      return ok({ ...s });
    }),

    updateStatus: (companyId, id, input) => call(() => {
      const s = statusOf(companyId, id);
      if (!s) return mockError('NOT_FOUND');
      const errs = validateStatus(input);
      const key = input.shortcutKey.trim().toUpperCase();
      if (statuses.some((x) => x.id !== id && x.companyId === companyId && x.shortcutKey === key)) errs.shortcutKey = 'This key is already used.';
      if (Object.keys(errs).length) return mockError('VALIDATION_FAILED', errs);
      const { isActive: _a, ...fields } = input;
      void _a;
      Object.assign(s, fields, { shortcutKey: key });
      return ok(statusWithUse(s));
    }),

    deleteStatus: (companyId, id) => call(() => {
      const s = statusOf(companyId, id);
      if (!s) return mockError('NOT_FOUND');
      if (statusWithUse(s).usedCount > 0) return refuse('This status is already used in Attendance and cannot be deleted. Make it inactive instead.');
      statuses.splice(statuses.indexOf(s), 1);
      return ok({ id });
    }),

    toggleStatus: (companyId, id) => call(() => {
      const s = statusOf(companyId, id);
      if (!s) return mockError('NOT_FOUND');
      s.isActive = !s.isActive;
      return ok(statusWithUse(s));
    }),

    listDeductions: (companyId) => call(() => ok(deductions.filter((d) => d.companyId === companyId).map(deductionWithUse))),

    createDeduction: (companyId, input) => call(() => {
      const errs = validateDeduction(input);
      if (deductions.some((d) => d.companyId === companyId && d.name.toLowerCase() === input.name.trim().toLowerCase())) errs.name = 'A deduction with this name exists.';
      if (Object.keys(errs).length) return mockError('VALIDATION_FAILED', errs);
      const d: Deduction = { name: input.name.trim(), standardAmountPaise: input.standardAmountPaise, isActive: true, id: nextId('d'), companyId, assignedCount: 0 };
      deductions.push(d);
      return ok({ ...d });
    }),

    updateDeduction: (companyId, id, input) => call(() => {
      const d = deductionOf(companyId, id);
      if (!d) return mockError('NOT_FOUND');
      const errs = validateDeduction(input);
      if (deductions.some((x) => x.id !== id && x.companyId === companyId && x.name.toLowerCase() === input.name.trim().toLowerCase())) errs.name = 'A deduction with this name exists.';
      if (Object.keys(errs).length) return mockError('VALIDATION_FAILED', errs);
      d.name = input.name.trim();
      d.standardAmountPaise = input.standardAmountPaise;
      return ok(deductionWithUse(d));
    }),

    deleteDeduction: (companyId, id) => call(() => {
      const d = deductionOf(companyId, id);
      if (!d) return mockError('NOT_FOUND');
      if (deductionWithUse(d).assignedCount > 0) return refuse('This deduction is assigned to an employee and cannot be deleted.');
      deductions.splice(deductions.indexOf(d), 1);
      return ok({ id });
    }),

    toggleDeduction: (companyId, id) => call(() => {
      const d = deductionOf(companyId, id);
      if (!d) return mockError('NOT_FOUND');
      d.isActive = !d.isActive;
      return ok(deductionWithUse(d));
    }),

    listStaffEmails: (companyId, q = {}) => call(() => {
      settleEmails();
      const mine = emails.filter((e) => e.companyId === companyId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const status = q.status ?? (q.tab === 'sent' ? 'sent' : q.tab === 'failed' ? 'failed' : undefined);
      const rows = mine
        .filter((e) => !status || (status === 'failed' ? e.state === 'failed' || e.state === 'stalled' : e.state === status))
        .filter((e) => (!q.from || e.createdAt.slice(0, 10) >= q.from) && (!q.to || e.createdAt.slice(0, 10) <= q.to));
      const page = pageOf(rows, q, (e, s) => `${e.employeeName} ${e.employeeCode} ${e.recipientName ?? ''} ${e.recipientEmail} ${e.sentBy}`.toLowerCase().includes(s));
      return ok({ page, summary: summaryOf(mine) });
    }),

    staffEmailFeed: (companyId, q) => call(() => {
      settleEmails();
      const mine = emails.filter((e) => e.companyId === companyId);
      const watch = new Set(q.watch.slice(0, STAFF_EMAIL_WATCH_MAX));
      const fresh = mine.filter((e) => e.createdAt > q.after).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, 50);
      const watched = mine.filter((e) => watch.has(e.id) && !fresh.includes(e));
      const items = [...fresh, ...watched].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((e) => ({ ...e }));
      return ok({ items, summary: summaryOf(mine) });
    }),

    listRecipients: () => call(() => ok(recipientsSeed.map((r) => ({ ...r })))),

    sendStaffEmails: (companyId, employeeIds, recipientId) => call(() => {
      const r = recipientsSeed.find((x) => x.id === recipientId);
      const errs: Record<string, string> = {};
      if (!r) errs.recipient = 'Choose who to send to.';
      if (!employeeIds.length) errs.employees = 'Choose at least one person.';
      else if (employeeIds.length > STAFF_EMAIL_SEND_MAX) errs.employees = `Choose at most ${STAFF_EMAIL_SEND_MAX} people at a time.`;
      if (!r || Object.keys(errs).length) return mockError('VALIDATION_FAILED', errs);
      const now = Date.now();
      const items: StaffEmail[] = [];
      employeeIds.forEach((eid, n) => {
        const e = employeeOf(companyId, eid);
        if (!e) return;
        const mail: StaffEmail = {
          id: nextId('se'), companyId, employeeId: e.id, employeeName: e.name, employeeCode: e.employeeCode, designation: e.designation,
          recipientName: r.name, recipientEmail: r.email, subject: `Staff details: ${e.name} (${e.employeeCode})`,
          message: `Please find the staff details of ${e.name} attached.`,
          state: 'sending', error: null, sentBy: 'You', createdAt: new Date(now + n).toISOString(), finishedAt: null, durationMs: null, attachmentKb: null,
        };
        emails.push(mail);
        items.push({ ...mail });
      });
      const failed = employeeIds.length - items.length;
      return ok({
        queued: items.length, failed,
        message: `${items.length} ${items.length === 1 ? 'email is' : 'emails are'} on the way to ${r.email}.${failed ? ` ${failed} could not be queued.` : ''}`,
        items,
      });
    }),
  };
}
