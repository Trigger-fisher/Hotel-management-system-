// Admin module contract (Hotel dashboard): user accounts, roles and permissions, master data, settings (general, email,
// backup, recycle bin), online payments (Razorpay), system health and my profile.
// Pure TypeScript (no React). Mock API with an in-memory store; every call resolves DashResult. Money in paise.
// Written from the S03 brief for the Hotel Pallav admin area. No chat-app messaging and no encryption-key screens (MJ).

import { newPasswordChecks } from '../auth/validation';
import type { MailLimitsInfo, MailProviderId, MailSenderIdentity, MailServerInfo } from './mailProviders';
import type { ListQuery, Page, Tone } from './common';
import type { MailConnectionTest } from './conversations';
import type { createAdminApi } from './admin.mock';

// ---------------------------------------------------------------- permissions

export type PermissionLevel = 'none' | 'view' | 'create' | 'edit' | 'full';
export const permissionLevels: PermissionLevel[] = ['none', 'view', 'create', 'edit', 'full'];

export const permissionLevelLabel: Record<PermissionLevel, string> = {
  none: 'No access',
  view: 'View only',
  create: 'View & Create',
  edit: 'View & Edit',
  full: 'Full Access',
};

export interface PermissionModule { key: string; label: string; group: string }

/** The modules a role can be given a level on (one row each in the permissions grid). */
export const permissionModules: PermissionModule[] = [
  { key: 'dashboard', label: 'Overview', group: 'Daily work' },
  { key: 'revenue', label: 'Revenue', group: 'Daily work' },
  { key: 'expense', label: 'Expenses', group: 'Daily work' },
  { key: 'handover', label: 'Handover', group: 'Daily work' },
  { key: 'bills', label: 'Billing', group: 'Daily work' },
  { key: 'companies', label: 'Companies', group: 'Accounts' },
  { key: 'payroll', label: 'Payroll', group: 'Accounts' },
  { key: 'reports', label: 'Reports', group: 'Accounts' },
  { key: 'pms', label: 'Front desk', group: 'Front desk' },
  { key: 'website', label: 'Website', group: 'Website' },
  // HMS's own module (not in Pallav's list; decision 66): email and WhatsApp in one inbox. View reads; Edit replies, assigns and adds notes.
  { key: 'conversations', label: 'Conversations', group: 'Front desk' },
  { key: 'users', label: 'Users', group: 'Admin' },
  { key: 'access', label: 'Roles', group: 'Admin' },
  { key: 'masters', label: 'Lists and rates', group: 'Admin' },
];

export type PermissionMap = Record<string, PermissionLevel>;

// ---------------------------------------------------------------- types

export type UserStatus = 'active' | 'inactive' | 'locked' | 'invited';
export const userStatusTone: Record<UserStatus, Tone> = { active: 'success', inactive: 'neutral', locked: 'danger', invited: 'info' };
export const userStatusLabel: Record<UserStatus, string> = { active: 'Active', inactive: 'Inactive', locked: 'Locked', invited: 'Invited' };

export interface PermissionOverride { module: string; level: PermissionLevel }

/** What a portal account is linked to. An unlinked account sees "Your account is not set up yet" in its portal until the hotel links it. */
export interface AdminPortalLink {
  kind: 'guest' | 'company';
  linked: boolean;
  recordId: string | null;
  /** The guest's or company's name, for the Users screen. */
  recordName: string | null;
}

/** One guest or company the account can be linked to (active records only). */
export interface AdminPortalOption {
  id: string;
  name: string;
  /** A short second line (mobile, city). */
  detail: string;
}

export interface AdminUser {
  id: string;
  name: string;
  username: string;
  email: string;
  mobile: string;
  roleId: string;
  roleName: string;
  status: UserStatus;
  /** Emailed sign-in code (Pallav two-factor). Off for everyone by default; only the person can switch it on for their own account (decision 46). */
  emailedCode: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  /** Per-user levels that replace the role's level for a module. */
  overrides: PermissionOverride[];
  /** A guest or company portal account (decision 47): which record it is linked to. Absent for staff accounts. */
  portal?: AdminPortalLink | null;
  /** Optional, as Pallav shows them on the account card. */
  lastLoginIp?: string;
  passwordChangedAt?: string | null;
  mustChangePassword?: boolean;
  createdBy?: string;
}

export interface AdminUserInput {
  name: string;
  username: string;
  email: string;
  mobile: string;
  roleId: string;
  overrides: PermissionOverride[];
}

export interface AdminUserStats { all: number; active: number; inactive: number; locked: number }

export interface AdminRole {
  id: string;
  name: string;
  description: string;
  /**
   * Shipped with the system (shared by every hotel): view only. Any change to its name, description, look, inherits, ticks or its place among the
   * other built-in roles is refused (server: PUT roles/{id} 409 CONFLICT, PUT roles/order VALIDATION_FAILED); it cannot be deleted.
   */
  builtIn: boolean;
  usersCount: number;
  levels: PermissionMap;
  /** Pallav's role look (bootstrap-icons name without "bi-", and a hex colour) and "gains everything below it". All optional. */
  icon?: string;
  accent?: string;
  inherits?: boolean;
}

export interface AdminRoleInput { name: string; description: string; levels: PermissionMap; icon?: string; accent?: string; inherits?: boolean }

/** A starting point for a new role (Roles > Add role > "Start from"): the usual hotel jobs, with their modules pre-ticked. Everything stays editable. */
export interface RoleTemplate { key: string; name: string; description: string; icon: string; levels: PermissionMap }
export const roleTemplates: RoleTemplate[] = [
  { key: 'frontDesk', name: 'Front Desk', description: 'Runs the desk: check-ins and check-outs, rooms, reservations, bills, and the shift handover.', icon: 'person-vcard',
    levels: { dashboard: 'view', pms: 'edit', bills: 'edit', handover: 'edit', revenue: 'create', companies: 'view', reports: 'view' } },
  { key: 'cashier', name: 'Cashier', description: 'Records deposits and expenses, settles bills and advances, and hands the shift over.', icon: 'cash-coin',
    levels: { dashboard: 'view', revenue: 'edit', expense: 'edit', handover: 'edit', bills: 'edit', companies: 'view', reports: 'view' } },
  { key: 'housekeeping', name: 'Housekeeping', description: 'Sees the rooms and marks them clean; nothing about money.', icon: 'stars',
    levels: { pms: 'edit' } },
  { key: 'manager', name: 'Manager', description: 'Everything a hotel does day to day, the reports, the staff and the master data; not the roles or the settings.', icon: 'briefcase',
    levels: { dashboard: 'view', revenue: 'full', expense: 'full', handover: 'full', bills: 'full', companies: 'full', payroll: 'full', reports: 'view', pms: 'full', website: 'edit', users: 'edit', masters: 'edit' } },
  { key: 'accountant', name: 'Accountant', description: 'Reads every book and report, changes nothing at the desk; runs payroll.', icon: 'calculator',
    levels: { dashboard: 'view', revenue: 'view', expense: 'view', handover: 'view', bills: 'view', companies: 'view', payroll: 'full', reports: 'view' } },
];

// ---- Master data, plan rates, settings, recycle bin, Razorpay (S08 rewrite: the server's shapes, docs/api/admin.md and
// web-app/src/server/services/admin/*; Pallav MasterDataController, MealPlanRateController, SettingsController, RazorpayPaymentController).

export type MasterBusiness = 'hotel' | 'food';
/** `both` is where a list that exists once per business opens: what is added there is added to both. */
export type MasterScope = 'both' | MasterBusiness;
export const masterScopes: MasterScope[] = ['both', 'hotel', 'food'];
export const masterScopeLabel: Record<MasterScope, string> = { both: 'Both businesses', hotel: 'Your hotel', food: 'Your restaurant' };
/** Pallav OptionSet::INPUTS: how a list shows on a form. */
export const masterInputLabel: Record<string, string> = { select: 'Dropdown', radio: 'Option cards', checkbox: 'Checkboxes' };

/** GET masters: one entry down the side. A list that exists once per business is ONE entry (`grouped`) that opens on the group's first section. */
export interface MasterRailEntry {
  key: string;
  name: string;
  /** Bootstrap Icons class, e.g. "bi-credit-card". */
  icon: string;
  hint: string;
  count: number | null;
  grouped: boolean;
}

export interface MasterRow {
  id: string;
  label: string;
  value: string;
  color: string | null;
  isActive: boolean;
  isDefault: boolean;
  sortOrder: number;
  /** The other business has an entry by the same name too. */
  shared: boolean;
}

export interface MasterSetInfo {
  key: string;
  name: string;
  description: string | null;
  icon: string | null;
  /** select | radio | checkbox (see masterInputLabel). */
  input: string;
  /** A list the app itself uses: it cannot be removed, its items can still change. */
  isSystem: boolean;
  /** A list of people: only the name is kept, read alphabetically. */
  isNameOnly: boolean;
  /** An expense catalogue: categories with priced items instead of options. */
  isCatalog: boolean;
}

export interface MasterPlacement { group: string; groupName: string; section: string; sectionLabel: string; business: MasterBusiness; businessName: string }
export interface MasterSection { key: string; name: string; setKey: string; active: boolean }

/** GET masters/{key}?scope */
export interface MasterList {
  set: MasterSetInfo;
  placement: MasterPlacement | null;
  /** The sections (tabs) of its group, or empty when the group has one. */
  sections: MasterSection[];
  scope: MasterScope | null;
  rows: MasterRow[];
}

export interface MasterItemInput { label: string; value: string; color: string | null; isActive: boolean; isDefault: boolean }
export interface MasterItemResult { item: MasterRow; message: string }

/**
 * Expense catalogue of one business (Pallav MasterCatalogController). The server has no route for it yet (the list answers `isCatalog: true` with no rows);
 * the mock follows Pallav's rules: a category has no price, an item has one, both-businesses mirroring by name.
 */
export interface CatalogItem { id: string; name: string; pricePaise: number; shared: boolean }
export interface CatalogCategory { id: string; name: string; shared: boolean; items: CatalogItem[] }
export interface ExpenseCatalog { setKey: string; business: MasterBusiness; scope: MasterScope; categories: CatalogCategory[] }

/** Plan rates (GET/POST plan-rates, DELETE plan-rates/{id}). */
export interface PlanChoice { value: string; label: string }
export interface PlanRate { id: string; plan: string; effectiveFrom: string; ratePaise: number; note: string; createdByName: string; createdAt: string }
export interface PlanRatesPanel {
  /** The active plans of the Plan list, in its order. */
  plans: PlanChoice[];
  /** Every rate, newest date first, grouped by plan in lower case ("cp"). */
  rates: Record<string, PlanRate[]>;
  /** Today (IST), YYYY-MM-DD. */
  today: string;
  /** What the hotel owes Sunrise Foods for plan meals on bills dated this month. */
  owedThisMonthPaise: number;
}
export interface PlanRateInput { plan: string; ratePaise: number; effectiveFrom: string; note: string }

/** Settings (GET settings?tab, PATCH settings/{group}). SuperAdmin only. */
export type SettingFieldType = 'text' | 'email' | 'number' | 'password' | 'select' | 'toggle' | 'textarea';
export interface SettingField {
  key: string;
  label: string;
  type: SettingFieldType;
  secret: boolean;
  options: Record<string, string> | null;
  help: string | null;
  placeholder: string | null;
  /** The saved value, or the field's default; "1"/"0" for a toggle; null for a secret. */
  value: string | null;
  /** A secret is never returned: only whether one is saved. */
  set: boolean;
  /** When a saved secret was last written (ISO time): the form shows Saved on <date>. Never any part of the secret itself. null = none saved, or not a secret. */
  savedAt?: string | null;
  /** Optional (the server does not send them yet): a unit shown after a number box ("%"), its range and step, a text limit, textarea rows. */
  suffix?: string | null;
  min?: number | null;
  max?: number | null;
  step?: number | null;
  maxLength?: number | null;
  rows?: number | null;
}
/**
 * Settings > Email besides its fields (MAIL-PROVIDERS-50K, 18 Oct 2026): who sends the hotel's mail (the platform's mail, or the hotel's own service), the service in use, its limits and where
 * the mail goes out from. The fields of the form are the generic settings fields of the group `email` (see `mode`, `provider` and mailProviders.ts for what to show for each service).
 */
export interface EmailStatus {
  /** The last "Send test email": when, whether it worked and the exact result, with plain help for the usual failures of the chosen service. null = never tested. */
  lastTest: { at: string; ok: boolean; message: string; hint?: string } | null;
  /** false only when the server has no key at all (no HMS_HASH_KEY): a password cannot be saved. */
  canStorePassword: boolean;
  /** A password is saved but cannot be opened (the key it was sealed with is not the one in use): type it again and save. */
  passwordUnreadable: boolean;
  /**
   * The status line: where THIS hotel's mail goes out from now. settings = the hotel's own service saved in Settings > Email (address = the address mail comes from, provider = the service);
   * platform = through the platform's mail: with the provider 'domain' from the hotel's own address (once verified), otherwise from the platform address made from the hotel's slug (null until the
   * platform has a sending domain). Once a hotel has its own service the server's own settings are never used for its mail.
   */
  sendingFrom: { source: 'settings' | 'platform'; address: string | null; provider: MailProviderId | null };
  /** Always null now: an older server shows as its own provider. */
  otherServer: string | null;
  /** The last mail of this hotel that failed, in plain words (never the address); null = the last mail went, or none yet. */
  lastFailure: { at: string; text: string } | null;
  /**
   * MAIL-PROVIDERS-50K (18 Oct 2026): the mail service this hotel saved (email.provider: gmail, brevo, ses, smtp or domain); null = none saved (the platform email sends). The form's other fields:
   * email.username (login), email.password (secret), email.host / email.port / email.encryption (tls | ssl | none) for smtp only, email.region for ses, email.from_address for every
   * provider but gmail, email.from_name, email.reply_to, email.daily_limit. See mailProviders.ts for what to show per provider. otherServer is always null now (an older server shows as its provider).
   */
  /**
   * Who sends this hotel's mail (email.mode, MJ 18 Oct 2026): 'platform' = the platform's mail (the default; nothing to set up: the mail goes from an address made from the hotel's slug on the
   * platform's sending domain, with the hotel's name as the sender name and its address as the reply-to) or 'own' = the hotel's own service (email.provider and its login). A hotel with its own service
   * saved before the choice existed is 'own'; one with nothing saved is 'platform'.
   */
  mode: 'platform' | 'own';
  /** With mode 'platform': the address the mail is sent from (<slug>@<sending domain>); null until the Super Admin has set the sending domain. */
  platformAddress: string | null;
  /** With the provider 'domain' (My own domain): the domain, its DNS records, their last check and where it stands; null otherwise. */
  identity: MailSenderIdentity | null;
  provider: MailProviderId | null;
  server: MailServerInfo | null;
  /** What the service allows now, after the hotel's own daily limit and the Super Admin's cap; null = no service saved. */
  limits: MailLimitsInfo | null;
  /**
   * The last "Test connection" (decision 66): reading (IMAP) and sending (SMTP) of the SAVED mailbox, each a code and a fixed sentence with plain help, and the time. Never the
   * server's own words, the login or the password. null = never tested; missing on an older server.
   */
  lastConnectionTest?: MailConnectionTest | null;
}
export interface SettingGroupInfo { key: string; label: string; icon: string; about: string }
export interface SettingGroup extends SettingGroupInfo { fields: SettingField[]; /** Only the Email group. */ emailStatus?: EmailStatus }
export interface SettingsOverview { groups: SettingGroupInfo[]; current: SettingGroup }
/** The Settings home as a map (H12): one row per area, with its state and the page where it is set. */
export interface SettingsMapItem {
  id: string;
  label: string;
  help: string;
  icon: string;
  state: 'done' | 'partial' | 'todo';
  /** What is there now ("23 rooms", the from address), or null. */
  detail: string | null;
  view: string;
  params?: Record<string, string>;
}
export interface SettingsMap { items: SettingsMapItem[]; done: number; total: number }
/** PATCH body: a toggle is a boolean, a secret left empty keeps what is saved. */
export type SettingsValues = Record<string, string | boolean>;

/** Backup tab, below the form (Pallav settings/_backup). The server has no route for it yet; the mock shows the screen. */
export interface BackupStatus { connected: boolean; redirectUri: string; lastAt: string | null; lastResult: string | null }

/** Recycle bin (GET admin/recycle, POST admin/recycle/{key}/{id}/restore, DELETE admin/recycle/{key}/{id}); SuperAdmin only. */
export interface RecycleItem {
  /** The kind's key ("bill", "hotel-deposit"). */
  key: string;
  id: string;
  /** The type, as Pallav names it ("Bill"). */
  kind: string;
  /** The record ("2026 / 1188"). */
  label: string;
  detail: string;
  deletedBy: string;
  deletedAt: string;
  daysLeft: number;
}
export interface RecycleResult { key: string; id: string; message: string }

/** Razorpay payments received by webhook, both businesses (Pallav RazorpayPaymentController). SuperAdmin only; the server has no route yet. */
export type RazorpayStatus = 'captured' | 'authorized' | 'failed' | 'refunded' | 'created';
export const razorpayStatusLabel: Record<RazorpayStatus, string> = { captured: 'Paid', authorized: 'Authorised', failed: 'Failed', refunded: 'Refunded', created: 'Started' };
export type RazorpayBusiness = 'hotel' | 'food';
export const razorpayBusinessName: Record<RazorpayBusiness, string> = { hotel: 'Your hotel', food: 'Your restaurant' };

export interface RazorpayPayment {
  id: string;
  paymentId: string;
  orderId: string | null;
  description: string | null;
  business: RazorpayBusiness;
  method: string | null;
  email: string | null;
  contact: string | null;
  status: RazorpayStatus;
  errorDescription: string | null;
  amountPaise: number;
  /** null: Razorpay has not reported a fee. */
  feePaise: number | null;
  taxPaise: number;
  amountRefundedPaise: number;
  lastEvent: string;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
  notes: Record<string, string>;
  payload: Record<string, unknown>;
}
export interface RazorpayHook { key: RazorpayBusiness; name: string; url: string; ready: boolean; last: string | null }
export interface RazorpayStats { todayPaise: number; monthPaise: number; failed: number; refundedPaise: number; rejected: number }
/** `attention`: failed payments and ones the bank approved but HMS has not captured. */
export interface RazorpayQuery { business?: RazorpayBusiness | 'all'; status?: RazorpayStatus | 'attention' | 'all'; method?: string; search?: string; page?: number; pageSize?: number }
/** Refund all or part of a paid payment; `instant` asks Razorpay for an instant refund (an extra fee applies). */
export interface RazorpayRefundInput { amountPaise: number; reason: string; note: string; instant: boolean }
export interface RazorpayRefundItem { id: string; paymentId: string; amountPaise: number; status: string; speed: string; reason: string | null; by: string | null; note: string | null; createdAt: string; payer?: string | null }
export interface RazorpayRefundResult { refund: RazorpayRefundItem; payment: RazorpayPayment; message: string }
export interface RazorpayCheckResult { payment: RazorpayPayment; message: string }
export interface RazorpayLinkInput { business: RazorpayBusiness; amountPaise: number; description: string; name: string; contact?: string; email?: string; validDays: 1 | 3 | 7 | 30; sms: boolean; mail: boolean; companyId?: string; customerId?: string; billRef?: string }
export type RazorpayLinkStatus = 'created' | 'paid' | 'partially_paid' | 'expired' | 'cancelled';
export interface RazorpayLinkItem { id: string; url: string; status: RazorpayLinkStatus; amountPaise: number; description: string; name: string | null; contact: string | null; email: string | null; business: RazorpayBusiness | null; createdAt: string; expiresAt: string | null; paidAt: string | null }
export interface RazorpaySettlementItem { id: string; amountPaise: number; feePaise: number; taxPaise: number; status: string; utr: string | null; createdAt: string }
export interface RazorpayOutcome { message: string }
/** Real server only: which business has its Razorpay keys saved and is switched on (the mock leaves it out). */
export interface RazorpaySetup { business: RazorpayBusiness; name: string; keyIdSet: boolean; keySecretSet: boolean; webhookSecretSet: boolean; ready: boolean }
export interface RazorpayOverview { page: Page<RazorpayPayment>; stats: RazorpayStats; hooks: RazorpayHook[]; counts: Record<RazorpayBusiness, number>; setup?: RazorpaySetup[] }

export type HealthState = 'ok' | 'warn' | 'down';
export const healthTone: Record<HealthState, Tone> = { ok: 'success', warn: 'warning', down: 'danger' };
export const healthLabel: Record<HealthState, string> = { ok: 'Working', warn: 'Needs a look', down: 'Not working' };

export interface HealthCheck { id: string; name: string; state: HealthState; detail: string; checkedAt: string }

export type ErrorState = 'open' | 'resolved';

export interface SystemErrorItem {
  id: string;
  message: string;
  where: string;
  count: number;
  firstAt: string;
  lastAt: string;
  state: ErrorState;
  resolvedBy: string | null;
}

export type LogLevel = 'info' | 'warn' | 'error';
export const logLevelTone: Record<LogLevel, Tone> = { info: 'info', warn: 'warning', error: 'danger' };

export interface SystemLogEntry { id: string; at: string; level: LogLevel; source: string; message: string }

export interface SystemOverview {
  checks: HealthCheck[];
  openErrors: number;
  logToday: number;
  uptimeLabel: string;
  version: string;
}

export interface AdminProfile {
  name: string;
  username: string;
  email: string;
  mobile: string;
  roleName: string;
  hotelName: string;
  /** The person asks for an emailed 6-digit code at sign-in (decision 46: off by default for everyone, the person's own choice; the server calls it `codeRequired`). */
  emailedCode: boolean;
  /** Pallav: the password was set by an administrator and must be replaced. Optional. */
  mustChangePassword?: boolean;
  /** Only administrators may rename their own username (Pallav). */
  canEditUsername: boolean;
  passwordChangedAt: string;
  /** The person's own photo (platform 0131): an address to show it (`<img src>`, signed-in only; it changes with every new photo), or null. Optional until every server has it. */
  photoUrl?: string | null;
}

/**
 * My profile photo, for EVERY login (guest, company, staff; platform migration 0131). Own photo only:
 * GET profilePhotoPath = the picture (404 when none); PUT { fileName, dataBase64 } adds or replaces it (JPG, PNG or WebP up to 10 MB; kept as WebP of at most 1 MB,
 * 1024 px at most); DELETE removes it. PUT and DELETE answer ProfilePhotoState. Errors: 422 on field `photo` (not a picture, too big, wrong type); 503 with a sentence when
 * this server has no photo store or the database update is missing; 429 after 20 changes in an hour.
 */
export const profilePhotoPath = '/api/v1/profile/photo';
export const PROFILE_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export interface ProfilePhotoState {
  hasPhoto: boolean;
  /** Same as AdminProfile.photoUrl. */
  photoUrl: string | null;
}

/**
 * Pallav ProfileController::update: name, email (valid, unique, it carries the codes) and phone are all required;
 * `username` only for administrators (3-50, letters, digits, dot, underscore, unique, lower-cased).
 */
export interface AdminProfileInput { name: string; email: string; mobile: string; username?: string }

/** Recent account changes (UserAuditLog, last 10, no sign-in rows). */
export interface AccountChange { id: string; at: string; summary: string }

/** Live devices (read only: no revoke, as Pallav). */
export interface LiveDevice { id: string; device: string; ip: string; place: string; lastActiveAt: string; current: boolean }

export interface SignInQuery extends ListQuery { ip?: string }

export interface SignInList {
  page: Page<SignInRecord>;
  totals: { all: number; success: number; failed: number };
  places: { place: string; count: number }[];
}

export interface PasswordChangeInput { current: string; next: string; confirm: string }

export interface SignInRecord {
  id: string;
  at: string;
  device: string;
  ip: string;
  place: string;
  result: 'success' | 'failed';
  /** The session has ended; only ended records can be deleted (not the running one). */
  ended: boolean;
  /** Optional: when it ended, and the raw browser string (Pallav's detail panel). */
  endedAt?: string;
  userAgent?: string;
  /** Mock only: the username of an attempt no account owns ('(unknown)', common.ts recordMockSignInAttempt); absent on the account's own rows. */
  username?: string;
}

// ---------------------------------------------------------------- helpers

export type FieldErrors = Record<string, string>;

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateUser(i: AdminUserInput): FieldErrors {
  const e: FieldErrors = {};
  if (i.name.trim().length < 2) e.name = 'Enter the full name.';
  if (!/^[A-Za-z0-9._]{3,50}$/.test(i.username.trim())) e.username = 'Use 3 to 50 letters, numbers, dots or underscores.';
  if (i.email.trim() && !EMAIL.test(i.email.trim())) e.email = 'Enter a valid email, or leave it empty.';
  if (i.mobile.trim() && !/^[6-9]\d{9}$/.test(i.mobile.replace(/\D/g, '').slice(-10))) e.mobile = 'Enter a 10-digit mobile number.';
  if (!i.roleId) e.roleId = 'Choose a role.';
  return e;
}

export function validateRole(i: AdminRoleInput): FieldErrors {
  const e: FieldErrors = {};
  if (i.name.trim().length < 2) e.name = 'Enter a role name.';
  return e;
}

/** Name of the level a user really has for a module: their override, else the role's. */
export function effectiveLevel(role: AdminRole | undefined, overrides: PermissionOverride[], module: string): PermissionLevel {
  return overrides.find((o) => o.module === module)?.level ?? role?.levels[module] ?? 'none';
}

export function maskPassword(v: string): string {
  return v.length <= 4 ? '••••••••' : `••••••••${v.slice(-2)}`;
}

export { newPasswordChecks };

// ---------------------------------------------------------------- copy

export const adminCopy = {
  common: {
    save: 'Save', saveChanges: 'Save changes', cancel: 'Cancel', edit: 'Edit', delete: 'Delete', add: 'Add', close: 'Close',
    activate: 'Activate', deactivate: 'Deactivate', saved: 'Saved.', deleted: 'Deleted.', none: '—', never: 'Never',
    comesWithBackend: 'Comes with the backend', adminOnly: { title: 'Admins only', body: 'Ask your hotel admin for access to this screen.' },
    search: 'Search', all: 'All',
  },
  users: {
    title: 'Users', subtitle: 'Everyone who can sign in to this hotel, and what they can do.',
    add: 'Add user', search: 'Search name, username, email, mobile',
    tabs: { all: 'All', active: 'Active', inactive: 'Inactive', locked: 'Locked' },
    emptyTitle: 'No users yet', emptyBody: 'Add the first user to give them access.',
    noMatchTitle: 'Nobody matches that search', noMatchBody: 'Try a different name or clear the search.',
    cols: { name: 'Name', username: 'Username', role: 'Role', status: 'Status', lastLogin: 'Last sign-in' },
    addTitle: 'Add a user', editTitle: (n: string) => `Edit ${n}`,
    inviteNote: 'An invite email will be sent so they can set their own password.',
    f: { name: 'Full name', username: 'Username', email: 'Email (optional)', mobile: 'Phone (optional)', role: 'Role', overrides: 'Extra permissions', overridesHint: 'Only change a module if this person needs more or less than their role gives.' },
    useRole: 'Same as role',
    created: 'User added. An invite email has been sent.', updated: 'User updated.',
    activated: 'User activated.', deactivated: 'User deactivated. They can no longer sign in.',
    unlock: 'Unlock account', unlocked: 'Account unlocked. They can try signing in again.',
    emailedCode: 'Emailed sign-in code', emailedCodeOnToast: 'Emailed sign-in code turned on.', emailedCodeOffToast: 'Emailed sign-in code turned off.',
    emailPassword: 'Email a new password', emailPasswordTitle: 'Email a new password?', emailPasswordBody: 'A temporary password is sent to their email. They must change it when they sign in.', passwordEmailed: (to: string) => `A new password was emailed to ${to}.`,
    deactivateTitle: (n: string) => `Deactivate ${n}?`, deactivateBody: 'They are signed out and cannot sign in until you activate them again.',
    deleteTitle: (n: string) => `Delete ${n}?`, deleteBody: 'The account is removed. Their past entries stay on record.',
    emailedOn: 'Emailed sign-in code: On', emailedOff: 'Emailed sign-in code: Off', lastSignIn: 'Last sign-in', member: 'Member since',
    selfBlock: 'You cannot deactivate or delete your own account.',
  },
  roles: {
    title: 'Roles', subtitle: 'What each role can do in every part of the hotel system.',
    add: 'Add role', builtIn: 'Built in', custom: 'Custom', usersCount: (n: number) => (n === 1 ? '1 user' : `${n} users`),
    addTitle: 'Add a role', editTitle: (n: string) => `Edit ${n}`,
    startFrom: 'Start from', startFromHint: 'A usual hotel job, with its modules ticked; change anything after.', blank: 'Blank',
    f: { name: 'Role name', description: 'What this role is for' },
    grid: 'Permissions', gridHint: 'Pick the highest thing this role may do in each module. Higher levels include the lower ones.',
    moduleCol: 'Module', created: 'Role added.', updated: 'Role saved.',
    deleteTitle: (n: string) => `Delete ${n}?`, deleteBody: 'The role is removed.',
    cannotDelete: 'Built-in roles and roles with users cannot be deleted.',
    /** Shown for every refused save of a built-in role (form, tick, move); the server's own sentence is never shown raw. */
    builtInLocked: 'Built-in roles cannot be changed. Create a new role instead.',
    viewOnly: 'Built-in role: view only',
    levelHelp: { none: 'Cannot open this part.', view: 'Can look but not change.', create: 'Can look and add new entries.', edit: 'Can look, add and change.', full: 'Can do everything, including delete.' } as Record<PermissionLevel, string>,
  },
  masters: {
    title: 'Lists and rates',
    search: { planRates: 'Search plans…', catalog: 'Search categories or items…', names: 'Search names…', options: 'Search options…' },
    clearSearch: 'Clear search',
    addName: 'Add name', addOption: 'Add option', saveChanges: 'Save changes',
    scope: {
      working: 'Working on', change: 'Change business',
      both: 'Showing what Your hotel and Your restaurant both have. Anything added here is added to both.',
      one: (business: string) => `Showing ${business} only. Anything added here is added to it alone.`,
      eyebrow: (business: string) => `For ${business}`,
    },
    rail: { title: 'Lists and rates', lists: 'Lists', perBusiness: 'For each business', rates: 'Rates', planRates: 'Plan rates', planRatesHint: 'Meals per person per night', inUse: (n: number) => `${n} in use` },
    noMatch: { title: (q: string) => `Nothing matches "${q}"`, text: 'Try a different word, or clear the search to see everything.' },
    note: { fallback: 'Used on forms across the app', shownAs: 'Shown as', hiding: 'Hiding an option keeps it on records that already use it.' },
    cols: { order: 'Order', name: 'Name', option: 'Option', value: 'Saved value', status: 'Status', action: 'Action' },
    tips: { up: 'Move up', down: 'Move down', open: 'Open', hide: 'Hide from forms', show: 'Show on forms', delete: 'Delete' },
    pills: { isDefault: 'default', both: 'Both', bothTitle: 'Your hotel and Your restaurant both have this name', onForms: 'On forms', hidden: 'Hidden' },
    remove: {
      title: (label: string) => `Remove ${label}?`, label: 'Remove',
      both: 'It leaves both businesses. Records that already use it keep it.', one: 'It leaves this list. Records that already use it keep it.',
    },
    empty: {
      bothTitle: 'Nothing both businesses have yet', oneTitle: 'Nothing in this list yet',
      both: 'Add a name here and it is added to Your hotel and Your restaurant. Names only one of them has show under that business.',
      names: 'Add the first name and it appears on the form.',
      options: (list: string) => `Add the first option and it appears on every form that uses ${list}.`,
    },
    foot: { key: 'Forms ask for this list by the key', deleteList: 'Delete list', removeListTitle: (name: string) => `Remove the whole ${name} list?`, removeListBody: 'Every option in it goes too.', removeListLabel: 'Remove list' },
    form: {
      addTo: (name: string) => `Add to ${name}`, addNameTo: (name: string) => `Add a name to ${name}`,
      name: 'Name', option: 'Option', optionHint: 'What people see in the dropdown.',
      value: 'Saved value', optional: 'optional', valuePlaceholder: 'Same as the option', valueHint: 'Leave blank unless older records store a different spelling.',
      offer: 'Offer this on forms', preselect: 'Pre-select it on new entries',
    },
    catalog: {
      addCategory: 'Add category', addItem: 'Add item', renameCategory: 'Rename category', renameTip: (n: string) => `Rename ${n}`, removeCategoryTip: 'Remove category', removeItemTip: 'Remove item',
      items: (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`,
      bothCategory: 'Your hotel and Your restaurant both have this category', bothItem: 'Your hotel and Your restaurant both have this item',
      itemCol: 'Item', priceCol: 'Price',
      emptyBoth: 'No items both businesses have yet. A category has no price of its own: add an item to give it one, and it is added to both.',
      emptyOne: 'No items yet. A category has no price of its own: add an item to give it one.',
      noneTitle: 'No categories yet', noneText: 'Add a category such as Kitchen or Housekeeping, then the items you buy under it with their prices. They appear on the Expense form for this business.',
      removeCategoryBoth: 'The category and every item in it are removed from both businesses. Expenses already recorded keep what they were saved with.',
      removeCategoryOne: 'The category and every item in it are removed. Expenses already recorded keep what they were saved with.',
      removeItemBoth: 'It leaves this category in both businesses. Expenses already recorded keep it.', removeItemOne: 'It leaves this category. Expenses already recorded keep it.',
      categoryName: 'Category name', categoryPlaceholder: 'e.g. Kitchen', addCategoryBtn: 'Add category',
      itemName: 'Item name', itemPlaceholder: 'e.g. Basmati rice (1 kg)', priceLabel: 'Price for one', priceHint: 'The listed price. When the cost differs, the expense line can be switched to Custom amount.',
      editItem: 'Edit item', addItemBtn: 'Add item', categoryFallback: 'Category',
      // Pallav's aria-labels on the row buttons (masters/_catalog)
      removeAria: (name: string) => `Remove ${name}`, editAria: (name: string) => `Edit ${name}`,
    },
    plan: {
      title: 'Plan Rates', newRate: 'New rate', newRateFor: (plan: string) => `New rate for ${plan}`,
      intro: "What Your restaurant charges the hotel for each plan's meals, per person per night. A bill works out what it owes from these. A new price starts on its date and never changes an older bill.",
      priced: (of: number) => `of ${of} plans priced today`, owed: 'Owed to Your restaurant this month',
      plans: 'Plans', openOne: 'Open one for its price history', planWord: 'Plan',
      inForceSince: 'In force since', noRateYet: 'No rate yet', nextChange: 'Next change', nonePlanned: 'None planned', history: 'History',
      rates: (n: number) => `${n} ${n === 1 ? 'rate' : 'rates'}`, perNight: 'Per person, per night', setRate: 'Set a rate',
      noRateText: (plan: string) => `No rate yet. Until one is set, stays on ${plan} owe Your restaurant nothing.`,
      from: (d: string) => `From ${d}`, inForce: 'In force', startsLater: 'Starts later', earlier: 'Earlier',
      footNote: 'A new price starts on its date; nights before it keep the old one.',
      removeTitle: 'Remove this rate?', removeBody: 'Bills already made keep the amount they were saved with.',
      noPlansTitle: 'No plans yet', noPlansText: 'Add the plans (EP, CP, MAP, AP) to the Plan list in Master Data first.', goMasters: 'Go to lists and rates',
      eyebrow: 'Plan Rates · New', modalTitle: 'New plan rate', save: 'Save rate',
      theRate: 'The rate', theRateHint: "What Your restaurant charges the hotel for one person's meals on this plan, for one night. Saving a rate for a date that already has one replaces it.",
      plan: 'Plan', rate: 'Rate per person, per night', startsOn: 'Starts on', startsOnHint: 'Nights before this keep the earlier rate.', note: 'Note', notePlaceholder: 'e.g. New breakfast menu', optional: 'optional',
    },
  },
  settings: {
    title: 'Settings',
    sub: 'The hotel details, bill header, email, online payments, backups and the rest of the set-up. Passwords and keys are stored encrypted and never shown in full.',
    foot: 'Changes apply straight away. Every save is written to the System Log.',
    save: (group: string) => `Save ${group}`,
    secret: { saved: 'Saved. Leave empty to keep it, or type a new one to replace it.', empty: 'Stored encrypted once saved.', placeholder: 'Not set' },
    email: {
      test: 'Send a test email',
      testHelp: 'Sends one email through the mail service you saved, so you know the login works. Save first.',
      sent: (to: string) => `Test email sent to ${to}. Check that inbox.`,
      failed: (message: string) => `The test email did not go: ${message}`,
      lastTest: (when: string) => `Last test: ${when}`,
      neverTested: 'Not tested yet. Save your changes, then press Send test email.',
      sendingFrom: {
        settings: (address: string) => `Sending from: this system's settings (${address})`,
        platform: 'Sending from: the platform\'s mail (the hotel\'s name is shown as the sender name)',
      },
      otherServer: (host: string) => `An older mail server (${host}) is still saved for this hotel and keeps sending.`,
      keyMissing: 'This server has no secret key, so a password cannot be saved here.',
      passwordUnreadable: 'The saved password cannot be opened on this server. Type the password again and save.',
      lastFailure: (when: string, text: string) => `Last mail failed (${when}): ${text}`,
      notSet: 'Choose your own mail service, enter its login and password under Email, save, then try again.',
      howTo: {
        title: 'How to set up your own mail service',
        steps: [
          'Choose the mail service in the list. The steps for that service are shown under it.',
          'Paste its login and password (or key), and the From address if it asks for one.',
          'Save, then press Send test email.',
        ],
      },
    },
    onlySuper: 'Only the SuperAdmin can open Settings.',
    map: {
      title: 'Set-up map',
      sub: 'Everything a hotel sets up, in one place. Each row opens the page where it is done.',
      progress: (done: number, total: number) => `${done} of ${total} set`,
      allSet: 'Everything is set.',
      state: { done: 'Set', partial: 'Partly set', todo: 'Not set' } as Record<'done' | 'partial' | 'todo', string>,
      open: 'Open',
      hide: 'Hide map',
      show: 'Show set-up map',
      count: (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`,
      /** The Email row's detail: the From address (when there is one) and whether the daily summary goes out, e.g. "desk@x.in, daily summary on" or "No daily summary". */
      emailDetail: (from: string, summary: boolean) => {
        const s = summary ? 'daily summary on' : 'no daily summary';
        return from.trim() ? `${from.trim()}, ${s}` : `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
      },
      websiteLive: (domains: number) => (domains ? `Live on ${domains} ${domains === 1 ? 'domain' : 'domains'}` : 'Live'),
      websiteOff: 'Not live yet',
      paymentsOn: 'Razorpay switched on',
      items: {
        profile: { label: 'Hotel profile', help: 'Name, address and phone on bills.', icon: 'building' },
        billing: { label: 'Bill header and GST', help: 'The GSTINs printed on bills.', icon: 'receipt' },
        email: { label: 'Email', help: 'The mail server guests and the owner are written from.', icon: 'envelope-at' },
        rooms: { label: 'Rooms', help: 'Every room with its type, ready for check-in.', icon: 'door-open' },
        rates: { label: 'Plan rates', help: 'Per person per night, in Master Data.', icon: 'tags' },
        staff: { label: 'Staff accounts', help: 'The people who work here and what each may open.', icon: 'people' },
        website: { label: 'Website', help: 'The hotel website and its booking enquiries.', icon: 'globe2' },
        payments: { label: 'Online payments', help: 'Razorpay for the hotel and the restaurant.', icon: 'credit-card' },
      },
    },
    drive: {
      title: 'Google Drive',
      connected: 'Connected. Backups are saved in a folder called "Your hotel Backups" in your Drive.',
      notConnected: 'Not connected. In Google Cloud Console create an OAuth client ID (Web application), add this as its authorised redirect address, save the client ID and secret above, then connect:',
      connect: 'Connect with Google', disconnect: 'Disconnect',
      disconnectTitle: 'Disconnect Google Drive?', disconnectBody: 'Nightly backups will stop going to Drive.',
      connectedToast: 'Google Drive connected.', disconnectedToast: 'Google Drive disconnected.',
    },
    status: {
      title: 'Backup status', last: (when: string, result: string) => `Last backup ${when}: ${result}`, none: 'No backup has run yet.',
      test: 'Test connection', run: 'Back up now',
    },
    recycle: {
      keep: (days: number) => `Deleted records are kept for ${days} days, then removed for good. Restore puts one back exactly as it was. Change the number of days above.`,
      empty: 'The recycle bin is empty.', restore: 'Restore', deleteForever: 'Delete for good',
      left: (n: number) => `${n} day${n === 1 ? '' : 's'} left`, deleted: 'Deleted', by: 'by',
      confirmTitle: 'Remove this for good?', confirmBody: 'It cannot be restored afterwards.', confirmLabel: 'Remove',
    },
  },
  payments: {
    title: 'Razorpay',
    sub: 'Payments Razorpay reports to us by webhook, for both businesses.',
    search: 'Search payments…', searchLabel: 'Search payments', clearSearch: 'Clear search', keys: 'Keys',
    kpi: { today: 'Received today', month: 'This month', failed: 'Failed, 30 days', rejected: 'Refused webhooks', bothBusinesses: 'Both businesses', refunded: (amount: string) => `${amount} refunded`, badSignature: 'Bad signature, 7 days' },
    hooks: {
      title: 'Webhook addresses', about: 'In each Razorpay dashboard: Settings, Webhooks, add this URL, tick the payment and refund events, and use the same secret you saved under Keys.',
      ready: 'Secret set', missing: 'Secret missing', copy: 'Copy', copied: 'Copied', lastEvent: (when: string) => `Last event received ${when}`, nothing: 'Nothing received yet.',
    },
    filters: { both: 'Both businesses', anyStatus: 'Any status' },
    empty: { title: (q: string) => (q ? `No payment matches "${q}"` : 'No payments yet'), text: 'Once a webhook address above is added in Razorpay, each payment appears here as it happens.' },
    cols: { payment: 'Payment', business: 'Business', payer: 'Payer', status: 'Status', amount: 'Amount' },
    methodUnknown: 'Method unknown', none: 'None',
    detail: {
      order: 'Order', description: 'Description', fee: 'Fee + tax', notReported: 'Not reported', refunded: 'Refunded', lastEvent: 'Last event', raw: 'Raw details from Razorpay',
    },
  },
  system: {
    title: 'System Health', subtitle: 'Is everything working, and what went wrong.',
    tabs: { health: 'Health', errors: 'Errors', log: 'System log' },
    kpi: { errors: 'Open errors', log: 'Log entries today', uptime: 'Running for', version: 'Version' },
    recheck: 'Check again',
    checked: 'Checked', rechecked: 'Checks finished.',
    errorsEmpty: { title: 'No errors', body: 'Nothing has gone wrong.' },
    open: 'Open', resolved: 'Resolved', resolve: 'Mark resolved', reopen: 'Reopen', resolvedToast: 'Marked resolved.', reopenedToast: 'Reopened.',
    times: (n: number) => (n === 1 ? 'Happened once' : `Happened ${n} times`),
    first: 'First seen', last: 'Last seen', where: 'Where',
    logEmpty: { title: 'Log is empty', body: 'Nothing matches these filters.' }, level: 'Level', allLevels: 'All levels',
    logSearch: 'Search the log',
  },
  profile: {
    title: 'My profile', subtitle: 'Your details, password and sign-in history.',
    details: 'Your details', f: { name: 'Full name', mobile: 'Mobile', username: 'Username', email: 'Email', role: 'Role', hotel: 'Hotel' }, lockedNote: 'Username, email and role are changed by an admin.',
    saved: 'Profile saved.',
    password: 'Change password', f2: { current: 'Current password', next: 'New password', confirm: 'Confirm new password' }, changed: 'Password changed.', passwordChangedOn: (d: string) => `Last changed ${d}`,
    wrongCurrent: 'Your current password is incorrect.', sameAsCurrent: 'The new password must be different from the current one.', emailedCodeSent: (to: string) => `We sent a test code to ${to}. Enter it to turn the emailed code on.`, emailedCodeCancelled: 'Cancelled. The emailed code stays off.', signInDeleted: 'Sign-in record deleted.', signInSearch: 'Search by IP, place, browser or date', allIps: 'All IPs', changes: 'Recent account changes', changesEmpty: { title: 'No changes yet', body: 'Changes to your account are listed here.' }, devices: 'Signed-in devices', thisDevice: 'This device', lastActive: 'Last active', signInTotals: (all: number, ok: number, bad: number) => `${all} sign-ins · ${ok} succeeded · ${bad} failed`, mismatch: 'The two passwords do not match.',
    security: 'Emailed sign-in code', securityOn: 'On: a 6-digit code is emailed to you every time you sign in.', securityOff: 'Off: you sign in with your password only.', codeSwitch: 'Ask for an emailed code when I sign in', codeSwitchHint: 'Off: your password is enough. On: we also email you a 6-digit code.', codeOnToast: 'We will email you a code when you sign in.', codeOffToast: 'Your password alone signs you in now.', codeOffTitle: 'Turn off the emailed code?', codeOffText: 'Anyone with your password could then sign in. Enter your current password to confirm.', codeOffPassword: 'Current password', codeOffConfirm: 'Turn off', codeOffPasswordRequired: 'Enter your current password.', codeNeedsEmail: 'Add an email address first.',
    history: 'Sign-in history', historyEmpty: { title: 'No sign-ins yet', body: 'Your sign-ins are listed here.' }, success: 'Signed in', failed: 'Failed attempt',
  },
} as const;

let shownNames = { full: 'Your hotel', hotel: 'Your hotel', food: 'Your restaurant' };
/**
 * Real server: the admin copy and the business labels name the demo hotel ("Hotel Sunrise", "Sunrise Foods"). When the signed-in hotel's own names
 * are known (common.ts sessionHotelNames), they are written over those in place (like the new mock hotel does), so no screen shows the demo names.
 * Safe to call again with other names (the names last written are the ones replaced).
 */
export function applyHotelNamesToAdminCopy(names: { hotel: string; food: string }): void {
  const next = { full: names.hotel, hotel: names.hotel, food: names.food };
  if (!next.hotel || !next.food || (next.hotel === shownNames.hotel && next.food === shownNames.food)) return;
  const from = shownNames;
  const swap = (s: string): string => s.split(from.full).join(next.full).split(from.food).join(next.food).split(from.hotel).join(next.hotel);
  const walk = (o: Record<string, unknown>): void => {
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === 'string') o[k] = swap(v);
      else if (typeof v === 'function') {
        const fn = v as (...a: unknown[]) => unknown;
        o[k] = (...a: unknown[]) => { const r = fn(...a); return typeof r === 'string' ? swap(r) : r; };
      } else if (v && typeof v === 'object') walk(v as Record<string, unknown>);
    }
  };
  walk(adminCopy as unknown as Record<string, unknown>);
  walk(masterScopeLabel);
  walk(razorpayBusinessName);
  shownNames = next;
}

export type AdminApi = ReturnType<typeof createAdminApi>;
