// The in-memory mock of adminSystem.ts (dev and local-demo builds only): loaded through ui-shared/mocks (web-app/src/lib/api/mockLoader.ts), never by app code.
// Dates are wall-clock strings around MOCK_TODAY with the IST offset, as Pallav's `created_at`. Paged and filtered like the server
// (web-app/src/server/services/systemAdmin/logService.ts and healthService.ts).
// The brand-new mock hotel (common.ts mockEmptyHotel): no log lines but "hotel created", no force log, no faults, no visits. The flag is read
// on every call, so the lists follow the hotel signed in now.
import { mockCall, mockEmptyHotel, mockError, ok, type DashResult, type MockClock, type Page } from './common';
import { MOCK_TODAY } from './payrollPay';
import {
  ACCESS_MODULES, MONEY_MODULES,
  type DailyUse, type FaultPage, type FaultQuery, type FeatureStatus, type ForceLogPage, type ForceLogQuery, type ForceLogRow, type HealthCheckRow, type HealthFault,
  type HealthFeature, type OverallStatus, type SystemAdminApi, type SystemHealthOverview, type SystemLogPage, type SystemLogQuery, type SystemLogRow, type RecordHistoryItem } from './adminSystem';

/** The new hotel's name (as ui-shared/auth-pallav/mock.ts `newhotel`). */
const NEW_HOTEL_NAME = 'Hotel Pearl, Surat';

const d = (day: number, time: string) => {
  const t = new Date(`${MOCK_TODAY}T00:00:00`);
  t.setDate(t.getDate() - day);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}T${time}+05:30`; // IST, so the "Exact time" reads the same in any browser zone
};

/* ------------------------------------------------------------------ System Log */

type Seed = [number, string, string, string | null, string, 'success' | 'failed', string, string | null, string, Record<string, string> | null, string | null];
// [day back, time, module, user, action, status, entity, subject, summary, details, ip]
const SYSTEM_SEED: Seed[] = [
  [0, '09:42:10', 'account', 'Super Admin', 'signed-in', 'success', 'Sign-in', 'superadmin', 'Signed in with a password: superadmin', { Ip: '127.0.0.1' }, '127.0.0.1'],
  [0, '09:15:44', 'revenue', 'Pooja Desai', 'created', 'success', 'Hotel deposit', 'HR-1042', 'Added a hotel revenue entry of ₹18,500.00', { Amount: '₹18,500.00', Mode: 'Cash', Date: '05 Nov 2026' }, '10.0.0.24'],
  [0, '08:58:02', 'bills', 'Ramesh Patel', 'updated', 'success', 'Bill', 'HS-0412', 'Changed bill HS-0412', { Rooms: '2 → 3', Total: '₹7,400.00 → ₹10,900.00' }, '10.0.0.18'],
  [0, '08:30:19', 'system', null, 'emailed', 'failed', 'Email', 'Shift summary', 'The shift summary email did not go: the mail server did not reply', { Reason: 'Connection timed out', To: 'owner@example.com' }, null],
  [1, '22:12:05', 'handover', 'Neha Joshi', 'created', 'success', 'Shift handover', 'Night shift', 'Handed over the night shift: ₹42,300.00 in the drawer', { Shift: 'Night', Cash: '₹42,300.00' }, '10.0.0.31'],
  [1, '19:44:50', 'expense', 'Pooja Desai', 'created', 'success', 'Expense', 'EXP-0214', 'Added an expense of ₹3,420.00 for Vegetables', { Category: 'Vegetables', Amount: '₹3,420.00' }, '10.0.0.24'],
  [1, '17:03:27', 'expense', 'Pooja Desai', 'deleted', 'success', 'Expense', 'EXP-0209', 'Deleted expense EXP-0209 (Gas cylinder, ₹1,450.00)', { Moved: 'Recycle bin' }, '10.0.0.24'],
  [1, '14:20:11', 'users', 'Super Admin', 'created', 'success', 'User', 'neha.joshi', 'Created the account neha.joshi (Cashier)', { Role: 'Cashier', 'Emailed code': 'On' }, '127.0.0.1'],
  [1, '11:08:36', 'account', 'Anita Shah', 'signed-in', 'failed', 'Sign-in', 'anita.shah', 'Sign-in refused: wrong password for anita.shah', { Ip: '103.21.44.108' }, '103.21.44.108'],
  [1, '11:09:52', 'account', 'Anita Shah', 'signed-in', 'success', 'Sign-in', 'anita.shah', 'Signed in with a password: anita.shah', { Ip: '103.21.44.108' }, '103.21.44.108'],
  [2, '21:30:00', 'frontdesk', 'Ramesh Patel', 'updated', 'success', 'Stay', 'Room 204', 'Checked in Rajesh Patel to Room 204', { Room: '204', Guests: '2', Nights: '3' }, '10.0.0.18'],
  [2, '16:41:12', 'companies', 'Anita Shah', 'updated', 'success', 'Company profile', 'Bhavani Traders', 'Changed the credit limit of Bhavani Traders', { 'Credit limit': '₹50,000.00 → ₹75,000.00' }, '103.21.44.108'],
  [2, '12:15:48', 'access', 'Super Admin', 'updated', 'success', 'Role', 'Cashier', 'Changed what the Cashier role may do', { Revenue: 'Edit → Full', Reports: 'None → View' }, '127.0.0.1'],
  [2, '09:02:30', 'revenue', 'Pooja Desai', 'created', 'success', 'Food deposit', 'FR-0588', 'Added a food revenue entry of ₹9,240.00', { Amount: '₹9,240.00', Mode: 'UPI' }, '10.0.0.24'],
  [3, '20:05:41', 'bills', 'Ramesh Patel', 'deleted', 'failed', 'Bill', 'HS-0398', 'Could not delete bill HS-0398: it has a payment', { Reason: 'Settled bills are locked' }, '10.0.0.18'],
  [3, '15:50:07', 'masters', 'Anita Shah', 'created', 'success', 'Master list', 'Payment modes', 'Added "Cheque" to Payment modes', { Value: 'Cheque' }, '103.21.44.108'],
  [3, '10:11:23', 'website', 'Anita Shah', 'updated', 'success', 'Page', 'Home', 'Updated the home page of the website', { Section: 'Hero text' }, '103.21.44.108'],
  [4, '18:22:15', 'system', 'Super Admin', 'updated', 'success', 'Setting', 'Backup', 'Changed the nightly backup time', { Time: '01:30 → 02:00' }, '127.0.0.1'],
  [4, '13:00:09', 'expense', 'Neha Joshi', 'created', 'success', 'Expense', 'EXP-0207', 'Added an expense of ₹860.00 for Cleaning', { Category: 'Cleaning', Amount: '₹860.00' }, '10.0.0.31'],
  [5, '23:40:00', 'handover', 'Neha Joshi', 'created', 'success', 'Shift handover', 'Evening shift', 'Handed over the evening shift: ₹31,950.00 in the drawer', { Shift: 'Evening', Cash: '₹31,950.00' }, '10.0.0.31'],
  [5, '09:30:55', 'users', 'Super Admin', 'updated', 'success', 'User', 'ramesh.patel', 'Reset the password of ramesh.patel', null, '127.0.0.1'],
  [6, '17:45:20', 'bills', 'Ramesh Patel', 'created', 'success', 'Bill', 'HS-0409', 'Created bill HS-0409 for Mehul Trivedi', { Total: '₹6,250.00' }, '10.0.0.18'],
  [8, '10:00:00', 'account', 'Mihir Jungiwala', 'signed-in', 'success', 'Sign-in', 'mihir', 'Signed in with a password: mihir', { Ip: '49.36.120.15' }, '49.36.120.15'],
  [9, '14:12:33', 'revenue', 'Pooja Desai', 'updated', 'success', 'Hotel deposit', 'HR-1030', 'Changed hotel revenue entry HR-1030', { Amount: '₹12,000.00 → ₹12,600.00' }, '10.0.0.24'],
  [11, '19:00:02', 'system', null, 'error', 'failed', 'Backup', 'Nightly backup', 'The nightly backup stopped: the disk was full', { Size: '181 MB', Reason: 'No space left on device' }, null],
];

const newestFirst = <T extends { at: string }>(a: T, b: T) => (a.at < b.at ? 1 : -1);

function systemLogSeed(empty: boolean): SystemLogRow[] {
  if (empty) {
    return [{ id: '1', module: 'system', userName: null, action: 'created', status: 'success', entity: 'Hotel', subject: NEW_HOTEL_NAME, summary: `The hotel ${NEW_HOTEL_NAME} was created`, details: null, ip: null, at: d(0, '09:00:00') }];
  }
  return SYSTEM_SEED.map(([day, time, module, userName, action, status, entity, subject, summary, details, ip], i) => ({
    id: String(i + 1), module, userName, action, status, entity, subject, summary, details, ip, at: d(day, time),
  })).sort(newestFirst);
}

/* ------------------------------------------------------------------ Force Log */

type FSeed = [number, string, string, string | null, ForceLogRow['action'], string, Record<string, string> | null, string | null, string | null, string | null];
// [day back, time, module, user, action, summary, details, method, path, route]
const FORCE_SEED: FSeed[] = [
  [0, '10:02:14', 'revenue', 'Super Admin', 'lock', 'Forced past a lock: revenue for 02 Nov 2026 is closed', { Lock: 'Revenue day closed' }, 'PUT', 'revenue/hotel/HR-1038', 'revenue.update'],
  [0, '10:01:40', 'system', 'Super Admin', 'armed', 'Force mode armed', { 'For': '30 minutes' }, 'POST', 'force-mode/arm', 'force-mode.arm'],
  [1, '18:30:00', 'bills', 'Super Admin', 'checks', 'Saved a bill that normal checks would refuse: total below advances', { Check: 'Advances above total', Bill: 'HS-0391' }, 'PUT', 'bill-master/bills/HS-0391', 'bill-master.update'],
  [1, '18:12:09', 'system', 'Super Admin', 'armed', 'Force mode armed', { 'For': '30 minutes' }, 'POST', 'force-mode/arm', 'force-mode.arm'],
  [1, '18:42:11', 'system', 'Super Admin', 'disarmed', 'Force mode turned off', null, 'POST', 'force-mode/disarm', 'force-mode.disarm'],
  [3, '12:20:45', 'expense', 'Anita Shah', 'lock', 'Forced past a lock: expense EXP-0198 is in a closed month', { Lock: 'Month closed' }, 'PUT', 'expense/EXP-0198', 'expense.update'],
  [3, '12:15:00', 'system', 'Anita Shah', 'armed', 'Force mode armed', { 'For': '30 minutes' }, 'POST', 'force-mode/arm', 'force-mode.arm'],
  [5, '09:10:30', 'handover', 'Super Admin', 'checks', 'Saved a handover that normal checks would refuse: cash count does not match', { Check: 'Cash count', Difference: '₹150.00' }, 'PUT', 'shift-handover/41', 'shift-handover.update'],
  [6, '09:05:00', 'system', 'Super Admin', 'armed', 'Force mode armed', { 'For': '30 minutes' }, 'POST', 'force-mode/arm', 'force-mode.arm'],
  [9, '16:40:12', 'revenue', 'Anita Shah', 'lock', 'Forced past a lock: food revenue for 28 Oct 2026 is closed', { Lock: 'Revenue day closed', Entry: 'FR-0571' }, 'PUT', 'revenue/food/FR-0571', 'revenue.update'],
  [12, '11:25:30', 'bills', 'Super Admin', 'checks', 'Saved a bill that normal checks would refuse: check-out before check-in', { Check: 'Dates out of order', Bill: '2026 / 1176' }, 'PUT', 'bill-master/bills/1176', 'bill-master.update'],
];

function forceLogSeed(empty: boolean): ForceLogRow[] {
  if (empty) return [];
  return FORCE_SEED.map(([day, time, module, userName, action, summary, details, method, path, route], i) => ({
    id: String(i + 1), module, userName, action, summary, details, method, path, route, ip: userName === 'Anita Shah' ? '103.21.44.108' : '127.0.0.1', at: d(day, time),
  })).sort(newestFirst);
}

/* ------------------------------------------------------------------ System Health */

type FeatSeed = [string, string, string, string, FeatureStatus, number, number, number, number, number | null, number, number, string[], string[], string[], string | undefined];
// [key, label, icon, group, status, hits7, hits30, trend, users7, avgMs, maxMs, errors7, depends, reasons, routes, menu]
const F: FeatSeed[] = [
  ['dashboard', 'Dashboard', 'speedometer2', 'Core', 'healthy', 412, 1710, 6, 7, 138, 420, 0, ['database'], [], ['dashboard.index', 'dashboard.data'], 'hotel.home'],
  ['login', 'Sign in', 'box-arrow-in-right', 'Core', 'healthy', 96, 402, -3, 9, 210, 640, 1, ['database', 'mail'], [], ['login.show', 'login.store', 'login.verify'], undefined],
  ['profile', 'My Profile', 'person-circle', 'Core', 'healthy', 31, 118, 12, 6, 160, 380, 0, ['database'], [], ['profile.show', 'profile.update'], 'hotel.admin.profile'],
  ['revenue', 'Revenue', 'cash-coin', 'Money', 'healthy', 238, 902, 9, 4, 174, 510, 0, ['database'], [], ['revenue.index', 'revenue.store', 'revenue.update', 'revenue.destroy'], 'hotel.cash.revenue'],
  ['expense', 'Expenses', 'cash-stack', 'Money', 'healthy', 187, 744, 4, 4, 181, 560, 0, ['database'], [], ['expense.index', 'expense.store', 'expense.update'], 'hotel.cash.expenses'],
  ['shift-handover', 'Shift Handover', 'arrow-left-right', 'Money', 'healthy', 64, 255, 0, 3, 190, 480, 0, ['database'], [], ['shift-handover.index', 'shift-handover.store'], 'hotel.cash.handover'],
  ['bill-master', 'Billing', 'receipt', 'Money', 'degraded', 301, 1120, 14, 5, 1740, 4100, 3, ['database', 'storage'], ['Average speed is above 1500 ms', '3 errors in 7 days'], ['bill-master.index', 'bill-master.show', 'bill-master.pdf'], 'hotel.billing.bills'],
  ['reports', 'Reports', 'bar-chart-line', 'Money', 'healthy', 22, 88, -18, 2, 620, 1900, 0, ['database'], [], ['reports.daily', 'reports.monthly'], undefined],
  ['company', 'Company Profiles', 'buildings', 'People', 'healthy', 77, 290, 2, 3, 150, 400, 0, ['database'], [], ['company.index', 'company.show', 'company.store'], 'hotel.companies.profiles'],
  ['users', 'User Accounts', 'people', 'Administration', 'healthy', 18, 66, 0, 2, 140, 300, 0, ['database'], [], ['users.index', 'users.store'], 'hotel.admin.users'],
  ['settings', 'Settings', 'gear', 'Administration', 'healthy', 14, 49, 40, 2, 170, 350, 0, ['database', 'backup'], [], ['settings.index', 'settings.update'], 'hotel.admin.settings'],
  ['system-log', 'System Log', 'clock-history', 'Administration', 'healthy', 9, 41, 0, 1, 230, 410, 0, ['database'], [], ['system-log.index', 'system-log.pdf'], 'hotel.admin.log'],
  ['force-log', 'Force Log', 'lightning-charge', 'Administration', 'healthy', 4, 12, 0, 1, 210, 330, 0, ['database'], [], ['force-log.index', 'force-log.pdf'], 'hotel.admin.forceLog'],
  ['razorpay', 'Razorpay', 'credit-card-2-front', 'Payments', 'degraded', 12, 51, 0, 2, 480, 1200, 2, ['database', 'razorpay'], ['A webhook signature did not match', '2 errors in 7 days'], ['razorpay.order', 'razorpay.verify'], 'hotel.admin.payments'],
  ['payroll.employees', 'Payroll employees', 'wallet2', 'Payroll', 'healthy', 88, 340, 5, 2, 200, 520, 0, ['database'], [], ['payroll.employees.index', 'payroll.employees.store'], 'hotel.payroll.staff'],
  ['payroll.attendance', 'Payroll attendance', 'calendar-check', 'Payroll', 'healthy', 54, 210, 3, 2, 260, 700, 0, ['database'], [], ['payroll.attendance.index'], 'hotel.payroll.attendance'],
  ['portal', 'Guest and Company Portal', 'phone', 'Portals', 'healthy', 0, 3, -100, 0, null, 0, 0, ['database'], [], ['portal.home', 'portal.bills'], undefined],
  ['website', 'Website admin', 'globe2', 'Website', 'idle', 0, 0, 0, 0, null, 0, 0, ['database'], [], ['website.index'], 'hotel.web'],
];

/** Thirty days of visits for one feature, oldest first (deterministic so Pallav and HMS agree). */
function dailyFor(key: string, hits30: number, errors7: number, avgMs: number | null): DailyUse[] {
  const out: DailyUse[] = [];
  const base = hits30 / 30;
  for (let i = 29; i >= 0; i--) {
    const t = new Date(`${MOCK_TODAY}T00:00:00`);
    t.setDate(t.getDate() - i);
    const wave = 0.55 + 0.9 * Math.abs(Math.sin((i + key.length) * 1.7));
    const hits = hits30 === 0 ? 0 : Math.round(base * wave);
    out.push({ day: t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), hits, errors: errors7 && i % 9 === 2 ? 1 : 0, avgMs: avgMs ?? 0 });
  }
  return out;
}

/** For the new hotel every feature is idle (no visits, no errors, no faults). */
function healthFeatureSeed(empty: boolean): HealthFeature[] {
  return F.map(([key, label, icon, group, status, hits7, hits30, trend, users7, avgMs, maxMs, errors7, depends, reasons, routes, openMenu]) => (empty
    ? { key, label, icon, group, status: 'idle' as const, hits7: 0, hits30: 0, trend: 0, users7: 0, avgMs: null, maxMs: 0, errors7: 0, openFaults: 0, depends, reasons: [], routes, daily: dailyFor(key, 0, 0, null), openMenu }
    : { key, label, icon, group, status, hits7, hits30, trend, users7, avgMs, maxMs, errors7, openFaults: key === 'bill-master' ? 2 : key === 'razorpay' ? 1 : 0, depends, reasons, routes, daily: dailyFor(key, hits30, errors7, avgMs), openMenu }));
}

function healthCheckSeed(empty: boolean): HealthCheckRow[] {
  return [
    { name: 'database', label: 'Database', icon: 'database', status: 'ok', message: 'Connected. Replies quickly.', latencyMs: 12, uptime: 100 },
    { name: 'mail', label: 'Email sending', icon: 'envelope', status: 'ok', message: 'The mail account accepts messages.', latencyMs: 310, uptime: empty ? 100 : 99.2 },
    { name: 'storage', label: 'Storage', icon: 'hdd', status: 'ok', message: empty ? '1% of the disk is used.' : '38% of the disk is used.', latencyMs: null, uptime: 100 },
    empty
      ? { name: 'backup', label: 'Backup', icon: 'cloud-arrow-up', status: 'warn', message: 'No backup yet. Connect Google Drive under Hotel settings, Backup and restore.', latencyMs: null, uptime: 100 }
      : { name: 'backup', label: 'Backup', icon: 'cloud-arrow-up', status: 'warn', message: 'The last backup is 2 days old. It should run every night.', latencyMs: null, uptime: 71.4 },
    { name: 'razorpay', label: 'Razorpay', icon: 'credit-card-2-front', status: 'ok', message: 'Razorpay is reachable.', latencyMs: 96, uptime: empty ? 100 : 99.8 },
    { name: 'scheduler', label: 'Scheduled jobs', icon: 'clock', status: 'ok', message: 'Last run finished 4 minutes ago.', latencyMs: null, uptime: 100 },
  ];
}

const TRACE = '#0 app/Http/Controllers/BillMasterController.php(212): App\\Support\\Pdf->render()\n#1 vendor/laravel/framework/src/Illuminate/Routing/Controller.php(54): BillMasterController->pdf()\n#2 {main}';

const faultSeed = (empty: boolean): HealthFault[] => (empty ? [] : [
  { id: 'f-1', exception: 'App\\Exceptions\\PdfRenderException', feature: 'bill-master', message: 'PDF could not be made: the logo file is missing.', occurrences: 6, lastSeen: d(0, '07:12:00'), method: 'GET', path: 'bill-master/bills/HS-0412/pdf', userName: 'Ramesh Patel', file: 'app/Support/Pdf.php', line: 88, trace: TRACE, resolvedBy: null, resolved: false },
  { id: 'f-2', exception: 'Symfony\\Component\\Mailer\\Exception\\TransportException', feature: 'login', message: 'Connection to the mail server timed out.', occurrences: 3, lastSeen: d(0, '08:30:19'), method: 'POST', path: 'login/verify', userName: null, file: 'vendor/symfony/mailer/Transport/Smtp/SmtpTransport.php', line: 201, trace: null, resolvedBy: null, resolved: false },
  { id: 'f-3', exception: 'App\\Exceptions\\WebhookSignatureException', feature: 'razorpay', message: 'Razorpay webhook signature did not match.', occurrences: 1, lastSeen: d(4, '14:03:00'), method: 'POST', path: 'webhooks/razorpay', userName: null, file: 'app/Http/Controllers/RazorpayWebhookController.php', line: 47, trace: null, resolvedBy: null, resolved: false },
  { id: 'f-4', exception: 'Illuminate\\Database\\QueryException', feature: 'bill-master', message: 'Lock wait timeout exceeded; try restarting transaction.', occurrences: 2, lastSeen: d(9, '11:40:00'), method: 'PUT', path: 'bill-master/bills/HS-0391', userName: 'Super Admin', file: 'vendor/laravel/framework/src/Illuminate/Database/Connection.php', line: 712, trace: TRACE, resolvedBy: 'Super Admin', resolved: true },
  { id: 'f-5', exception: 'Illuminate\\Validation\\ValidationException', feature: 'expense', message: 'An expense item had no price, so the total could not be worked out.', occurrences: 2, lastSeen: d(7, '13:05:00'), method: 'POST', path: 'expense', userName: 'Neha Joshi', file: 'app/Http/Controllers/ExpenseController.php', line: 134, trace: null, resolvedBy: 'Anita Shah', resolved: true },
  { id: 'f-6', exception: 'ErrorException', feature: 'payroll.attendance', message: 'Undefined array key "night_shift" while reading the month sheet.', occurrences: 1, lastSeen: d(12, '10:15:00'), method: 'GET', path: 'payroll/attendance', userName: 'Pooja Desai', file: 'app/Http/Controllers/Payroll/AttendanceController.php', line: 96, trace: null, resolvedBy: 'Super Admin', resolved: true },
]);

/** Shared tables and journeys, kept small and hand-written (Pallav learns these from traffic). */
const FEATURE_TABLES: Record<string, string[]> = {
  revenue: ['hotel_cash_deposits', 'food_cash_deposits', 'system_logs'],
  expense: ['hotel_cash_withdrawals', 'hotel_misc_expenses', 'system_logs'],
  'shift-handover': ['shift_handovers', 'hotel_cash_deposits', 'system_logs'],
  'bill-master': ['bill_master_bills', 'bill_master_advances', 'company_profiles', 'system_logs'],
  company: ['company_profiles', 'bill_master_bills', 'system_logs'],
  users: ['users', 'roles', 'system_logs'],
  settings: ['settings', 'system_logs'],
  razorpay: ['online_payments', 'bill_master_bills'],
  dashboard: ['hotel_cash_deposits', 'bill_master_bills', 'shift_handovers'],
};

const FEATURE_FLOWS: [string, string, number][] = [
  ['login', 'dashboard', 88],
  ['dashboard', 'revenue', 61],
  ['dashboard', 'bill-master', 74],
  ['revenue', 'expense', 29],
  ['expense', 'shift-handover', 22],
  ['bill-master', 'company', 18],
  ['company', 'bill-master', 15],
  ['bill-master', 'razorpay', 7],
];

/* ------------------------------------------------------------------ the api */

interface State {
  empty: boolean;
  system: SystemLogRow[];
  force: ForceLogRow[];
  features: HealthFeature[];
  checks: HealthCheckRow[];
  faults: HealthFault[];
}

function seed(empty: boolean): State {
  return { empty, system: systemLogSeed(empty), force: forceLogSeed(empty), features: healthFeatureSeed(empty), checks: healthCheckSeed(empty), faults: faultSeed(empty) };
}

function weekStart(): string {
  const t = new Date(`${MOCK_TODAY}T00:00:00`);
  t.setDate(t.getDate() - 6);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

function textHit(r: SystemLogRow | ForceLogRow, q: string): boolean {
  const hay = [r.summary, r.userName ?? '', r.details ? JSON.stringify(r.details) : '', 'subject' in r ? (r.subject ?? '') : '', 'entity' in r ? r.entity : ''].join(' ').toLowerCase();
  return hay.includes(q.toLowerCase());
}

/** The server's page sizes: anything else becomes the nearest larger one. */
const snap = (n: number | undefined): number => [10, 25, 50, 100].find((s) => s >= (n ?? 25)) ?? 100;

function paged<T>(rows: T[], q: { page?: number; pageSize?: number }): Page<T> {
  const pageSize = snap(q.pageSize);
  const page = Math.max(1, Math.floor(q.page ?? 1));
  return { items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize };
}

/** Distinct modules (most lines first) and people (A to Z), from the whole log as the server's `distinct`. */
function modulesOf(rows: { module: string }[]): { key: string; count: number }[] {
  const m = new Map<string, number>();
  rows.forEach((r) => m.set(r.module, (m.get(r.module) ?? 0) + 1));
  return [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function peopleOf(rows: { userName: string | null }[]): string[] {
  return [...new Set(rows.map((r) => r.userName).filter((x): x is string => Boolean(x)))].sort();
}

const isToday = (at: string) => at.slice(0, 10) === MOCK_TODAY;

function overallOf(s: State): OverallStatus {
  if (s.features.some((f) => f.status === 'down') || s.checks.some((c) => c.status === 'down')) return 'down';
  if (s.features.some((f) => f.status === 'degraded') || s.checks.some((c) => c.status === 'warn')) return 'degraded';
  return 'healthy';
}

/** In-memory System Log, Force Log and System Health for the screens and tests. Marking a fault fixed lasts until the hotel changes. */
export function createSystemAdminMock(clock: MockClock = {}): SystemAdminApi {
  let state = seed(mockEmptyHotel());
  /** The lists of the hotel signed in now (re-seeded when the new-hotel flag changed since the last call). */
  const now = (): State => {
    const empty = mockEmptyHotel();
    if (state.empty !== empty) state = seed(empty);
    return state;
  };
  const call = <T,>(fn: () => DashResult<T>) => mockCall(fn, clock);

  function listSystemLog(q: SystemLogQuery): SystemLogPage {
    const all = now().system;
    const search = q.search?.trim() ?? '';
    const status = q.view === 'problems' ? (q.status && q.status !== 'failed' ? '__none__' : 'failed') : q.status;
    const rows = all.filter((r) => {
      if (search && !textHit(r, search)) return false;
      if (q.module && r.module !== q.module) return false;
      if (q.action && r.action !== q.action) return false;
      if (status && r.status !== status) return false;
      if (q.user && r.userName !== q.user) return false;
      if (q.from && r.at.slice(0, 10) < q.from) return false;
      if (q.to && r.at.slice(0, 10) > q.to) return false;
      switch (q.view) {
        case 'today': return isToday(r.at);
        case 'week': return r.at.slice(0, 10) >= weekStart();
        case 'money': return MONEY_MODULES.includes(r.module);
        case 'access': return ACCESS_MODULES.includes(r.module);
        case 'deletions': return r.action === 'deleted';
        default: return true;
      }
    });
    const people = peopleOf(all);
    return {
      ...paged(rows, q),
      stats: { total: all.length, today: all.filter((r) => isToday(r.at)).length, people: people.length, failed: all.filter((r) => r.status === 'failed').length },
      modules: modulesOf(all),
      people,
    };
  }

  function listForceLog(q: ForceLogQuery): ForceLogPage {
    const all = now().force;
    const search = q.search?.trim() ?? '';
    const rows = all.filter((r) => {
      if (search && !textHit(r, search)) return false;
      if (q.module && r.module !== q.module) return false;
      if (q.action && r.action !== q.action) return false;
      if (q.user && r.userName !== q.user) return false;
      if (q.from && r.at.slice(0, 10) < q.from) return false;
      if (q.to && r.at.slice(0, 10) > q.to) return false;
      switch (q.view) {
        case 'today': return isToday(r.at);
        case 'week': return r.at.slice(0, 10) >= weekStart();
        case 'locks': return r.action === 'lock';
        case 'checks': return r.action === 'checks';
        case 'sessions': return r.action === 'armed' || r.action === 'disarmed';
        default: return true;
      }
    });
    return {
      ...paged(rows, q),
      stats: { total: all.length, today: all.filter((r) => isToday(r.at)).length, locks: all.filter((r) => r.action === 'lock').length, checks: all.filter((r) => r.action === 'checks').length },
      modules: modulesOf(all),
      people: peopleOf(all),
    };
  }

  function health(): SystemHealthOverview {
    const s = now();
    const open = s.faults.filter((e) => !e.resolved);
    return {
      overall: overallOf(s),
      checks: s.checks.map((c) => ({ ...c })),
      openErrors: open.length,
      recentErrors: open.slice(0, 6).map((e) => ({ ...e })),
      features: s.features.map((f) => ({ ...f, openFaults: open.filter((e) => e.feature === f.key).length })),
      tables: s.empty ? {} : FEATURE_TABLES,
      flows: s.empty ? [] : FEATURE_FLOWS,
    };
  }

  function faults(q: FaultQuery): FaultPage {
    const all = [...now().faults].sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
    const show = q.show ?? 'open';
    const words = (q.search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const rows = all.filter((e) => (!q.feature || e.feature === q.feature) && (show === 'all' || (show === 'open' ? !e.resolved : e.resolved)) && words.every((w) => `${e.exception} ${e.feature} ${e.message} ${e.path ?? ''} ${e.userName ?? ''}`.toLowerCase().includes(w)));
    return {
      page: paged(rows.map((e) => ({ ...e })), q),
      counts: { open: all.filter((e) => !e.resolved).length, resolved: all.filter((e) => e.resolved).length },
      features: [...new Set(all.map((e) => e.feature))].sort(),
    };
  }

  function setResolved(id: string, resolved: boolean): DashResult<{ fault: HealthFault; message: string }> {
    const s = now();
    const at = s.faults.findIndex((e) => e.id === id);
    if (at < 0) return mockError('NOT_FOUND');
    const fault: HealthFault = { ...s.faults[at], resolved, resolvedBy: resolved ? 'Super Admin' : null };
    s.faults = s.faults.map((e, i) => (i === at ? fault : e));
    return ok({ fault: { ...fault }, message: resolved ? 'Marked as fixed. It will reopen by itself if it happens again.' : 'Reopened.' });
  }

  return {
    recordHistory: (id) => call(() => {
      // the demo has no per-record lines: three believable ones for any id, none for the brand-new hotel
      if (mockEmptyHotel()) return ok({ items: [], more: false });
      const rows = now().system;
      const seedAt = rows[0]?.at ?? new Date().toISOString();
      const day = (n: number) => new Date(new Date(seedAt).getTime() - n * 86_400_000).toISOString();
      // a company or customer card (ids co-*, cust-*) reads contact changes; a reservation (res-*) its dates; a stay (st-*) its room moves; an employee
      // (e1, e2 ...) the payroll log's lines; a bill or advance its payment lines
      const kind = /^(co|cust|cu)-/.test(id) ? 'person' : /^res-/.test(id) ? 'reservation' : /^st-/.test(id) ? 'stay' : /^e\d+$/.test(id) ? 'employee' : 'bill';
      const latest: Record<typeof kind, RecordHistoryItem> = {
        person: { id: `${id}-3`, at: day(0), userName: 'Ramesh Patel', action: 'updated', status: 'success', summary: 'Changed the contact details', details: { Mobile: 'was 98250 00001, became 98250 00011' } },
        reservation: { id: `${id}-3`, at: day(0), userName: 'Ramesh Patel', action: 'updated', status: 'success', summary: 'Changed the reservation (Check-out)', details: { 'Check-out': 'was 14 Nov 2026, became 15 Nov 2026' } },
        stay: { id: `${id}-3`, at: day(0), userName: 'Ramesh Patel', action: 'updated', status: 'success', summary: 'Moved the guest from room 201 to 203', details: { Rate: '2,400' } },
        employee: { id: `${id}-3`, at: day(0), userName: 'Ramesh Patel', action: 'updated', status: 'success', summary: 'Employee updated', details: { Designation: 'was Cook, became Head cook' } },
        bill: { id: `${id}-3`, at: day(0), userName: 'Ramesh Patel', action: 'updated', status: 'success', summary: 'Changed the payment mode (Cash to UPI)', details: { 'Mode of payment': 'was Cash, became UPI' } },
      };
      const earlier: Record<typeof kind, RecordHistoryItem> = {
        person: { id: `${id}-2`, at: day(1), userName: 'Pooja Desai', action: 'updated', status: 'success', summary: 'Corrected the name', details: { Name: 'was Rakesh Patel, became Rakesh M. Patel' } },
        reservation: { id: `${id}-2`, at: day(1), userName: 'Pooja Desai', action: 'updated', status: 'success', summary: 'Changed the reservation (Rooms)', details: { Rooms: 'was 1, became 2' } },
        stay: { id: `${id}-2`, at: day(1), userName: 'Pooja Desai', action: 'updated', status: 'success', summary: 'Changed the expected check-out', details: { 'Expected check out': 'was 13 Nov 2026, became 14 Nov 2026' } },
        employee: { id: `${id}-2`, at: day(1), userName: 'Pooja Desai', action: 'updated', status: 'success', summary: 'Salary revised', details: { Salary: 'was 18,000, became 20,000' } },
        bill: { id: `${id}-2`, at: day(1), userName: 'Pooja Desai', action: 'updated', status: 'success', summary: 'Corrected the guest name', details: { 'Guest name': 'was Rakesh Patel, became Rakesh M. Patel' } },
      };
      const items: RecordHistoryItem[] = [latest[kind], earlier[kind], { id: `${id}-1`, at: day(2), userName: 'Pooja Desai', action: 'created', status: 'success', summary: kind === 'employee' ? 'Employee added' : kind === 'stay' ? 'Checked in' : 'Added', details: null }];
      return ok({ items, more: false });
    }),
    listSystemLog: (q) => call(() => ok(listSystemLog(q))),
    listForceLog: (q) => call(() => ok(listForceLog(q))),
    getHealth: () => call(() => ok(health())),
    runHealthChecks: () => call(() => ok({ checks: now().checks.map((c) => ({ ...c })), message: 'All checks ran just now.' })),
    listFaults: (q) => call(() => ok(faults(q))),
    resolveFault: (id) => call(() => setResolved(id, true)),
    reopenFault: (id) => call(() => setResolved(id, false)),
  };
}
