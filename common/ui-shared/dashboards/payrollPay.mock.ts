// The in-memory mock of payrollPay.ts (dev and local-demo builds only): loaded through ui-shared/mocks (web-app/src/lib/api/mockLoader.ts), never by app code.
import { formatINR, amountInWords, formatMonth, formatDate } from './format';
import { type MockClock, type DashResult, mockCall, mockError, ok, type ListQuery, type Page, pageOf } from './common';
import { MOCK_TODAY, addMonths, balanceOf, bulkPaymentStatuses, daysInMonth, grossOf, letterSectionDefs, maskAccount, masterLists, monthOf, paymentStatuses, payrollPayCompanyStore, serviceLength, totalDeductionsOf, type Advance, type AdvanceInput, type AdvanceList, type AdvanceSummary, type BonusEntry, type BonusInput, type BonusList, type BonusSummary, type BonusType, type BulkPaymentInput, type DocBlock, type GenerateRow, type LetterKind, type LetterTemplate, type LetterTemplateInput, type LinkedEmployee, type LogAction, type LogQuery, type LogResult, type LogStatus, type MasterItem, type MasterItemInput, type MasterListKey, type MasterScope, type MasterView, type MealBillRow, type MealPeriod, type MealPrice, type MealStaffRow, type MealsOverview, type PayEmployee, type PayLine, type PaymentMonth, type PaymentStatus, type PaymentSummary, type PaymentUpdateInput, type PayrollCompanyRef, type PayrollDoc, type PayrollMockLink, type PayrollPaySeed, type RecoveryType, type RejoinInput, type ReportResult, type SalaryChange, type SalaryDays, type SalaryLine, type SalaryLineCategory, type SalaryProfile, type SalaryRecord, type SalaryRevision, type SalaryRevisionInput, type Separation, type SeparationInput, type SeparationSeed, type SeparationSummary, type Store } from './payrollPay';
import type { PaymentListQuery, PayStaffItem, PayStaffLookupQuery } from './payrollPay';
import { advanceSorts, advanceStatuses, bonusSorts, bonusTypes, separationSorts, separationStatuses, slipSorts, type AdvanceListQuery, type AdvanceStatus, type BonusListQuery, type SeparationListQuery, type SeparationStatus, type SlipList, type SlipListQuery, type SlipSummary } from './payrollPay';

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function isDate(s: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)); }

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

const companies: PayrollCompanyRef[] = [
  { id: 'pc1', name: 'Hotel Sunrise Pvt Ltd', code: 'HSP', providesFood: false, address: '150 Feet Ring Road, Near Raiya Circle, Rajkot, Gujarat 360007', gstin: '24ABCDE1234F1Z5', mobile: '+91 98240 11000', email: 'accounts@hotelsunrise.in' },
  { id: 'pc2', name: 'Sunrise Foods LLP', code: 'SFL', providesFood: true, address: '150 Feet Ring Road, Near Raiya Circle, Rajkot, Gujarat 360007', gstin: '24AAKFS5678K1Z2', mobile: '+91 98250 98765', email: 'foods@hotelsunrise.in' },
];

type EmpSeed = [id: string, name: string, designation: string, department: string, companyId: string, joining: string, salaryRs: number, hours: number, mode: string, bank: string, phone: string];

const empSeed: EmpSeed[] = [
  ['e01', 'Ramesh Patel', 'Front Office Executive', 'Front Office', 'pc1', '2023-04-10', 22000, 9, 'Bank', 'State Bank of India', '98250 11223'],
  ['e02', 'Sunita Sharma', 'Housekeeping Supervisor', 'Housekeeping', 'pc1', '2021-11-01', 26500, 9, 'Bank', 'HDFC Bank', '98793 44556'],
  ['e03', 'Imran Shaikh', 'Chef', 'Kitchen', 'pc2', '2022-06-15', 38000, 10, 'Bank', 'ICICI Bank', '99099 12345'],
  ['e04', 'Pooja Desai', 'Accountant', 'Accounts', 'pc1', '2024-01-08', 32000, 8, 'Bank', 'Bank of Baroda', '97277 67890'],
  ['e05', 'Vikram Singh', 'Security', 'Security', 'pc1', '2025-03-20', 15500, 12, 'Cash', '', '90990 55443'],
  ['e06', 'Neha Joshi', 'Receptionist', 'Front Office', 'pc1', '2025-08-01', 18000, 9, 'Bank', 'Kotak Mahindra Bank', '98980 22110'],
  ['e07', 'Kiran Parmar', 'Waiter', 'Restaurant', 'pc2', '2024-09-12', 14000, 10, 'Bank', 'State Bank of India', '93270 33221'],
  ['e08', 'Manoj Yadav', 'Room Attendant', 'Housekeeping', 'pc1', '2026-02-10', 13500, 9, 'Cash', '', '88660 77889'],
  ['e09', 'Farhan Qureshi', 'Steward', 'Restaurant', 'pc2', '2025-06-05', 12500, 10, 'Cash', '', '70160 44332'],
  ['e10', 'Divya Nair', 'F&B Manager', 'Food & Beverage', 'pc2', '2020-08-17', 55000, 9, 'Bank', 'Axis Bank', '98244 90011'],
  ['e11', 'Ajay Chauhan', 'Maintenance', 'Engineering', 'pc1', '2022-03-03', 17000, 9, 'Bank', 'Union Bank of India', '96010 12121'],
  ['e12', 'Meera Iyer', 'HR Executive', 'Human Resources', 'pc1', '2023-10-23', 28000, 8, 'Bank', 'HDFC Bank', '98251 30303'],
  ['e13', 'Bhavesh Rathod', 'Commis Chef', 'Kitchen', 'pc2', '2026-07-15', 16000, 10, 'Bank', 'Bank of Baroda', '97144 56781'],
  ['e14', 'Jyoti Makwana', 'Laundry Attendant', 'Housekeeping', 'pc1', '2026-01-01', 12500, 9, 'Cash', '', '96380 21457'],
  ['e15', 'Hitesh Gohil', 'Night Auditor', 'Front Office', 'pc1', '2026-11-01', 21000, 8, 'Bank', 'State Bank of India', '99743 10862'],
];

function seedEmployees(): PayEmployee[] {
  const counters: Record<string, number> = {};
  return empSeed.map(([id, name, designation, department, companyId, joiningDate, salaryRs, hours, mode, bank, phone], i) => {
    const co = companies.find((c) => c.id === companyId);
    counters[companyId] = (counters[companyId] ?? 0) + 1;
    const acct = mode === 'Bank' ? `${30000000000 + (i + 1) * 7919131}` : '';
    return {
      id, name, designation, department, companyId, joiningDate,
      code: `${co?.code ?? 'EMP'}-${String(counters[companyId]).padStart(3, '0')}`,
      isActive: id !== 'e11',
      salaryPaise: salaryRs * 100, dailyWorkingHours: hours, paymentMode: mode,
      bankName: bank, accountHolderName: mode === 'Bank' ? name : '', accountNumber: acct || null,
      ifscCode: mode === 'Bank' ? `${bank.slice(0, 4).toUpperCase().replace(/\s/g, 'X')}0001${String(234 + i).padStart(3, '0')}` : '',
      branchName: mode === 'Bank' ? 'Kalawad Road, Rajkot' : '', phone: `+91 ${phone}`,
    };
  });
}

/** The pay facts of the seed staff (payment mode, bank, account, IFSC, branch): payrollCore's mock builds its staff from these, so both halves agree. */
export function payrollPayEmployeeSeed(): PayEmployee[] { return seedEmployees(); }

interface BonusSeed { id: string; employeeId: string; date: string; type: BonusType; rs: number; remarks: string }
const bonusSeed: BonusSeed[] = [
  { id: 'b01', employeeId: 'e10', date: '2026-08-25', type: 'Bonus', rs: 5000, remarks: 'Banquet season target met' },
  { id: 'b02', employeeId: 'e01', date: '2026-08-28', type: 'Incentive', rs: 1500, remarks: 'Upsell of suites' },
  { id: 'b03', employeeId: 'e02', date: '2026-09-15', type: 'Bonus', rs: 2000, remarks: 'Ganesh Chaturthi bonus' },
  { id: 'b04', employeeId: 'e07', date: '2026-09-30', type: 'Incentive', rs: 800, remarks: 'Guest feedback' },
  { id: 'b05', employeeId: 'e04', date: '2026-10-10', type: 'Incentive', rs: 1200, remarks: 'GST filing on time' },
  { id: 'b06', employeeId: 'e03', date: '2026-10-20', type: 'Bonus', rs: 3000, remarks: 'Dussehra menu' },
  { id: 'b07', employeeId: 'e06', date: '2026-10-28', type: 'Incentive', rs: 500, remarks: '' },
  { id: 'b08', employeeId: 'e12', date: '2026-11-01', type: 'Bonus', rs: 2500, remarks: 'Recruitment drive completed ahead of Diwali' },
  { id: 'b09', employeeId: 'e08', date: '2026-11-03', type: 'Incentive', rs: 700, remarks: 'Extra floor during wedding block' },
  { id: 'b10', employeeId: 'e09', date: '2026-11-04', type: 'Bonus', rs: 1000, remarks: 'Diwali bonus (early)' },
  { id: 'b11', employeeId: 'e13', date: '2026-10-24', type: 'Incentive', rs: 600, remarks: 'Sharad Purnima buffet prep' },
  { id: 'b12', employeeId: 'e14', date: '2026-09-15', type: 'Bonus', rs: 1000, remarks: 'Ganesh Chaturthi bonus' },
  { id: 'b13', employeeId: 'e05', date: '2026-11-05', type: 'Incentive', rs: 500, remarks: 'Night patrol during the Patel wedding block' },
];

interface AdvSeed { id: string; employeeId: string; date: string; rs: number; type: RecoveryType; instRs: number; recoveredRs: number; settled: boolean; carry: boolean; remarks: string }
const advanceSeed: AdvSeed[] = [
  { id: 'a01', employeeId: 'e10', date: '2026-05-10', rs: 50000, type: 'Monthly', instRs: 10000, recoveredRs: 50000, settled: true, carry: false, remarks: 'Family medical expense' },
  { id: 'a02', employeeId: 'e05', date: '2026-07-12', rs: 10000, type: 'Monthly', instRs: 2500, recoveredRs: 7500, settled: false, carry: false, remarks: 'Two-wheeler repair' },
  { id: 'a03', employeeId: 'e08', date: '2026-08-03', rs: 5000, type: 'One Time', instRs: 5000, recoveredRs: 5000, settled: true, carry: false, remarks: '' },
  { id: 'a04', employeeId: 'e07', date: '2026-09-20', rs: 8000, type: 'Monthly', instRs: 2000, recoveredRs: 2000, settled: false, carry: false, remarks: 'School fees' },
  { id: 'a05', employeeId: 'e01', date: '2026-10-05', rs: 15000, type: 'Monthly', instRs: 3000, recoveredRs: 3000, settled: false, carry: false, remarks: 'House deposit' },
  { id: 'a06', employeeId: 'e09', date: '2026-10-18', rs: 3000, type: 'One Time', instRs: 3000, recoveredRs: 3000, settled: true, carry: false, remarks: 'Festival' },
  { id: 'a07', employeeId: 'e09', date: '2026-11-01', rs: 1000, type: 'One Time', instRs: 1000, recoveredRs: 0, settled: false, carry: true, remarks: 'Remainder of the October advance' },
  { id: 'a08', employeeId: 'e02', date: '2026-11-02', rs: 6000, type: 'One Time', instRs: 6000, recoveredRs: 0, settled: false, carry: false, remarks: 'Diwali shopping' },
  { id: 'a09', employeeId: 'e06', date: '2026-11-04', rs: 4000, type: 'Monthly', instRs: 1000, recoveredRs: 0, settled: false, carry: false, remarks: '' },
  { id: 'a10', employeeId: 'e03', date: '2026-11-05', rs: 2500, type: 'One Time', instRs: 2500, recoveredRs: 0, settled: false, carry: false, remarks: 'Travel to native place' },
  { id: 'a11', employeeId: 'e14', date: '2026-10-25', rs: 3000, type: 'Monthly', instRs: 1000, recoveredRs: 0, settled: false, carry: false, remarks: 'Child school uniform' },
  { id: 'a12', employeeId: 'e15', date: '2026-11-03', rs: 5000, type: 'Monthly', instRs: 2500, recoveredRs: 0, settled: false, carry: false, remarks: 'Room deposit after moving to Rajkot' },
];

/** Advance recovered from salary: employee -> period -> rupees. */
const recoverySeed: Record<string, Record<string, number>> = {
  e10: { '2026-08': 10000, '2026-09': 10000, '2026-10': 10000 },
  e05: { '2026-08': 2500, '2026-09': 2500, '2026-10': 2500 },
  e08: { '2026-09': 5000 },
  e07: { '2026-10': 2000 },
  e01: { '2026-10': 3000 },
  e09: { '2026-10': 2000 },
};

const SALARY_PERIODS = ['2026-08', '2026-09', '2026-10'];
const OT_PATTERN = [0, 4, 6, 2.5, 0, 8, 3, 0, 5, 1.5, 0, 2];

/** October payment states (August and September are fully paid). */
const lastPayment: Record<string, { status: PaymentStatus; part?: number }> = {
  e01: { status: 'Paid' }, e02: { status: 'Paid' }, e03: { status: 'On Hold' }, e04: { status: 'Partially Paid', part: 0.5 },
  e05: { status: 'Pending' }, e06: { status: 'Processing' }, e07: { status: 'Failed' }, e08: { status: 'Pending' },
  e09: { status: 'Pending' }, e10: { status: 'Paid' }, e12: { status: 'Paid' }, e13: { status: 'Paid' }, e14: { status: 'Pending' },
};

function buildRecord(e: PayEmployee, period: string, idx: number, bonus: BonusSeed[]): SalaryRecord {
  const days = daysInMonth(period);
  const monthNo = Number(period.slice(5));
  const unpaid = (idx + monthNo) % 3;
  const half = idx % 2;
  const full = days - unpaid - half;
  const payable = full + half * 0.5;
  const attendance = Math.round((e.salaryPaise * payable) / days);
  const otHours = OT_PATTERN[(idx + monthNo) % OT_PATTERN.length] ?? 0;
  const otAmount = Math.round((e.salaryPaise / days / e.dailyWorkingHours) * otHours);
  const inMonth = bonus.filter((b) => b.employeeId === e.id && monthOf(b.date) === period);
  const bonusPaise = inMonth.filter((b) => b.type === 'Bonus').reduce((s, b) => s + b.rs * 100, 0);
  const incentivePaise = inMonth.filter((b) => b.type === 'Incentive').reduce((s, b) => s + b.rs * 100, 0);
  const deductions: PayLine[] = [{ label: 'Professional Tax', paise: 20000 }];
  if (e.id === 'e07' && period === '2026-09') deductions.push({ label: 'Uniform', paise: 30000 });
  if (e.id === 'e03' && period === '2026-10') deductions.push({ label: 'Breakage (crockery)', paise: 45000 });
  const advance = (recoverySeed[e.id]?.[period] ?? 0) * 100;
  const gross = attendance + otAmount + bonusPaise + incentivePaise;
  const net = Math.max(0, gross - deductions.reduce((s, d) => s + d.paise, 0) - advance);
  const nextMonth = addMonths(period, 1);
  const isLast = period === '2026-10';
  const pay = isLast ? (lastPayment[e.id] ?? { status: 'Pending' as PaymentStatus }) : { status: 'Paid' as PaymentStatus };
  const paidPaise = pay.status === 'Paid' ? net : pay.status === 'Partially Paid' ? Math.round(net * (pay.part ?? 0.5)) : 0;
  const settles = pay.status === 'Paid' || pay.status === 'Partially Paid';
  const pendingAdv = e.id === 'e05' ? (period === '2026-10' ? 250000 : period === '2026-09' ? 500000 : 750000)
    : e.id === 'e07' && period === '2026-10' ? 600000 : e.id === 'e01' && period === '2026-10' ? 1200000 : 0;
  const lines: SalaryLine[] = [
    ...deductions.map((d) => ({ category: 'Deduction' as const, label: d.label, type: 'Monthly', paise: d.paise, pendingPaise: 0 })),
    ...(advance ? [{ category: 'Advance' as const, label: 'Advance recovery', type: e.id === 'e08' ? 'One Time' : 'Monthly', paise: advance, pendingPaise: pendingAdv }] : []),
    ...inMonth.map((b) => ({ category: b.type, label: b.remarks || b.type, type: null, paise: b.rs * 100, pendingPaise: 0 })),
  ];
  return {
    id: `sp-${e.id}-${period}`, companyId: e.companyId, employeeId: e.id, employeeCode: e.code, employeeName: e.name,
    designation: e.designation, department: e.department, period, processedAt: `${nextMonth}-01T06:30:00Z`, monthlySalaryPaise: e.salaryPaise,
    dailyWorkingHours: e.dailyWorkingHours, daysInMonth: days, days: { p0: unpaid, p25: 0, p50: half, p75: 0, p100: full }, payableDays: payable,
    otHours, dailySalaryPaise: Math.round(e.salaryPaise / days), hourlyRatePaise: Math.round(e.salaryPaise / days / e.dailyWorkingHours),
    attendanceSalaryPaise: attendance, otAmountPaise: otAmount, bonusPaise, incentivePaise, deductions, lines,
    advanceRecoveryPaise: advance, pendingAdvancePaise: pendingAdv, netPaise: net, paymentMode: e.paymentMode, bankName: e.bankName,
    accountNumber: e.accountNumber, ifscCode: e.ifscCode, branchName: e.branchName, paymentStatus: pay.status, paidPaise,
    paidOn: settles ? (isLast ? '2026-11-03' : `${nextMonth}-07`) : null,
    reference: settles && e.paymentMode === 'Bank' ? `NEFT${period.replace('-', '')}${e.id.toUpperCase()}` : '',
    remarks: pay.status === 'Failed' ? 'Bank returned: account name mismatch' : pay.status === 'On Hold' ? 'Held until breakage is settled' : '',
    paymentUpdatedBy: pay.status === 'Pending' ? null : 'Pooja Desai',
    generationCount: 1,
    version: 1,
  };
}
const separationSeed: SeparationSeed[] = [
  { id: 'sep1', entryNo: 'SEP-0004', employeeId: 'e06', type: 'Resignation', resignationDate: '2026-10-28', lastWorkingDate: '2026-11-27', reason: 'Moving to Ahmedabad after marriage', remarks: 'Notice period being served', status: 'Pending', documentName: null, rejoinedOn: null, createdBy: 'Meera Iyer' },
  { id: 'sep2', entryNo: 'SEP-0003', employeeId: 'e09', type: 'Resignation', resignationDate: '2026-10-15', lastWorkingDate: '2026-11-15', reason: 'Higher studies (hotel management diploma)', remarks: '', status: 'Accepted', documentName: 'farhan-acceptance.pdf', rejoinedOn: null, createdBy: 'Divya Nair' },
  { id: 'sep3', entryNo: 'SEP-0002', employeeId: 'e11', type: 'End of Contract', resignationDate: '2026-09-01', lastWorkingDate: '2026-09-30', reason: 'Annual maintenance contract ended', remarks: 'All tools returned. Full and final settled.', status: 'Relieved', documentName: 'ajay-relieving.pdf', rejoinedOn: null, createdBy: 'Meera Iyer' },
  { id: 'sep4', entryNo: 'SEP-0001', employeeId: 'e08', type: 'Resignation', resignationDate: '2025-11-20', lastWorkingDate: '2025-12-05', reason: 'Family reasons (returned to village)', remarks: '', status: 'Relieved', documentName: null, rejoinedOn: '2026-02-10', createdBy: 'Meera Iyer' },
];

function seedTemplates(): LetterTemplate[] {
  const mk = (companyId: string, kind: LetterKind, subject: string, texts: Record<string, string>, signer: [string, string]): LetterTemplate => ({
    companyId, kind, subject, signatoryName: signer[0], signatoryDesignation: signer[1], isActive: true, updatedAt: '2026-07-02T09:15:00Z',
    sections: letterSectionDefs[kind].map((d) => ({ id: d.id, label: d.label, text: texts[d.id] ?? '' })),
    useCompanySignatory: true,
    // Pallav's two "Closing text" boxes: above the signatory, and (joining letter) under the acceptance text.
    signatoryClosingText: `For ${companies.find((c) => c.id === companyId)?.name ?? ''}`,
    ...(kind === 'joining' ? { acceptanceHeading: 'Employee Acceptance', acceptanceClosingText: texts.acceptanceClosing ?? '' } : {}),
  });
  return [
    mk('pc1', 'joining', 'Appointment as {DESIGNATION}', {
      introduction: 'Dear {EMPLOYEE_NAME},\nWe are pleased to appoint you as {DESIGNATION} in the {DEPARTMENT} department of Hotel Sunrise, Rajkot, with effect from {JOINING_DATE}.',
      responsibilities: 'Your main responsibilities: {RESPONSIBILITIES}',
      terms: '1. You will be on probation for six months.\n2. Salary is paid by the 7th of every month.\n3. Either side may end this appointment with one month’s notice.\n4. You will follow the hotel’s grooming and conduct policy.',
      closing: 'We welcome you to the Hotel Sunrise family and wish you a rewarding career with us.',
      acceptance: 'I, {EMPLOYEE_NAME}, accept the terms of this appointment.',
      acceptanceClosing: 'Please sign and return one copy of this letter by {JOINING_DATE}.',
    }, ['Meera Iyer', 'HR Executive']),
    mk('pc1', 'experience', 'Experience certificate', {
      body: 'This is to certify that {EMPLOYEE_NAME} was employed with us as {DESIGNATION} in the {DEPARTMENT} department from {JOINING_DATE} to {LAST_WORKING_DATE}, a period of {DURATION}.',
      conduct: 'During the tenure, we found {EMPLOYEE_NAME} to be sincere, hardworking and professional in conduct.',
      closing: 'We wish {EMPLOYEE_NAME} every success in future endeavours.',
    }, ['Meera Iyer', 'HR Executive']),
    mk('pc2', 'joining', 'Offer of employment', {
      introduction: 'Dear {EMPLOYEE_NAME},\nSunrise Foods LLP is happy to offer you the post of {DESIGNATION} from {JOINING_DATE}.',
      responsibilities: '{RESPONSIBILITIES}',
      terms: 'Kitchen hygiene (FSSAI) rules apply at all times. Salary is paid monthly.',
      closing: 'Welcome aboard.',
      acceptance: 'Accepted by {EMPLOYEE_NAME}.',
      acceptanceClosing: 'Signed copy to be handed to the F&B office.',
    }, ['Divya Nair', 'F&B Manager']),
    mk('pc2', 'experience', 'Experience letter', {
      body: 'This is to certify that {EMPLOYEE_NAME} worked with Sunrise Foods LLP as {DESIGNATION} in the {DEPARTMENT} department from {JOINING_DATE} to {LAST_WORKING_DATE} ({DURATION}).',
      conduct: '{EMPLOYEE_NAME} followed our kitchen hygiene (FSSAI) rules and was punctual and helpful to the team.',
      closing: 'We wish {EMPLOYEE_NAME} the very best.',
    }, ['Divya Nair', 'F&B Manager']),
  ];
}

const responsibilitiesByDesignation: Record<string, string> = {
  'Front Office Executive': 'guest check-in and check-out, reservations, and billing at the front desk.',
  Receptionist: 'welcoming guests, phone enquiries, and keeping the guest register.',
  'Room Attendant': 'cleaning and setting up rooms to the hotel standard.',
  Chef: 'menu planning, food quality and kitchen hygiene.',
};

interface MasterSeed { list: MasterListKey; scope: MasterScope; label: string; value?: string; active?: boolean }
const masterSeed: MasterSeed[] = [
  { list: 'designations', scope: 'all', label: 'Front Office Executive' },
  { list: 'designations', scope: 'all', label: 'Receptionist' },
  { list: 'designations', scope: 'all', label: 'Housekeeping Supervisor' },
  { list: 'designations', scope: 'all', label: 'Room Attendant' },
  { list: 'designations', scope: 'all', label: 'Accountant' },
  { list: 'designations', scope: 'all', label: 'Security' },
  { list: 'designations', scope: 'pc2', label: 'Chef' },
  { list: 'designations', scope: 'pc2', label: 'Steward' },
  { list: 'designations', scope: 'pc2', label: 'Commis Chef (Tandoor)', active: false },
  { list: 'departments', scope: 'all', label: 'Front Office' },
  { list: 'departments', scope: 'all', label: 'Housekeeping' },
  { list: 'departments', scope: 'all', label: 'Accounts' },
  { list: 'departments', scope: 'pc2', label: 'Kitchen' },
  { list: 'departments', scope: 'pc2', label: 'Restaurant' },
  { list: 'separation_type', scope: 'all', label: 'Resignation' },
  { list: 'separation_type', scope: 'all', label: 'Termination' },
  { list: 'separation_type', scope: 'all', label: 'Retirement' },
  { list: 'separation_type', scope: 'all', label: 'End of Contract' },
  { list: 'separation_type', scope: 'all', label: 'Absconding', active: false },
  { list: 'salary_payment_mode', scope: 'all', label: 'Cash' },
  { list: 'salary_payment_mode', scope: 'all', label: 'Bank' },
  { list: 'salary_payment_mode', scope: 'pc1', label: 'UPI' },
  { list: 'share_emails', scope: 'pc1', label: 'Accounts team', value: 'accounts@hotelsunrise.in' },
  { list: 'share_emails', scope: 'pc1', label: 'CA - Shah & Associates', value: 'filings@shahassociates.co.in' },
  { list: 'id_proofs', scope: 'all', label: 'Aadhaar Card' },
  { list: 'id_proofs', scope: 'all', label: 'PAN Card' },
  { list: 'designations', scope: 'all', label: 'Maintenance' },
  { list: 'designations', scope: 'all', label: 'HR Executive' },
  { list: 'designations', scope: 'all', label: 'Laundry Attendant' },
  { list: 'designations', scope: 'all', label: 'Night Auditor' },
  { list: 'designations', scope: 'pc2', label: 'Waiter' },
  { list: 'designations', scope: 'pc2', label: 'F&B Manager' },
  { list: 'designations', scope: 'pc2', label: 'Commis Chef' },
  { list: 'departments', scope: 'all', label: 'Security' },
  { list: 'departments', scope: 'all', label: 'Engineering' },
  { list: 'departments', scope: 'all', label: 'Human Resources' },
  { list: 'departments', scope: 'pc2', label: 'Food & Beverage' },
  { list: 'id_proofs', scope: 'all', label: 'Driving Licence' },
  { list: 'id_proofs', scope: 'all', label: 'Voter ID' },
  { list: 'share_emails', scope: 'pc2', label: 'F&B office', value: 'foods@hotelsunrise.in' },
];

type LogSeed = [at: string, companyId: string | null, user: string, action: LogAction, entity: string, subject: string, summary: string, status?: LogStatus, details?: string];
const logSeed: LogSeed[] = [
  ['2026-11-05T04:10:00Z', 'pc2', 'Divya Nair', 'created', 'Advance', 'Imran Shaikh', 'Advance of ₹2,500.00 recorded (One Time)'],
  ['2026-11-05T03:42:00Z', 'pc1', 'Meera Iyer', 'emailed', 'Salary slip', 'Ramesh Patel', 'October salary slip emailed to ramesh.patel@gmail.com'],
  ['2026-11-05T03:41:00Z', 'pc1', 'Meera Iyer', 'error', 'Salary slip', 'Vikram Singh', 'Salary slip email failed: mailbox full', 'failed', 'The mail server refused the message: the mailbox is full.'],
  ['2026-11-04T12:20:00Z', 'pc1', 'Pooja Desai', 'created', 'Advance', 'Neha Joshi', 'Advance of ₹4,000.00 recorded (₹1,000.00 per month)'],
  ['2026-11-04T10:05:00Z', 'pc2', 'Divya Nair', 'created', 'Bonus / incentive', 'Farhan Qureshi', 'Bonus of ₹1,000.00 recorded'],
  ['2026-11-03T13:30:00Z', 'pc1', 'Pooja Desai', 'updated', 'Salary payment', 'Pooja Desai', 'October salary marked Partially Paid (₹15,983.87)'],
  ['2026-11-03T13:28:00Z', 'pc1', 'Pooja Desai', 'updated', 'Salary payment', '3 employees', 'October salary marked Paid for 3 employees'],
  ['2026-11-03T11:00:00Z', 'pc2', 'Divya Nair', 'updated', 'Salary payment', 'Kiran Parmar', 'Transfer bounced: account name mismatch', 'failed'],
  ['2026-11-03T09:12:00Z', 'pc1', 'Meera Iyer', 'created', 'Bonus / incentive', 'Manoj Yadav', 'Incentive of ₹700.00 recorded'],
  ['2026-11-02T08:45:00Z', 'pc1', 'Meera Iyer', 'created', 'Advance', 'Sunita Sharma', 'Advance of ₹6,000.00 recorded (One Time)'],
  ['2026-11-01T07:00:00Z', 'pc2', 'System', 'created', 'Advance', 'Farhan Qureshi', 'Carried forward ₹1,000.00 from the October advance'],
  ['2026-11-01T06:30:00Z', 'pc1', 'Meera Iyer', 'created', 'Salary slip', 'October 2026', 'Salary generated for 8 employees'],
  ['2026-11-01T06:30:00Z', 'pc2', 'Divya Nair', 'created', 'Salary slip', 'October 2026', 'Salary generated for 5 employees'],
  ['2026-11-01T05:00:00Z', 'pc2', 'Divya Nair', 'created', 'Meal price', '₹1,500.00', 'Meal price ₹1,500.00 per employee from 01 Nov 2026'],
  ['2026-11-01T04:30:00Z', 'pc2', 'Divya Nair', 'created', 'Meals record', 'Farhan Qureshi', 'Farhan Qureshi takes meals from 01 Nov 2026'],
  ['2026-10-30T10:00:00Z', 'pc1', 'Meera Iyer', 'updated', 'Attendance', 'October 2026', 'Attendance locked for October 2026'],
  ['2026-10-28T09:30:00Z', 'pc1', 'Meera Iyer', 'created', 'Resignation', 'Neha Joshi', 'Resignation recorded, last working day 27 Nov 2026'],
  ['2026-10-20T08:00:00Z', 'pc2', 'Divya Nair', 'created', 'Bonus / incentive', 'Imran Shaikh', 'Bonus of ₹3,000.00 recorded'],
  ['2026-10-15T12:10:00Z', 'pc2', 'Divya Nair', 'created', 'Resignation', 'Farhan Qureshi', 'Resignation recorded and accepted'],
  ['2026-10-12T06:40:00Z', null, 'Admin', 'created', 'Payroll master', 'UPI', 'Added "UPI" to Salary payment modes for Hotel Sunrise Pvt Ltd'],
  ['2026-10-10T11:15:00Z', 'pc1', 'Meera Iyer', 'updated', 'Salary update', 'Pooja Desai', 'Salary changed from ₹30,000.00 to ₹32,000.00'],
  ['2026-10-05T07:20:00Z', 'pc1', 'Meera Iyer', 'created', 'Advance', 'Ramesh Patel', 'Advance of ₹15,000.00 recorded (₹3,000.00 per month)'],
  ['2026-10-01T06:30:00Z', 'pc1', 'Meera Iyer', 'emailed', 'Staff details', 'Accounts team', 'Staff list shared with accounts@hotelsunrise.in'],
  ['2026-09-30T13:00:00Z', 'pc1', 'Meera Iyer', 'updated', 'Resignation', 'Ajay Chauhan', 'Ajay Chauhan marked Relieved'],
  ['2026-09-14T09:00:00Z', 'pc1', 'Meera Iyer', 'deleted', 'Bonus / incentive', 'Vikram Singh', 'Duplicate incentive entry of ₹500.00 removed'],
  ['2026-08-01T05:00:00Z', 'pc2', 'Divya Nair', 'created', 'Meal price', '₹1,350.00', 'Meal price ₹1,350.00 per employee from 01 Aug 2026'],
  ['2026-11-05T05:20:00Z', 'pc1', 'Meera Iyer', 'created', 'Bonus / incentive', 'Vikram Singh', 'Incentive of ₹500.00 recorded'],
  ['2026-11-03T06:15:00Z', 'pc1', 'Meera Iyer', 'created', 'Advance', 'Hitesh Gohil', 'Advance of ₹5,000.00 recorded (₹2,500.00 per month)'],
  ['2026-11-01T04:00:00Z', 'pc1', 'Meera Iyer', 'created', 'Staff', 'Hitesh Gohil', 'New staff added: Night Auditor, Front Office'],
  ['2026-11-01T04:05:00Z', 'pc1', 'Meera Iyer', 'emailed', 'Joining letter', 'Hitesh Gohil', 'Joining letter emailed to hitesh.e15@hotelsunrise.in'],
  ['2026-10-25T10:40:00Z', 'pc1', 'Pooja Desai', 'created', 'Advance', 'Jyoti Makwana', 'Advance of ₹3,000.00 recorded (₹1,000.00 per month)'],
  ['2026-10-24T12:30:00Z', 'pc2', 'Divya Nair', 'created', 'Bonus / incentive', 'Bhavesh Rathod', 'Incentive of ₹600.00 recorded'],
  ['2026-07-15T05:30:00Z', 'pc2', 'Divya Nair', 'created', 'Staff', 'Bhavesh Rathod', 'New staff added: Commis Chef, Kitchen'],
];

const MONEY_ENTITIES = ['Salary slip', 'Salary payment', 'Advance', 'Bonus / incentive', 'Meal price', 'Meals record', 'Attendance', 'Salary update'];

function seedStore(): Store {
  const employees = seedEmployees();
  const records: SalaryRecord[] = [];
  SALARY_PERIODS.forEach((period) => {
    employees.forEach((e, idx) => {
      const end = `${period}-${String(daysInMonth(period)).padStart(2, '0')}`;
      if (e.joiningDate > end) return;
      if (e.id === 'e11' && period > '2026-09') return; // relieved 30 Sep
      records.push(buildRecord(e, period, idx, bonusSeed));
    });
  });
  const history: Store['history'] = [
    { employeeId: 'e04', batchId: 'h1', effectiveDate: '2026-10-01', changedAt: '2026-10-10T11:15:00Z', changedBy: 'Meera Iyer', changes: [
      { id: 'h1a', field: 'Salary', previous: '30000', next: '32000' },
    ] },
    { employeeId: 'e04', batchId: 'h0', effectiveDate: '2025-05-01', changedAt: '2025-05-02T05:00:00Z', changedBy: 'Meera Iyer', changes: [
      { id: 'h0a', field: 'Salary', previous: '27500', next: '30000' },
      { id: 'h0b', field: 'Working Hours', previous: '9', next: '8' },
    ] },
    { employeeId: 'e01', batchId: 'h2', effectiveDate: '2026-05-01', changedAt: '2026-05-01T06:00:00Z', changedBy: 'Meera Iyer', changes: [
      { id: 'h2a', field: 'Salary', previous: '20000', next: '22000' },
      { id: 'h2b', field: 'Salary Payment Type', previous: 'Cash', next: 'Bank' },
      { id: 'h2c', field: 'Bank Name', previous: null, next: 'State Bank of India' },
    ] },
    { employeeId: 'e10', batchId: 'h3', effectiveDate: '2026-02-01', changedAt: '2026-02-03T07:30:00Z', changedBy: 'Admin', changes: [
      { id: 'h3a', field: 'Salary', previous: '50000', next: '55000' },
      { id: 'h3b', field: 'Designation', previous: 'Restaurant Manager', next: 'F&B Manager' },
    ] },
    { employeeId: 'e02', batchId: 'h4', effectiveDate: '2025-12-01', changedAt: '2025-12-01T05:30:00Z', changedBy: 'Meera Iyer', changes: [
      { id: 'h4a', field: 'Salary', previous: '24000', next: '26500' },
      { id: 'h4b', field: 'Designation', previous: 'Room Attendant', next: 'Housekeeping Supervisor' },
    ] },
  ];
  const coOf = (empId: string) => employees.find((e) => e.id === empId)?.companyId ?? 'pc1';
  let advNo = 0;
  let bonNo = 0;
  return {
    employees,
    history,
    records,
    advances: advanceSeed.map((a) => ({
      id: a.id, entryNo: String(++advNo), companyId: coOf(a.employeeId), employeeId: a.employeeId, date: `${a.date}T05:30:00.000Z`,
      amountPaise: a.rs * 100, recoveryType: a.type, instalmentPaise: a.instRs * 100, recoveredPaise: a.recoveredRs * 100,
      isSettled: a.settled, isCarryForward: a.carry, remarks: a.remarks, createdBy: a.carry ? 'System' : 'Meera Iyer',
    })),
    bonus: bonusSeed.map((b) => ({
      id: b.id, entryNo: String(++bonNo), companyId: coOf(b.employeeId), employeeId: b.employeeId, date: `${b.date}T06:00:00.000Z`,
      type: b.type, amountPaise: b.rs * 100, remarks: b.remarks,
    })),
    separationBin: [],
    advanceBin: [],
    bonusBin: [],
    prices: [
      { id: 'mp1', effectiveFrom: '2026-02-01', monthlyPaise: 120000, createdAt: '2026-01-29T06:10:00Z' },
      { id: 'mp2', effectiveFrom: '2026-08-01', monthlyPaise: 135000, createdAt: '2026-08-01T05:00:00Z' },
      { id: 'mp3', effectiveFrom: '2026-11-01', monthlyPaise: 150000, createdAt: '2026-11-01T05:00:00Z' },
    ],
    meals: [
      { id: 'm1', employeeId: 'e01', startsOn: '2026-02-15', endsOn: null, createdBy: 'Meera Iyer' },
      { id: 'm2', employeeId: 'e02', startsOn: '2026-04-01', endsOn: '2026-09-30', createdBy: 'Meera Iyer' },
      { id: 'm3', employeeId: 'e05', startsOn: '2026-06-01', endsOn: null, createdBy: 'Meera Iyer' },
      { id: 'm4', employeeId: 'e06', startsOn: '2026-10-10', endsOn: null, createdBy: 'Meera Iyer' },
      { id: 'm5', employeeId: 'e08', startsOn: '2026-03-01', endsOn: null, createdBy: 'Meera Iyer' },
      { id: 'm6', employeeId: 'e03', startsOn: '2026-05-01', endsOn: null, createdBy: 'Divya Nair' },
      { id: 'm7', employeeId: 'e07', startsOn: '2026-07-01', endsOn: null, createdBy: 'Divya Nair' },
      { id: 'm8', employeeId: 'e09', startsOn: '2026-11-01', endsOn: null, createdBy: 'Divya Nair' },
      { id: 'm9', employeeId: 'e11', startsOn: '2026-03-01', endsOn: '2026-09-30', createdBy: 'Meera Iyer' },
      { id: 'm10', employeeId: 'e13', startsOn: '2026-07-15', endsOn: null, createdBy: 'Divya Nair' },
      { id: 'm11', employeeId: 'e14', startsOn: '2026-01-01', endsOn: null, createdBy: 'Meera Iyer' },
      { id: 'm12', employeeId: 'e15', startsOn: '2026-11-01', endsOn: null, createdBy: 'Meera Iyer' },
    ],
    templates: seedTemplates(),
    separations: separationSeed.map((s) => ({ ...s })),
    master: masterSeed.map((m, i) => ({
      id: `mi${i + 1}`, list: m.list, scope: m.scope, label: m.label, value: m.value ?? null, isActive: m.active ?? true, sortOrder: i + 1,
    })),
    log: logSeed.map(([at, companyId, userName, action, entity, subject, summary, status, details], i) => ({
      id: `lg${i + 1}`, at, companyId, companyName: companies.find((c) => c.id === companyId)?.name ?? 'All companies', userName,
      action, entity, subject, summary, details: details ?? '', status: status ?? 'success',
    })),
    seq: 100,
  };
}

function phoneText(dial: string, digits: string): string {
  if (!digits) return '';
  return `+${dial || '91'} ${digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits}`;
}

/** A PayEmployee that reads and writes the core staff record itself (no copy to keep in step). */
function linkedView(e: LinkedEmployee): PayEmployee {
  const v = {} as PayEmployee;
  const rec = e as unknown as Record<string, unknown>;
  (['id', 'companyId', 'name', 'designation', 'department', 'joiningDate', 'isActive', 'salaryPaise', 'dailyWorkingHours', 'paymentMode',
    'bankName', 'accountHolderName', 'accountNumber', 'ifscCode', 'branchName'] as const).forEach((k) => {
    Object.defineProperty(v, k, { enumerable: true, get: () => rec[k], set: (x: unknown) => { rec[k] = x; } });
  });
  Object.defineProperty(v, 'code', { enumerable: true, get: () => e.employeeCode, set: (x: string) => { e.employeeCode = x; } });
  Object.defineProperty(v, 'phone', {
    enumerable: true,
    get: () => phoneText(e.contactCountry, e.contactNumber),
    set: (x: string) => {
      const digits = String(x).replace(/\D/g, '');
      const cc = e.contactCountry || '91';
      const national = digits.length > 10 && digits.startsWith(cc) ? digits.slice(cc.length) : digits;
      if (!national) return;
      e.contactNumber = national;
      e.display = { ...e.display, contact: phoneText(cc, national) };
    },
  });
  return v;
}

// ---- the pay lists' paging, like the server (docs/BACKEND.md 7.6 "Pay lists"): period, search, status, sort, page
type ListSortKey = string | number | readonly (string | number)[];
const PAY_PAGE_SIZE = 25;

/** The IST month ("YYYY-MM") of a stored date or date-time. */
function istMonth(iso: string): string {
  if (iso.length <= 10) return iso.slice(0, 7);
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso.slice(0, 7) : new Date(t + 330 * 60_000).toISOString().slice(0, 7);
}

/** Every word of the search inside the parts joined by spaces (lower-cased). */
function hasWords(search: string | undefined, ...parts: (string | null | undefined)[]): boolean {
  const words = (search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = parts.filter((p) => p !== null && p !== undefined).join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

function compareKeys(x: ListSortKey, y: ListSortKey): number {
  const a = Array.isArray(x) ? x : [x];
  const b = Array.isArray(y) ? y : [y];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

/** Sort (stable: ties keep the list's own order, in either direction) and cut one page. A page past the end has no items and the same total. */
function sortAndPage<T, S extends string>(rows: T[], q: { page?: number; pageSize?: number; sort?: S; dir?: 'asc' | 'desc' }, sorters: Record<S, (r: T) => ListSortKey>): Page<T> {
  const key = q.sort ? sorters[q.sort] : undefined;
  const sign = q.dir === 'desc' ? -1 : 1;
  const sorted = key ? rows.map((r, i) => ({ r, i, k: key(r) })).sort((a, b) => compareKeys(a.k, b.k) * sign || a.i - b.i).map((x) => x.r) : rows;
  const pageSize = q.pageSize ?? PAY_PAGE_SIZE;
  const page = Math.max(1, Math.floor(q.page ?? 1));
  return { items: sorted.slice((page - 1) * pageSize, page * pageSize), total: sorted.length, page, pageSize };
}

/** Unknown status or sort ids are a 422, as on the server. The field name and its sentence. */
function badListQuery(q: { status?: string; sort?: string }, statuses: readonly string[], sorts: readonly string[]): Record<string, string> | null {
  if (q.status !== undefined && !statuses.includes(q.status)) return { status: `Status must be one of: ${statuses.join(', ')}.` };
  if (q.sort !== undefined && !sorts.includes(q.sort)) return { sort: `Sort must be one of: ${sorts.join(', ')}.` };
  return null;
}

const entryNumber = (no: string) => Number(no.replace(/\D/g, '')) || 0;

/** Identity is never input: "changed by" / "created by" / "paid by" come from the session (the mock says "You"). */
export function createPayrollPayApi(clock: MockClock = {}, seed?: PayrollPaySeed, link?: PayrollMockLink) {
  const actor = 'You';
  if (seed) {
    // One mock store per browser session: the company list is module-level (documents read it), so it is swapped in place.
    companies.splice(0, companies.length, ...seed.companies.map((c) => ({ ...c })));
    const first = companies[0];
    if (first) payrollPayCompanyStore.set(first.id);
  }
  const s: Store = seed ? { ...(JSON.parse(JSON.stringify({ ...seed, companies: [] as PayrollCompanyRef[] })) as Omit<PayrollPaySeed, "companies">), seq: 100 } : seedStore();
  const call = <T>(fn: () => DashResult<T>) => mockCall(fn, clock);
  const nextId = (p: string) => `${p}${++s.seq}`;
  const company = (id: string | null) => companies.find((c) => c.id === id);
  const emp = (id: string) => s.employees.find((e) => e.id === id);
  const today = MOCK_TODAY;

  const log = (companyId: string | null, action: LogAction, entity: string, subject: string, summary: string) => {
    s.log.unshift({
      id: nextId('lg'), at: stamp(today), companyId, companyName: company(companyId)?.name ?? 'All companies',
      userName: actor, action, entity, subject, summary, details: '', status: 'success',
    });
  };

  const processedPeriods = (companyId: string): string[] =>
    [...new Set(s.records.filter((r) => r.companyId === companyId).map((r) => r.period))].sort().reverse();
  const isProcessed = (companyId: string, employeeId: string, date: string) =>
    s.records.some((r) => r.companyId === companyId && r.employeeId === employeeId && r.period === monthOf(date));
  /** Meals close for both companies once either generates salary for a month. */
  const mealsClosedThrough = (): string | null => {
    const all = [...new Set(s.records.map((r) => r.period))].sort();
    return all.length ? (all[all.length - 1] ?? null) : null;
  };
  const mealsClosedFor = (date: string) => { const c = mealsClosedThrough(); return c !== null && monthOf(date) <= c; };

  /** 422: Pallav's sentence in error.message (the first field's), fields for the form. */
  const fail = (fields: Record<string, string>) => mockError('VALIDATION_FAILED', fields, { message: Object.values(fields)[0] });
  /** 409 for state rules, sentence in error.message (no `form` field). */
  const conflict = (sentence: string) => mockError('CONFLICT', undefined, { message: sentence });
  const selectFirst = () => mockError('NOT_FOUND', undefined, { message: 'Select a company first.' });
  const day = (iso: string) => iso.slice(0, 10);
  /** "YYYY-MM-DD" today = the moment of saving (Pallav _stamp_set); other plain dates at 00:00 IST. */
  // "Now" keeps the mock's own date (MOCK_TODAY) with the clock's time of day, so a saved entry is never later than the mock's today.
  const stamp = (date: string) => (date.length > 10 ? date : date === today ? `${today}T${new Date(Date.now() + 330 * 60_000).toISOString().slice(11, 19)}+05:30` : `${date}T00:00:00+05:30`);
  const empMatch = (name: string, q: string) => name.toLowerCase().includes(q);

  // ---- advances helpers
  const toAdvance = (a: Store['advances'][number]): Advance => ({
    ...a, employeeName: emp(a.employeeId)?.name ?? 'Former employee', employeeCode: emp(a.employeeId)?.code ?? '',
    outstandingPaise: a.isSettled ? 0 : Math.max(0, a.amountPaise - a.recoveredPaise),
    locked: a.isCarryForward || isProcessed(a.companyId, a.employeeId, a.date),
    canEdit: true, canDelete: true,
  });
  const checkAdvance = (companyId: string, i: AdvanceInput): Record<string, string> => {
    const f: Record<string, string> = {};
    const e = emp(i.employeeId);
    if (!e || e.companyId !== companyId || !e.isActive) f.employeeId = 'Choose an active employee of this company.';
    if (!isDate(day(i.date))) f.date = 'Enter the advance date.';
    else if (day(i.date) > today) f.date = 'Advance date cannot be in the future.';
    if (!i.amountPaise || i.amountPaise <= 0) f.amountPaise = 'Advance amount must be greater than zero.';
    if (i.recoveryType === 'Monthly' && (!i.instalmentPaise || i.instalmentPaise <= 0)) f.instalmentPaise = 'A monthly recovery needs an instalment greater than zero.';
    if (i.recoveryType === 'Monthly' && i.instalmentPaise && i.amountPaise && i.instalmentPaise > i.amountPaise) f.instalmentPaise = 'The instalment cannot be more than the advance.';
    if (!f.date && e && isProcessed(companyId, e.id, i.date)) f.date = `Salary for ${formatMonth(monthOf(i.date))} is already processed. Pick a date in an open month.`;
    return f;
  };

  // ---- bonus helpers
  const toBonus = (b: Store['bonus'][number]): BonusEntry => ({
    ...b, employeeName: emp(b.employeeId)?.name ?? 'Former employee', employeeCode: emp(b.employeeId)?.code ?? '', locked: isProcessed(b.companyId, b.employeeId, b.date),
    canEdit: true, canDelete: true,
  });
  const checkBonus = (companyId: string, i: BonusInput, isNew: boolean): Record<string, string> => {
    const f: Record<string, string> = {};
    const e = emp(i.employeeId);
    if (!e || e.companyId !== companyId || !e.isActive) f.employeeId = 'Choose an active employee of this company.';
    if (!isDate(day(i.date))) f.date = 'Enter the date.';
    else if (day(i.date) > today) f.date = 'Date cannot be in the future.';
    else if (isNew && monthOf(i.date) !== monthOf(today)) f.date = `Bonus and incentive entries can only be dated in the current month (${formatMonth(monthOf(today))}).`;
    if (!i.amountPaise || i.amountPaise <= 0) f.amountPaise = 'Amount must be greater than zero.';
    return f;
  };
  const bonusMonthClosed = (companyId: string, i: BonusInput) =>
    isProcessed(companyId, i.employeeId, i.date) ? conflict('Salary has already been generated for this month, so no more bonus or incentive entries can be added to it.') : null;

  // ---- meals helpers
  const priceOn = (date: string): number | null => {
    const p = [...s.prices].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)).filter((x) => x.effectiveFrom <= date);
    return p.length ? (p[p.length - 1]?.monthlyPaise ?? null) : null;
  };
  const mealBill = (companyId: string, period: string): MealBillRow[] => {
    const dim = daysInMonth(period);
    const last = period === monthOf(today) ? today : `${period}-${String(dim).padStart(2, '0')}`;
    const rows: MealBillRow[] = [];
    s.employees.filter((e) => e.companyId === companyId).forEach((e) => {
      let days = 0;
      let amount = 0;
      for (let d = 1; d <= dim; d++) {
        const day = `${period}-${String(d).padStart(2, '0')}`;
        if (day > last) break;
        const covered = s.meals.some((m) => m.employeeId === e.id && m.startsOn <= day && (m.endsOn === null || m.endsOn >= day));
        if (!covered) continue;
        days += 1;
        amount += (priceOn(day) ?? 0) / dim;
      }
      if (days > 0) rows.push({ employeeId: e.id, employeeName: e.name, designation: e.designation, days, amountPaise: Math.round(amount) });
    });
    return rows;
  };
  const overlapping = (employeeId: string, starts: string, ends: string | null, except?: string) =>
    s.meals.find((m) => m.employeeId === employeeId && m.id !== except && m.startsOn <= (ends ?? '9999-12-31') && (m.endsOn === null || m.endsOn >= starts));
  const periodLabel = (m: { startsOn: string; endsOn: string | null }) =>
    m.endsOn ? `${formatDate(m.startsOn)} to ${formatDate(m.endsOn)}` : `from ${formatDate(m.startsOn)}`;
  const closedMsg = (date: string) => {
    const c = mealsClosedThrough();
    return `Salary has already been generated for ${formatMonth(monthOf(date))}, so its meals bill is closed. Changes can start from ${formatMonth(addMonths(c ?? monthOf(today), 1))} onwards.`;
  };

  // ---- separations
  const toSeparation = (x: SeparationSeed): Separation => {
    const e = emp(x.employeeId);
    return {
      ...x, companyId: e?.companyId ?? 'pc1', employeeName: e?.name ?? 'Former employee', designation: e?.designation ?? '',
      ...(e ? { employeeCode: e.code, joiningDate: e.joiningDate } : {}), canEdit: true, canDelete: true,
    };
  };
  const checkSeparation = (companyId: string, i: SeparationInput, exceptId?: string): Record<string, string> => {
    const f: Record<string, string> = {};
    const e = emp(i.employeeId);
    if (!e || e.companyId !== companyId) f.employeeId = 'Choose an employee of this company.';
    if (!i.type) f.type = 'Choose the exit type.';
    if (!isDate(i.resignationDate)) f.resignationDate = 'Enter the resignation date.';
    if (!isDate(i.lastWorkingDate)) f.lastWorkingDate = 'Enter the last working day.';
    else if (isDate(i.resignationDate) && i.lastWorkingDate < i.resignationDate) f.lastWorkingDate = 'The last working day cannot be before the resignation date.';
    if (!i.reason.trim()) f.reason = 'Enter the reason.';
    if (!f.employeeId && s.separations.some((x) => x.employeeId === i.employeeId && x.rejoinedOn === null && x.id !== exceptId)) {
      f.employeeId = 'This employee already has an open separation record.';
    }
    return f;
  };

  // ---- reports: the per-day pay the period report adds up (the mock's stand-in for Pallav's daily attendance rows)
  /** A fixed hash, so a record's days are laid out the same way on every call. */
  const seedOf = (text: string) => [...text].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  /**
   * One salary record day by day, made from its monthly counts: `frac` = the paid share of each day (0, 0.25, 0.5, 0.75 or 1;
   * index 0 = the 1st), `ot` = each day's overtime in half-hours, `lineDay` = the day of the month each of `r.lines` falls on
   * (a bonus or incentive on the day it was given; 0 = a monthly item, spread over the calendar days).
   */
  const dayPlan = (r: SalaryRecord): { frac: number[]; ot: number[]; lineDay: number[] } => {
    const dim = Math.max(1, r.daysInMonth);
    const seed = seedOf(`${r.employeeId}:${r.period}`);
    const frac = Array<number>(dim).fill(-1);
    // Unpaid and part days sit at spread-out places; the full days fill the rest, then any day the month's counts leave out pays 0.
    const special = [...Array<number>(r.days.p0).fill(0), ...Array<number>(r.days.p25).fill(0.25), ...Array<number>(r.days.p50).fill(0.5), ...Array<number>(r.days.p75).fill(0.75)].slice(0, dim);
    special.forEach((f, k) => {
      let d = (seed + k * 11) % dim;
      while (frac[d] !== -1) d = (d + 1) % dim;
      frac[d] = f;
    });
    let fullLeft = r.days.p100;
    for (let d = 0; d < dim; d++) if (frac[d] === -1) frac[d] = fullLeft-- > 0 ? 1 : 0;
    // Overtime in half-hour pieces on worked days.
    const worked = frac.map((f, d) => (f > 0 ? d : -1)).filter((d) => d >= 0);
    const onDays = worked.length ? worked : frac.map((_, d) => d);
    const ot = Array<number>(dim).fill(0);
    const pieces = Math.round(r.otHours * 2);
    for (let j = 0; j < pieces; j++) {
      const d = onDays[(seed * 3 + j * 5) % onDays.length] ?? 0;
      ot[d] = (ot[d] ?? 0) + 1;
    }
    if (r.otHours > 0 && pieces === 0) ot[onDays[0] ?? 0] = 1;
    // A bonus / incentive line lands on the day of its entry (same employee, month, type and amount); else on the last day.
    const used = new Set<string>();
    const lineDay = r.lines.map((l) => {
      if (l.category !== 'Bonus' && l.category !== 'Incentive') return 0;
      const entry = s.bonus.find((b) => !used.has(b.id) && b.employeeId === r.employeeId && monthOf(b.date) === r.period && b.type === l.category && b.amountPaise === l.paise);
      if (!entry) return dim;
      used.add(entry.id);
      return Math.min(dim, Number(day(entry.date).slice(8, 10)) || dim);
    });
    return { frac, ot, lineDay };
  };
  const sumTo = (w: number[], n: number) => w.slice(0, Math.max(0, n)).reduce((t, x) => t + x, 0);
  /** The part of a monthly `total` that falls on days a..b (1-based), weighted by `w`: rounded on running totals, so the days add up to it. */
  const partOf = (total: number, w: number[], a: number, b: number) => {
    const all = sumTo(w, w.length);
    if (!all || !total) return 0;
    const upTo = (n: number) => Math.round((total * sumTo(w, n)) / all);
    return upTo(b) - upTo(a - 1);
  };
  const reportOf =(rows: SalaryRecord[], meals: number | null): ReportResult => ({
    rows,
    totals: rows.reduce((t, r) => ({
      salaryPaise: t.salaryPaise + r.monthlySalaryPaise, attendancePaise: t.attendancePaise + r.attendanceSalaryPaise,
      otHours: t.otHours + r.otHours, otPaise: t.otPaise + r.otAmountPaise, bonusPaise: t.bonusPaise + r.bonusPaise,
      incentivePaise: t.incentivePaise + r.incentivePaise, deductionsPaise: t.deductionsPaise + r.deductions.reduce((x, d) => x + d.paise, 0),
      advancePaise: t.advancePaise + r.advanceRecoveryPaise, netPaise: t.netPaise + r.netPaise, payableDays: t.payableDays + r.payableDays,
    }), { salaryPaise: 0, attendancePaise: 0, otHours: 0, otPaise: 0, bonusPaise: 0, incentivePaise: 0, deductionsPaise: 0, advancePaise: 0, netPaise: 0, payableDays: 0 }),
    mealsBillPaise: meals,
  });

  // ---- letters
  const fill = (text: string, values: Record<string, string>) => text.replace(/\{[A-Z_]+\}/g, (t) => values[t] ?? t);

  const letterDoc = (t: LetterTemplate, values: Record<string, string>, details: { label: string; value: string }[], to: string[]): PayrollDoc => {
    const co = company(t.companyId);
    const blocks: DocBlock[] = [
      { kind: 'kv', items: [{ label: 'Date', value: formatDate(today) }, ...to.map((v, i) => ({ label: i === 0 ? 'To' : '', value: v }))] },
      { kind: 'heading', text: fill(t.subject, values) },
    ];
    const paras = t.sections.filter((x) => x.id !== 'acceptance' && x.text.trim());
    paras.slice(0, 1).forEach((x) => fill(x.text, values).split('\n').forEach((p) => blocks.push({ kind: 'para', text: p })));
    blocks.push({ kind: 'kv', title: t.kind === 'joining' ? 'Appointment details' : 'Service record', items: details });
    paras.slice(1).forEach((x) => fill(x.text, values).split('\n').forEach((p) => blocks.push({ kind: 'para', text: p })));
    // Pallav's signature caption: the signatory's "Closing text" above the space to sign.
    if (t.signatoryClosingText?.trim()) fill(t.signatoryClosingText, values).split('\n').forEach((p) => blocks.push({ kind: 'para', text: p }));
    blocks.push({ kind: 'signatures', items: [{ name: t.signatoryName || 'Authorised signatory', role: `${t.signatoryDesignation || 'For'} · ${co?.name ?? ''}` }] });
    const acc = t.sections.find((x) => x.id === 'acceptance');
    if (t.kind === 'joining' && (t.acceptanceHeading?.trim() || acc?.text.trim())) {
      blocks.push({ kind: 'heading', text: t.acceptanceHeading?.trim() ? fill(t.acceptanceHeading, values) : 'Employee Acceptance' });
      if (acc?.text.trim()) blocks.push({ kind: 'para', text: fill(acc.text, values) });
      if (t.acceptanceClosingText?.trim()) blocks.push({ kind: 'para', text: fill(t.acceptanceClosingText, values) });
      blocks.push({ kind: 'signatures', items: [{ name: values['{EMPLOYEE_NAME}'] ?? '', role: 'Employee signature' }, { name: '', role: 'Date' }] });
    }
    // Pallav's letter head: the address, then the company's mobile (and email when set).
    const contact = [co?.mobile, co?.email].filter((x): x is string => !!x?.trim()).join(' · ');
    return {
      companyName: co?.name ?? '', companyLine: `${co?.address ?? ''}${contact ? ` · ${contact}` : ''} · GSTIN ${co?.gstin ?? ''}`,
      title: t.kind === 'joining' ? 'Joining Letter' : 'Experience Letter', subtitle: t.kind === 'experience' ? 'To whomsoever it may concern' : undefined, blocks,
    };
  };

  // ---- salary generation (Attendance's Generate / Re-Generate; Pallav app/Services/Payroll/SalaryProcessor.php)
  /** What each record applied, so a re-generate gives it back first (Pallav reverse()). carried = [carry-forward id, parent advance id]. */
  const applied = new Map<string, { advances: [string, number][]; carried: [string, string][]; oneTime: string[] }>();
  const settledOneTime = new Set<string>();
  // The seed's recoveries, tied to the advance they came from (so re-generating a seeded month gives them back).
  for (const r of s.records) {
    const end = `${r.period}-${String(r.daysInMonth).padStart(2, '0')}`;
    const own = s.advances.filter((a) => a.employeeId === r.employeeId && !a.isCarryForward && day(a.date) <= end).sort((a, b) => b.date.localeCompare(a.date));
    const carried = s.advances.filter((a) => a.employeeId === r.employeeId && a.isCarryForward && day(a.date) === `${addMonths(r.period, 1)}-01`);
    if (!r.advanceRecoveryPaise && !carried.length) continue;
    applied.set(r.id, {
      advances: r.advanceRecoveryPaise && own[0] ? [[own[0].id, r.advanceRecoveryPaise]] : [],
      carried: own[0] ? carried.map((c): [string, string] => [c.id, own[0]?.id ?? '']) : [],
      oneTime: [],
    });
  }
  const reverseMonth = (companyId: string, period: string): SalaryRecord[] => {
    const old = s.records.filter((r) => r.companyId === companyId && r.period === period);
    for (const r of old) {
      const a = applied.get(r.id);
      if (!a) continue;
      const touched = new Set<string>();
      for (const [carryId, parentId] of a.carried) {
        const c = s.advances.find((x) => x.id === carryId);
        const p = s.advances.find((x) => x.id === parentId);
        if (c && p) { p.recoveredPaise = Math.max(0, p.recoveredPaise - c.amountPaise); touched.add(p.id); }
        s.advances = s.advances.filter((x) => x.id !== carryId);
      }
      for (const [advId, paise] of a.advances) {
        const adv = s.advances.find((x) => x.id === advId);
        if (adv) { adv.recoveredPaise = Math.max(0, adv.recoveredPaise - paise); touched.add(adv.id); }
      }
      a.oneTime.forEach((k) => settledOneTime.delete(k));
      touched.forEach((advId) => {
        const adv = s.advances.find((x) => x.id === advId);
        if (adv) adv.isSettled = adv.amountPaise - adv.recoveredPaise <= 0;
      });
      applied.delete(r.id);
    }
    s.records = s.records.filter((r) => !(r.companyId === companyId && r.period === period));
    return old;
  };
  const generateMonth = (companyId: string, period: string, rows: GenerateRow[], by: string): number => {
    // Payments are real-world events: a re-generate keeps them (Pallav).
    const prior = new Map(reverseMonth(companyId, period).map((r) => [r.employeeId, r]));
    const dim = daysInMonth(period);
    const start = `${period}-01`;
    const end = `${period}-${String(dim).padStart(2, '0')}`;
    const generation = Math.max(0, ...[...prior.values()].map((r) => r.generationCount)) + 1;
    let made = 0;
    for (const row of [...rows].sort((a, b) => (emp(a.employeeId)?.name ?? '').localeCompare(emp(b.employeeId)?.name ?? ''))) {
      const e = emp(row.employeeId);
      if (!e || e.companyId !== companyId) continue;
      // A salary revision inside the month pays its new rate only from its effective date (Pallav dailySalaryScheduleFor).
      const revs = s.history.filter((h) => h.employeeId === e.id && h.effectiveDate >= start && h.effectiveDate <= end)
        .flatMap((h) => h.changes.filter((c) => c.field === 'Salary').map((c) => ({ date: h.effectiveDate, at: h.changedAt, prev: c.previous, next: c.next })))
        .sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at));
      let rate = revs.length ? Math.round(Number(revs[0]?.prev ?? e.salaryPaise / 100) * 100) : e.salaryPaise;
      let k = 0;
      const days: SalaryDays = { p0: 0, p25: 0, p50: 0, p75: 0, p100: 0 };
      let attendance = 0;
      let otHours = 0;
      for (let d = 1; d <= dim; d++) {
        const date = `${period}-${String(d).padStart(2, '0')}`;
        while (k < revs.length && (revs[k]?.date ?? '9999') <= date) { rate = Math.round(Number(revs[k]?.next ?? 0) * 100); k += 1; }
        otHours += row.overtime[d - 1] ?? 0;
        const pct = row.percents[d - 1];
        if (pct === null || pct === undefined) continue;
        if (pct === 0) days.p0 += 1; else if (pct === 25) days.p25 += 1; else if (pct === 50) days.p50 += 1; else if (pct === 75) days.p75 += 1; else if (pct === 100) days.p100 += 1; else continue;
        attendance += (rate / dim) * (pct / 100);
      }
      attendance = Math.round(attendance);
      const payable = days.p25 * 0.25 + days.p50 * 0.5 + days.p75 * 0.75 + days.p100;
      const hours = e.dailyWorkingHours > 0 ? e.dailyWorkingHours : 1;
      const otAmount = Math.round((e.salaryPaise / dim / hours) * otHours);
      const bonusRows = s.bonus.filter((b) => b.employeeId === e.id && monthOf(day(b.date)) === period);
      const bonusPaise = bonusRows.filter((b) => b.type === 'Bonus').reduce((t, b) => t + b.amountPaise, 0);
      const incentivePaise = bonusRows.filter((b) => b.type === 'Incentive').reduce((t, b) => t + b.amountPaise, 0);
      const lines: SalaryLine[] = bonusRows.map((b) => ({ category: b.type, label: b.remarks || b.type, type: null, paise: b.amountPaise, pendingPaise: 0 }));
      const track = { advances: [] as [string, number][], carried: [] as [string, string][], oneTime: [] as string[] };
      // Deductions: monthly ones every month, a One Time one once.
      const deductions: PayLine[] = [];
      for (const d of row.deductions) {
        if (d.paise <= 0 || (d.type === 'One Time' && settledOneTime.has(d.key))) continue;
        deductions.push({ label: d.label, paise: d.paise });
        lines.push({ category: 'Deduction', label: d.label, type: d.type, paise: d.paise, pendingPaise: 0 });
        if (d.type === 'One Time') { settledOneTime.add(d.key); track.oneTime.push(d.key); }
      }
      const gross = attendance + otAmount + bonusPaise + incentivePaise;
      const afterDeductions = Math.max(0, gross - deductions.reduce((t, d) => t + d.paise, 0));
      // Advances: oldest first, never more than the salary can bear; the rest moves to a carry-forward dated the 1st of next month.
      // (The mock only takes advances dated in or before the month; Pallav takes every open one.)
      let budget = afterDeductions;
      let recovered = 0;
      let carried = 0;
      const open = s.advances.filter((a) => a.employeeId === e.id && !a.isSettled && day(a.date) <= end && a.amountPaise - a.recoveredPaise > 0)
        .sort((a, b) => a.date.localeCompare(b.date));
      for (const a of open) {
        const outstanding = a.amountPaise - a.recoveredPaise;
        const instalment = a.recoveryType === 'Monthly' ? Math.min(a.instalmentPaise, outstanding) : outstanding;
        const taken = Math.max(0, Math.min(instalment, budget));
        const remainder = outstanding - taken;
        if (taken > 0) {
          a.recoveredPaise += taken;
          lines.push({ category: 'Advance', label: a.remarks || 'Salary Advance', type: a.recoveryType, paise: taken, pendingPaise: remainder });
          track.advances.push([a.id, taken]);
          budget -= taken;
          recovered += taken;
        }
        if (remainder > 0) {
          a.recoveredPaise += remainder;
          const c = {
            id: nextId('a'), entryNo: String(s.advances.length + s.advanceBin.length + 1), companyId, employeeId: e.id, date: stamp(`${addMonths(period, 1)}-01`),
            amountPaise: remainder, recoveryType: a.recoveryType, instalmentPaise: Math.min(a.instalmentPaise, remainder), recoveredPaise: 0,
            isSettled: false, isCarryForward: true, remarks: `Carry Forward from Previous Month${a.remarks ? ` - ${a.remarks}` : ''}`, createdBy: 'System',
          };
          s.advances.push(c);
          track.carried.push([c.id, a.id]);
          carried += remainder;
        }
        a.isSettled = true;
      }
      const net = Math.max(0, afterDeductions - recovered);
      const before = prior.get(e.id);
      let status: PaymentStatus = before?.paymentStatus ?? 'Pending';
      if (status === 'Paid' && (before?.paidPaise ?? 0) < net) status = 'Partially Paid';
      const record: SalaryRecord = {
        id: `sp-${e.id}-${period}`, companyId, employeeId: e.id, employeeCode: e.code, employeeName: e.name, designation: e.designation, department: e.department,
        period, processedAt: stamp(today), monthlySalaryPaise: e.salaryPaise, dailyWorkingHours: e.dailyWorkingHours, daysInMonth: dim, days, payableDays: payable,
        otHours, dailySalaryPaise: Math.round(e.salaryPaise / dim), hourlyRatePaise: Math.round(e.salaryPaise / dim / hours),
        attendanceSalaryPaise: attendance, otAmountPaise: otAmount, bonusPaise, incentivePaise, deductions, lines,
        advanceRecoveryPaise: recovered, pendingAdvancePaise: carried, netPaise: net, paymentMode: e.paymentMode, bankName: e.bankName,
        accountNumber: e.accountNumber, ifscCode: e.ifscCode, branchName: e.branchName,
        paymentStatus: status, paidPaise: before?.paidPaise ?? 0, paidOn: before?.paidOn ?? null, reference: before?.reference ?? '', remarks: before?.remarks ?? '',
        paymentUpdatedBy: before?.paymentUpdatedBy ?? null, generationCount: generation, version: (before?.version ?? 0) + 1,
      };
      s.records.push(record);
      applied.set(record.id, track);
      made += 1;
    }
    log(companyId, 'created', 'Salary slip', formatMonth(period), `Salary ${generation > 1 ? 're-generated' : 'generated'} for ${made} employee${made === 1 ? '' : 's'}${by ? ` by ${by}` : ''}`);
    return made;
  };

  // ---- the link (see PayrollMockLink)
  if (link) {
    let source: (() => LinkedEmployee[]) | null = null;
    const views = new WeakMap<LinkedEmployee, PayEmployee>();
    const sync = () => {
      if (!source) return;
      s.employees = source().map((e) => {
        let v = views.get(e);
        if (!v) { v = linkedView(e); views.set(e, v); }
        return v;
      });
    };
    link.pay = {
      useEmployees: (src) => { source = src; sync(); },
      syncEmployees: sync,
      generate: (companyId, period, rows, by) => generateMonth(companyId, period, rows, by ?? ''),
      isUsed: (employeeId) => s.records.some((r) => r.employeeId === employeeId) || s.advances.some((a) => a.employeeId === employeeId)
        || s.bonus.some((b) => b.employeeId === employeeId) || s.meals.some((m) => m.employeeId === employeeId) || s.separations.some((x) => x.employeeId === employeeId),
      choices: (companyId, list) => {
        const items = s.master.filter((m) => m.list === list && m.isActive && (m.scope === 'all' || m.scope === companyId)).map((m) => m.label);
        return items.length ? items : [...(masterLists.find((l) => l.key === list)?.defaults ?? [])];
      },
      overview: (companyId) => {
        const period = processedPeriods(companyId)[0] ?? null;
        const rows = period ? s.records.filter((r) => r.companyId === companyId && r.period === period) : [];
        return {
          period,
          netPaise: rows.reduce((t, r) => t + r.netPaise, 0),
          paidPaise: rows.reduce((t, r) => t + r.paidPaise, 0),
          outstandingPaise: rows.reduce((t, r) => t + balanceOf(r), 0),
          openPayments: rows.filter((r) => balanceOf(r) > 0).length,
          processed: rows.length,
          advanceOutPaise: s.advances.filter((a) => a.companyId === companyId && !a.isSettled).reduce((t, a) => t + Math.max(0, a.amountPaise - a.recoveredPaise), 0),
          inNotice: s.separations.filter((x) => emp(x.employeeId)?.companyId === companyId && x.status !== 'Relieved' && !x.rejoinedOn).length,
          recent: s.log.filter((l) => l.companyId === companyId && l.status === 'success').sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5).map((l) => ({ ...l })),
        };
      },
    };
  }

  return {
    // ---------------- reference data
    /** The fixed payroll companies, in order (providesFood = code PF01). */
    listCompanies: () => call(() => ok(companies.slice())),
    /** The pickers: one company's staff, by name. */
    listEmployees: (companyId: string, activeOnly = true) => call(() => ok(
      s.employees.filter((e) => e.companyId === companyId && (!activeOnly || e.isActive)).sort((a, b) => a.name.localeCompare(b.name)),
    )),
    /** Payroll Master, else Pallav's defaults (same as core getOptions). */
    masterChoices: (companyId: string, list: MasterListKey) => call(() => {
      const items = s.master.filter((m) => m.list === list && m.isActive && (m.scope === 'all' || m.scope === companyId)).map((m) => m.label);
      return ok(items.length ? items : (masterLists.find((l) => l.key === list)?.defaults ?? []));
    }),

    // ---------------- salary update
    /** Active staff, latest revised first, then by name. */
    listSalaryProfiles: (companyId: string, q: ListQuery = {}) => call((): DashResult<Page<SalaryProfile>> => {
      if (!company(companyId)) return selectFirst();
      const rows: SalaryProfile[] = s.employees.filter((e) => e.companyId === companyId && e.isActive).map((e) => {
        const h = s.history.filter((x) => x.employeeId === e.id).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
        return { employee: e, lastRevisedOn: h[0]?.effectiveDate ?? null, revisionCount: h.length };
      }).sort((a, b) => (b.lastRevisedOn ?? '').localeCompare(a.lastRevisedOn ?? '') || a.employee.name.localeCompare(b.employee.name));
      return ok(pageOf(rows, q, (r, x) => empMatch(r.employee.name, x) || r.employee.designation.toLowerCase().includes(x) || r.employee.code.toLowerCase().includes(x)));
    }),
    getSalaryProfile: (companyId: string, employeeId: string) => call((): DashResult<{ employee: PayEmployee; history: SalaryRevision[] }> => {
      const e = emp(employeeId);
      if (!e || e.companyId !== companyId) return mockError('NOT_FOUND');
      const history = s.history.filter((x) => x.employeeId === e.id)
        .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.changedAt.localeCompare(a.changedAt))
        .map(({ employeeId: _drop, ...rest }) => rest);
      return ok({ employee: e, history });
    }),
    reviseSalary: (companyId: string, employeeId: string, i: SalaryRevisionInput) => call((): DashResult<{ changed: number; message: string }> => {
      const e = emp(employeeId);
      if (!e || e.companyId !== companyId) return mockError('NOT_FOUND');
      const f: Record<string, string> = {};
      const hours = Number(i.dailyWorkingHours);
      const account = i.accountNumber === undefined ? undefined : i.accountNumber.replace(/\s+/g, '');
      if (!isDate(i.effectiveDate)) f.effectiveDate = 'Enter the effective date.';
      if (i.salaryPaise === null || i.salaryPaise < 0) f.salaryPaise = 'Enter the monthly salary.';
      if (!Number.isFinite(hours) || hours < 0.5 || hours > 24) f.dailyWorkingHours = 'Working hours must be between 0.5 and 24.';
      if (!i.paymentMode) f.paymentMode = 'Choose the payment mode.';
      if (i.paymentMode === 'Bank') {
        if (!i.bankName.trim()) f.bankName = 'Enter the bank name.';
        if (account === undefined ? !e.accountNumber : !account) f.accountNumber = 'Enter the account number.';
        if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(i.ifscCode.trim().toUpperCase())) f.ifscCode = 'Enter a valid IFSC code, e.g. SBIN0001234.';
      }
      if (Object.keys(f).length) return fail(f);
      const nextAccount = account === undefined ? e.accountNumber : account || null;
      const next: Record<string, [string, string | null, string | null]> = {
        salaryPaise: ['Salary', String(e.salaryPaise / 100), String((i.salaryPaise ?? 0) / 100)],
        designation: ['Designation', e.designation, i.designation.trim()],
        department: ['Department', e.department, i.department.trim()],
        dailyWorkingHours: ['Working Hours', String(e.dailyWorkingHours), String(hours)],
        paymentMode: ['Salary Payment Type', e.paymentMode, i.paymentMode],
        bankName: ['Bank Name', e.bankName, i.bankName.trim()],
        accountHolderName: ['Account Holder Name', e.accountHolderName, i.accountHolderName.trim()],
        accountNumber: ['Account Number', e.accountNumber, nextAccount],
        ifscCode: ['IFSC Code', e.ifscCode, i.ifscCode.trim().toUpperCase()],
        branchName: ['Branch Name', e.branchName, i.branchName.trim()],
      };
      const changes: SalaryChange[] = [];
      Object.values(next).forEach(([field, prev, nv]) => {
        if ((prev ?? '') !== (nv ?? '')) changes.push({ id: nextId('hc'), field, previous: prev || null, next: nv || null });
      });
      if (!changes.length) return conflict('No tracked fields were changed.');
      Object.assign(e, {
        salaryPaise: i.salaryPaise ?? e.salaryPaise, designation: i.designation.trim() || e.designation, department: i.department.trim(),
        dailyWorkingHours: hours, paymentMode: i.paymentMode, bankName: i.bankName.trim(), accountHolderName: i.accountHolderName.trim(),
        accountNumber: nextAccount, ifscCode: i.ifscCode.trim().toUpperCase(), branchName: i.branchName.trim(),
      });
      s.history.push({ employeeId, batchId: nextId('hb'), effectiveDate: i.effectiveDate, changedAt: stamp(today), changedBy: actor, changes });
      log(e.companyId, 'updated', 'Salary update', e.name, `${changes.length} field(s) changed, effective ${formatDate(i.effectiveDate)}`);
      return ok({ changed: changes.length, message: `${changes.length} field(s) updated and recorded in the update history.` });
    }),

    // ---------------- payments
    /** "YYYY-MM", newest first. */
    processedPeriods: (companyId: string) => call(() => ok(processedPeriods(companyId))),
    /** No period = the latest processed month (Pallav resolveMonth; the current month when none is). */
    listPayments: (companyId: string, period?: string, q?: PaymentListQuery) => call((): DashResult<PaymentMonth> => {
      if (!company(companyId)) return selectFirst();
      const p = period ?? processedPeriods(companyId)[0] ?? monthOf(today);
      const rows = s.records.filter((r) => r.companyId === companyId && r.period === p)
        .sort((a, b) => (a.paidOn === null ? -1 : 0) - (b.paidOn === null ? -1 : 0) || (b.paidOn ?? '').localeCompare(a.paidOn ?? '') || a.employeeName.localeCompare(b.employeeName));
      const byStatus = Object.fromEntries(paymentStatuses.map((st) => [st, rows.filter((r) => r.paymentStatus === st).length])) as Record<PaymentStatus, number>;
      const summary: PaymentSummary = {
        netPaise: rows.reduce((t, r) => t + r.netPaise, 0), paidPaise: rows.reduce((t, r) => t + r.paidPaise, 0),
        outstandingPaise: rows.reduce((t, r) => t + balanceOf(r), 0), fullyPaid: byStatus.Paid, total: rows.length, byStatus,
      };
      if (q?.page === undefined) return ok({ period: p, rows, summary });
      // Asked a page at a time: filter, order and cut here, like the server does; the summary above still counts the whole month.
      const needle = (q.search ?? '').trim().toLowerCase();
      let matching = rows.filter((r) => (!q.status || r.paymentStatus === q.status)
        && (!needle || `${r.employeeName} ${r.employeeCode} ${r.designation} ${r.reference}`.toLowerCase().includes(needle)));
      if (q.sort) {
        const key: Record<NonNullable<PaymentListQuery['sort']>, (r: SalaryRecord) => string | number> = {
          employee: (r) => r.employeeName.toLowerCase(), net: (r) => r.netPaise, paid: (r) => r.paidPaise, balance: (r) => balanceOf(r), paidOn: (r) => r.paidOn ?? '', status: (r) => r.paymentStatus,
        };
        const k = key[q.sort]; const dir = q.dir === 'desc' ? -1 : 1;
        matching = matching.slice().sort((a, b) => { const x = k(a), y = k(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
      }
      const size = [10, 25, 50, 100].includes(q.pageSize ?? 25) ? (q.pageSize ?? 25) : 25;
      const page = Math.max(1, q.page);
      return ok({ period: p, rows: matching.slice((page - 1) * size, page * size), summary, page: { page, pageSize: size, total: matching.length } });
    }),
    /** The lean picker: id, name, code, designation, by name or code prefix, at most 50. */
    lookupStaff: (companyId: string, q: PayStaffLookupQuery = {}) => call((): DashResult<PayStaffItem[]> => {
      const needle = (q.q ?? '').trim().toLowerCase();
      const limit = Math.min(50, Math.max(1, q.limit ?? 20));
      return ok(s.employees
        .filter((e) => e.companyId === companyId && (q.activeOnly === false || e.isActive) && (!needle || e.name.toLowerCase().startsWith(needle) || e.code.toLowerCase().startsWith(needle)))
        .sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit)
        .map((e) => ({ id: e.id, name: e.name, code: e.code, designation: e.designation })));
    }),
    updatePayment: (companyId: string, id: string, i: PaymentUpdateInput) => call((): DashResult<SalaryRecord> => {
      const r = s.records.find((x) => x.id === id && x.companyId === companyId);
      if (!r) return mockError('NOT_FOUND');
      if (i.version !== undefined && i.version !== r.version) return mockError('CONFLICT', undefined, { currentVersion: r.version });
      const settles = i.status === 'Paid' || i.status === 'Partially Paid';
      const f: Record<string, string> = {};
      if (i.status === 'Partially Paid' && (!i.paidPaise || i.paidPaise <= 0 || i.paidPaise >= r.netPaise)) {
        f.paidPaise = `A partial payment must be more than ₹0 and less than the net salary of ${formatINR(r.netPaise)}.`;
      }
      if (settles && i.paidOn && (!isDate(i.paidOn) || i.paidOn > today)) f.paidOn = 'The payment date cannot be in the future.';
      if (Object.keys(f).length) return fail(f);
      r.paymentStatus = i.status;
      r.paidPaise = i.status === 'Paid' ? r.netPaise : i.status === 'Partially Paid' ? (i.paidPaise ?? 0) : 0;
      r.paidOn = settles ? (i.paidOn || today) : null;
      r.reference = i.reference.trim() || (settles ? r.reference : '');
      r.remarks = i.remarks.trim();
      r.paymentUpdatedBy = actor;
      r.version += 1;
      log(r.companyId, 'updated', 'Salary payment', r.employeeName, `${formatMonth(r.period)} salary marked ${i.status}`);
      return ok(r);
    }),
    bulkUpdatePayments: (companyId: string, i: BulkPaymentInput) => call((): DashResult<{ updated: number; message: string }> => {
      if (!i.ids.length) return fail({ ids: 'Select at least one employee.' });
      if (!bulkPaymentStatuses.includes(i.status)) return fail({ status: 'Choose a status.' });
      if (i.paidOn && (!isDate(i.paidOn) || i.paidOn > today)) return fail({ paidOn: 'The payment date cannot be in the future.' });
      const rows = s.records.filter((r) => r.companyId === companyId && i.ids.includes(r.id));
      const stale = rows.find((r) => i.versions?.[r.id] !== undefined && i.versions[r.id] !== r.version);
      if (stale) return mockError('CONFLICT', undefined, { currentVersion: stale.version });
      rows.forEach((r) => {
        r.version += 1;
        r.paymentStatus = i.status;
        r.paidPaise = i.status === 'Paid' ? r.netPaise : 0;
        r.paidOn = i.status === 'Paid' ? (i.paidOn || today) : null;
        r.reference = i.reference.trim() || (i.status === 'Paid' ? r.reference : '');
        r.paymentUpdatedBy = actor;
      });
      log(companyId, 'updated', 'Salary payment', `${rows.length} employees`, `Salary marked ${i.status} for ${rows.length} employee(s)`);
      return ok({ updated: rows.length, message: `Salary marked ${i.status} for ${rows.length} employee(s).` });
    }),

    // ---------------- slips
    /**
     * Newest period first, newest processing within it. q.period narrows to one month; search (name, code, designation), status (the payment
     * status) and sort apply before paging. The summary covers q.period (else every slip) whatever the page, search, status or sort.
     */
    listSlips: (companyId: string, q: SlipListQuery = {}) => call((): DashResult<SlipList> => {
      if (!company(companyId)) return selectFirst();
      const bad = badListQuery(q, paymentStatuses, slipSorts);
      if (bad) return fail(bad);
      const own = s.records.filter((r) => r.companyId === companyId)
        .sort((a, b) => b.period.localeCompare(a.period) || b.processedAt.localeCompare(a.processedAt) || b.id.localeCompare(a.id));
      const inPeriod = q.period ? own.filter((r) => r.period === q.period) : own;
      const byStatus = Object.fromEntries(paymentStatuses.map((st) => [st, inPeriod.filter((r) => r.paymentStatus === st).length])) as Record<PaymentStatus, number>;
      const summary: SlipSummary = {
        period: q.period ?? null, slips: inPeriod.length, people: new Set(inPeriod.map((r) => r.employeeId)).size,
        netPaise: inPeriod.reduce((t, r) => t + r.netPaise, 0), paidPaise: inPeriod.reduce((t, r) => t + r.paidPaise, 0),
        outstandingPaise: inPeriod.reduce((t, r) => t + balanceOf(r), 0), byStatus, latestPeriod: own[0]?.period ?? null,
      };
      const kept = inPeriod.filter((r) => hasWords(q.search, r.employeeName, r.employeeCode, r.designation) && (!q.status || r.paymentStatus === q.status));
      const page = sortAndPage(kept, q, {
        period: (r) => r.period, employee: (r) => [r.employeeName.toLowerCase(), r.employeeCode.toLowerCase()], net: (r) => r.netPaise,
        processed: (r) => r.processedAt, status: (r) => r.paymentStatus,
      });
      return ok({ ...page, summary });
    }),
    getSlip: (companyId: string, id: string) => call((): DashResult<SalaryRecord> => {
      const r = s.records.find((x) => x.id === id && x.companyId === companyId);
      return r ? ok(r) : mockError('NOT_FOUND');
    }),

    // ---------------- advances
    /**
     * Newest first. q.period (the advance date's IST month), search (name, code, remarks, entry no), status or tab (open | settled) and sort apply
     * before paging. The summary is the period's LIVE advances (also in the recycle-bin view); counts are the period's rows of the view (live or bin).
     */
    listAdvances: (companyId: string, q: AdvanceListQuery = {}) => call((): DashResult<AdvanceList> => {
      if (!company(companyId)) return selectFirst();
      const bad = badListQuery(q, advanceStatuses, advanceSorts);
      if (bad) return fail(bad);
      const scoped = (pool: Store['advances']) => pool.filter((a) => a.companyId === companyId && (!q.period || istMonth(a.date) === q.period)).map(toAdvance)
        .sort((a, b) => b.date.localeCompare(a.date) || entryNumber(b.entryNo) - entryNumber(a.entryNo));
      const live = scoped(s.advances);
      const all = q.deleted ? scoped(s.advanceBin) : live;
      const carriedOut = (a: Advance) => live.filter((c) => c.isCarryForward && c.employeeId === a.employeeId && c.date > a.date && a.isSettled && a.recoveredPaise >= a.amountPaise && c.remarks.includes('Remainder')).reduce((t, c) => t + c.amountPaise, 0);
      const summary: AdvanceSummary = {
        issuedPaise: live.filter((a) => !a.isCarryForward).reduce((t, a) => t + a.amountPaise, 0),
        recoveredPaise: live.reduce((t, a) => t + a.recoveredPaise - carriedOut(a), 0),
        outstandingPaise: live.reduce((t, a) => t + a.outstandingPaise, 0),
        open: live.filter((a) => !a.isSettled).length,
      };
      const keep = (a: Advance, st: 'all' | AdvanceStatus | undefined) => (st === 'open' ? !a.isSettled : st === 'settled' ? a.isSettled : true);
      const kept = all.filter((a) => hasWords(q.search, a.employeeName, a.employeeCode, a.remarks, a.entryNo) && keep(a, q.tab) && keep(a, q.status));
      const page = sortAndPage(kept, q, {
        date: (a) => Date.parse(a.date) || 0, entryNo: (a) => entryNumber(a.entryNo), employee: (a) => [a.employeeName.toLowerCase(), a.employeeCode.toLowerCase()],
        amount: (a) => a.amountPaise, outstanding: (a) => a.outstandingPaise,
      });
      const open = all.filter((a) => !a.isSettled).length;
      return ok({ page, summary, counts: { all: all.length, open, settled: all.length - open } });
    }),
    createAdvance: (companyId: string, i: AdvanceInput) => call((): DashResult<Advance> => {
      if (!company(companyId)) return selectFirst();
      const f = checkAdvance(companyId, i);
      if (Object.keys(f).length) return fail(f);
      const amount = i.amountPaise ?? 0;
      const a = {
        id: nextId('a'), entryNo: String(s.advances.length + s.advanceBin.length + 1), companyId, employeeId: i.employeeId, date: stamp(i.date),
        amountPaise: amount, recoveryType: i.recoveryType, instalmentPaise: i.recoveryType === 'One Time' ? amount : (i.instalmentPaise ?? 0),
        recoveredPaise: 0, isSettled: false, isCarryForward: false, remarks: i.remarks.trim(), createdBy: actor,
      };
      s.advances.push(a);
      log(companyId, 'created', 'Advance', emp(i.employeeId)?.name ?? '', `Advance of ${formatINR(amount)} recorded (${i.recoveryType})`);
      return ok(toAdvance(a));
    }),
    updateAdvance: (companyId: string, id: string, i: AdvanceInput) => call((): DashResult<Advance> => {
      const a = s.advances.find((x) => x.id === id && x.companyId === companyId);
      if (!a) return mockError('NOT_FOUND');
      if (a.isCarryForward) return conflict('Carry-forward advances are generated by Salary Processing and cannot be edited.');
      if (isProcessed(a.companyId, a.employeeId, a.date)) return conflict('Salary Processing is already completed for this period, so this advance cannot be changed.');
      const f = checkAdvance(a.companyId, i);
      if (Object.keys(f).length) return fail(f);
      const amount = i.amountPaise ?? 0;
      Object.assign(a, { employeeId: i.employeeId, date: day(i.date) === day(a.date) ? a.date : stamp(i.date), amountPaise: amount, recoveryType: i.recoveryType, instalmentPaise: i.recoveryType === 'One Time' ? amount : (i.instalmentPaise ?? 0), remarks: i.remarks.trim() });
      log(a.companyId, 'updated', 'Advance', emp(a.employeeId)?.name ?? '', `Advance ${a.entryNo} updated`);
      return ok(toAdvance(a));
    }),
    /** To the recycle bin. */
    deleteAdvance: (companyId: string, id: string) => call((): DashResult<{ id: string }> => {
      const a = s.advances.find((x) => x.id === id && x.companyId === companyId);
      if (!a) return mockError('NOT_FOUND');
      if (a.isCarryForward) return conflict('Carry-forward advances are generated by Salary Processing and cannot be deleted.');
      if (isProcessed(a.companyId, a.employeeId, a.date)) return conflict('Salary Processing is already completed for this period, so this advance cannot be deleted.');
      s.advances = s.advances.filter((x) => x.id !== id);
      s.advanceBin.push(a);
      log(a.companyId, 'deleted', 'Advance', emp(a.employeeId)?.name ?? '', `Advance ${a.entryNo} of ${formatINR(a.amountPaise)} deleted`);
      return ok({ id });
    }),
    restoreAdvance: (companyId: string, id: string) => call((): DashResult<Advance> => {
      const a = s.advanceBin.find((x) => x.id === id && x.companyId === companyId);
      if (!a) return mockError('NOT_FOUND');
      s.advanceBin = s.advanceBin.filter((x) => x.id !== id);
      s.advances.push(a);
      return ok(toAdvance(a));
    }),
    purgeAdvance: (companyId: string, id: string) => call((): DashResult<{ id: string }> => {
      if (!s.advanceBin.some((x) => x.id === id && x.companyId === companyId)) return mockError('NOT_FOUND');
      s.advanceBin = s.advanceBin.filter((x) => x.id !== id);
      return ok({ id });
    }),

    // ---------------- bonus / incentive
    /**
     * Newest first. q.period (the entry date's IST month), search (name, code, remarks, type, entry no), status or tab (the entry type) and sort
     * apply before paging. The summary is the period's LIVE entries (also in the recycle-bin view); counts are the period's rows of the view.
     */
    listBonus: (companyId: string, q: BonusListQuery = {}) => call((): DashResult<BonusList> => {
      if (!company(companyId)) return selectFirst();
      const bad = badListQuery(q, bonusTypes, bonusSorts);
      if (bad) return fail(bad);
      const scoped = (pool: Store['bonus']) => pool.filter((b) => b.companyId === companyId && (!q.period || istMonth(b.date) === q.period)).map(toBonus)
        .sort((a, b) => b.date.localeCompare(a.date) || entryNumber(b.entryNo) - entryNumber(a.entryNo));
      const live = scoped(s.bonus);
      const all = q.deleted ? scoped(s.bonusBin) : live;
      const summary: BonusSummary = {
        bonusPaise: live.filter((b) => b.type === 'Bonus').reduce((t, b) => t + b.amountPaise, 0),
        incentivePaise: live.filter((b) => b.type === 'Incentive').reduce((t, b) => t + b.amountPaise, 0),
        people: new Set(live.map((b) => b.employeeId)).size,
      };
      const tab = q.tab === 'Bonus' || q.tab === 'Incentive' ? q.tab : undefined;
      const kept = all.filter((b) => hasWords(q.search, b.employeeName, b.employeeCode, b.remarks, b.type, b.entryNo) && (!tab || b.type === tab) && (!q.status || b.type === q.status));
      const page = sortAndPage(kept, q, {
        date: (b) => Date.parse(b.date) || 0, entryNo: (b) => entryNumber(b.entryNo), employee: (b) => [b.employeeName.toLowerCase(), b.employeeCode.toLowerCase()],
        amount: (b) => b.amountPaise, type: (b) => b.type,
      });
      return ok({ page, summary, counts: { all: all.length, Bonus: all.filter((b) => b.type === 'Bonus').length, Incentive: all.filter((b) => b.type === 'Incentive').length } });
    }),
    createBonus: (companyId: string, i: BonusInput) => call((): DashResult<BonusEntry> => {
      if (!company(companyId)) return selectFirst();
      const f = checkBonus(companyId, i, true);
      if (Object.keys(f).length) return fail(f);
      const closed = bonusMonthClosed(companyId, i);
      if (closed) return closed;
      const b = { id: nextId('b'), entryNo: String(s.bonus.length + s.bonusBin.length + 1), companyId, employeeId: i.employeeId, date: stamp(i.date), type: i.type, amountPaise: i.amountPaise ?? 0, remarks: i.remarks.trim() };
      s.bonus.push(b);
      log(companyId, 'created', 'Bonus / incentive', emp(i.employeeId)?.name ?? '', `${i.type} of ${formatINR(b.amountPaise)} recorded`);
      return ok(toBonus(b));
    }),
    updateBonus: (companyId: string, id: string, i: BonusInput) => call((): DashResult<BonusEntry> => {
      const b = s.bonus.find((x) => x.id === id && x.companyId === companyId);
      if (!b) return mockError('NOT_FOUND');
      if (isProcessed(b.companyId, b.employeeId, b.date)) return conflict('Salary Processing is already completed for this period, so this entry cannot be changed.');
      const f = checkBonus(b.companyId, i, false);
      if (Object.keys(f).length) return fail(f);
      const closed = bonusMonthClosed(companyId, i);
      if (closed) return closed;
      Object.assign(b, { employeeId: i.employeeId, date: day(i.date) === day(b.date) ? b.date : stamp(i.date), type: i.type, amountPaise: i.amountPaise ?? 0, remarks: i.remarks.trim() });
      log(b.companyId, 'updated', 'Bonus / incentive', emp(b.employeeId)?.name ?? '', `${b.entryNo} updated`);
      return ok(toBonus(b));
    }),
    deleteBonus: (companyId: string, id: string) => call((): DashResult<{ id: string }> => {
      const b = s.bonus.find((x) => x.id === id && x.companyId === companyId);
      if (!b) return mockError('NOT_FOUND');
      if (isProcessed(b.companyId, b.employeeId, b.date)) return conflict('Salary Processing is already completed for this period, so this entry cannot be deleted.');
      s.bonus = s.bonus.filter((x) => x.id !== id);
      s.bonusBin.push(b);
      log(b.companyId, 'deleted', 'Bonus / incentive', emp(b.employeeId)?.name ?? '', `${b.type} of ${formatINR(b.amountPaise)} deleted`);
      return ok({ id });
    }),
    restoreBonus: (companyId: string, id: string) => call((): DashResult<BonusEntry> => {
      const b = s.bonusBin.find((x) => x.id === id && x.companyId === companyId);
      if (!b) return mockError('NOT_FOUND');
      s.bonusBin = s.bonusBin.filter((x) => x.id !== id);
      s.bonus.push(b);
      return ok(toBonus(b));
    }),
    purgeBonus: (companyId: string, id: string) => call((): DashResult<{ id: string }> => {
      if (!s.bonusBin.some((x) => x.id === id && x.companyId === companyId)) return mockError('NOT_FOUND');
      s.bonusBin = s.bonusBin.filter((x) => x.id !== id);
      return ok({ id });
    }),

    // ---------------- staff meals (only the payroll companies that serve meals: HP01 and PF01)
    /** No period = this month; a later one = this month. */
    getMeals: (companyId: string, period?: string) => call((): DashResult<MealsOverview> => {
      const co = company(companyId);
      if (!co) return selectFirst();
      const p = !period || period > monthOf(today) ? monthOf(today) : period;
      const sorted = [...s.prices].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
      const inForceId = sorted.filter((x) => x.effectiveFrom <= today).pop()?.id;
      const prices: MealPrice[] = sorted.map((x, i) => ({
        id: x.id, effectiveFrom: x.effectiveFrom, monthlyPaise: x.monthlyPaise, previousPaise: i > 0 ? (sorted[i - 1]?.monthlyPaise ?? null) : null,
        inForce: x.id === inForceId, locked: mealsClosedFor(x.effectiveFrom), ...(x.createdAt ? { createdAt: x.createdAt } : {}),
      })).reverse();
      const staff: MealStaffRow[] = s.employees.filter((e) => e.companyId === companyId)
        .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name))
        .map((e) => {
          const periods = s.meals.filter((m) => m.employeeId === e.id).sort((a, b) => b.startsOn.localeCompare(a.startsOn));
          return { employee: e, periods, onMealsToday: periods.some((m) => m.startsOn <= today && (m.endsOn === null || m.endsOn >= today)) };
        });
      const bill = mealBill(companyId, p);
      const closed = mealsClosedThrough();
      const firstOpen = closed ? addMonths(closed, 1) : monthOf(today);
      return ok({
        period: p, today, canSetPrice: co.providesFood, currentPricePaise: priceOn(today),
        // The company's own close (meals records) and ANY company's close (the price): the mock closes both at the same month.
        closedThrough: closed, firstOpenMonth: firstOpen, priceClosedThrough: closed, firstOpenPriceMonth: firstOpen,
        prices, staff, bill, billTotalPaise: bill.reduce((t, r) => t + r.amountPaise, 0), billFinal: closed !== null && p <= closed,
      });
    }),
    /** Pallav Food only; Hotel Pallav answers 404 (Pallav abort_unless(providesFood, 404)). */
    addMealPrice: (companyId: string, i: { monthlyPaise: number | null; effectiveFrom: string }) => call((): DashResult<{ effectiveFrom: string; message: string }> => {
      if (!company(companyId)?.providesFood) return mockError('NOT_FOUND');
      const f: Record<string, string> = {};
      if (i.monthlyPaise === null || i.monthlyPaise < 0 || i.monthlyPaise > 100000000) f.monthlyPaise = 'Enter a price between ₹0 and ₹10,00,000.';
      if (!isDate(i.effectiveFrom)) f.effectiveFrom = 'Enter the start date.';
      else if (i.effectiveFrom > today) f.effectiveFrom = 'A price cannot start after today. Choose today or an earlier day in an open month.';
      else if (mealsClosedFor(i.effectiveFrom)) f.effectiveFrom = `Salary has already been generated for ${formatMonth(monthOf(i.effectiveFrom))}, so its meal price is closed.`;
      if (Object.keys(f).length) return fail(f);
      const same = s.prices.find((x) => x.effectiveFrom === i.effectiveFrom);
      if (same) same.monthlyPaise = i.monthlyPaise ?? 0;
      else s.prices.push({ id: nextId('mp'), effectiveFrom: i.effectiveFrom, monthlyPaise: i.monthlyPaise ?? 0, createdAt: stamp(today) });
      log(companyId, 'created', 'Meal price', formatINR(i.monthlyPaise ?? 0), `Meal price ${formatINR(i.monthlyPaise ?? 0)} per employee from ${formatDate(i.effectiveFrom)}`);
      return ok({
        effectiveFrom: i.effectiveFrom,
        message: `The price is now ${formatINR(i.monthlyPaise ?? 0)} per employee from ${formatDate(i.effectiveFrom)}. The earlier price stays on record.`,
      });
    }),
    deleteMealPrice: (companyId: string, id: string) => call((): DashResult<{ id: string; message: string }> => {
      if (!company(companyId)?.providesFood) return mockError('NOT_FOUND');
      const p = s.prices.find((x) => x.id === id);
      if (!p) return mockError('NOT_FOUND');
      if (mealsClosedFor(p.effectiveFrom)) return conflict(`Salary has already been generated for ${formatMonth(monthOf(p.effectiveFrom))}, so this price cannot be removed.`);
      s.prices = s.prices.filter((x) => x.id !== id);
      log(companyId, 'deleted', 'Meal price', formatINR(p.monthlyPaise), 'Meal price removed. Days it covered fall back to the price before it.');
      return ok({ id, message: 'Meal price removed. Days it covered fall back to the price before it.' });
    }),
    startMeals: (companyId: string, employeeId: string, i: { startsOn: string; endsOn: string }) => call((): DashResult<MealPeriod> => {
      const e = emp(employeeId);
      if (!e || e.companyId !== companyId) return mockError('NOT_FOUND');
      const f: Record<string, string> = {};
      const ends = i.endsOn.trim() ? i.endsOn : null;
      if (!isDate(i.startsOn)) f.startsOn = 'Enter the start date.';
      else if (i.startsOn > today) f.startsOn = 'Meals cannot start after today.';
      else if (i.startsOn < e.joiningDate) f.startsOn = `${e.name} joined on ${formatDate(e.joiningDate)}, so meals cannot start before that.`;
      else if (mealsClosedFor(i.startsOn)) f.startsOn = closedMsg(i.startsOn);
      if (ends !== null) {
        if (!isDate(ends)) f.endsOn = 'Enter a valid end date or leave it empty.';
        else if (ends > today) f.endsOn = 'The end date cannot be after today.';
        else if (isDate(i.startsOn) && ends < i.startsOn) f.endsOn = 'The end date cannot be before the start date.';
      }
      if (!f.startsOn && !f.endsOn) {
        const clash = overlapping(e.id, i.startsOn, ends);
        if (clash) f.startsOn = `${e.name} already has meals recorded for ${periodLabel(clash)}. Stop that first, or start after it.`;
      }
      if (Object.keys(f).length) return fail(f);
      const m: MealPeriod = { id: nextId('m'), employeeId: e.id, startsOn: i.startsOn, endsOn: ends, createdBy: actor };
      s.meals.push(m);
      log(e.companyId, 'created', 'Meals record', e.name, `${e.name} takes meals ${periodLabel(m)}`);
      return ok(m);
    }),
    stopMeals: (companyId: string, periodId: string, endsOn: string) => call((): DashResult<MealPeriod> => {
      const m = s.meals.find((x) => x.id === periodId && emp(x.employeeId)?.companyId === companyId);
      if (!m) return mockError('NOT_FOUND');
      if (!isDate(endsOn)) return fail({ endsOn: 'Enter the last day of meals.' });
      if (endsOn < m.startsOn) return fail({ endsOn: `The end date cannot be before the start date (${formatDate(m.startsOn)}).` });
      if (endsOn > today) return fail({ endsOn: 'The end date cannot be after today.' });
      const firstChanged = addDays(m.endsOn === null || endsOn < m.endsOn ? endsOn : m.endsOn, 1);
      if (mealsClosedFor(firstChanged)) return fail({ endsOn: closedMsg(firstChanged) });
      const clash = overlapping(m.employeeId, m.startsOn, endsOn, m.id);
      if (clash) return fail({ endsOn: `That would run into another record (${periodLabel(clash)}).` });
      m.endsOn = endsOn;
      const e = emp(m.employeeId);
      log(e?.companyId ?? null, 'updated', 'Meals record', e?.name ?? '', `${e?.name ?? ''} takes meals ${periodLabel(m)}`);
      return ok(m);
    }),
    /** To the recycle bin. */
    deleteMealPeriod: (companyId: string, periodId: string) => call((): DashResult<{ id: string; message: string }> => {
      const m = s.meals.find((x) => x.id === periodId && emp(x.employeeId)?.companyId === companyId);
      if (!m) return mockError('NOT_FOUND');
      if (mealsClosedFor(m.startsOn)) return conflict(`${closedMsg(m.startsOn)} To stop meals from a later day instead, end the record rather than removing it.`);
      s.meals = s.meals.filter((x) => x.id !== periodId);
      const e = emp(m.employeeId);
      log(e?.companyId ?? null, 'deleted', 'Meals record', e?.name ?? '', `The meals record for ${e?.name ?? ''} was removed`);
      return ok({ id: periodId, message: `The meals record for ${e?.name ?? 'the employee'} was removed.` });
    }),

    // ---------------- reports
    periodReport: (companyId: string, from: string, to: string, employeeId?: string) => call((): DashResult<ReportResult> => {
      if (!company(companyId)) return selectFirst();
      const f: Record<string, string> = {};
      if (!isDate(from)) f.from = 'Enter the from date.';
      if (!isDate(to)) f.to = 'Enter the to date.';
      if (!Object.keys(f).length) {
        if (from > to) f.to = 'From date must be on or before To date.';
        else if (monthOf(from) !== monthOf(to)) f.to = 'The selected date range must belong to the same month and year.';
        else if (to > today) f.to = 'The selected date range must not go past today.';
      }
      if (Object.keys(f).length) return fail(f);
      // Day by day: each day's pay comes from the record's day plan (attendance share, overtime, the day a bonus was given) and
      // only the chosen days are added up. The whole month gives back the monthly figures exactly.
      const first = Number(from.slice(8, 10));
      const last = Number(to.slice(8, 10));
      const part = (r: SalaryRecord): SalaryRecord => {
        const dim = r.daysInMonth;
        if (first <= 1 && last >= dim) return r;
        const plan = dayPlan(r);
        const inRange = (day: number) => day >= first && day <= last;
        // Earnings of each single day (attendance share, overtime, bonus / incentive on its day). Bonus / incentive not
        // itemised on a line (none in the mock) falls on the last day of the month.
        const dated = (cat: SalaryLineCategory, monthly: number, a: number, b: number) => {
          const listed = r.lines.filter((l) => l.category === cat).reduce((t, l) => t + l.paise, 0);
          const onDays = r.lines.reduce((t, l, k) => {
            const d = plan.lineDay[k] ?? 0;
            return l.category === cat && d >= a && d <= b ? t + l.paise : t;
          }, 0);
          return onDays + (dim >= a && dim <= b ? monthly - listed : 0);
        };
        const earned = (a: number, b: number) => partOf(r.attendanceSalaryPaise, plan.frac, a, b) + partOf(r.otAmountPaise, plan.ot, a, b)
          + dated('Bonus', r.bonusPaise, a, b) + dated('Incentive', r.incentivePaise, a, b);
        const daily = Array.from({ length: dim }, (_, i) => earned(i + 1, i + 1));
        // Deductions and advance recovery are taken from the days in proportion to what each day earned, so a day's net
        // is never below zero and the days add up to the month's net exactly (no per-day floor that would inflate the sum).
        // `taken` is what the month actually took (less than deductions + advance when the month's net was floored at 0).
        const gross = daily.reduce((t, x) => t + x, 0);
        const taken = gross - r.netPaise;
        const lines = r.lines.map((l, k) => {
          const day = plan.lineDay[k] ?? 0;
          return { ...l, paise: day ? (inRange(day) ? l.paise : 0) : partOf(l.paise, daily, first, last) };
        });
        const deductions = r.deductions.map((x) => ({ ...x, paise: partOf(x.paise, daily, first, last) }));
        const attendance = partOf(r.attendanceSalaryPaise, plan.frac, first, last);
        const ot = partOf(r.otAmountPaise, plan.ot, first, last);
        const bonus = dated('Bonus', r.bonusPaise, first, last);
        const incentive = dated('Incentive', r.incentivePaise, first, last);
        const advance = partOf(r.advanceRecoveryPaise, daily, first, last);
        const net = attendance + ot + bonus + incentive - partOf(taken, daily, first, last);
        const chosen = plan.frac.filter((_, i) => inRange(i + 1));
        const count = (f: number) => chosen.filter((x) => x === f).length;
        return {
          ...r,
          days: { p0: count(0), p25: count(0.25), p50: count(0.5), p75: count(0.75), p100: count(1) },
          payableDays: partOf(Math.round(r.payableDays * 100), plan.frac, first, last) / 100,
          otHours: partOf(Math.round(r.otHours * 100), plan.ot, first, last) / 100,
          attendanceSalaryPaise: attendance, otAmountPaise: ot, bonusPaise: bonus, incentivePaise: incentive,
          deductions, lines, advanceRecoveryPaise: advance, netPaise: net,
        };
      };
      const rows = s.records.filter((r) => r.companyId === companyId && r.period === monthOf(from) && (!employeeId || r.employeeId === employeeId))
        .sort((a, b) => a.employeeName.localeCompare(b.employeeName))
        .map(part);
      return ok(reportOf(rows, null));
    }),
    /** No period = the latest processed month. mealsBillPaise is null until task B6b on the server. */
    monthlyReport: (companyId: string, period?: string) => call((): DashResult<ReportResult & { period: string }> => {
      if (!company(companyId)) return selectFirst();
      const p = period ?? processedPeriods(companyId)[0] ?? monthOf(today);
      const rows = s.records.filter((r) => r.companyId === companyId && r.period === p).sort((a, b) => a.employeeName.localeCompare(b.employeeName));
      const meals = rows.length ? mealBill(companyId, p).reduce((t, r) => t + r.amountPaise, 0) : null;
      return ok({ ...reportOf(rows, meals), period: p });
    }),

    // ---------------- letters
    getLetterTemplate: (companyId: string, kind: LetterKind) => call((): DashResult<LetterTemplate | null> => {
      if (!company(companyId)) return selectFirst();
      return ok(s.templates.find((t) => t.companyId === companyId && t.kind === kind) ?? null);
    }),
    /** Pallav's rules: every field optional (subject max 255, signatory name max 150, designation max 100). */
    saveLetterTemplate: (companyId: string, kind: LetterKind, i: LetterTemplateInput) => call((): DashResult<LetterTemplate> => {
      if (!company(companyId)) return selectFirst();
      const f: Record<string, string> = {};
      if (i.subject.trim().length > 255) f.subject = 'Keep the subject to 255 characters.';
      if (i.signatoryName.trim().length > 150) f.signatoryName = 'Keep the signatory name to 150 characters.';
      if (i.signatoryDesignation.trim().length > 100) f.signatoryDesignation = 'Keep the designation to 100 characters.';
      const known = new Set(letterSectionDefs[kind].map((d) => d.id));
      i.sections.forEach((x, n) => { if (!known.has(x.id)) f[`sections.${n}.id`] = 'This section does not belong in this letter.'; });
      if (Object.keys(f).length) return fail(f);
      const existing = s.templates.find((t) => t.companyId === companyId && t.kind === kind);
      const next: LetterTemplate = {
        companyId, kind, subject: i.subject.trim(), sections: i.sections.map((x) => ({ ...x })), signatoryName: i.signatoryName.trim(),
        signatoryDesignation: i.signatoryDesignation.trim(), useCompanySignatory: i.useCompanySignatory ?? existing?.useCompanySignatory ?? true, signatureImageName: i.signatureImageName ?? existing?.signatureImageName ?? null, acceptanceHeading: i.acceptanceHeading ?? existing?.acceptanceHeading ?? '',
        signatoryClosingText: (i.signatoryClosingText ?? existing?.signatoryClosingText ?? '').trim(),
        ...(kind === 'joining' ? { acceptanceClosingText: (i.acceptanceClosingText ?? existing?.acceptanceClosingText ?? '').trim() } : {}),
        isActive: existing?.isActive ?? true, updatedAt: stamp(today),
      };
      s.templates = s.templates.filter((t) => t !== existing).concat(next);
      log(companyId, existing ? 'updated' : 'created', kind === 'joining' ? 'Joining letter' : 'Experience letter', 'Template', 'Letter template saved');
      return ok(next);
    }),
    toggleLetterTemplate: (companyId: string, kind: LetterKind) => call((): DashResult<LetterTemplate> => {
      const t = s.templates.find((x) => x.companyId === companyId && x.kind === kind);
      if (!t) return mockError('NOT_FOUND');
      t.isActive = !t.isActive;
      return ok(t);
    }),
    deleteLetterTemplate: (companyId: string, kind: LetterKind) => call((): DashResult<{ kind: LetterKind }> => {
      const before = s.templates.length;
      s.templates = s.templates.filter((t) => !(t.companyId === companyId && t.kind === kind));
      if (s.templates.length === before) return mockError('NOT_FOUND');
      log(companyId, 'deleted', kind === 'joining' ? 'Joining letter' : 'Experience letter', 'Template', 'Letter template deleted');
      return ok({ kind });
    }),
    /** 404 when no template exists. A switched-off template still prints (only the appointment EMAIL needs it on). */
    generateJoiningLetter: (companyId: string, employeeId: string) => call((): DashResult<PayrollDoc> => {
      const e = emp(employeeId);
      if (!e || e.companyId !== companyId) return mockError('NOT_FOUND');
      const t = s.templates.find((x) => x.companyId === e.companyId && x.kind === 'joining');
      if (!t) return mockError('NOT_FOUND', undefined, { message: 'No joining letter template configured for this company.' });
      const values: Record<string, string> = {
        '{EMPLOYEE_NAME}': e.name, '{DESIGNATION}': e.designation, '{DEPARTMENT}': e.department || 'General',
        '{RESPONSIBILITIES}': responsibilitiesByDesignation[e.designation] ?? 'duties assigned by your reporting manager.',
        '{JOINING_DATE}': formatDate(e.joiningDate), '{CURRENT_DATE}': formatDate(today),
      };
      return ok(letterDoc(t, values, [
        { label: 'Designation', value: e.designation }, { label: 'Department', value: e.department || 'General' },
        { label: 'Joining date', value: formatDate(e.joiningDate) }, { label: 'Working hours', value: `${e.dailyWorkingHours} hours a day` },
        { label: 'Monthly salary', value: formatINR(e.salaryPaise) }, { label: 'Payment mode', value: e.paymentMode },
      ], [e.name, `Employee ID ${e.code}`]));
    }),
    generateExperienceLetter: (companyId: string, separationId: string) => call((): DashResult<PayrollDoc> => {
      const x = s.separations.find((y) => y.id === separationId);
      const e = x ? emp(x.employeeId) : undefined;
      if (!x || !e || e.companyId !== companyId) return mockError('NOT_FOUND');
      if (x.status !== 'Relieved') return conflict('An experience letter can only be issued once the employee is marked Relieved.');
      const t = s.templates.find((y) => y.companyId === e.companyId && y.kind === 'experience');
      if (!t) return mockError('NOT_FOUND', undefined, { message: 'No experience letter template configured for this company.' });
      const values: Record<string, string> = {
        '{EMPLOYEE_NAME}': e.name, '{DESIGNATION}': e.designation, '{DEPARTMENT}': e.department || 'General',
        '{JOINING_DATE}': formatDate(e.joiningDate), '{LAST_WORKING_DATE}': formatDate(x.lastWorkingDate),
        '{DURATION}': serviceLength(e.joiningDate, x.lastWorkingDate), '{CURRENT_DATE}': formatDate(today),
      };
      return ok(letterDoc(t, values, [
        { label: 'Employee name', value: e.name }, { label: 'Employee ID', value: e.code },
        { label: 'Designation', value: e.designation }, { label: 'Department', value: e.department || 'General' },
        { label: 'Date of joining', value: formatDate(e.joiningDate) }, { label: 'Last working day', value: formatDate(x.lastWorkingDate) },
        { label: 'Total service', value: serviceLength(e.joiningDate, x.lastWorkingDate) }, { label: 'Reason for leaving', value: x.type },
      ], ['To whomsoever it may concern']));
    }),

    // ---------------- resignations
    /**
     * Latest last working day first. q.period (the last working day's month), search (name, code, reason, type, entry no), status (the record's
     * status) or tab (all | notice | relieved | rejoined) and sort apply before paging; the summary covers the period's records of the view
     * (live or bin) whatever the page, search, status, tab or sort. q.deleted = recycle bin.
     */
    listSeparations: (companyId: string, q: SeparationListQuery = {}) => call((): DashResult<{ page: Page<Separation>; summary: SeparationSummary }> => {
      if (!company(companyId)) return selectFirst();
      const bad = badListQuery(q, separationStatuses, separationSorts);
      if (bad) return fail(bad);
      const pool = q.deleted ? s.separationBin : s.separations;
      const all = pool.map(toSeparation).filter((x) => x.companyId === companyId && (!q.period || x.lastWorkingDate.slice(0, 7) === q.period))
        .sort((a, b) => b.lastWorkingDate.localeCompare(a.lastWorkingDate) || entryNumber(b.entryNo) - entryNumber(a.entryNo));
      const summary: SeparationSummary = {
        inNotice: all.filter((x) => x.status !== 'Relieved' && !x.rejoinedOn).length,
        relieved: all.filter((x) => x.status === 'Relieved' && !x.rejoinedOn).length,
        rejoined: all.filter((x) => x.rejoinedOn).length, all: all.length,
        byStatus: Object.fromEntries(separationStatuses.map((st) => [st, all.filter((x) => x.status === st).length])) as Record<SeparationStatus, number>,
      };
      const inTab = (x: Separation) => (q.tab === 'notice' ? x.status !== 'Relieved' && !x.rejoinedOn
        : q.tab === 'relieved' ? x.status === 'Relieved' && !x.rejoinedOn
          : q.tab === 'rejoined' ? Boolean(x.rejoinedOn) : true);
      const kept = all.filter((x) => hasWords(q.search, x.employeeName, x.employeeCode, x.reason, x.type, x.entryNo) && inTab(x) && (!q.status || x.status === q.status));
      const page = sortAndPage(kept, q, {
        lastWorkingDate: (x) => x.lastWorkingDate, resignationDate: (x) => x.resignationDate, employee: (x) => x.employeeName.toLowerCase(),
        entryNo: (x) => x.entryNo, status: (x) => x.status,
      });
      return ok({ page, summary });
    }),
    createSeparation: (companyId: string, i: SeparationInput) => call((): DashResult<Separation> => {
      if (!company(companyId)) return selectFirst();
      const f = checkSeparation(companyId, i);
      if (Object.keys(f).length) return fail(f);
      if (s.separations.some((x) => x.employeeId === i.employeeId && x.rejoinedOn === null)) return conflict('This employee already has an open separation record.');
      const x: SeparationSeed = {
        id: nextId('sep'), entryNo: `SEP-${String(s.separations.length + s.separationBin.length + 1).padStart(4, '0')}`, employeeId: i.employeeId, type: i.type,
        resignationDate: i.resignationDate, lastWorkingDate: i.lastWorkingDate, reason: i.reason.trim(), remarks: i.remarks.trim(),
        status: i.status, documentName: null, rejoinedOn: null, createdBy: actor,
      };
      s.separations.push(x);
      const e = emp(i.employeeId);
      if (e && i.status === 'Relieved') e.isActive = false;
      log(companyId, 'created', 'Resignation', e?.name ?? '', `Separation recorded, last working day ${formatDate(i.lastWorkingDate)}`);
      return ok(toSeparation(x));
    }),
    /** employeeId is ignored on an edit: a record never moves to another person. */
    updateSeparation: (companyId: string, id: string, i: SeparationInput) => call((): DashResult<Separation> => {
      const x = s.separations.find((y) => y.id === id);
      const e = x ? emp(x.employeeId) : undefined;
      if (!x || !e || e.companyId !== companyId) return mockError('NOT_FOUND');
      const f = checkSeparation(companyId, { ...i, employeeId: x.employeeId }, id);
      if (Object.keys(f).length) return fail(f);
      Object.assign(x, { type: i.type, resignationDate: i.resignationDate, lastWorkingDate: i.lastWorkingDate, reason: i.reason.trim(), remarks: i.remarks.trim(), status: i.status });
      if (!x.rejoinedOn) e.isActive = i.status !== 'Relieved';
      log(e.companyId, 'updated', 'Resignation', e.name, `Separation updated (${i.status})`);
      return ok(toSeparation(x));
    }),
    /** To the recycle bin. */
    deleteSeparation: (companyId: string, id: string) => call((): DashResult<{ id: string; message: string }> => {
      const x = s.separations.find((y) => y.id === id);
      const e = x ? emp(x.employeeId) : undefined;
      if (!x || !e || e.companyId !== companyId) return mockError('NOT_FOUND');
      s.separations = s.separations.filter((y) => y.id !== id);
      s.separationBin.push(x);
      e.isActive = true;
      log(e.companyId, 'deleted', 'Resignation', e.name, 'Separation record removed and the employee reactivated');
      return ok({ id, message: `The separation record for ${e.name} was removed.` });
    }),
    restoreSeparation: (companyId: string, id: string) => call((): DashResult<Separation> => {
      const x = s.separationBin.find((y) => y.id === id);
      const e = x ? emp(x.employeeId) : undefined;
      if (!x || !e || e.companyId !== companyId) return mockError('NOT_FOUND');
      s.separationBin = s.separationBin.filter((y) => y.id !== id);
      s.separations.push(x);
      if (!x.rejoinedOn) e.isActive = x.status !== 'Relieved';
      return ok(toSeparation(x));
    }),
    purgeSeparation: (companyId: string, id: string) => call((): DashResult<{ id: string }> => {
      const x = s.separationBin.find((y) => y.id === id);
      if (!x || emp(x.employeeId)?.companyId !== companyId) return mockError('NOT_FOUND');
      s.separationBin = s.separationBin.filter((y) => y.id !== id);
      return ok({ id });
    }),
    /** Pallav has no "after the last working day" rule. The phone is normalised by the server (a "+" names the country). */
    rejoin: (companyId: string, id: string, i: RejoinInput) => call((): DashResult<Separation> => {
      const x = s.separations.find((y) => y.id === id);
      const e = x ? emp(x.employeeId) : undefined;
      if (!x || !e || e.companyId !== companyId) return mockError('NOT_FOUND');
      const f: Record<string, string> = {};
      const hours = Number(i.dailyWorkingHours);
      const account = i.accountNumber === undefined ? undefined : i.accountNumber.replace(/\s+/g, '');
      if (!isDate(i.joiningDate)) f.joiningDate = 'Enter the new joining date.';
      if (!i.designation.trim()) f.designation = 'Enter the designation.';
      if (i.salaryPaise === null || i.salaryPaise < 0) f.salaryPaise = 'Enter the monthly salary.';
      if (!Number.isFinite(hours) || hours < 0.5 || hours > 24) f.dailyWorkingHours = 'Working hours must be between 0.5 and 24.';
      if (i.phone.trim() && !/^\+?[\d\s-]{6,20}$/.test(i.phone.trim())) f.phone = 'Enter a valid mobile number.';
      if (!i.paymentMode) f.paymentMode = 'Choose the payment mode.';
      if (i.paymentMode === 'Bank') {
        if (!i.bankName.trim()) f.bankName = 'Enter the bank name.';
        if (!i.accountHolderName.trim()) f.accountHolderName = 'Enter the account holder name.';
        if (account === undefined ? !e.accountNumber : !account) f.accountNumber = 'Enter the account number.';
        if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(i.ifscCode.trim().toUpperCase())) f.ifscCode = 'Enter a valid IFSC code, e.g. SBIN0001234.';
      }
      if (Object.keys(f).length) return fail(f);
      Object.assign(e, {
        joiningDate: i.joiningDate, designation: i.designation.trim(), department: i.department.trim(), salaryPaise: i.salaryPaise ?? 0,
        dailyWorkingHours: hours, phone: i.phone.trim() || e.phone, paymentMode: i.paymentMode, bankName: i.bankName.trim(),
        accountHolderName: i.accountHolderName.trim(), ifscCode: i.ifscCode.trim().toUpperCase(), isActive: true,
        ...(i.branchName !== undefined ? { branchName: i.branchName.trim() } : {}),
      });
      if (account !== undefined) e.accountNumber = account || null;
      x.rejoinedOn = i.joiningDate;
      log(e.companyId, 'updated', 'Resignation', e.name, `${e.name} has rejoined from ${formatDate(i.joiningDate)}`);
      return ok(toSeparation(x));
    }),

    // ---------------- payroll master
    getMaster: (scope: MasterScope, list: MasterListKey) => call(() => {
      const own = s.master.filter((m) => m.list === list && m.scope === scope).sort((a, b) => a.sortOrder - b.sortOrder);
      const inherited = scope === 'all' ? [] : s.master.filter((m) => m.list === list && m.scope === 'all').sort((a, b) => a.sortOrder - b.sortOrder);
      const counts = Object.fromEntries(masterLists.map((l) => [l.key, s.master.filter((m) => m.list === l.key && m.scope === scope).length])) as Record<MasterListKey, number>;
      return ok<MasterView>({ own, inherited, counts });
    }),
    createMasterItem: (scope: MasterScope, list: MasterListKey, i: MasterItemInput) => call(() => {
      const def = masterLists.find((l) => l.key === list);
      if (!def) return mockError('NOT_FOUND');
      const f: Record<string, string> = {};
      if (!i.label.trim()) f.label = 'Enter a name.';
      else if (i.label.trim().length > 120) f.label = 'Keep the name under 120 characters.';
      const value = def.isEmail ? i.value.trim().toLowerCase() : '';
      if (def.isEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) f.value = 'Enter a valid email address.';
      const dup = s.master.some((m) => m.list === list && m.scope === scope && (def.isEmail ? m.value === value : m.label.toLowerCase() === i.label.trim().toLowerCase()));
      if (!Object.keys(f).length && dup) f[def.isEmail ? 'value' : 'label'] = 'That is already in this list.';
      if (Object.keys(f).length) return fail(f);
      const item: MasterItem = { id: nextId('mi'), list, scope, label: i.label.trim(), value: def.isEmail ? value : null, isActive: true, sortOrder: s.seq };
      s.master.push(item);
      log(scope === 'all' ? null : scope, 'created', 'Payroll master', item.label, `Added "${item.label}" to ${def.name}`);
      return ok(item);
    }),
    // scope (the list's own scope, 'all' or a payroll company id) is what the real server needs to find the item; the mock finds it by id.
    updateMasterItem: (id: string, i: MasterItemInput, _scope: MasterScope = 'all') => call(() => {
      const m = s.master.find((x) => x.id === id);
      const def = masterLists.find((l) => l.key === m?.list);
      if (!m || !def) return mockError('NOT_FOUND');
      const f: Record<string, string> = {};
      if (!i.label.trim()) f.label = 'Enter a name.';
      const value = def.isEmail ? i.value.trim().toLowerCase() : '';
      if (def.isEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) f.value = 'Enter a valid email address.';
      const dup = s.master.some((x) => x.id !== id && x.list === m.list && x.scope === m.scope && (def.isEmail ? x.value === value : x.label.toLowerCase() === i.label.trim().toLowerCase()));
      if (!Object.keys(f).length && dup) f[def.isEmail ? 'value' : 'label'] = 'That is already in this list.';
      if (Object.keys(f).length) return fail(f);
      m.label = i.label.trim();
      m.value = def.isEmail ? value : null;
      log(m.scope === 'all' ? null : m.scope, 'updated', 'Payroll master', m.label, `Changed an item in ${def.name}`);
      return ok(m);
    }),
    toggleMasterItem: (id: string, _scope: MasterScope = 'all') => call(() => {
      const m = s.master.find((x) => x.id === id);
      if (!m) return mockError('NOT_FOUND');
      m.isActive = !m.isActive;
      return ok(m);
    }),
    deleteMasterItem: (id: string, _scope: MasterScope = 'all') => call(() => {
      const m = s.master.find((x) => x.id === id);
      if (!m) return mockError('NOT_FOUND');
      s.master = s.master.filter((x) => x.id !== id);
      log(m.scope === 'all' ? null : m.scope, 'deleted', 'Payroll master', m.label, `Removed "${m.label}"`);
      return ok({ id });
    }),

    // ---------------- log
    listLog: (scope: MasterScope, q: LogQuery = {}) => call(() => {
      const scoped = s.log.filter((l) => scope === 'all' || l.companyId === scope);
      const day = today;
      const weekFrom = addDays(today, -6);
      const dayOf = (iso: string) => iso.slice(0, 10);
      const filtered = scoped.filter((l) =>
        (!q.action || l.action === q.action) && (!q.entity || l.entity === q.entity) && (!q.status || l.status === q.status) &&
        (!q.user || l.userName === q.user) && (!q.from || dayOf(l.at) >= q.from) && (!q.to || dayOf(l.at) <= q.to) &&
        (!q.view || (q.view === 'today' ? dayOf(l.at) === day : q.view === 'week' ? dayOf(l.at) >= weekFrom
          : q.view === 'emails' ? l.action === 'emailed' : q.view === 'money' ? MONEY_ENTITIES.includes(l.entity)
            : q.view === 'deletions' ? l.action === 'deleted' : l.status === 'failed')),
      ).sort((a, b) => b.at.localeCompare(a.at));
      return ok<LogResult>({
        page: pageOf(filtered, { ...q, pageSize: q.pageSize ?? 25 }, (l, x) => [l.summary, l.subject, l.userName, l.companyName, l.details].some((v) => v.toLowerCase().includes(x))),
        stats: {
          total: scoped.length, today: scoped.filter((l) => dayOf(l.at) === day).length,
          emails: scoped.filter((l) => l.action === 'emailed' && l.status === 'success').length, failed: scoped.filter((l) => l.status === 'failed').length,
        },
        entities: [...new Set(scoped.map((l) => l.entity))].sort(),
        people: [...new Set(scoped.map((l) => l.userName))].sort(),
      });
    }),
  };
}

// ---------------------------------------------------------------------------
// Document builders (previews)
// ---------------------------------------------------------------------------

function docHead(co: PayrollCompanyRef | undefined): Pick<PayrollDoc, 'companyName' | 'companyLine'> {
  return { companyName: co?.name ?? '', companyLine: co ? `${co.address} · GSTIN ${co.gstin}` : '' };
}

export function payrollCompanyById(id: string): PayrollCompanyRef | undefined { return companies.find((c) => c.id === id); }

export function slipDoc(r: SalaryRecord): PayrollDoc {
  const gross = grossOf(r);
  const ded = totalDeductionsOf(r);
  const dedRows: string[][] = r.deductions.map((d) => [d.label, 'Fixed', formatINR(d.paise)]);
  if (r.advanceRecoveryPaise > 0) dedRows.push(['Advance recovery', 'From advances', formatINR(r.advanceRecoveryPaise)]);
  const payItems = [{ label: 'Method', value: r.paymentMode }, { label: 'Status', value: r.paymentStatus }, { label: 'Paid on', value: r.paidOn ? formatDate(r.paidOn) : 'Not paid yet' }];
  if (r.paymentMode === 'Bank') payItems.push({ label: 'Bank', value: r.bankName }, { label: 'Branch', value: r.branchName }, { label: 'Account', value: maskAccount(r.accountNumber) }, { label: 'IFSC', value: r.ifscCode });
  if (r.reference) payItems.push({ label: 'Reference', value: r.reference });
  return {
    ...docHead(payrollCompanyById(r.companyId)), title: 'Salary Slip', subtitle: `Pay period ${formatMonth(r.period)}`,
    blocks: [
      { kind: 'kv', items: [
        { label: 'Employee', value: r.employeeName }, { label: 'Employee ID', value: r.employeeCode },
        { label: 'Designation', value: r.designation }, { label: 'Monthly CTC', value: formatINR(r.monthlySalaryPaise) },
        { label: 'Working hours', value: `${r.dailyWorkingHours} hours a day` }, { label: 'Processed', value: formatDate(r.processedAt) },
      ] },
      { kind: 'kv', title: 'Attendance', items: [
        { label: 'Days in month', value: String(r.daysInMonth) }, { label: 'Full days (100%)', value: String(r.days.p100) },
        ...(r.days.p75 ? [{ label: 'Three-quarter days (75%)', value: String(r.days.p75) }] : []),
        { label: 'Half days (50%)', value: String(r.days.p50) },
        ...(r.days.p25 ? [{ label: 'Quarter days (25%)', value: String(r.days.p25) }] : []),
        { label: 'Unpaid days (0%)', value: String(r.days.p0) },
        { label: 'Payable days', value: String(r.payableDays) }, { label: 'Overtime', value: `${r.otHours} hrs` },
      ] },
      { kind: 'table', title: 'Earnings', columns: [{ header: 'Component', align: 'left' }, { header: 'Basis', align: 'left' }, { header: 'Amount', align: 'right' }],
        rows: [
          ['Attendance salary', `${r.payableDays} of ${r.daysInMonth} days`, formatINR(r.attendanceSalaryPaise)],
          ['Overtime', `${r.otHours} hrs`, formatINR(r.otAmountPaise)],
          ...(r.bonusPaise ? [['Bonus', 'This month', formatINR(r.bonusPaise)]] : []),
          ...(r.incentivePaise ? [['Incentive', 'This month', formatINR(r.incentivePaise)]] : []),
        ],
        footer: ['Gross earnings (A)', '', formatINR(gross)] },
      { kind: 'table', title: 'Deductions', columns: [{ header: 'Component', align: 'left' }, { header: 'Basis', align: 'left' }, { header: 'Amount', align: 'right' }],
        rows: dedRows.length ? dedRows : [['No deductions this month', '', formatINR(0)]], footer: ['Total deductions (B)', '', formatINR(ded)] },
      { kind: 'total', label: 'Net payable salary (A - B)', value: formatINR(r.netPaise), words: amountInWords(r.netPaise) },
      ...(r.pendingAdvancePaise > 0 ? [{ kind: 'para' as const, text: `Advance still to recover: ${formatINR(r.pendingAdvancePaise)}.` }] : []),
      { kind: 'kv', title: 'Payment details', items: payItems },
      { kind: 'signatures', items: [{ name: 'Employee', role: 'Signature' }, { name: 'Authorised signatory', role: payrollCompanyById(r.companyId)?.name ?? '' }] },
    ],
  };
}

export function registerDoc(companyId: string, m: PaymentMonth): PayrollDoc {
  return {
    ...docHead(payrollCompanyById(companyId)), title: 'Salary Payment Register', subtitle: formatMonth(m.period),
    blocks: [
      { kind: 'table', columns: [
        { header: 'Employee', align: 'left' }, { header: 'Mode', align: 'left' }, { header: 'Net salary', align: 'right' },
        { header: 'Paid', align: 'right' }, { header: 'Balance', align: 'right' }, { header: 'Paid on', align: 'right' }, { header: 'Status', align: 'left' },
      ], rows: [...m.rows].sort((a, b) => a.employeeName.localeCompare(b.employeeName)).map((r) => [
        `${r.employeeName} (${r.employeeCode})`, r.paymentMode, formatINR(r.netPaise), formatINR(r.paidPaise), formatINR(balanceOf(r)),
        r.paidOn ? formatDate(r.paidOn) : '-', r.paymentStatus,
      ]), footer: ['Total', '', formatINR(m.summary.netPaise), formatINR(m.summary.paidPaise), formatINR(m.summary.outstandingPaise), '', `${m.summary.fullyPaid} of ${m.summary.total} paid`] },
      { kind: 'signatures', items: [{ name: 'Prepared by', role: 'Accounts' }, { name: 'Approved by', role: 'Authorised signatory' }] },
    ],
  };
}

export function reportDoc(companyId: string, title: string, subtitle: string, r: ReportResult): PayrollDoc {
  const t = r.totals;
  return {
    ...docHead(payrollCompanyById(companyId)), title, subtitle,
    blocks: [
      { kind: 'table', columns: [
        { header: 'Employee', align: 'left' }, { header: 'Salary', align: 'right' }, { header: 'Payable', align: 'right' },
        { header: 'Attendance', align: 'right' }, { header: 'OT hrs', align: 'right' }, { header: 'OT', align: 'right' },
        { header: 'Bonus + Inc.', align: 'right' }, { header: 'Deductions', align: 'right' }, { header: 'Advance', align: 'right' }, { header: 'Net', align: 'right' },
      ], rows: r.rows.map((x) => [
        `${x.employeeName} (${x.employeeCode})`, formatINR(x.monthlySalaryPaise), String(x.payableDays), formatINR(x.attendanceSalaryPaise),
        String(x.otHours), formatINR(x.otAmountPaise), formatINR(x.bonusPaise + x.incentivePaise),
        formatINR(x.deductions.reduce((s, d) => s + d.paise, 0)), formatINR(x.advanceRecoveryPaise), formatINR(x.netPaise),
      ]), footer: ['Total', formatINR(t.salaryPaise), String(t.payableDays), formatINR(t.attendancePaise), String(t.otHours), formatINR(t.otPaise),
        formatINR(t.bonusPaise + t.incentivePaise), formatINR(t.deductionsPaise), formatINR(t.advancePaise), formatINR(t.netPaise)] },
      ...(r.mealsBillPaise !== null ? [
        { kind: 'kv' as const, items: [{ label: 'Net salary', value: formatINR(t.netPaise) }, { label: 'Staff meals bill', value: formatINR(r.mealsBillPaise) }] },
        { kind: 'total' as const, label: 'Grand total', value: formatINR(t.netPaise + r.mealsBillPaise), words: amountInWords(t.netPaise + r.mealsBillPaise) },
      ] : [{ kind: 'total' as const, label: 'Net salary', value: formatINR(t.netPaise), words: amountInWords(t.netPaise) }]),
      { kind: 'signatures', items: [{ name: 'Prepared by', role: 'Accounts' }, { name: 'Approved by', role: 'Authorised signatory' }] },
    ],
  };
}
