// The in-memory mock of admin.ts (dev and local-demo builds only): loaded through ui-shared/mocks (web-app/src/lib/api/mockLoader.ts), never by app code.
import { type MockClock, type DashResult, mockCall, mockSignInAttempts, mockError, type ListQuery, type Page, pageOf, ok, mockEmptyHotel } from './common';
import { MAIL_PROVIDER_OPTIONS, imapHostError, mailProviderCopy, type MailProviderId, type MailReadingKind, type MailSenderIdentity } from './mailProviders';
import type { MailCheck, MailConnectionTest } from './conversations';
import { validateNewPassword } from '../auth/validation';
import { mockCodeRequired, mockSetCodeRequired } from './signInCode.mock';
import { EMAIL, adminCopy, masterScopeLabel, permissionModules, razorpayBusinessName, validateRole, validateUser, type AccountChange, type AdminPortalOption, type AdminProfile, type AdminProfileInput, type AdminRole, type AdminRoleInput, type AdminUser, type AdminUserInput, type AdminUserStats, type BackupStatus, type ErrorState, type ExpenseCatalog, type FieldErrors, type HealthCheck, type LiveDevice, type LogLevel, type MasterBusiness, type MasterItemInput, type MasterItemResult, type MasterList, type MasterRailEntry, type MasterRow, type MasterScope, type MasterSection, type PasswordChangeInput, type PermissionLevel, type PermissionMap, type PermissionOverride, type PlanRate, type PlanRateInput, type PlanRatesPanel, type RazorpayBusiness, type RazorpayHook, type RazorpayOverview, type RazorpayPayment, type RazorpayQuery, type RazorpayRefundInput, type RazorpayRefundItem, type RazorpayRefundResult, type RazorpayCheckResult, type RazorpayLinkInput, type RazorpayLinkItem, type RazorpaySettlementItem, type RazorpayOutcome, type RazorpayStats, type RazorpayStatus, type RecycleItem, type RecycleResult, type SettingFieldType, type SettingGroup, type SettingsMap, type SettingsMapItem, type SettingsOverview, type SettingsValues, type SignInList, type SignInQuery, type SignInRecord, type SystemErrorItem, type SystemLogEntry, type SystemOverview, type UserStatus } from './admin';

// ---------------------------------------------------------------- mock data

const NOW = () => new Date();

/**
 * The brand-new mock hotel (common.ts mockEmptyHotel, hotel id 'h-new', login newhotel / Pooja Shah). Its admin store starts empty and every
 * name of the demo hotel (Hotel Sunrise, Sunrise Foods, Rajkot, its mail domain) is replaced by these. Mock only.
 */
const NEW_HOTEL = { full: 'Hotel Pearl, Surat', hotel: 'Hotel Pearl', food: 'Pearl Foods', city: 'Surat', domain: 'hotelpearl.in' } as const;
const DEMO_DOMAIN = 'hotelsunriserajkot.in';

function rebrand(text: string, on: boolean): string {
  if (!on) return text;
  return text
    .replace(/Hotel Sunrise, Rajkot/g, NEW_HOTEL.full).replace(/Sunrise Foods/g, NEW_HOTEL.food).replace(/Hotel Sunrise/g, NEW_HOTEL.hotel)
    .replace(/hotelsunriserajkot\.in/g, NEW_HOTEL.domain).replace(/Rajkot/g, NEW_HOTEL.city).replace(/Sunrise/g, 'Pearl');
}

let copyRebranded = false;
/**
 * The admin copy and the business labels name the demo hotel. For the new hotel they are rewritten in place once, when its store is
 * seeded (the flag is per page load: the mock sign-out reloads the page). Real mode never seeds, so it never runs there.
 */
function rebrandCopy(): void {
  if (copyRebranded) return;
  copyRebranded = true;
  const walk = (o: Record<string, unknown>): void => {
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === 'string') o[k] = rebrand(v, true);
      else if (typeof v === 'function') {
        const fn = v as (...a: unknown[]) => unknown;
        o[k] = (...a: unknown[]) => { const r = fn(...a); return typeof r === 'string' ? rebrand(r, true) : r; };
      } else if (v && typeof v === 'object') walk(v as Record<string, unknown>);
    }
  };
  walk(adminCopy as unknown as Record<string, unknown>);
  walk(masterScopeLabel);
  walk(razorpayBusinessName);
}

function ago(days: number, hours = 0, minutes = 0): string {
  return new Date(NOW().getTime() - ((days * 24 + hours) * 60 + minutes) * 60_000).toISOString();
}

function lv(map: Partial<PermissionMap>): PermissionMap {
  return Object.fromEntries(permissionModules.map((m) => [m.key, map[m.key] ?? 'none'])) as PermissionMap;
}

function allAt(level: PermissionLevel): PermissionMap {
  return Object.fromEntries(permissionModules.map((m) => [m.key, level])) as PermissionMap;
}

interface Store {
  users: AdminUser[];
  roles: Omit<AdminRole, 'usersCount'>[];
  actorSuper: boolean;
  /** The account that is signed in (setActor); "My Profile", the "You" tag and the self-protection follow it. */
  selfId: string;
  masterSets: MasterSetRecord[];
  masterItems: MasterItemRecord[];
  catalog: CatalogCategoryRecord[];
  planRates: PlanRate[];
  /** Saved values by key; a secret is kept here and never returned. */
  settings: Record<string, string>;
  drive: { connected: boolean; lastAt: string | null; lastResult: string | null };
  /** The last Settings > Email test (the mock keeps it for the status panel). */
  emailTest: { at: string; ok: boolean; message: string; hint?: string } | null;
  /** The last Settings > Email "Test connection" (codes and fixed sentences only, as the server keeps it). */
  mailConnTest: MailConnectionTest | null;
  recycle: RecycleRecord[];
  razorpay: RazorpayPayment[];
  /** Refunds and payment links made in this session, on top of what the sample payments imply. */
  rzRefunds?: RazorpayRefundItem[];
  rzLinks?: RazorpayLinkItem[];
  health: HealthCheck[];
  errors: SystemErrorItem[];
  log: SystemLogEntry[];
  profile: AdminProfile;
  signIns: SignInRecord[];
  changes: AccountChange[];
  devices: LiveDevice[];
  pendingCode: boolean;
  seq: number;
  /** The brand-new hotel (mockEmptyHotel at seed time): empty lists, its own names. */
  empty: boolean;
}

function seed(): Store {
  // Read at seed time (when the admin store is built, after the shell has set it), never at import time.
  return mockEmptyHotel() ? emptyHotelFrom(seedDemo()) : seedDemo();
}

/**
 * The brand-new hotel: only the defaults a new hotel has (the standard roles, the master lists with their default options, the expense
 * categories), nothing the demo hotel did (no other users, people lists, plan rates, recycle bin, Razorpay payments, faults, sign-ins of
 * others), the profile blank but the hotel's name, and its own names in place of the demo hotel's. The signed-in account is added by setActor.
 */
function emptyHotelFrom(demo: Store): Store {
  rebrandCopy();
  const now = NOW().toISOString();
  const peopleLists = MASTER_NAME_ONLY;
  return {
    ...demo,
    empty: true,
    users: [],
    selfId: '',
    roles: demo.roles.filter((r) => r.builtIn),
    masterSets: demo.masterSets.map((m) => ({ ...m, name: rebrand(m.name, true), description: rebrand(m.description, true) })),
    masterItems: demo.masterItems.filter((i) => !peopleLists.has(i.setKey)).map((i) => ({ ...i, isActive: true })),
    planRates: [],
    settings: {
      'general.site_name': NEW_HOTEL.full, 'general.portal_enabled': '0',
      'razorpay_hotel.enabled': '0', 'razorpay_food.enabled': '0', 'backup.enabled': '0', 'recycle.days': '30',
    },
    drive: { connected: false, lastAt: null, lastResult: null },
  emailTest: null,
    mailConnTest: null,
    recycle: [],
    razorpay: [],
    health: demo.health.map((h) => (h.name === 'Backup' ? { ...h, state: 'warn' as const, detail: 'No backup yet. Connect Google Drive under Hotel settings, Backup & Restore.' } : h.name === 'Storage' ? { ...h, detail: '1% of the disk is used.' } : { ...h })),
    errors: [],
    log: [{ id: 'l-1', at: now, level: 'info', source: 'System', message: `${NEW_HOTEL.full} was created.` }],
    profile: { name: '', username: '', email: '', mobile: '', roleName: '', hotelName: NEW_HOTEL.full, emailedCode: false, canEditUsername: true, passwordChangedAt: now },
    signIns: [{ id: 's-1', at: now, device: 'Chrome on Windows', ip: '49.36.88.21', place: `${NEW_HOTEL.city}, Gujarat`, result: 'success', ended: false }],
    changes: [],
    devices: [{ id: 'd-1', device: 'Chrome on Windows', ip: '49.36.88.21', place: `${NEW_HOTEL.city}, Gujarat`, lastActiveAt: now, current: true }],
    pendingCode: false,
  };
}

function seedDemo(): Store {
  const roles: Store['roles'] = [
    { id: 'r-super', name: 'Super Admin', description: 'Owner access to everything, including users and system.', builtIn: true, levels: allAt('full'), icon: 'shield-fill-check', accent: '#2B2B31', inherits: false },
    { id: 'r-admin', name: 'Admin', description: 'Runs the hotel day to day. Can manage users and settings.', builtIn: true, levels: lv({ dashboard: 'full', revenue: 'full', expense: 'full', handover: 'full', bills: 'full', companies: 'full', payroll: 'full', reports: 'full', pms: 'full', website: 'full', conversations: 'edit', masters: 'full', users: 'edit', access: 'view' }), icon: 'person-gear', accent: '#B45309', inherits: false },
    { id: 'r-editor', name: 'Editor', description: 'Front desk and accounts staff who add and change entries.', builtIn: true, levels: lv({ dashboard: 'view', revenue: 'create', expense: 'create', handover: 'create', bills: 'edit', companies: 'edit', pms: 'edit', reports: 'view', website: 'view', payroll: 'view' }), icon: 'pencil-square', accent: '#0F766E', inherits: false },
    { id: 'r-viewer', name: 'Viewer', description: 'Can look at reports and records but not change them.', builtIn: true, levels: lv({ dashboard: 'view', revenue: 'view', expense: 'view', handover: 'view', bills: 'view', companies: 'view', pms: 'view', reports: 'view' }), icon: 'eye', accent: '#64748B', inherits: false },
    { id: 'r-accounts', name: 'Accounts', description: 'Accountant: cash, billing and payroll only.', builtIn: false, levels: lv({ dashboard: 'view', revenue: 'full', expense: 'full', handover: 'full', bills: 'edit', companies: 'edit', payroll: 'edit', reports: 'view' }), icon: 'calculator', accent: '#0f766e', inherits: false },
    { id: 'r-frontdesk', name: 'Front Desk Supervisor', description: 'Shift lead at reception: check-ins, bills and handovers, plus everything a Viewer sees.', builtIn: false, levels: lv({ dashboard: 'view', revenue: 'create', expense: 'view', handover: 'edit', bills: 'edit', companies: 'view', pms: 'full', reports: 'view', website: 'view' }), icon: 'person-workspace', accent: '#111114', inherits: true },
  ];
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? '';
  const mk = (id: string, name: string, username: string, email: string, mobile: string, roleId: string, status: UserStatus, emailedCode: boolean, last: string | null, created: string, overrides: PermissionOverride[] = []): AdminUser =>
    ({ id, name, username, email, mobile, roleId, roleName: roleName(roleId), status, emailedCode, lastLoginAt: last, createdAt: created, overrides });
  const users: AdminUser[] = [
    mk('u-1', 'Mihir Jungiwala', 'mihir', 'gm@hotelsunriserajkot.in', '9825735404', 'r-super', 'active', true, ago(0, 1), ago(400)),
    mk('u-2', 'Anita Shah', 'anita.shah', 'anita.shah@hotelsunriserajkot.in', '9898012345', 'r-admin', 'active', true, ago(0, 3), ago(380)),
    mk('u-3', 'Nikhil Shah', 'nikhil', 'nikhil@hotelsunriserajkot.in', '9825011223', 'r-admin', 'active', false, ago(1, 5), ago(350)),
    mk('u-4', 'Pooja Desai', 'pooja.d', 'pooja.desai@hotelsunriserajkot.in', '9727345678', 'r-accounts', 'active', true, ago(0, 6), ago(300)),
    mk('u-5', 'Ramesh Patel', 'ramesh.p', 'ramesh.patel@hotelsunriserajkot.in', '9825012345', 'r-editor', 'active', false, ago(0, 2), ago(280), [{ module: 'expense', level: 'view' }]),
    mk('u-6', 'Neha Joshi', 'neha.j', 'neha.joshi@hotelsunriserajkot.in', '9909012345', 'r-editor', 'active', false, ago(2), ago(250)),
    mk('u-7', 'Vikram Singh', 'vikram.s', 'vikram.singh@hotelsunriserajkot.in', '9714412345', 'r-viewer', 'locked', false, ago(6), ago(220)),
    mk('u-8', 'Sunita Sharma', 'sunita.s', 'sunita.sharma@hotelsunriserajkot.in', '9879012345', 'r-viewer', 'inactive', false, ago(90), ago(200)),
    mk('u-9', 'Kiran Mehta', 'kiran.m', 'kiran.mehta@hotelsunriserajkot.in', '9824456789', 'r-editor', 'invited', false, null, ago(1)),
    // Portal accounts (decision 47): one not linked yet, one linked to a company
    { ...mk('u-10', 'Test Guest', 'test.guest', 'test.guest@example.test', '9820000010', 'r-viewer', 'active', false, ago(1), ago(20)), portal: { kind: 'guest' as const, linked: false, recordId: null, recordName: null } },
    { ...mk('u-11', 'Test Company', 'test.company', 'accounts@example.test', '9820000011', 'r-viewer', 'active', false, ago(2), ago(30)), portal: { kind: 'company' as const, linked: true, recordId: 'co-demo-1', recordName: 'Sample Traders Pvt Ltd' } },
  ];

  // Master data, from Pallav's demo lists (docs/sessions/S08-fixtures option_sets / option_items, expense_categories)
  const mkSet = (key: string, name: string, description: string, icon: string): MasterSetRecord => ({ key, name, description, icon, input: 'select', isSystem: true });
  const masterSets: MasterSetRecord[] = [
    mkSet('payment_mode', 'Payment Modes', 'How a guest settles a bill or advance', 'bi-credit-card'),
    mkSet('hotel_plan', 'Hotel Plans', 'Room packages offered on a bill', 'bi-house-check'),
    mkSet('shift', 'Shifts', 'Front desk shifts used on handovers', 'bi-clock-history'),
    mkSet('revenue_source', 'Revenue Sources', 'Where a cash deposit came from', 'bi-cash-coin'),
    mkSet('company_contact_role', 'Company Contact Roles', 'What a person is to a company, on Company Profiles', 'bi-person-badge'),
    mkSet('revenue_depositor_hotel', 'Revenue (Hotel Sunrise)', 'Who hands cash in to the Hotel Sunrise book. Names only.', 'bi-person-vcard'),
    mkSet('revenue_depositor_food', 'Revenue (Sunrise Foods)', 'Who hands cash in to the Sunrise Foods book. Names only.', 'bi-person-vcard'),
    mkSet('expense_catalog_hotel', 'Miscellaneous (Hotel Sunrise)', 'Categories and their items, with the price of each. What a Miscellaneous expense picks from.', 'bi-basket'),
    mkSet('expense_catalog_food', 'Miscellaneous (Sunrise Foods)', 'Categories and their items, with the price of each. What a Miscellaneous expense picks from.', 'bi-basket'),
    mkSet('cash_person_hotel', 'Receiver Names (Hotel Sunrise)', 'Who cash is handed to when it leaves the Hotel Sunrise till. Names only.', 'bi-person-vcard'),
    mkSet('cash_person_food', 'Receiver Names (Sunrise Foods)', 'Who cash is handed to when it leaves the Sunrise Foods till. Names only.', 'bi-person-vcard'),
  ];
  const masterItems: MasterItemRecord[] = [];
  const addMaster = (setKey: string, labels: string[], withDefault = true): void => {
    labels.forEach((label, i) => masterItems.push({ id: `mi-${setKey}-${i + 1}`, setKey, label, value: label, color: null, isActive: true, isDefault: withDefault && i === 0, sortOrder: i + 1 }));
  };
  addMaster('payment_mode', ['Cash', 'Card', 'Debit', 'Bank Transfer', 'Cheque', 'UPI', 'Complimentary', 'Paytm Wallet']);
  addMaster('hotel_plan', ['EP', 'CP', 'MAP', 'AP', 'AI']);
  addMaster('shift', ['Morning', 'Afternoon', 'Evening', 'Night', 'General', 'Split']);
  addMaster('revenue_source', ['Front Desk Collection', 'Restaurant Collection', 'Banquet', 'Laundry', 'Room Service', 'Parking', 'Mini Bar', 'Other']);
  addMaster('company_contact_role', ['Managing Director', 'HR Head', 'Assistant HR', 'Accountant Head', 'Accountant Assistant', 'Travel Desk', 'Admin Executive', 'Other']);
  addMaster('revenue_depositor_hotel', ['Anita Shah', 'Nikhil Shah', 'Ramesh Patel', 'Neha Joshi', 'Kiran Mehta', 'Bhavesh Chauhan', 'Hetal Parmar'], false);
  addMaster('revenue_depositor_food', ['Ramesh Patel', 'Kitchen Head', 'Anita Shah', 'Jignesh Rathod', 'Manoj Vaghela', 'Sanjay Thakkar'], false);
  addMaster('cash_person_hotel', ['Pooja Desai', 'Ramesh Patel', 'Housekeeping Head', 'Dinesh Solanki', 'Maintenance Head', 'Bhavesh Chauhan'], false);
  addMaster('cash_person_food', ['Pooja Desai', 'Kitchen Head', 'Jignesh Rathod', 'Store Keeper', 'Manoj Vaghela'], false);
  // A few options hidden from forms (kept on old records), as a real hotel's lists end up
  const hidden = new Set(['mi-payment_mode-8', 'mi-hotel_plan-5', 'mi-shift-6', 'mi-revenue_source-7', 'mi-company_contact_role-7']);
  masterItems.forEach((i) => { if (hidden.has(i.id)) i.isActive = false; });

  // Expense catalogues: categories (no price) with priced items (paise)
  const catalog: CatalogCategoryRecord[] = [];
  const cat = (business: MasterBusiness, name: string, items: [string, number][]): void => {
    const id = `cc-${business}-${name.toLowerCase()}`;
    catalog.push({ id, business, name, items: items.map(([n, pricePaise], i) => ({ id: `${id}-${i + 1}`, name: n, pricePaise })) });
  };
  for (const business of ['hotel', 'food'] as const) {
    cat(business, 'Kitchen', business === 'hotel' ? [['Gas cylinder (commercial)', 185000], ['Cooking oil (15 L)', 215000], ['Tea leaves (1 kg)', 52000], ['Sugar (5 kg)', 23000]] : [['Gas cylinder (commercial)', 185000], ['Basmati rice (1 kg)', 11000], ['Paneer (1 kg)', 36000], ['Vegetables (daily)', 145000], ['Milk (10 L)', 66000]]);
    cat(business, 'Housekeeping', [['Floor cleaner (5 L)', 42000], ['Bed linen set', 125000], ['Bath towels (dozen)', 186000], ['Toiletries kit (50)', 95000]]);
    cat(business, 'Maintenance', business === 'hotel' ? [['Plumbing repair', 220000], ['AC service', 180000], ['Electrician visit', 60000], ['Lift AMC visit', 350000]] : [['Mixer grinder repair', 85000], ['Exhaust fan cleaning', 120000]]);
    cat(business, 'Utilities', [['Drinking water (20 L jar)', 4000], ['Generator diesel (10 L)', 92000], ['Internet recharge', 118000]]);
    cat(business, 'Marketing', business === 'hotel' ? [['Pamphlets (500)', 180000], ['Google ads top-up', 500000]] : [['Menu card printing', 240000]]);
    cat(business, 'Transport', [['Local pickup', 90000], ['Courier', 15000], ['Auto rickshaw', 8000]]);
    cat(business, 'Office', [['Printer paper (ream)', 32000], ['Printer toner', 280000], ['Register book', 12000]]);
    cat(business, 'Other', [['Pooja items', 25000], ['Staff refreshments', 40000]]);
  }

  // Plan rates (dated rows); the meals the hotel owes Sunrise Foods this month come from the nights on each plan
  const day = (offset: number): string => new Date(NOW().getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  const planRates: PlanRate[] = [
    { id: 'pr-1', plan: 'CP', effectiveFrom: day(-190), ratePaise: 15000, note: 'Opening price', createdByName: 'Mihir Jungiwala', createdAt: ago(190) },
    { id: 'pr-2', plan: 'CP', effectiveFrom: day(-66), ratePaise: 16500, note: 'New breakfast menu', createdByName: 'Mihir Jungiwala', createdAt: ago(66) },
    { id: 'pr-3', plan: 'CP', effectiveFrom: day(25), ratePaise: 18000, note: '', createdByName: 'Mihir Jungiwala', createdAt: ago(1) },
    { id: 'pr-4', plan: 'MAP', effectiveFrom: day(-190), ratePaise: 38000, note: '', createdByName: 'Mihir Jungiwala', createdAt: ago(190) },
    { id: 'pr-5', plan: 'MAP', effectiveFrom: day(-30), ratePaise: 40000, note: 'Dinner buffet added', createdByName: 'Anita Shah', createdAt: ago(30) },
    { id: 'pr-6', plan: 'AP', effectiveFrom: day(-190), ratePaise: 55000, note: 'Opening price', createdByName: 'Mihir Jungiwala', createdAt: ago(190) },
    { id: 'pr-7', plan: 'AP', effectiveFrom: day(-45), ratePaise: 58000, note: 'Vegetable prices up', createdByName: 'Anita Shah', createdAt: ago(45) },
    { id: 'pr-8', plan: 'MAP', effectiveFrom: day(15), ratePaise: 42000, note: 'Diwali season menu', createdByName: 'Anita Shah', createdAt: ago(2) },
  ];

  // Settings, as saved (a secret is sealed here and never returned)
  const settings: Record<string, string> = {
    'general.site_name': 'Hotel Sunrise', 'general.support_email': 'stay@hotelsunriserajkot.in', 'general.support_phone': '02812345678',
    'general.address': 'Sunrise Complex, KKV Chowk, Kalavad Road, Rajkot, Gujarat 360005', 'general.check_in_time': '12:00', 'general.check_out_time': '11:00', 'general.portal_enabled': '1',
    'billing.hotel_gstin': '24ABCDE1234F1Z5', 'billing.food_gstin': '24ABCDE1234F2Z4',
    'email.mode': 'own', 'email.provider': 'gmail', 'email.username': 'stay@hotelsunriserajkot.in',
    'email.password': 'abcdefghijklmnop', 'email.from_name': 'Hotel Sunrise',
    // the demo hotel reads its Gmail in Conversations (decision 66)
    'email.imap': '1',
    'razorpay_hotel.enabled': '1', 'razorpay_hotel.mode': 'test', 'razorpay_hotel.key_id': 'rzp_test_Nx7100Hotel', 'razorpay_hotel.key_secret': 'sealed-hotel-secret', 'razorpay_hotel.webhook_secret': 'sealed-hotel-hook',
    'razorpay_food.enabled': '1', 'razorpay_food.mode': 'test', 'razorpay_food.key_id': 'rzp_test_Nx7100Food', 'razorpay_food.key_secret': 'sealed-food-secret',
    'backup.enabled': '1', 'backup.client_id': '482910357-sunrise.apps.googleusercontent.com', 'backup.client_secret': 'sealed-google-secret', 'backup.keep_days': '30',
    'recycle.days': '30',
  };

  // Dates in the detail text are built from the same clock as deletedAt, so they always fall before the deletion.
  const onDay = (days: number): string =>
    new Date(new Date(ago(days)).getTime() + 330 * 60_000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const recycle: RecycleRecord[] = [
    { key: 'advance', id: 'rb-1', kind: 'Advance', label: 'ADV-0031 · Rajesh Patel', detail: `₹5,000.00 received on ${onDay(8)}`, deletedBy: 'Ramesh Patel', deletedAt: ago(1, 2) },
    { key: 'hotel-expense', id: 'rb-2', kind: 'Hotel expense', label: 'EXP-0214 · Vegetables', detail: `₹3,420.00 on ${onDay(7)}`, deletedBy: 'Pooja Desai', deletedAt: ago(2, 6) },
    { key: 'customer', id: 'rb-3', kind: 'Customer', label: 'Harshad Joshi', detail: 'Mobile 9824456789', deletedBy: 'Neha Joshi', deletedAt: ago(9) },
    { key: 'company', id: 'rb-4', kind: 'Company', label: 'Bhavani Traders', detail: 'GSTIN 24AAACB1234C1Z2', deletedBy: 'Anita Shah', deletedAt: ago(28) },
    { key: 'bill', id: 'rb-5', kind: 'Bill', label: '2026 / 1187 · Kinjal Dave', detail: '₹4,042.50, Room 201, made by mistake twice', deletedBy: 'Ramesh Patel', deletedAt: ago(0, 4) },
    { key: 'hotel-deposit', id: 'rb-6', kind: 'Hotel deposit', label: 'HR-1036 · Front Desk Collection', detail: `₹12,000.00 on ${onDay(6)}`, deletedBy: 'Pooja Desai', deletedAt: ago(5, 3) },
    { key: 'employee', id: 'rb-7', kind: 'Employee', label: 'Suresh Makwana', detail: `Housekeeping, left on ${onDay(20)}`, deletedBy: 'Anita Shah', deletedAt: ago(14) },
  ];

  // Razorpay payments received by webhook
  const rzMethods = ['upi', 'card', 'netbanking', 'wallet'];
  const payers: [string, string, string][] = [
    ['Amit Joshi', 'amit.joshi@gmail.com', '9825099887'], ['Deepa Iyer', 'deepa.iyer@tcs.com', '9840011223'], ['Rajesh Patel', 'rajesh.patel@gmail.com', '9825012345'],
    ['Priya Sharma', 'priya.sharma@outlook.com', '9898123456'], ['Fatima Shaikh', 'fatima.s@gmail.com', '9998877665'], ['Amit Desai', 'amit.desai@infosys.com', '9909090909'],
    ['Lakshmi Venkatesh', 'lakshmi.v@gmail.com', '9444455566'], ['Gurpreet Singh', 'gurpreet.singh@gmail.com', '9815566778'],
  ];
  const rzStatuses: RazorpayStatus[] = ['captured', 'captured', 'captured', 'failed', 'captured', 'refunded', 'created', 'captured', 'authorized', 'failed', 'captured', 'captured'];
  const rzAmounts = [1062400, 317100, 89400, 520000, 264000, 142500, 750000, 98000, 430500, 215000, 68000, 312000];
  const razorpay: RazorpayPayment[] = rzStatuses.map((status, i) => {
    const payer = payers[i % payers.length] ?? ['Guest', 'guest@example.com', '9000000000'];
    const business: RazorpayBusiness = i % 3 === 0 ? 'hotel' : 'food';
    const amountPaise = rzAmounts[i] ?? 100000;
    const method = rzMethods[i % rzMethods.length] ?? 'upi';
    const created = ago(Math.floor(i / 2), i * 2, i * 7);
    const paid = status === 'captured' || status === 'refunded' || status === 'authorized' ? created : null;
    const paymentId = `pay_Nx${8200 + i}Rjk`;
    const orderId = `order_Nx${7100 + i}Sun`;
    const error = status === 'failed' ? (i % 2 ? 'Payment declined by the bank.' : 'Customer closed the payment window.') : null;
    return {
      id: `rz-${i + 1}`, paymentId, orderId, description: business === 'hotel' ? 'Advance for room booking' : 'Restaurant bill', business, method,
      email: payer[1], contact: `+91${payer[2]}`, status, errorDescription: error, amountPaise,
      feePaise: status === 'captured' || status === 'refunded' ? Math.round(amountPaise * 0.02) : null, taxPaise: status === 'captured' || status === 'refunded' ? Math.round(amountPaise * 0.0036) : 0,
      amountRefundedPaise: status === 'refunded' ? amountPaise : 0, lastEvent: `payment.${status}`, paidAt: paid, createdAt: created, updatedAt: created,
      notes: { bill_no: business === 'hotel' ? `HS-04${10 + i}` : `SF-09${70 + i}`, payer: payer[0] },
      payload: { entity: 'payment', id: paymentId, order_id: orderId, amount: amountPaise, currency: 'INR', status, method, email: payer[1], error_description: error },
    };
  });

  const health: HealthCheck[] = [
    { id: 'h-1', name: 'Database', state: 'ok', detail: 'Connected. Replies in 12 ms.', checkedAt: ago(0, 0, 2) },
    { id: 'h-2', name: 'Email sending', state: 'ok', detail: 'The mail account accepts messages.', checkedAt: ago(0, 0, 2) },
    { id: 'h-3', name: 'Online payments', state: 'ok', detail: 'Razorpay is reachable.', checkedAt: ago(0, 0, 2) },
    { id: 'h-4', name: 'Backup', state: 'warn', detail: 'The last backup is 2 days old. It should run every night.', checkedAt: ago(0, 0, 2) },
    { id: 'h-5', name: 'Storage', state: 'ok', detail: '38% of the disk is used.', checkedAt: ago(0, 0, 2) },
    { id: 'h-6', name: 'Scheduled jobs', state: 'ok', detail: 'Last run finished 4 minutes ago.', checkedAt: ago(0, 0, 2) },
  ];
  const errors: SystemErrorItem[] = [
    { id: 'e-1', message: 'Could not send email: the mail server did not reply in time.', where: 'Staff email', count: 3, firstAt: ago(2, 3), lastAt: ago(0, 5), state: 'open', resolvedBy: null },
    { id: 'e-2', message: 'Razorpay webhook signature did not match.', where: 'Online payments', count: 1, firstAt: ago(4), lastAt: ago(4), state: 'open', resolvedBy: null },
    { id: 'e-3', message: 'PDF could not be made: the logo file is missing.', where: 'Guest bill', count: 6, firstAt: ago(12), lastAt: ago(9), state: 'resolved', resolvedBy: 'Mihir Jungiwala' },
    { id: 'e-4', message: 'Nightly backup stopped: the disk was full.', where: 'Backup', count: 1, firstAt: ago(11), lastAt: ago(11), state: 'resolved', resolvedBy: 'Mihir Jungiwala' },
    { id: 'e-5', message: 'Bill list took more than 4 seconds to open.', where: 'Billing', count: 4, firstAt: ago(5), lastAt: ago(1, 2), state: 'open', resolvedBy: null },
  ];
  const levels: LogLevel[] = ['info', 'info', 'warn', 'info', 'error', 'info', 'info', 'warn', 'info', 'info'];
  const sources = ['Sign-in', 'Scheduler', 'Email', 'Backup', 'Payments', 'Sign-in', 'Scheduler', 'Email', 'Reports', 'Sign-in'];
  const messages = ['Mihir Jungiwala signed in.', 'Nightly jobs finished in 41 seconds.', 'Email queue is slow: 3 messages waiting.', 'Backup started.', 'Razorpay webhook rejected.', 'Anita Shah signed in.', 'Reminder emails queued: 4.', 'Email to staff failed once, will retry.', 'Monthly revenue report built.', 'Pooja Desai signed in.'];
  const log: SystemLogEntry[] = levels.map((level, i) => ({ id: `l-${i + 1}`, at: ago(0, i, i * 4), level, source: sources[i] ?? 'System', message: messages[i] ?? '' }));

  const profile: AdminProfile = {
    name: 'Anita Shah', username: 'anita.shah', email: 'anita.shah@hotelsunriserajkot.in', mobile: '9898012345', roleName: 'Admin',
    hotelName: 'Hotel Sunrise, Rajkot', emailedCode: false, canEditUsername: true, passwordChangedAt: ago(41),
  };
  const signIns: SignInRecord[] = [
    { id: 's-1', at: ago(0, 3), device: 'Chrome on Windows', ip: '103.21.44.108', place: 'Rajkot, Gujarat', result: 'success', ended: false },
    { id: 's-2', at: ago(1, 4), device: 'Edge on Windows', ip: '106.215.18.72', place: 'Rajkot, Gujarat', result: 'success', ended: true },
    { id: 's-3', at: ago(2, 9), device: 'Chrome on Windows', ip: '103.21.44.108', place: 'Rajkot, Gujarat', result: 'failed', ended: true },
    { id: 's-4', at: ago(3, 2), device: 'Chrome on Windows', ip: '103.21.44.108', place: 'Rajkot, Gujarat', result: 'success', ended: true },
    { id: 's-5', at: ago(8, 6), device: 'Safari on iPhone', ip: '49.36.120.15', place: 'Ahmedabad, Gujarat', result: 'success', ended: true },
    { id: 's-6', at: ago(5, 1), device: 'Edge on Windows', ip: '103.21.44.112', place: 'Rajkot, Gujarat', result: 'success', ended: true },
    { id: 's-7', at: ago(10, 8), device: 'Firefox on Linux', ip: '157.32.88.40', place: 'Vadodara, Gujarat', result: 'failed', ended: true },
    { id: 's-8', at: ago(12, 4), device: 'Chrome on Android', ip: '106.215.18.72', place: 'Rajkot, Gujarat', result: 'success', ended: true },
  ];

  return {
    users, roles, actorSuper: true, selfId: 'u-2', masterSets, masterItems, catalog, planRates, settings,
    drive: { connected: true, lastAt: ago(0, 9), lastResult: 'Done, 184 MB sent to Google Drive.' },
  emailTest: null,
    mailConnTest: null,
    recycle, razorpay, health, errors, log, profile, signIns, pendingCode: false, seq: 100, empty: false,
    changes: [{ id: 'ac-1', at: ago(41), summary: 'Password changed' }, { id: 'ac-2', at: ago(60), summary: 'Profile details updated' }],
    devices: [{ id: 'd-1', device: 'Chrome on Windows', ip: '103.21.44.108', place: 'Rajkot, Gujarat', lastActiveAt: ago(0, 1), current: true }, { id: 'd-2', device: 'Chrome on Android', ip: '106.215.18.72', place: 'Rajkot, Gujarat', lastActiveAt: ago(0, 6), current: false }],
  };
}

// ---------------------------------------------------------------- master data and settings rules (the server's: masterRules.ts, settingsDefs.ts)

interface MasterSetRecord { key: string; name: string; description: string; icon: string; input: string; isSystem: boolean }
interface MasterItemRecord { id: string; setKey: string; label: string; value: string; color: string | null; isActive: boolean; isDefault: boolean; sortOrder: number }
interface CatalogCategoryRecord { id: string; business: MasterBusiness; name: string; items: { id: string; name: string; pricePaise: number }[] }
type RecycleRecord = Omit<RecycleItem, 'daysLeft'>;

/** Lists of people: only the name is kept, and they read alphabetically. */
const MASTER_NAME_ONLY = new Set(['revenue_depositor_hotel', 'revenue_depositor_food', 'cash_person_hotel', 'cash_person_food']);
/** The expense catalogues: categories with priced items, one per business. */
const MASTER_CATALOGS: Record<string, MasterBusiness> = { expense_catalog_hotel: 'hotel', expense_catalog_food: 'food' };

interface MasterGroupDef { name: string; icon: string; sections: Record<string, { label: string; sets: Record<MasterBusiness, string> }> }
/** Lists that exist once per business show as one entry (Revenue, Expense) and the business is picked inside it. */
const MASTER_GROUPS: Record<string, MasterGroupDef> = {
  revenue: { name: 'Revenue', icon: 'bi-cash-coin', sections: { names: { label: 'Depositor Names', sets: { hotel: 'revenue_depositor_hotel', food: 'revenue_depositor_food' } } } },
  expense: {
    name: 'Expense',
    icon: 'bi-basket',
    sections: {
      names: { label: 'Receiver Names', sets: { hotel: 'cash_person_hotel', food: 'cash_person_food' } },
      misc: { label: 'Miscellaneous', sets: { hotel: 'expense_catalog_hotel', food: 'expense_catalog_food' } },
    },
  },
};

interface MasterPlace { group: string; section: string; business: MasterBusiness }
function placementOf(key: string): MasterPlace | null {
  for (const [group, def] of Object.entries(MASTER_GROUPS)) {
    for (const [section, part] of Object.entries(def.sections)) {
      for (const business of ['hotel', 'food'] as const) if (part.sets[business] === key) return { group, section, business };
    }
  }
  return null;
}
const siblingFor = (p: MasterPlace, business: MasterBusiness): string | null => MASTER_GROUPS[p.group]?.sections[p.section]?.sets[business] ?? null;
const twinKeyOf = (p: MasterPlace): string | null => siblingFor(p, p.business === 'hotel' ? 'food' : 'hotel');
const scopeOf = (asked: string | undefined | null): MasterScope => (asked === 'hotel' || asked === 'food' ? asked : 'both');
/** "both" reads Hotel Sunrise and keeps only what Sunrise Foods has too. */
const scopeBusiness = (scope: MasterScope): MasterBusiness => (scope === 'both' ? 'hotel' : scope);
const fold = (name: string | null | undefined): string => (name ?? '').trim().toLowerCase();
const naturalCompare = (a: string, b: string): number => a.toLowerCase().localeCompare(b.toLowerCase(), undefined, { numeric: true });

interface SettingFieldDef {
  label: string;
  type: SettingFieldType;
  secret?: boolean;
  default?: string;
  options?: Record<string, string>;
  help?: string;
  placeholder?: string;
  check?: (value: string) => string | null;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Decimal places a number may carry (default 0: whole numbers only). */
  decimals?: number;
  maxLength?: number;
  rows?: number;
}
interface SettingGroupDef { label: string; icon: string; about: string; fields: Record<string, SettingFieldDef> }

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const gstinCheck = (label: string) => (value: string): string | null => (value === '' || GSTIN.test(value.toUpperCase()) ? null : `${label} must be a valid GSTIN, for example 24ABCDE1234F1Z5.`);
const timeCheck = (label: string) => (value: string): string | null => (value === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? null : `${label} must be a 24-hour time such as 12:00.`);
/** DECISIONS #13: GST is a typed percent from 0 to 28 (two decimals at most); empty falls back to the default 5. */
const gstPercentCheck = (label: string) => (value: string): string | null => {
  if (value === '') return null;
  const n = Number(value);
  return /^\d{1,2}(\.\d{1,2})?$/.test(value) && n >= 0 && n <= 28 ? null : `${label} must be a percent from 0 to 28, for example 5 or 12.`;
};
const CANCELLATION_MAX = 600;
const lengthCheck = (label: string, max: number) => (value: string): string | null => (value.length <= max ? null : `${label} must not be longer than ${max} characters.`);

function razorpayGroup(book: RazorpayBusiness, name: string, holds: string): SettingGroupDef {
  return {
    label: `Razorpay · ${name}`,
    icon: book === 'hotel' ? 'bi-building' : 'bi-cup-hot',
    about: `The Razorpay account that receives ${name} payments. ${holds}`,
    fields: {
      [`razorpay_${book}.enabled`]: { label: `Take online payments for ${name}`, type: 'toggle' },
      [`razorpay_${book}.mode`]: { label: 'Mode', type: 'select', options: { test: 'Test', live: 'Live' }, default: 'test' },
      [`razorpay_${book}.key_id`]: { label: 'Key ID', type: 'text', placeholder: 'rzp_test_xxxxxxxx' },
      [`razorpay_${book}.key_secret`]: { label: 'Key secret', type: 'password', secret: true },
      [`razorpay_${book}.webhook_secret`]: { label: 'Webhook secret', type: 'password', secret: true, help: 'Set the same value in the Razorpay dashboard webhook for this account.' },
    },
  };
}

/** The setting groups in the order the screen shows them (chat-app messaging and the encryption screens are left out, MJ). */
const SETTING_DEFS: Record<string, SettingGroupDef> = {
  general: {
    label: 'General', icon: 'bi-sliders', about: 'How the site presents itself to guests and companies.',
    fields: {
      'general.site_name': { label: 'Site name', type: 'text', default: 'Hotel Sunrise' },
      'general.support_email': { label: 'Support email', type: 'email' },
      'general.support_phone': { label: 'Support phone', type: 'text' },
      'general.address': { label: 'Address on bills', type: 'textarea' },
      'general.check_in_time': { label: 'Check-in time', type: 'text', default: '12:00', help: 'Hours and minutes, for example 12:00 for noon or 14:30 for 2:30 pm.', check: timeCheck('Check-in time') },
      'general.check_out_time': { label: 'Check-out time', type: 'text', default: '11:00', check: timeCheck('Check-out time') },
      'general.cancellation_policy': {
        label: 'Cancellation policy', type: 'textarea', rows: 4, maxLength: CANCELLATION_MAX,
        default: 'Free cancellation up to 48 hours before check-in. After that the first night is charged.',
        help: `What guests read before they book, on the website and the booking confirmation. Up to ${CANCELLATION_MAX} characters.`,
        check: lengthCheck('Cancellation policy', CANCELLATION_MAX),
      },
      'general.portal_enabled': { label: 'Guest and company portal', type: 'toggle', help: 'Lets guests and companies sign in to see bills and book rooms.' },
    },
  },
  billing: {
    label: 'Bill header', icon: 'bi-receipt', about: "The GSTINs printed under each business's name on bills and receipts, and the GST a new bill starts with.",
    fields: {
      'billing.hotel_gstin': { label: 'Hotel GSTIN', type: 'text', placeholder: '24ABCDE1234F1Z5', check: gstinCheck('Hotel GSTIN') },
      'billing.food_gstin': { label: 'Food business GSTIN', type: 'text', placeholder: '24ABCDE1234F2Z4', check: gstinCheck('Food business GSTIN') },
      // Same keys as the server's app_settings (stayService / guestService read checkout.*_gst_percent, seeded 5, CHECK 0..28).
      'checkout.hotel_gst_percent': {
        label: 'Default GST % for Hotel', type: 'number', default: '5', suffix: '%', min: 0, max: 28, step: 0.01, decimals: 2,
        help: 'Rooms and other hotel charges. 0 to 28. A new bill starts with it; the percent is saved on each bill, so a change never alters an older bill.',
        check: gstPercentCheck('Default GST % for Hotel'),
      },
      'checkout.food_gst_percent': {
        label: 'Default GST % for Food', type: 'number', default: '5', suffix: '%', min: 0, max: 28, step: 0.01, decimals: 2,
        help: 'Restaurant and room service. 0 to 28. Saved on each bill like the hotel percent.',
        check: gstPercentCheck('Default GST % for Food'),
      },
    },
  },
  email: {
    label: 'Email', icon: 'bi-envelope-at', about: 'Where credentials, statements and receipts are sent from.',
    fields: {

      'email.mode': { label: 'Mail', type: 'select', options: { platform: 'Use the platform\'s mail', own: 'Use my own mail' }, default: 'platform', help: 'The platform\'s mail needs nothing from you. With your own mail you bring a mail service and its login.' },
      'email.provider': { label: 'Mail service', type: 'select', options: { ses: 'Amazon SES', brevo: 'Brevo', gmail: 'Gmail', smtp: 'Other SMTP server', domain: 'My own domain (sent by the platform)' }, default: 'ses', help: 'Only for your own mail.' },
      'email.username': { label: 'Login', type: 'text', placeholder: 'name@gmail.com', help: 'Gmail: the Gmail address. Brevo, Amazon SES and other servers: the SMTP login. Empty = this hotel sends through the platform email.' },
      'email.password': { label: 'App password', type: 'password', secret: true, help: 'A Google app password (16 letters), saved encrypted. Leave empty to keep the saved one.' },
      'email.host': { label: 'Server (host)', type: 'text', placeholder: 'smtp.example.com', help: 'Only for another SMTP server.' },
      'email.port': { label: 'Port', type: 'number', default: '587', help: 'Only for another SMTP server.' },
      'email.encryption': { label: 'Security', type: 'select', options: { tls: 'STARTTLS (port 587)', ssl: 'SSL/TLS (port 465)', none: 'None' }, default: 'tls', help: 'Only for another SMTP server.' },
      'email.region': { label: 'Amazon SES region', type: 'select', options: { 'ap-south-1': 'Mumbai (ap-south-1)', 'ap-southeast-1': 'Singapore (ap-southeast-1)', 'eu-west-1': 'Ireland (eu-west-1)', 'us-east-1': 'N. Virginia (us-east-1)' }, default: 'ap-south-1', help: 'Only for Amazon SES.' },
      'email.from_address': { label: 'From address', type: 'email', help: 'The address mail comes from, verified with the service. Not used for Gmail.' },
      'email.from_name': { label: 'Sender name', type: 'text', default: 'Hotel Sunrise' },
      'email.reply_to': { label: 'Reply-to (optional)', type: 'email' },
      'email.daily_limit': { label: 'Daily limit (optional)', type: 'number', help: 'The most mails sent in a day through this account. Empty = the service\'s own limit.' },
      // Reading the mailbox in Conversations (decision 66): the same keys as the server's settingsDefs.ts.
      'email.imap': { label: 'Read this mailbox in Conversations', type: 'toggle', default: '0', help: mailProviderCopy.reading.toggleHint },
      'email.imap_host': { label: 'IMAP server (host)', type: 'text', placeholder: 'imap.example.com', help: mailProviderCopy.reading.imapHostHint },
      'email.imap_port': { label: 'IMAP port', type: 'select', options: { '993': '993 (SSL/TLS)', '143': '143 (STARTTLS)' }, default: '993', help: mailProviderCopy.reading.imapPortHint },
    },
  },
  razorpay_hotel: razorpayGroup('hotel', 'Hotel Sunrise', 'Rooms, laundry and advances.'),
  razorpay_food: razorpayGroup('food', 'Sunrise Foods', 'Restaurant and room service.'),
  backup: {
    label: 'Backup and restore', icon: 'bi-cloud-arrow-up', about: 'Every night the database and all uploaded files are zipped and sent to a Google Drive folder.',
    fields: {
      'backup.enabled': { label: 'Back up to Google Drive every night', type: 'toggle', help: 'Runs at 2:00 AM.' },
      'backup.client_id': { label: 'Google client ID', type: 'text', help: 'From Google Cloud Console, Credentials, OAuth client ID (Web application).' },
      'backup.client_secret': { label: 'Google client secret', type: 'password', secret: true },
      'backup.keep_days': { label: 'Keep backups for (days)', type: 'number', default: '30' },
    },
  },
  recycle: {
    label: 'Recycle bin', icon: 'bi-recycle', about: 'Deleted records wait here and can be restored.',
    fields: {
      'recycle.days': { label: 'Keep deleted records for (days)', type: 'number', default: '30', help: 'After this many days a deleted record is removed for good, along with its uploaded files.' },
    },
  },
};

// ---------------------------------------------------------------- Settings > Email: Test connection (decision 66)

/** How each saved service reads mail (mailProviders.ts `reading`): Gmail fixed, another SMTP server by its typed IMAP server, the rest only send. */
const MAIL_READING: Record<string, MailReadingKind> = Object.fromEntries(MAIL_PROVIDER_OPTIONS.map((o) => [o.id, o.reading]));

/**
 * The answers of the mock's "Test connection", in the server's own fixed sentences (mail/connectionTest.ts, mail/imapFailure.ts, mail/hints.ts): never a server's words, a login
 * or a password. Pick a failure for the dev preview with `window.__mailConnTest = 'AUTH' | 'WEB_LOGIN'` (a login that starts with "bad" also gives AUTH, as the test email does).
 */
export const MOCK_MAIL_CHECKS = {
  imapOk: { ok: true, code: null, message: 'Signed in. Sent folder found.' },
  smtpOk: { ok: true, code: null, message: 'Signed in. Sending works.' },
  sendOnly: { ok: false, code: 'SEND_ONLY', message: 'Reading mail needs Gmail or your own mail server.' },
  imapNotSet: { ok: false, code: 'NOT_SET', message: 'Reading mail is not set up yet: switch it on in the mail settings, enter the IMAP server if asked, and save.' },
  AUTH: {
    ok: false,
    code: 'AUTH',
    message: 'The mail server did not accept the login for reading mail.',
    hint: 'Google refused the app password. Make a new app password (Google Account > Security > App passwords), paste it in Settings > Email and save.',
  },
  WEB_LOGIN: {
    ok: false,
    code: 'WEB_LOGIN',
    message: 'The mail service wants someone to sign in to this account in a web browser first.',
    hint: 'Google wants someone to sign in to this Gmail account in a web browser once. Sign in at mail.google.com, then try again.',
  },
  smtpAuth: {
    ok: false,
    code: 'AUTH',
    message: 'The mail server refused the login.',
    hint: 'Gmail refused the login. Use a Google APP PASSWORD (16 letters), not the normal Google password, and check that 2-step verification is switched on for that Google account.',
  },
} as const satisfies Record<string, MailCheck>;

/** The dev preview's chosen failure: `window.__mailConnTest` in the browser console (read at call time). */
function mockMailFailure(): 'AUTH' | 'WEB_LOGIN' | null {
  const v = (globalThis as { __mailConnTest?: unknown }).__mailConnTest;
  return v === 'AUTH' || v === 'WEB_LOGIN' ? v : null;
}

// ---------------------------------------------------------------- api

function bad(fields: FieldErrors): DashResult<never> | null {
  return Object.keys(fields).length ? mockError('VALIDATION_FAILED', fields) : null;
}

export function createAdminApi(clock: MockClock = {}) {
  const s = seed();
  const call = <T>(fn: () => DashResult<T>) => mockCall(fn, clock);
  const nextId = (p: string) => `${p}-${++s.seq}`;
  const roleName = (id: string) => s.roles.find((r) => r.id === id)?.name ?? '';
  const withCount = (r: Store['roles'][number]): AdminRole => ({ ...r, levels: { ...r.levels }, usersCount: s.users.filter((u) => u.roleId === r.id).length });
  const user = (id: string) => s.users.find((u) => u.id === id);
  const copyUser = (u: AdminUser): AdminUser => ({ ...u, overrides: u.overrides.map((o) => ({ ...o })) });

  // ---- sign-in history: the store's own rows plus the auth mock's failed attempts with no account (common.ts mockSignInAttempts),
  // newest attempt first ahead of the own rows, with the place / address / browser of the store's latest row (the mock's usual placeholders)
  const ATTEMPT_ID = 's-unknown-';
  const removedAttempts = new Set<string>();
  const withAttempts = (): SignInRecord[] => {
    const like = s.signIns[0] ?? { device: 'Chrome on Windows', ip: '103.21.44.108', place: 'Rajkot, Gujarat' };
    const attempts = mockSignInAttempts()
      .map((a, i) => ({ a, id: `${ATTEMPT_ID}${i + 1}` }))
      .filter(({ a, id }) => !a.ok && !removedAttempts.has(id))
      .map(({ a, id }): SignInRecord => ({
        id, at: new Date(a.at).toISOString(), device: like.device, ip: like.ip, place: like.place, result: 'failed', ended: true, username: a.username,
      }))
      .reverse();
    return attempts.length ? [...attempts, ...s.signIns] : s.signIns;
  };

  // ---- master data, plan rates, settings helpers
  const masterSet = (key: string): MasterSetRecord | undefined => s.masterSets.find((x) => x.key === key);
  const masterItemsOf = (key: string): MasterItemRecord[] => s.masterItems.filter((i) => i.setKey === key).sort((a, b) => a.sortOrder - b.sortOrder);
  const masterRow = (i: MasterItemRecord, shared: boolean): MasterRow => ({ id: i.id, label: i.label, value: i.value, color: i.color, isActive: i.isActive, isDefault: i.isDefault, sortOrder: i.sortOrder, shared });
  const onBoth = (set: MasterSetRecord, scope: MasterScope): boolean => placementOf(set.key) !== null && scope === 'both';
  /** The twin entry on the other business's list, by value. */
  const twinOf = (set: MasterSetRecord, value: string): MasterItemRecord | null => {
    const p = placementOf(set.key);
    const twinKey = p ? twinKeyOf(p) : null;
    return twinKey ? (masterItemsOf(twinKey).find((i) => fold(i.value) === fold(value)) ?? null) : null;
  };
  const clearDefaults = (setKey: string, keep: string): void => { s.masterItems.forEach((i) => { if (i.setKey === setKey && i.id !== keep) i.isDefault = false; }); };
  const masterWhere = (set: MasterSetRecord, both: boolean): string => {
    if (both) return 'both businesses';
    const p = placementOf(set.key);
    return p ? `${MASTER_GROUPS[p.group]?.sections[p.section]?.label ?? set.name} for ${masterScopeLabel[p.business]}` : set.name;
  };
  /** itemRules: a list of names keeps only the name; otherwise a blank value falls back to the label, and the duplicate check runs on what is stored. */
  const validatedMaster = (set: MasterSetRecord, input: MasterItemInput, except?: string): { data: Pick<MasterItemRecord, 'label' | 'value' | 'color' | 'isActive' | 'isDefault'> } | { error: ReturnType<typeof mockError> } => {
    const f: FieldErrors = {};
    const label = input.label.trim();
    if (!label) f.label = 'The label field is required.';
    else if (label.length > 60) f.label = 'The label field must not be greater than 60 characters.';
    const taken = (v: string) => masterItemsOf(set.key).some((i) => i.id !== except && fold(i.value) === fold(v));
    const fail = () => ({ error: mockError('VALIDATION_FAILED', f, { message: Object.values(f)[0] }) });
    if (MASTER_NAME_ONLY.has(set.key)) {
      if (!f.label && taken(label)) f.label = 'That name is already on this list.';
      if (Object.keys(f).length) return fail();
      return { data: { label, value: label, color: null, isActive: true, isDefault: false } };
    }
    const typed = input.value.trim();
    const value = typed || label;
    if (typed.length > 60) f.value = 'The value field must not be greater than 60 characters.';
    else if (!f.label && taken(value.slice(0, 60))) f.value = 'The value has already been taken.';
    const color = (input.color ?? '').trim() || null;
    if (color && color.length > 7) f.color = 'The color field must not be greater than 7 characters.';
    if (Object.keys(f).length) return fail();
    return { data: { label, value: value.slice(0, 60), color, isActive: input.isActive, isDefault: input.isDefault } };
  };
  const planPanel = (): PlanRatesPanel => {
    const today = new Date().toISOString().slice(0, 10);
    const plans = masterItemsOf('hotel_plan').filter((i) => i.isActive).map((i) => ({ value: i.value, label: i.label }));
    const sorted = [...s.planRates].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
    const rates: Record<string, PlanRate[]> = {};
    for (const r of sorted) (rates[r.plan.toLowerCase()] ??= []).push({ ...r });
    // Plan meals served this month: how many person-nights the bills carry, per plan
    const nights: Record<string, number> = s.empty ? {} : { cp: 38, map: 22 };
    const owed = Object.entries(nights).reduce((t, [plan, n]) => t + n * (rates[plan]?.find((r) => r.effectiveFrom <= today)?.ratePaise ?? 0), 0);
    return { plans, rates, today, owedThisMonthPaise: owed };
  };
  const emailSet = (): boolean => String(s.settings['email.username'] ?? '').trim() !== '' && String(s.settings['email.password'] ?? '') !== '';
  const settingGroup = (key: string): SettingGroup => {
    const def = SETTING_DEFS[key] as SettingGroupDef;
    const rb = (text: string | undefined): string | null => (text === undefined ? null : rebrand(text, s.empty));
    return {
      key, label: rb(def.label) ?? '', icon: def.icon, about: rb(def.about) ?? '',
      fields: Object.entries(def.fields).map(([k, f]) => {
        const stored = s.settings[k] ?? null;
        const secret = f.secret === true;
        return {
          key: k, label: rb(f.label) ?? '', type: f.type, secret, options: f.options ?? null, help: rb(f.help), placeholder: f.placeholder ?? null,
          value: secret ? null : stored !== null && stored !== '' ? stored : rb(f.default),
          set: secret && stored !== null && stored !== '',
          suffix: f.suffix ?? null, min: f.min ?? null, max: f.max ?? null, step: f.step ?? null, maxLength: f.maxLength ?? null, rows: f.rows ?? null,
        };
      }),
      ...(key === 'email' ? { emailStatus: { lastTest: s.emailTest, lastConnectionTest: s.mailConnTest, canStorePassword: true, passwordUnreadable: false, sendingFrom: emailSet() ? { source: 'settings' as const, address: String(s.settings['email.username']).trim(), provider: (String(s.settings['email.provider'] || 'gmail')) as MailProviderId } : { source: 'platform' as const, address: null, provider: null }, otherServer: null, lastFailure: null, identity: null, mode: emailSet() ? ('own' as const) : ('platform' as const), platformAddress: emailSet() ? null : 'hotel-sunrise@mail.easyhotelsolutions.in', provider: emailSet() ? ((String(s.settings['email.provider'] || 'gmail')) as MailProviderId) : null, server: emailSet() ? { host: String(s.settings['email.host'] || 'smtp.gmail.com'), port: Number(s.settings['email.port'] || 587), security: 'starttls' as const, region: '' } : null, limits: emailSet() ? { perSecond: 1, perDay: 500 } : null } } : {}),
    };
  };
  const backupStatus = (): BackupStatus => ({ connected: s.drive.connected, redirectUri: `https://hms.${s.empty ? NEW_HOTEL.domain : DEMO_DOMAIN}/settings/backup/google/callback`, lastAt: s.drive.lastAt, lastResult: s.drive.lastResult });
  const recycleDays = (): number => {
    const n = Math.floor(Number(s.settings['recycle.days'] ?? 30));
    return Number.isFinite(n) && n >= 1 ? n : 30;
  };

  return {
    // ---------------- users
    listUsers: (q: ListQuery = {}) => call<{ page: Page<AdminUser>; stats: AdminUserStats }>(() => {
      const stats: AdminUserStats = { all: s.users.length, active: s.users.filter((u) => u.status === 'active').length, inactive: s.users.filter((u) => u.status === 'inactive').length, locked: s.users.filter((u) => u.status === 'locked').length };
      const tab = q.tab && q.tab !== 'all' ? q.tab : null;
      const rows = s.users.filter((u) => !tab || u.status === tab);
      const page = pageOf(rows, q, (u, x) => [u.name, u.username, u.email, u.mobile].some((v) => v.toLowerCase().includes(x)));
      return ok({ page: { ...page, items: page.items.map(copyUser) }, stats });
    }),
    getUser: (id: string) => call<AdminUser>(() => { const u = user(id); return u ? ok(copyUser(u)) : mockError('NOT_FOUND'); }),
    createUser: (i: AdminUserInput) => call<AdminUser>(() => {
      const f = validateUser(i);
      if (s.users.some((u) => u.username.toLowerCase() === i.username.trim().toLowerCase())) f.username = 'That username is taken.';
      if (i.email.trim() && s.users.some((u) => u.email.toLowerCase() === i.email.trim().toLowerCase())) f.email = 'Someone already uses that email.';
      const e = bad(f);
      if (e) return e;
      const u: AdminUser = { id: nextId('u'), name: i.name.trim(), username: i.username.trim(), email: i.email.trim(), mobile: i.mobile.replace(/\D/g, '').slice(-10), roleId: i.roleId, roleName: roleName(i.roleId), status: 'invited', emailedCode: false, lastLoginAt: null, createdAt: new Date().toISOString(), overrides: i.overrides.map((o) => ({ ...o })) };
      s.users.unshift(u);
      return ok(copyUser(u));
    }),
    updateUser: (id: string, i: AdminUserInput) => call<AdminUser>(() => {
      const u = user(id);
      if (!u) return mockError('NOT_FOUND');
      const f = validateUser(i);
      if (s.users.some((x) => x.id !== id && x.username.toLowerCase() === i.username.trim().toLowerCase())) f.username = 'That username is taken.';
      const e = bad(f);
      if (e) return e;
      Object.assign(u, { name: i.name.trim(), username: i.username.trim(), email: i.email.trim(), mobile: i.mobile.replace(/\D/g, '').slice(-10), roleId: i.roleId, roleName: roleName(i.roleId), overrides: i.overrides.map((o) => ({ ...o })) });
      return ok(copyUser(u));
    }),
    toggleUser: (id: string) => call<AdminUser>(() => {
      const u = user(id);
      if (!u) return mockError('NOT_FOUND');
      if (u.id === s.selfId) return mockError('CONFLICT', { form: adminCopy.users.selfBlock });
      u.status = u.status === 'active' ? 'inactive' : 'active';
      return ok(copyUser(u));
    }),
    unlockUser: (id: string) => call<AdminUser>(() => {
      const u = user(id);
      if (!u) return mockError('NOT_FOUND');
      if (u.status !== 'locked') return mockError('CONFLICT');
      u.status = 'active';
      return ok(copyUser(u));
    }),
    /** Decision 47: the guests or companies this portal account could be linked to (the demo's own small lists). */
    listPortalOptions: (id: string, q?: string) => call<AdminPortalOption[]>(() => {
      const u = user(id);
      if (!u || !u.portal) return mockError('NOT_FOUND');
      const all: AdminPortalOption[] = u.portal.kind === 'guest'
        ? [{ id: 'g-1', name: 'Amit Joshi', detail: '98250 00001' }, { id: 'g-2', name: 'Ravi Kumar', detail: '98250 00002' }, { id: 'g-3', name: 'Deepa Iyer', detail: '98250 00003' }]
        : [{ id: 'co-demo-1', name: 'Sample Traders Pvt Ltd', detail: 'Rajkot' }, { id: 'co-demo-2', name: 'Example Pharma LLP', detail: 'Ahmedabad' }];
      const needle = (q ?? '').trim().toLowerCase();
      return ok(all.filter((o) => !needle || `${o.name} ${o.detail}`.toLowerCase().includes(needle)));
    }),
    linkPortal: (id: string, input: { kind: 'guest' | 'company'; recordId: string }) => call<AdminUser>(() => {
      const u = user(id);
      if (!u || !u.portal) return mockError('NOT_FOUND');
      if (!input.recordId) return mockError('VALIDATION_FAILED', { recordId: 'Choose who this account belongs to.' });
      const names: Record<string, string> = { 'g-1': 'Amit Joshi', 'g-2': 'Ravi Kumar', 'g-3': 'Deepa Iyer', 'co-demo-1': 'Sample Traders Pvt Ltd', 'co-demo-2': 'Example Pharma LLP' };
      u.portal = { kind: u.portal.kind, linked: true, recordId: input.recordId, recordName: names[input.recordId] ?? input.recordId };
      return ok(copyUser(u));
    }),
    unlinkPortal: (id: string) => call<AdminUser>(() => {
      const u = user(id);
      if (!u || !u.portal) return mockError('NOT_FOUND');
      u.portal = { kind: u.portal.kind, linked: false, recordId: null, recordName: null };
      return ok(copyUser(u));
    }),
    emailNewPassword: (id: string) => call<{ to: string }>(() => { const u = user(id); return u ? ok({ to: u.email }) : mockError('NOT_FOUND'); }),
    deleteUser: (id: string) => call<{ id: string }>(() => {
      const u = user(id);
      if (!u) return mockError('NOT_FOUND');
      if (u.id === s.selfId) return mockError('CONFLICT', { form: adminCopy.users.selfBlock });
      s.users = s.users.filter((x) => x.id !== id);
      return ok({ id });
    }),

    // ---------------- roles
    listRoles: () => call<AdminRole[]>(() => ok(s.roles.map(withCount))),
    createRole: (i: AdminRoleInput) => call<AdminRole>(() => {
      const e = bad(validateRole(i));
      if (e) return e;
      const r = { id: nextId('r'), name: i.name.trim(), description: i.description.trim(), builtIn: false, levels: { ...allAt('none'), ...i.levels }, icon: i.icon, accent: i.accent, inherits: i.inherits };
      s.roles.push(r);
      return ok(withCount(r));
    }),
    updateRole: (id: string, i: AdminRoleInput) => call<AdminRole>(() => {
      const r = s.roles.find((x) => x.id === id);
      if (!r) return mockError('NOT_FOUND');
      const e = bad(validateRole(i));
      if (e) return e;
      // Built-in roles are view only (server roleService.update): the same values are a no-op, any change is CONFLICT naming each changed field.
      if (r.builtIn) {
        const levels = { ...allAt('none'), ...i.levels };
        const changed: string[] = [];
        if (i.name.trim() !== r.name) changed.push('name');
        if (i.description.trim() !== r.description) changed.push('description');
        if (i.icon !== undefined && i.icon !== r.icon) changed.push('icon');
        if (i.accent !== undefined && i.accent !== r.accent) changed.push('accent');
        if (i.inherits !== undefined && i.inherits !== (r.inherits ?? false)) changed.push('inherits');
        if (permissionModules.some((m) => (levels[m.key] ?? 'none') !== (r.levels[m.key] ?? 'none'))) changed.push('levels');
        const locked = adminCopy.roles.builtInLocked;
        if (changed.length) return mockError('CONFLICT', Object.fromEntries(changed.map((f) => [f, locked])), { message: locked });
        return ok(withCount(r));
      }
      Object.assign(r, { name: i.name.trim(), description: i.description.trim(), levels: { ...allAt('none'), ...i.levels }, icon: i.icon ?? r.icon, accent: i.accent ?? r.accent, inherits: i.inherits ?? r.inherits });
      return ok(withCount(r));
    }),
    /** Pallav's ladder: the new order of the role ids (the top rung, Super Admin, stays first; the built-in roles keep their order, as the server's VALIDATION_FAILED). */
    reorderRoles: (ids: string[]) => call<AdminRole[]>(() => {
      const shippedNow = s.roles.filter((r) => r.builtIn).map((r) => r.id);
      const shippedWanted = ids.filter((id) => shippedNow.includes(id));
      if (shippedWanted.join() !== shippedNow.join()) return mockError('VALIDATION_FAILED', { order: adminCopy.roles.builtInLocked }, { message: adminCopy.roles.builtInLocked });
      const known = ids.filter((id) => s.roles.some((r) => r.id === id));
      const rest = s.roles.filter((r) => !known.includes(r.id));
      const next = [...known.map((id) => s.roles.find((r) => r.id === id)!), ...rest];
      const top = next.findIndex((r) => r.id === 'r-super');
      if (top > 0) next.unshift(...next.splice(top, 1));
      s.roles = next;
      return ok(s.roles.map(withCount));
    }),
    deleteRole: (id: string) => call<{ id: string }>(() => {
      const r = s.roles.find((x) => x.id === id);
      if (!r) return mockError('NOT_FOUND');
      if (r.builtIn || s.users.some((u) => u.roleId === id)) return mockError('CONFLICT', { form: adminCopy.roles.cannotDelete });
      s.roles = s.roles.filter((x) => x.id !== id);
      return ok({ id });
    }),

    // ---------------- master data (server: masterService; the rules below are the server's)
    listMasterRail: () => call<MasterRailEntry[]>(() => {
      const out: MasterRailEntry[] = [];
      const seen = new Set<string>();
      for (const set of s.masterSets) {
        const p = placementOf(set.key);
        if (!p) {
          const count = s.masterItems.filter((i) => i.setKey === set.key && i.isActive).length;
          out.push({ key: set.key, name: set.name, icon: set.icon, hint: adminCopy.masters.rail.inUse(count), count, grouped: false });
          continue;
        }
        if (seen.has(p.group)) continue;
        seen.add(p.group);
        const def = MASTER_GROUPS[p.group];
        if (!def) continue;
        const first = Object.values(def.sections)[0]?.sets.hotel ?? set.key;
        out.push({ key: first, name: def.name, icon: def.icon, hint: Object.values(def.sections).map((x) => x.label).join(' · '), count: null, grouped: true });
      }
      return ok(out);
    }),
    getMasterList: (key: string, askedScope?: string) => call<MasterList>(() => {
      const asked = masterSet(key);
      if (!asked) return mockError('NOT_FOUND');
      const p = placementOf(asked.key);
      const scope: MasterScope | null = p ? scopeOf(askedScope) : null;
      const current = (p && scope ? masterSet(siblingFor(p, scopeBusiness(scope)) ?? '') : null) ?? asked;
      const cp = placementOf(current.key);
      const isCatalog = current.key in MASTER_CATALOGS;
      let rows: MasterRow[] = [];
      if (!isCatalog) {
        const items = masterItemsOf(current.key);
        const ordered = MASTER_NAME_ONLY.has(current.key) ? [...items].sort((a, b) => naturalCompare(a.label, b.label)) : items;
        const twinKey = cp ? twinKeyOf(cp) : null;
        const twinNames = new Set(scope && twinKey ? masterItemsOf(twinKey).map((i) => fold(i.value)) : []);
        rows = ordered.map((i) => masterRow(i, scope !== null && twinNames.has(fold(i.value)))).filter((r) => !(scope === 'both' && !r.shared));
      }
      const groupSections = cp ? Object.entries(MASTER_GROUPS[cp.group]?.sections ?? {}) : [];
      const sections: MasterSection[] = cp && groupSections.length >= 2 ? groupSections.map(([sk, part]) => ({ key: sk, name: part.label, setKey: part.sets[cp.business], active: sk === cp.section })) : [];
      return ok({
        set: { key: current.key, name: current.name, description: current.description, icon: current.icon, input: current.input, isSystem: current.isSystem, isNameOnly: MASTER_NAME_ONLY.has(current.key), isCatalog },
        placement: cp ? { group: cp.group, groupName: MASTER_GROUPS[cp.group]?.name ?? '', section: cp.section, sectionLabel: MASTER_GROUPS[cp.group]?.sections[cp.section]?.label ?? '', business: cp.business, businessName: masterScopeLabel[cp.business] } : null,
        sections,
        scope,
        rows,
      });
    }),
    createMasterItem: (key: string, askedScope: string | undefined, input: MasterItemInput) => call<MasterItemResult>(() => {
      const set = masterSet(key);
      if (!set) return mockError('NOT_FOUND');
      const v = validatedMaster(set, input);
      if ('error' in v) return v.error;
      const item: MasterItemRecord = { id: nextId('mi'), setKey: set.key, ...v.data, sortOrder: masterItemsOf(set.key).reduce((m, i) => Math.max(m, i.sortOrder), 0) + 1 };
      s.masterItems.push(item);
      if (item.isDefault) clearDefaults(set.key, item.id);
      const both = onBoth(set, scopeOf(askedScope));
      if (both) {
        const p = placementOf(set.key);
        const twinKey = p ? twinKeyOf(p) : null;
        if (twinKey && !twinOf(set, item.value)) s.masterItems.push({ id: nextId('mi'), setKey: twinKey, label: item.label, value: item.value, color: null, isActive: item.isActive, isDefault: false, sortOrder: masterItemsOf(twinKey).reduce((m, i) => Math.max(m, i.sortOrder), 0) + 1 });
      }
      return ok({ item: masterRow(item, both), message: `"${item.label}" added to ${masterWhere(set, both)}.` });
    }),
    updateMasterItem: (id: string, askedScope: string | undefined, input: MasterItemInput) => call<MasterItemResult>(() => {
      const item = s.masterItems.find((i) => i.id === id);
      const set = item ? masterSet(item.setKey) : undefined;
      if (!item || !set) return mockError('NOT_FOUND');
      const twin = onBoth(set, scopeOf(askedScope)) ? twinOf(set, item.value) : null;
      const v = validatedMaster(set, input, id);
      if ('error' in v) return v.error;
      Object.assign(item, v.data);
      if (item.isDefault) clearDefaults(set.key, id);
      if (twin) Object.assign(twin, { label: item.label, value: item.value });
      return ok({ item: masterRow(item, twin !== null), message: twin ? 'Option updated for both businesses.' : 'Option updated.' });
    }),
    toggleMasterItem: (id: string, askedScope?: string) => call<MasterItemResult>(() => {
      const item = s.masterItems.find((i) => i.id === id);
      const set = item ? masterSet(item.setKey) : undefined;
      if (!item || !set) return mockError('NOT_FOUND');
      const twin = onBoth(set, scopeOf(askedScope)) ? twinOf(set, item.value) : null;
      item.isActive = !item.isActive;
      if (twin) twin.isActive = item.isActive;
      return ok({ item: masterRow(item, twin !== null), message: item.isActive ? `"${item.label}" is offered on forms again.` : `"${item.label}" is hidden from forms. Records that already use it keep it.` });
    }),
    /** Swaps places with the neighbour; at an end nothing happens (`moved: false`). */
    moveMasterItem: (id: string, direction: 'up' | 'down') => call<{ id: string; moved: boolean }>(() => {
      const item = s.masterItems.find((i) => i.id === id);
      if (!item) return mockError('NOT_FOUND');
      const list = masterItemsOf(item.setKey);
      const at = list.findIndex((i) => i.id === id);
      const other = list[direction === 'up' ? at - 1 : at + 1];
      if (!other) return ok({ id, moved: false });
      [item.sortOrder, other.sortOrder] = [other.sortOrder, item.sortOrder];
      return ok({ id, moved: true });
    }),
    deleteMasterItem: (id: string, askedScope?: string) => call<{ id: string; message: string }>(() => {
      const item = s.masterItems.find((i) => i.id === id);
      const set = item ? masterSet(item.setKey) : undefined;
      if (!item || !set) return mockError('NOT_FOUND');
      const twin = onBoth(set, scopeOf(askedScope)) ? twinOf(set, item.value) : null;
      s.masterItems = s.masterItems.filter((i) => i.id !== id && i.id !== twin?.id);
      const p = placementOf(set.key);
      return ok({ id, message: `"${item.label}" removed from ${twin ? 'both businesses' : p ? masterScopeLabel[p.business] : set.name}. Records that already use it are untouched.` });
    }),
    /** A list the app itself uses cannot be removed (409). */
    deleteMasterSet: (key: string) => call<{ key: string; message: string }>(() => {
      const set = masterSet(key);
      if (!set) return mockError('NOT_FOUND');
      if (set.isSystem) return mockError('CONFLICT', undefined, { message: 'This list is used by the app itself and cannot be removed. You can still change what is in it.' });
      s.masterSets = s.masterSets.filter((x) => x.key !== key);
      s.masterItems = s.masterItems.filter((i) => i.setKey !== key);
      return ok({ key, message: `List "${set.name}" removed.` });
    }),

    // expense catalogue (no server route yet; Pallav's rules)
    getExpenseCatalog: (setKey: string, askedScope?: string) => call<ExpenseCatalog>(() => {
      const business = MASTER_CATALOGS[setKey];
      const set = masterSet(setKey);
      if (!business || !set) return mockError('NOT_FOUND');
      const scope = scopeOf(askedScope);
      const categories = s.catalog.filter((c) => c.business === business).map((c) => {
        const twinCat = s.catalog.find((x) => x.business !== business && fold(x.name) === fold(c.name));
        const items = c.items.map((i) => ({ id: i.id, name: i.name, pricePaise: i.pricePaise, shared: Boolean(twinCat?.items.some((x) => fold(x.name) === fold(i.name))) }));
        return { id: c.id, name: c.name, shared: Boolean(twinCat), items: scope === 'both' ? items.filter((i) => i.shared) : items };
      }).filter((c) => scope !== 'both' || c.shared);
      return ok({ setKey, business, scope, categories });
    }),
    saveCatalogCategory: (setKey: string, askedScope: string | undefined, id: string | null, name: string) => call<{ category: { id: string; name: string }; message: string }>(() => {
      const business = MASTER_CATALOGS[setKey];
      if (!business) return mockError('NOT_FOUND');
      const clean = name.trim();
      if (!clean) return mockError('VALIDATION_FAILED', { name: 'The name field is required.' }, { message: 'The name field is required.' });
      if (clean.length > 80) return mockError('VALIDATION_FAILED', { name: 'The name field must not be greater than 80 characters.' }, { message: 'The name field must not be greater than 80 characters.' });
      const both = scopeOf(askedScope) === 'both';
      const clash = s.catalog.some((c) => c.business === business && c.id !== id && fold(c.name) === fold(clean));
      if (clash) return mockError('VALIDATION_FAILED', { name: 'That category is already on this list.' }, { message: 'That category is already on this list.' });
      if (id) {
        const c = s.catalog.find((x) => x.id === id);
        if (!c) return mockError('NOT_FOUND');
        const twin = both ? s.catalog.find((x) => x.business !== c.business && fold(x.name) === fold(c.name)) : undefined;
        c.name = clean;
        if (twin) twin.name = clean;
        return ok({ category: { id: c.id, name: c.name }, message: both ? 'Category renamed in both businesses.' : 'Category renamed.' });
      }
      const c: CatalogCategoryRecord = { id: nextId('cc'), business, name: clean, items: [] };
      s.catalog.push(c);
      if (both) {
        const other: MasterBusiness = business === 'hotel' ? 'food' : 'hotel';
        if (!s.catalog.some((x) => x.business === other && fold(x.name) === fold(clean))) s.catalog.push({ id: nextId('cc'), business: other, name: clean, items: [] });
      }
      return ok({ category: { id: c.id, name: c.name }, message: `"${clean}" added to ${both ? 'both businesses' : masterScopeLabel[business]}.` });
    }),
    deleteCatalogCategory: (id: string, askedScope?: string) => call<{ id: string; message: string }>(() => {
      const c = s.catalog.find((x) => x.id === id);
      if (!c) return mockError('NOT_FOUND');
      const both = scopeOf(askedScope) === 'both';
      s.catalog = s.catalog.filter((x) => x.id !== id && !(both && x.business !== c.business && fold(x.name) === fold(c.name)));
      return ok({ id, message: `"${c.name}" removed from ${both ? 'both businesses' : masterScopeLabel[c.business]}. Expenses already recorded keep what they were saved with.` });
    }),
    saveCatalogItem: (categoryId: string, askedScope: string | undefined, id: string | null, input: { name: string; pricePaise: number | null }) => call<{ item: { id: string; name: string; pricePaise: number }; message: string }>(() => {
      const c = s.catalog.find((x) => x.id === categoryId);
      if (!c) return mockError('NOT_FOUND');
      const name = input.name.trim();
      const f: FieldErrors = {};
      if (!name) f.name = 'The name field is required.';
      else if (name.length > 80) f.name = 'The name field must not be greater than 80 characters.';
      else if (c.items.some((x) => x.id !== id && fold(x.name) === fold(name))) f.name = 'That item is already in this category.';
      if (input.pricePaise === null || !Number.isInteger(input.pricePaise)) f.price = 'The price field is required.';
      else if (input.pricePaise < 0) f.price = 'The price field must be at least 0.';
      if (Object.keys(f).length) return mockError('VALIDATION_FAILED', f, { message: Object.values(f)[0] });
      const price = input.pricePaise ?? 0;
      const both = scopeOf(askedScope) === 'both';
      const twinCat = both ? s.catalog.find((x) => x.business !== c.business && fold(x.name) === fold(c.name)) : undefined;
      if (id) {
        const it = c.items.find((x) => x.id === id);
        if (!it) return mockError('NOT_FOUND');
        const twin = twinCat?.items.find((x) => fold(x.name) === fold(it.name));
        Object.assign(it, { name, pricePaise: price });
        if (twin) Object.assign(twin, { name, pricePaise: price });
        return ok({ item: { id: it.id, name: it.name, pricePaise: it.pricePaise }, message: both ? 'Item updated in both businesses.' : 'Item updated.' });
      }
      const it = { id: nextId('ci'), name, pricePaise: price };
      c.items.push(it);
      if (twinCat && !twinCat.items.some((x) => fold(x.name) === fold(name))) twinCat.items.push({ id: nextId('ci'), name, pricePaise: price });
      return ok({ item: it, message: `"${name}" added to ${both ? 'both businesses' : masterScopeLabel[c.business]}.` });
    }),
    deleteCatalogItem: (id: string, askedScope?: string) => call<{ id: string; message: string }>(() => {
      const c = s.catalog.find((x) => x.items.some((i) => i.id === id));
      const it = c?.items.find((i) => i.id === id);
      if (!c || !it) return mockError('NOT_FOUND');
      const both = scopeOf(askedScope) === 'both';
      c.items = c.items.filter((i) => i.id !== id);
      const twinCat = both ? s.catalog.find((x) => x.business !== c.business && fold(x.name) === fold(c.name)) : undefined;
      if (twinCat) twinCat.items = twinCat.items.filter((i) => fold(i.name) !== fold(it.name));
      return ok({ id, message: `"${it.name}" removed from ${both ? 'both businesses' : masterScopeLabel[c.business]}. Expenses already recorded keep it.` });
    }),

    // ---------------- plan rates (server: planRateService)
    getPlanRates: () => call<PlanRatesPanel>(() => ok(planPanel())),
    /** One price per plan per date: a second one for the same date replaces it. */
    savePlanRate: (i: PlanRateInput) => call<{ rate: PlanRate; message: string }>(() => {
      const f: FieldErrors = {};
      const choices = (masterItemsOf('hotel_plan')).filter((x) => x.isActive).map((x) => x.value);
      if (!i.plan.trim()) f.plan = 'The plan field is required.';
      else if (!choices.includes(i.plan)) f.plan = 'The selected plan is invalid.';
      if (!Number.isInteger(i.ratePaise)) f.ratePaise = 'The rate per person field must be a number.';
      else if (i.ratePaise < 0) f.ratePaise = 'The rate per person field must be at least 0.';
      else if (i.ratePaise > 10_000_000) f.ratePaise = 'The rate per person field must not be greater than 100000.';
      if (!i.effectiveFrom.trim()) f.effectiveFrom = 'The effective from field is required.';
      else if (!/^\d{4}-\d{2}-\d{2}$/.test(i.effectiveFrom) || Number.isNaN(Date.parse(i.effectiveFrom))) f.effectiveFrom = 'The effective from field must be a valid date.';
      if (i.note.length > 255) f.note = 'The note field must not be greater than 255 characters.';
      if (Object.keys(f).length) return mockError('VALIDATION_FAILED', f, { message: Object.values(f)[0] });
      const same = s.planRates.find((r) => r.plan === i.plan && r.effectiveFrom === i.effectiveFrom);
      if (same) {
        Object.assign(same, { ratePaise: i.ratePaise, note: i.note.trim() });
        return ok({ rate: { ...same }, message: `${i.plan} plan rate saved.` });
      }
      const rate: PlanRate = { id: nextId('pr'), plan: i.plan, effectiveFrom: i.effectiveFrom, ratePaise: i.ratePaise, note: i.note.trim(), createdByName: s.profile.name, createdAt: new Date().toISOString() };
      s.planRates.push(rate);
      return ok({ rate: { ...rate }, message: `${i.plan} plan rate saved.` });
    }),
    deletePlanRate: (id: string) => call<{ id: string; message: string }>(() => {
      if (!s.planRates.some((r) => r.id === id)) return mockError('NOT_FOUND');
      s.planRates = s.planRates.filter((r) => r.id !== id);
      return ok({ id, message: 'Rate removed. Bills already made keep the amount they were saved with.' });
    }),

    /** The Set-up map (H12): the demo's own settings, 23 rooms, its plan rates, its people and a live website; the brand-new hotel has nothing set. */
    getSettingsMap: () => call<SettingsMap>(() => {
      if (!s.actorSuper) return mockError('FORBIDDEN', undefined, { message: adminCopy.settings.onlySuper });
      const M = adminCopy.settings.map;
      const v = (key: string) => (s.settings[key] ?? '').trim();
      const item = (id: keyof typeof M.items, state: SettingsMapItem['state'], detail: string | null, view: string, params?: Record<string, string>): SettingsMapItem => ({ id, ...M.items[id], state, detail, view, ...(params ? { params } : {}) });
      const rooms = s.empty ? 0 : 23;
      // like the server (settingsMapService): SET only with a login AND a From address; Gmail sends from its own address (the login), so that counts as the From
      const mailLogin = Boolean(v('email.username') && v('email.password'));
      const mailFrom = v('email.from_address') || (v('email.provider') === 'gmail' ? v('email.username') : '');
      const items: SettingsMapItem[] = [
        item('profile', v('general.site_name') && (v('general.address') || v('general.support_phone')) ? 'done' : v('general.site_name') ? 'partial' : 'todo', v('general.site_name') ? [v('general.site_name'), v('general.support_phone')].filter(Boolean).join(', ') : null, 'hotel.admin.settings', { tab: 'general' }),
        item('billing', v('billing.hotel_gstin') ? 'done' : 'todo', v('billing.hotel_gstin') || null, 'hotel.admin.settings', { tab: 'billing' }),
        item('email', mailLogin && mailFrom ? 'done' : v('email.username') || v('email.password') || mailFrom ? 'partial' : 'todo', mailLogin && mailFrom ? M.emailDetail(mailFrom, Boolean(v('email.daily_summary_to'))) : null, 'hotel.admin.settings', { tab: 'email' }),
        item('rooms', rooms ? 'done' : 'todo', rooms ? M.count(rooms, 'room') : null, 'hotel.fo.rooms'),
        item('rates', s.planRates.length ? 'done' : 'todo', s.planRates.length ? M.count(s.planRates.length, 'plan rate') : null, 'hotel.admin.masters', { list: 'plan-rates' }),
        item('staff', s.users.length > 1 ? 'done' : 'todo', s.users.length ? M.count(s.users.length, 'person', 'people') : null, 'hotel.admin.users'),
        item('website', s.empty ? 'todo' : 'done', s.empty ? null : M.websiteLive(1), 'hotel.web.overview'),
        item('payments', v('razorpay_hotel.enabled') === '1' && v('razorpay_hotel.key_id') ? 'done' : v('razorpay_hotel.enabled') === '1' || v('razorpay_hotel.key_id') ? 'partial' : 'todo', v('razorpay_hotel.enabled') === '1' && v('razorpay_hotel.key_id') ? M.paymentsOn : null, 'hotel.admin.settings', { tab: 'razorpay_hotel' }),
      ];
      return ok({ items, done: items.filter((i) => i.state === 'done').length, total: items.length });
    }),

    // ---------------- settings (SuperAdmin only; a secret is never returned)
    /** The groups, and the open one with its values (`tab`; the first when missing or unknown). */
    getSettings: (tab?: string) => call<SettingsOverview>(() => {
      if (!s.actorSuper) return mockError('FORBIDDEN', undefined, { message: adminCopy.settings.onlySuper });
      const key = tab && tab in SETTING_DEFS ? tab : (Object.keys(SETTING_DEFS)[0] ?? 'general');
      return ok({ groups: Object.entries(SETTING_DEFS).map(([k, g]) => ({ key: k, label: rebrand(g.label, s.empty), icon: g.icon, about: rebrand(g.about, s.empty) })), current: settingGroup(key) });
    }),
    /** A save reads every field of the group: empty falls back to the default, an unsent toggle is off, a secret left empty keeps what is saved. */
    saveSettings: (group: string, values: SettingsValues, clear?: readonly string[]) => call<{ group: SettingGroup; message: string }>(() => {
      if (!s.actorSuper) return mockError('FORBIDDEN', undefined, { message: adminCopy.settings.onlySuper });
      const def = SETTING_DEFS[group];
      if (!def) return mockError('NOT_FOUND');
      const unknown = Object.keys(values).filter((k) => !(k in def.fields));
      if (unknown.length) return mockError('VALIDATION_FAILED', Object.fromEntries(unknown.map((k) => [k, 'Not a setting of this group.'])), { message: 'Unknown setting.' });
      const next: Record<string, string> = {};
      for (const [key, f] of Object.entries(def.fields)) {
        const raw = values[key];
        if (f.type === 'toggle') { next[key] = raw === true || raw === '1' || raw === 'true' || raw === 'on' ? '1' : '0'; continue; }
        let value = (raw === undefined || raw === null ? '' : String(raw)).trim();
        if (f.secret) { if (value !== '') next[key] = value; else if (clear?.includes(key)) next[key] = ''; continue; }
        const fail = (m: string) => mockError('VALIDATION_FAILED', { [key]: m }, { message: m });
        if (f.type === 'email' && value !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return fail(`${f.label} is not a valid email address.`);
        const decimals = f.decimals ?? 0;
        const numberShape = decimals > 0 ? new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`) : /^\d+$/;
        if (f.type === 'number' && value !== '' && !numberShape.test(value)) return fail(`${f.label} must be a number.`);
        if (f.type === 'number' && value !== '' && ((f.min !== undefined && Number(value) < f.min) || (f.max !== undefined && Number(value) > f.max))) return fail(f.check?.(value) ?? `${f.label} must be from ${f.min ?? 0} to ${f.max ?? ''}.`);
        if (f.type === 'select' && !(value in (f.options ?? {}))) value = f.default ?? '';
        const msg = f.check?.(value);
        if (msg) return fail(msg);
        if (key.endsWith('_gstin')) value = value.toUpperCase();
        next[key] = value;
      }
      if (group === 'email') {
        // Reading (decision 66), as the server: a service that only sends (and the platform's mail) never reads; Gmail's IMAP server is fixed; another server needs its public IMAP name.
        const provider = next['email.provider'] ?? '';
        const reads = next['email.mode'] === 'own' ? (MAIL_READING[provider] ?? 'none') : 'none';
        if (reads !== 'server') { next['email.imap_host'] = ''; next['email.imap_port'] = '993'; }
        if (reads === 'none') next['email.imap'] = '0';
        if (reads === 'server' && next['email.imap'] === '1') {
          const hostError = imapHostError(next['email.imap_host'] ?? '');
          if (hostError) return mockError('VALIDATION_FAILED', { 'email.imap_host': hostError }, { message: hostError });
          next['email.imap_host'] = (next['email.imap_host'] ?? '').trim().toLowerCase();
        }
      }
      Object.assign(s.settings, next);
      return ok({ group: settingGroup(group), message: `${rebrand(def.label, s.empty)} settings saved.` });
    }),
    getBackupStatus: () => call<BackupStatus>(() => (s.actorSuper ? ok(backupStatus()) : mockError('FORBIDDEN', undefined, { message: adminCopy.settings.onlySuper }))),
    connectDrive: () => call<BackupStatus>(() => { s.drive.connected = true; return ok(backupStatus()); }),
    disconnectDrive: () => call<BackupStatus>(() => { s.drive.connected = false; return ok(backupStatus()); }),
    testBackup: () => call<{ message: string }>(() => (s.drive.connected ? ok({ message: 'Connection to Google Drive works.' }) : mockError('CONFLICT', undefined, { message: 'Google Drive is not connected yet.' }))),
    /** Send a test email through the hotel's own mail settings (the server really sends one; the mock checks the host and from address are filled in). */
    /** Looks the DNS records of the hotel's own sender domain up (mock: the DKIM names are never there yet, so it stays pending with a plain next step). */
    checkEmailDomain: () => call<MailSenderIdentity>(() => {
      if (!s.actorSuper) return mockError('FORBIDDEN', undefined, { message: adminCopy.settings.onlySuper });
      const address = String(s.settings['email.from_address'] ?? '').trim();
      const domain = address.split('@')[1] ?? '';
      if (String(s.settings['email.provider'] ?? '') !== 'domain' || !domain) return mockError('CONFLICT', undefined, { message: 'Choose "My own domain", type your address and save first.' });
      return ok({ scope: 'hotel', hotelName: null, domain, fromAddress: address, status: 'pending' as const, dkimReady: false, sesConfirmed: false, records: [], checkedAt: null, nextStep: `Waiting for the platform to add ${domain} in Amazon SES. The DNS records to add appear here as soon as it has.` });
    }),

    testEmail: (to?: string) => call<{ sent: boolean; to: string; message: string; at: string; hint?: string }>(() => {
      if (!s.actorSuper) return mockError('FORBIDDEN', undefined, { message: adminCopy.settings.onlySuper });
      const user = String(s.settings['email.username'] ?? '').trim();
      if (!user || !String(s.settings['email.password'] ?? '')) return mockError('CONFLICT', undefined, { message: adminCopy.settings.email.notSet });
      const at = new Date().toISOString();
      const bad = user.startsWith('bad');
      s.emailTest = bad ? { at, ok: false, message: 'EAUTH 535-5.7.8 Username and Password not accepted', hint: 'Gmail refused the login. Use a Google APP PASSWORD (16 letters), not the normal Google password, and check that 2-step verification is switched on for that Google account.' } : { at, ok: true, message: 'Sent' };
      return ok({ sent: !bad, to: (to ?? '').trim() || user, message: s.emailTest.message, at, ...(s.emailTest.hint ? { hint: s.emailTest.hint } : {}) });
    }),
    /**
     * "Test connection" (decision 66): signs in to the SAVED mailbox for reading and for sending (the mock: Gmail and another server answer "works"; a service that only sends
     * answers SEND_ONLY for reading; `window.__mailConnTest` or a login starting with "bad" gives a failure). The result is kept for the status panel, codes and sentences only.
     */
    startMailConnectionTest: () => call<MailConnectionTest>(() => {
      if (!s.actorSuper) return mockError('FORBIDDEN', undefined, { message: adminCopy.settings.onlySuper });
      const user = String(s.settings['email.username'] ?? '').trim();
      const own = String(s.settings['email.mode'] ?? '') === 'own' || (s.settings['email.mode'] === undefined && emailSet());
      if (!own || !user || !String(s.settings['email.password'] ?? '')) return mockError('CONFLICT', undefined, { message: adminCopy.settings.email.notSet });
      const reads = MAIL_READING[String(s.settings['email.provider'] || 'gmail')] ?? 'none';
      const failure = mockMailFailure() ?? (user.startsWith('bad') ? 'AUTH' : null);
      const smtp: MailCheck = failure === 'AUTH' ? { ...MOCK_MAIL_CHECKS.smtpAuth } : { ...MOCK_MAIL_CHECKS.smtpOk };
      const imap: MailCheck =
        reads === 'none' ? { ...MOCK_MAIL_CHECKS.sendOnly }
          : reads === 'server' && !String(s.settings['email.imap_host'] ?? '').trim() ? { ...MOCK_MAIL_CHECKS.imapNotSet }
            : failure ? { ...MOCK_MAIL_CHECKS[failure] }
              : { ...MOCK_MAIL_CHECKS.imapOk };
      s.mailConnTest = { imap, smtp, at: new Date().toISOString() };
      return ok({ imap: { ...imap }, smtp: { ...smtp }, at: s.mailConnTest.at });
    }),    runBackup: () => call<BackupStatus & { message: string }>(() => {
      if (!s.drive.connected) return mockError('CONFLICT', undefined, { message: 'Google Drive is not connected yet.' });
      s.drive.lastAt = new Date().toISOString();
      s.drive.lastResult = 'Done, 186 MB sent to Google Drive.';
      return ok({ ...backupStatus(), message: 'Backup finished.' });
    }),

    // ---------------- recycle bin (SuperAdmin only)
    listRecycle: (q: ListQuery = {}) => call<Page<RecycleItem>>(() => {
      if (!s.actorSuper) return mockError('FORBIDDEN', undefined, { message: 'Only the SuperAdmin can open the recycle bin.' });
      const days = recycleDays();
      const rows = [...s.recycle].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt) || a.label.localeCompare(b.label))
        .map((r): RecycleItem => ({ ...r, daysLeft: Math.max(0, days - Math.floor((Date.now() - Date.parse(r.deletedAt)) / 86_400_000)) }));
      return ok(pageOf(rows, { pageSize: 100, ...q }, (r, x) => x.split(/\s+/).every((w) => `${r.kind} ${r.label} ${r.detail} ${r.deletedBy}`.toLowerCase().includes(w))));
    }),
    restoreRecycle: (key: string, id: string) => call<RecycleResult>(() => {
      const r = s.recycle.find((x) => x.key === key && x.id === id);
      if (!r) return mockError('NOT_FOUND', undefined, { message: 'That record is not in the recycle bin.' });
      s.recycle = s.recycle.filter((x) => x !== r);
      return ok({ key, id, message: `${r.kind} ${r.label} restored.` });
    }),
    purgeRecycle: (key: string, id: string) => call<RecycleResult>(() => {
      const r = s.recycle.find((x) => x.key === key && x.id === id);
      if (!r) return mockError('NOT_FOUND', undefined, { message: 'That record is not in the recycle bin.' });
      s.recycle = s.recycle.filter((x) => x !== r);
      return ok({ key, id, message: `${r.kind} ${r.label} removed for good.` });
    }),

    // ---------------- Razorpay: refunds, payment links, settlements, check a payment (SuperAdmin only)
    refundRazorpay: (business: RazorpayBusiness, paymentId: string, input: RazorpayRefundInput) => call<RazorpayRefundResult>(() => {
      if (!s.actorSuper) return mockError('FORBIDDEN', undefined, { message: 'Only the SuperAdmin can open Razorpay.' });
      const p = s.razorpay.find((x) => x.business === business && x.paymentId === paymentId);
      if (!p) return mockError('NOT_FOUND', undefined, { message: 'This payment is not in HMS. Use Check with Razorpay first.' });
      if (p.status !== 'captured') return mockError('CONFLICT', undefined, { message: p.status === 'refunded' ? 'This payment is already fully refunded.' : 'Only a paid payment can be refunded.' });
      const left = p.amountPaise - p.amountRefundedPaise;
      if (input.amountPaise > left) return mockError('VALIDATION_FAILED', undefined, { message: `At most ${left / 100} rupees can still be refunded.` });
      p.amountRefundedPaise += input.amountPaise;
      if (p.amountRefundedPaise >= p.amountPaise) p.status = 'refunded';
      p.lastEvent = 'refund.created';
      p.updatedAt = new Date().toISOString();
      const refund: RazorpayRefundItem = { id: `rfnd_Nx${++s.seq}Mock`, paymentId, amountPaise: input.amountPaise, status: 'processed', speed: input.instant ? 'optimum' : 'normal', reason: input.reason, by: s.profile.name, note: input.note || null, createdAt: new Date().toISOString(), payer: p.contact ?? p.email };
      (s.rzRefunds ??= []).unshift(refund);
      return ok({ refund, payment: { ...p, notes: { ...p.notes }, payload: { ...p.payload } }, message: `${input.amountPaise / 100} rupees are on their way back to the guest.` });
    }),
    checkRazorpay: (business: RazorpayBusiness, paymentId: string) => call<RazorpayCheckResult>(() => {
      if (!s.actorSuper) return mockError('FORBIDDEN', undefined, { message: 'Only the SuperAdmin can open Razorpay.' });
      const p = s.razorpay.find((x) => x.business === business && x.paymentId === paymentId);
      if (!p) return mockError('NOT_FOUND', undefined, { message: 'Razorpay has no such payment.' });
      return ok({ payment: { ...p, notes: { ...p.notes }, payload: { ...p.payload } }, message: `Checked with Razorpay: the payment is ${p.status}.` });
    }),
    listRazorpayRefunds: (business: RazorpayBusiness) => call<{ items: RazorpayRefundItem[]; page: number }>(() => {
      if (!s.actorSuper) return mockError('FORBIDDEN', undefined, { message: 'Only the SuperAdmin can open Razorpay.' });
      s.rzRefunds ??= s.razorpay.filter((p) => p.amountRefundedPaise > 0).map((p) => ({ id: `rfnd_${p.paymentId.slice(4)}`, paymentId: p.paymentId, amountPaise: p.amountRefundedPaise, status: 'processed', speed: 'normal', reason: 'Guest cancelled', by: s.profile.name, note: null, createdAt: p.updatedAt, payer: p.contact ?? p.email }));
      const ids = new Set(s.razorpay.filter((p) => p.business === business).map((p) => p.paymentId));
      return ok({ items: s.rzRefunds.filter((r) => ids.has(r.paymentId)), page: 1 });
    }),
    listRazorpayLinks: (business: RazorpayBusiness) => call<{ items: RazorpayLinkItem[]; page: number }>(() => {
      if (!s.actorSuper) return mockError('FORBIDDEN', undefined, { message: 'Only the SuperAdmin can open Razorpay.' });
      s.rzLinks ??= [
        { id: 'plink_Nx0001Rjk', url: 'https://rzp.io/i/Ab3xK9', status: 'paid', amountPaise: 1250000, description: 'Advance for booking BK-20418', name: 'Amit Joshi', contact: '+919825099887', email: null, business: 'hotel', createdAt: ago(0, 5), expiresAt: ago(-1), paidAt: ago(0, 3) },
        { id: 'plink_Nx0002Rjk', url: 'https://rzp.io/i/Pq7mT2', status: 'created', amountPaise: 600000, description: 'Advance for booking BK-20422', name: 'Deepa Iyer', contact: '+919840011223', email: 'deepa.iyer@tcs.com', business: 'hotel', createdAt: ago(0, 4), expiresAt: ago(-1), paidAt: null },
        { id: 'plink_Nx0003Rjk', url: 'https://rzp.io/i/Zt1nW5', status: 'expired', amountPaise: 340000, description: 'Banquet token', name: 'Rajesh Patel', contact: '+919825012345', email: null, business: 'food', createdAt: ago(4), expiresAt: ago(3), paidAt: null },
      ];
      return ok({ items: s.rzLinks.filter((l) => l.business === business), page: 1 });
    }),
    createRazorpayLink: (input: RazorpayLinkInput) => call<{ link: RazorpayLinkItem; message: string }>(() => {
      if (!s.actorSuper) return mockError('FORBIDDEN', undefined, { message: 'Only the SuperAdmin can open Razorpay.' });
      if (input.sms && !input.contact) return mockError('VALIDATION_FAILED', undefined, { message: "Add the guest's phone number to send an SMS." });
      if (input.mail && !input.email) return mockError('VALIDATION_FAILED', undefined, { message: 'Add the guest\'s email to send it by email.' });
      const link: RazorpayLinkItem = { id: `plink_Nx${++s.seq}Mock`, url: `https://rzp.io/i/${Math.random().toString(36).slice(2, 8)}`, status: 'created', amountPaise: input.amountPaise, description: input.description, name: input.name, contact: input.contact ?? null, email: input.email ?? null, business: input.business, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + input.validDays * 86_400_000).toISOString(), paidAt: null };
      (s.rzLinks ??= []).unshift(link);
      return ok({ link, message: 'Payment link made.' });
    }),
    cancelRazorpayLink: (business: RazorpayBusiness, linkId: string) => call<{ link: RazorpayLinkItem; message: string }>(() => {
      if (!s.actorSuper) return mockError('FORBIDDEN', undefined, { message: 'Only the SuperAdmin can open Razorpay.' });
      const l = (s.rzLinks ?? []).find((x) => x.id === linkId && x.business === business);
      if (!l) return mockError('NOT_FOUND', undefined, { message: 'No such payment link.' });
      if (l.status !== 'created') return mockError('CONFLICT', undefined, { message: 'Only a link nobody has paid yet can be cancelled.' });
      l.status = 'cancelled';
      return ok({ link: { ...l }, message: 'Link cancelled. The guest can no longer pay with it.' });
    }),
    resendRazorpayLink: (business: RazorpayBusiness, linkId: string, medium: 'sms' | 'email') => call<RazorpayOutcome>(() => {
      if (!s.actorSuper) return mockError('FORBIDDEN', undefined, { message: 'Only the SuperAdmin can open Razorpay.' });
      if (!(s.rzLinks ?? []).some((x) => x.id === linkId && x.business === business)) return mockError('NOT_FOUND', undefined, { message: 'No such payment link.' });
      return ok({ message: medium === 'sms' ? 'Sent again by SMS.' : 'Sent again by email.' });
    }),
    listRazorpaySettlements: (business: RazorpayBusiness) => call<{ items: RazorpaySettlementItem[]; page: number }>(() => {
      if (!s.actorSuper) return mockError('FORBIDDEN', undefined, { message: 'Only the SuperAdmin can open Razorpay.' });
      const amounts = business === 'hotel' ? [5883400, 8250600, 4288600, 11013800] : [1420000, 2105000, 986000, 1730000];
      return ok({
        items: amounts.map((amountPaise, i) => ({ id: `setl_Nx${business[0]}${i + 1}Mock`, amountPaise, feePaise: Math.round(amountPaise * 0.021), taxPaise: Math.round(amountPaise * 0.0038), status: i === 0 ? 'created' : 'processed', utr: i === 0 ? null : `HDFCR5202611${String(100 - i * 7).padStart(2, '0')}0${4000 + i * 311}`, createdAt: ago(i * 2) })),
        page: 1,
      });
    }),

    // ---------------- Razorpay payments (SuperAdmin only)
    listRazorpay: (q: RazorpayQuery = {}) => call<RazorpayOverview>(() => {
      if (!s.actorSuper) return mockError('FORBIDDEN', undefined, { message: 'Only the SuperAdmin can open Razorpay.' });
      const when = (p: RazorpayPayment) => p.paidAt ?? p.createdAt;
      const words = (q.search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      const rows = [...s.razorpay]
        .filter((p) => (!q.business || q.business === 'all' || p.business === q.business) && (!q.status || q.status === 'all' || (q.status === 'attention' ? p.status === 'failed' || p.status === 'authorized' : p.status === q.status)) && (!q.method || p.method === q.method))
        .filter((p) => words.every((w) => [p.paymentId, p.orderId, p.email, p.contact, p.description, p.method, p.errorDescription].some((v) => (v ?? '').toLowerCase().includes(w))))
        .sort((a, b) => when(b).localeCompare(when(a)) || b.id.localeCompare(a.id));
      const pageSize = q.pageSize ?? 25;
      const page = Math.max(1, q.page ?? 1);
      const paid = s.razorpay.filter((p) => p.status === 'captured' && p.paidAt);
      const todayKey = new Date().toISOString().slice(0, 10);
      const monthKey = todayKey.slice(0, 7);
      const stats: RazorpayStats = {
        todayPaise: paid.filter((p) => (p.paidAt ?? '').slice(0, 10) === todayKey).reduce((t, p) => t + p.amountPaise, 0),
        monthPaise: paid.filter((p) => (p.paidAt ?? '').slice(0, 7) === monthKey).reduce((t, p) => t + p.amountPaise, 0),
        failed: s.razorpay.filter((p) => p.status === 'failed' && Date.parse(p.updatedAt) >= Date.now() - 30 * 86_400_000).length,
        refundedPaise: s.razorpay.reduce((t, p) => t + p.amountRefundedPaise, 0),
        rejected: s.empty ? 0 : 2,
      };
      const hooks: RazorpayHook[] = (['hotel', 'food'] as const).map((key) => ({
        key, name: razorpayBusinessName[key], url: `https://hms.${s.empty ? NEW_HOTEL.domain : DEMO_DOMAIN}/api/v1/webhooks/razorpay/demo-hotel/${key}`,
        ready: (s.settings[`razorpay_${key}.webhook_secret`] ?? '') !== '',
        last: [...s.razorpay].filter((p) => p.business === key).map((p) => p.updatedAt).sort().pop() ?? null,
      }));
      return ok({
        page: { items: rows.slice((page - 1) * pageSize, page * pageSize).map((p) => ({ ...p, notes: { ...p.notes }, payload: { ...p.payload } })), total: rows.length, page, pageSize },
        stats, hooks,
        counts: { hotel: s.razorpay.filter((p) => p.business === 'hotel').length, food: s.razorpay.filter((p) => p.business === 'food').length },
      });
    }),
    /**
     * Tell the mock who is working: settings, the recycle bin and Razorpay are the SuperAdmin's only; `username` / `name` / `role`
     * pick the signed-in account (My Profile, the "You" tag, "you cannot delete yourself"). An account the list does not have yet is added.
     */
    setActor: (a: { superAdmin: boolean; username?: string | null; name?: string; role?: string }) => {
      s.actorSuper = a.superAdmin;
      if (!a.username && !a.name) return;
      const un = (a.username ?? '').toLowerCase();
      const nm = (a.name ?? '').toLowerCase();
      let me = s.users.find((u) => un && u.username.toLowerCase() === un)
        ?? s.users.find((u) => un && u.username.toLowerCase().startsWith(`${un}.`))
        ?? s.users.find((u) => nm && u.name.toLowerCase() === nm)
        ?? s.users.find((u) => nm && u.name.toLowerCase().startsWith(`${nm} `));
      if (!me) {
        const roleId = a.role === 'super_admin' ? 'r-super' : a.role === 'hotel_admin' || a.role === 'group_hotel_admin' || a.role === 'platform_admin' ? 'r-admin' : 'r-editor';
        me = { id: nextId('u'), name: a.name || un, username: un || nm.replace(/\s+/g, '.'), email: `${un || 'me'}@${s.empty ? NEW_HOTEL.domain : DEMO_DOMAIN}`, mobile: '9825000000', roleId, roleName: roleName(roleId), status: 'active', emailedCode: mockCodeRequired(un || nm.replace(/\s+/g, '.')), lastLoginAt: new Date().toISOString(), createdAt: s.empty ? ago(0, 0, 10) : ago(120), overrides: [] };
        s.users.push(me);
      }
      if (me.id === s.selfId) return;
      s.selfId = me.id;
      s.pendingCode = false;
      const admin = me.roleId === 'r-super' || me.roleId === 'r-admin';
      s.profile = { ...s.profile, name: me.name, username: me.username, email: me.email, mobile: me.mobile, roleName: me.roleName, emailedCode: me.emailedCode, canEditUsername: admin };
    },

    // ---------------- system
    getSystem: () => call<SystemOverview>(() => ok({ checks: s.health.map((h) => ({ ...h })), openErrors: s.errors.filter((e) => e.state === 'open').length, logToday: s.log.length, uptimeLabel: s.empty ? 'Less than a day' : '12 days, 4 hours', version: '1.0.0' })),
    runChecks: () => call<HealthCheck[]>(() => {
      const at = new Date().toISOString();
      s.health.forEach((h) => { h.checkedAt = at; });
      return ok(s.health.map((h) => ({ ...h })));
    }),
    listErrors: (q: ListQuery = {}) => call<Page<SystemErrorItem>>(() => ok(pageOf(s.errors.filter((e) => !q.tab || q.tab === 'all' || e.state === q.tab), q, (e, x) => [e.message, e.where].some((v) => v.toLowerCase().includes(x))))),
    setErrorState: (id: string, state: ErrorState) => call<SystemErrorItem>(() => {
      const e = s.errors.find((x) => x.id === id);
      if (!e) return mockError('NOT_FOUND');
      e.state = state;
      e.resolvedBy = state === 'resolved' ? s.profile.name : null;
      return ok({ ...e });
    }),
    listLog: (q: ListQuery & { level?: LogLevel | '' } = {}) => call<Page<SystemLogEntry>>(() => ok(pageOf(s.log.filter((l) => !q.level || l.level === q.level), q, (l, x) => [l.source, l.message].some((v) => v.toLowerCase().includes(x))))),

    // ---------------- profile
    getProfile: () => call<AdminProfile>(() => ok({ ...s.profile })),
    updateProfile: (i: AdminProfileInput) => call<AdminProfile>(() => {
      const f: FieldErrors = {};
      if (!i.name.trim()) f.name = 'Enter your full name.';
      if (i.name.trim().length > 100) f.name = 'Keep your name to 100 characters.';
      if (!i.email.trim() || !EMAIL.test(i.email.trim())) f.email = 'Enter a valid email address.';
      else if (s.users.some((u) => u.email.toLowerCase() === i.email.trim().toLowerCase() && u.username !== s.profile.username)) f.email = 'This email address is already used by another account.';
      const phone = i.mobile.replace(/\D/g, '').slice(-10);
      if (!i.mobile.trim()) f.mobile = 'Enter your phone number.';
      else if (i.mobile.trim().length > 20 || !/^[6-9]\d{9}$/.test(phone)) f.mobile = 'Enter a 10-digit mobile number.';
      if (i.username !== undefined && s.profile.canEditUsername) {
        const u = i.username.trim().toLowerCase();
        if (!/^[a-z0-9._]{3,50}$/.test(u)) f.username = 'Use 3 to 50 letters, digits, dots or underscores.';
        else if (u !== s.profile.username && s.users.some((x) => x.username.toLowerCase() === u)) f.username = 'This username is already taken.';
      }
      const e = bad(f);
      if (e) return e;
      Object.assign(s.profile, { name: i.name.trim(), email: i.email.trim(), mobile: phone });
      if (i.username !== undefined && s.profile.canEditUsername) s.profile.username = i.username.trim().toLowerCase();
      // The same person on User Accounts
      const me = user(s.selfId);
      if (me) Object.assign(me, { name: s.profile.name, email: s.profile.email, mobile: s.profile.mobile, username: s.profile.username });
      s.changes.unshift({ id: nextId('ac'), at: new Date().toISOString(), summary: 'Profile details updated' });
      return ok({ ...s.profile });
    }),
    /** Pallav: the last 10 account changes (no sign-in rows). */
    listAccountChanges: () => call<AccountChange[]>(() => ok(s.changes.slice(0, 10).map((x) => ({ ...x })))),
    /** Pallav: read-only live devices, the current one first. */
    listDevices: () => call<LiveDevice[]>(() => ok(s.devices.map((x) => ({ ...x })))),
    /** Decision 46: the person's own choice, off by default. ON needs nothing more; OFF needs the current password (the demo accepts the demo password). The demo sign-in follows it. */
    setMySignInCode: (enabled: boolean, password?: string) => call<AdminProfile>(() => {
      if (enabled && !s.profile.email.trim()) return mockError('VALIDATION_FAILED', { email: adminCopy.profile.codeNeedsEmail });
      if (!enabled) {
        if (!password || !password.trim()) return mockError('VALIDATION_FAILED', { password: adminCopy.profile.codeOffPasswordRequired });
        if (password !== 'Demo@Pass2026') return mockError('VALIDATION_FAILED', { password: adminCopy.profile.wrongCurrent });
      }
      s.profile.emailedCode = enabled;
      const me = user(s.selfId);
      if (me) me.emailedCode = enabled;
      mockSetCodeRequired(s.profile.username, enabled);
      return ok({ ...s.profile });
    }),
    changePassword: (i: PasswordChangeInput) => call<{ changedAt: string }>(() => {
      const f: FieldErrors = {};
      if (i.current !== 'Demo@Pass2026') f.current = adminCopy.profile.wrongCurrent;
      else if (i.next === i.current) f.next = adminCopy.profile.sameAsCurrent;
      const v = validateNewPassword(i.next, i.confirm, [s.profile.username, s.profile.name]);
      if (v.password) f.next = v.password === 'required' ? 'Enter a new password.' : 'Follow every rule below.';
      if (v.confirm) f.confirm = v.confirm === 'required' ? 'Confirm the new password.' : adminCopy.profile.mismatch;
      const e = bad(f);
      if (e) return e;
      s.profile.passwordChangedAt = new Date().toISOString();
      return ok({ changedAt: s.profile.passwordChangedAt });
    }),
    /** Pallav: the person's own sign-ins: IP filter, search (ip, place, browser or a date as 27-09-2026 / 27/09/2026 / 2026-09-27), paging 10/25/50/100, totals and places by count. */
    listSignIns: (q: SignInQuery = {}) => call<SignInList>(() => {
      const dateForms = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return [`${d}-${m}-${y}`, `${d}/${m}/${y}`, `${y}-${m}-${d}`]; };
      const rows = withAttempts();
      const all = rows.filter((x) => !q.ip || x.ip === q.ip);
      const page = pageOf(all, q, (x, y) => [x.ip, x.place, x.device, x.username ?? '', ...dateForms(x.at)].some((v) => v.toLowerCase().includes(y)));
      const counts = new Map<string, number>();
      rows.forEach((x) => counts.set(x.place, (counts.get(x.place) ?? 0) + 1));
      return ok({
        page: { ...page, items: page.items.map((x) => ({ ...x })) },
        totals: { all: rows.length, success: rows.filter((x) => x.result === 'success').length, failed: rows.filter((x) => x.result === 'failed').length },
        places: [...counts].map(([place, count]) => ({ place, count })).sort((a, b) => b.count - a.count),
      });
    }),
    /** Only an ENDED record (never the running session); written to the audit trail. */
    deleteSignIn: (id: string) => call<{ id: string }>(() => {
      if (id.startsWith(ATTEMPT_ID) && withAttempts().some((x) => x.id === id)) {
        removedAttempts.add(id);
        s.changes.unshift({ id: nextId('ac'), at: new Date().toISOString(), summary: 'Sign-in record deleted' });
        return ok({ id });
      }
      const r = s.signIns.find((x) => x.id === id);
      if (!r) return mockError('NOT_FOUND');
      if (!r.ended) return mockError('CONFLICT', undefined, { message: 'The running session cannot be deleted.' });
      s.signIns = s.signIns.filter((x) => x.id !== id);
      s.changes.unshift({ id: nextId('ac'), at: new Date().toISOString(), summary: 'Sign-in record deleted' });
      return ok({ id });
    }),
  };
}
