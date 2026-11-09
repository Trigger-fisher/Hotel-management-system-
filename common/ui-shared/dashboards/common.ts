// Shared shapes for every dashboard mock API. Same rules as auth: calls never throw (R8).

/** Dashboard-wide error codes. */
export type DashErrorCode =
  | 'NOT_FOUND' | 'FORBIDDEN' | 'VALIDATION_FAILED' | 'CONFLICT' | 'NETWORK_OFFLINE' | 'SERVER_ERROR'
  /** 401: the session ended; the app goes to the sign-in screen. */
  | 'SESSION_EXPIRED'
  /** 429: too many requests; details.retryAfterSeconds says when to try again. */
  | 'RATE_LIMITED'
  /** Idempotency-Key replays: the same request is still running / the key was used for a different body. */
  | 'REQUEST_IN_PROGRESS' | 'IDEMPOTENCY_KEY_REUSED'
  /** 409 on a portal call: the account is in the hotel but not linked to a guest, company or staff record (decision 47). The screens show the friendly "not set up yet" page, never this text. */
  | 'PORTAL_NOT_LINKED'
  /** 409 on a portal call: the linked guest, company or staff record is switched off. */
  | 'PORTAL_INACTIVE';

export interface DashError {
  code: DashErrorCode;
  message: string;
  traceId: string;
  details?: {
    fields?: Record<string, string>;
    /** CONFLICT ("someone else changed this, please reload", MJ #14): the record's version now. */
    currentVersion?: number;
    /** The server's own code when it is finer than `code` (SESSION_EXPIRED, RATE_LIMITED, IDEMPOTENCY_KEY_REUSED ...). Set by the HTTP client only. */
    serverCode?: string;
    /** 429: seconds until the person may try again (the Retry-After header). */
    retryAfterSeconds?: number;
    /** Why, when the server names it (FORBIDDEN 'recheck_required': a vault asks the person to confirm it is them, then tries again). */
    reason?: string;
  };
}

/** Every dashboard call resolves to this and never throws. */
export type DashResult<T> = { ok: true; data: T } | { ok: false; error: DashError };

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ListQuery {
  search?: string;
  /** Filter tab id, e.g. "due", "paid". */
  tab?: string;
  /** ISO dates (inclusive). */
  from?: string;
  to?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

/**
 * PICKERS (company, staff, room, options): a small typeahead lookup, never the whole table.
 * Server: GET /api/v1/<module>/lookup?q=...&limit=50 (prefix search, limit capped at 50,
 * permission = the module's view level). Tiny fixed lists (shifts, payment modes, ID proof types)
 * come from the module's `options` call and are cached by the client.
 */
export interface LookupItem {
  id: string;
  label: string;
  hint?: string;
}

export interface LookupQuery {
  q?: string;
  /** Max 50. */
  limit?: number;
}

export const LOOKUP_LIMIT_MAX = 50;

/**
 * STATEMENTS (company ledger, payroll period reports): one call for a whole period, no paging.
 * The server works out the running balance; periods over 5,000 rows answer 422 "choose a shorter period".
 */
export interface StatementQuery {
  /** YYYY-MM-DD, inclusive. */
  from: string;
  to: string;
}

export interface Statement<Row> {
  openingBalancePaise: number;
  rows: Row[];
  closingBalancePaise: number;
  totals: { debitPaise: number; creditPaise: number };
}

export const STATEMENT_MAX_ROWS = 5000;

/**
 * Special abilities the server sends in the signed-in user's `abilities` (from the user's HOTEL role,
 * Pallav style). Screens use them only to show or hide controls; the server always re-checks.
 * NOTE: "hotel super admin" (Pallav's SuperAdmin inside a hotel) is NOT the platform role `super_admin`.
 */
export const ABILITY = {
  /** Set an entry's date and time by hand. */
  backdate: 'system.backdate',
  /** Force mode: correct closed entries and step past the accounting-year lock. */
  force: 'system.force',
  /** Recycle bins: list deleted records, restore, delete for ever. */
  recycleBin: 'system.recycle',
} as const;

export function hasAbility(user: { abilities?: readonly string[] }, ability: string): boolean {
  return (user.abilities ?? []).includes(ability);
}

/**
 * PDFs (MJ #22, "open in the PDF always"): every printable document is a real PDF made by the server (pdfkit,
 * one DocumentRenderer, from the same data as the on-screen preview). Same permission as the preview.
 * GET <path> → application/pdf (Content-Disposition inline, no-store); errors stay the normal JSON error body.
 * Web: open the URL in a new tab. Mobile: download with the session token and open the system viewer / share sheet.
 */
export const PDF_ROUTES = {
  bill: (id: string) => `/api/v1/billing/bills/${id}/pdf`,
  advance: (id: string) => `/api/v1/billing/advances/${id}/pdf`,
  companyStatement: (companyId: string, q: { from: string; to: string }) =>
    `/api/v1/companies/${companyId}/statement/pdf?from=${q.from}&to=${q.to}`,
  salarySlip: (companyId: string, id: string) => `/api/v1/payroll/companies/${companyId}/slips/${id}/pdf`,
  paymentRegister: (companyId: string, period: string) => `/api/v1/payroll/companies/${companyId}/payments/pdf?period=${period}`,
  periodReport: (companyId: string, q: { from: string; to: string; employeeId?: string }) =>
    `/api/v1/payroll/companies/${companyId}/reports/period/pdf?from=${q.from}&to=${q.to}${q.employeeId ? `&employeeId=${q.employeeId}` : ''}`,
  monthlyReport: (companyId: string, period: string) => `/api/v1/payroll/companies/${companyId}/reports/monthly/pdf?period=${period}`,
  payrollAdvance: (companyId: string, id: string) => `/api/v1/payroll/companies/${companyId}/advances/${id}/pdf`,
  payrollBonus: (companyId: string, id: string) => `/api/v1/payroll/companies/${companyId}/bonuses/${id}/pdf`,
  separation: (companyId: string, id: string) => `/api/v1/payroll/companies/${companyId}/separations/${id}/pdf`,
  experienceLetter: (companyId: string, separationId: string) =>
    `/api/v1/payroll/companies/${companyId}/separations/${separationId}/experience-letter/pdf`,
  joiningLetter: (companyId: string, employeeId: string) => `/api/v1/payroll/companies/${companyId}/employees/${employeeId}/joining-letter/pdf`,
  staffRecordSheet: (companyId: string, employeeId: string) => `/api/v1/payroll/companies/${companyId}/employees/${employeeId}/pdf`,
  // Routes below are agreed but NOT built on the server yet (backend pending): the buttons may link to them.
  companyProfile: (id: string) => `/api/v1/companies/${id}/pdf`,
  customerProfile: (id: string) => `/api/v1/companies/customers/${id}/pdf`,
  ledgerSummary: () => `/api/v1/companies/ledger/pdf`,
  dailyReport: (date: string) => `/api/v1/reports/daily/pdf?date=${date}`,
  foodPlanReport: (month: string, plan?: string) => `/api/v1/reports/food-plan/pdf?month=${month}${plan ? `&plan=${plan}` : ''}`,
  payrollCompany: (id: string) => `/api/v1/payroll/companies/${id}/pdf`,
} as const;

/** Status pill tones used across all modules (map to tokens in each app). */
export type Tone = 'neutral' | 'graphite' | 'success' | 'warning' | 'danger' | 'info';

export interface Kpi {
  id: string;
  label: string;
  /** Money in paise when kind = 'money'; plain count otherwise. */
  value: number;
  kind: 'money' | 'count' | 'percent';
  /** Change vs previous period, e.g. +12.5 (%). null = no trend chip. */
  trend: number | null;
  tone: Tone;
  icon: string;
  /**
   * Footer line under the number so every tile has equal content, like Pallav
   * ("2 of 2 bills open", "Advance received", "Check-out 11:00"). Every KPI should set it.
   */
  hint?: string;
}

export const dashErrorText: Record<DashErrorCode, string> = {
  NOT_FOUND: "We couldn't find that. It may have been removed.",
  FORBIDDEN: "You don't have access to this. Ask your hotel admin.",
  VALIDATION_FAILED: 'Some details need fixing. Check the highlighted fields.',
  CONFLICT: 'Someone else changed this just now. Refresh and try again.',
  NETWORK_OFFLINE: "You're offline. Check your internet connection and try again.",
  SERVER_ERROR: 'Something went wrong on our side. Please try again in a moment.',
  SESSION_EXPIRED: 'Your session has ended. Please sign in again.',
  RATE_LIMITED: 'Too many requests. Please wait a moment and try again.',
  REQUEST_IN_PROGRESS: 'This is still being saved. Please wait a moment.',
  IDEMPOTENCY_KEY_REUSED: 'This request was already used for something else. Please try again.',
  PORTAL_NOT_LINKED: 'Your account is not set up yet. Please ask the hotel front desk to link it.',
  PORTAL_INACTIVE: 'Your profile is not active at the moment. Please ask the hotel front desk.',
};

/**
 * Default labels used inside the shared UI pieces (ErrorState, EmptyState, LoadingState, tables, dialogs).
 * Web and mobile import these; never type them inline in a component or screen.
 */
export const dashLabels = {
  /** One word for the error-card button on web AND mobile (hms-7e parity finding): "Retry". */
  tryAgain: 'Retry',
  retry: 'Retry',
  /** Conflict ("someone else changed this"): close the form and reload the latest data. */
  refresh: 'Refresh',
  loading: 'Loading…',
  loadMore: 'Load more',
  noResults: 'Nothing matches your search',
  clearSearch: 'Clear search',
  cancel: 'Cancel',
  confirm: 'Confirm',
  delete: 'Delete',
  save: 'Save',
  saving: 'Saving…',
  close: 'Close',
  back: 'Back',
  backToDashboard: 'Back to overview',
  comingSoonTitle: 'Coming soon',
  comingSoonBody: "We're still building this part. It will appear here soon.",
  offlineBanner: "You're offline. Check your internet connection and try again.",
  offlineTitle: "You're offline",
  loadFailedTitle: "Couldn't load this",
  /** The shell's own notes: a page whose code would not download, and a page that stopped with an error (the menu keeps working). */
  loadFailedBody: 'This page could not be downloaded. Check your connection and try again.',
  screenErrorTitle: 'This page ran into a problem',
  screenErrorBody: 'Something went wrong while showing this page. Try again, or open another page from the menu.',
  showing: 'Showing {from} to {to} of {total}',
  /** Scroll cue chip on wide tables. */
  moreColumns: 'More columns →',
  previousColumns: '← Previous columns',
  paid: 'paid',
  /** Typeahead picker (LookupSelect). */
  lookupSearching: 'Searching…',
  lookupNoMatches: 'No matches',
  lookupMore: `Showing the first ${LOOKUP_LIMIT_MAX}. Type to narrow down.`,
  lookupClear: 'Clear',
  lookupTypeToSearch: 'Type to search',
  /** One-call statement view (StatementView). */
  statementOpening: 'Opening balance',
  statementClosing: 'Closing balance',
  statementDebit: 'Debit',
  statementCredit: 'Credit',
  statementEmpty: 'No entries in this period',
  statementTooLong: 'There are too many entries in this period. Choose a shorter period.',
  statementFrom: 'From',
  statementTo: 'To',
  signOut: 'Sign out',
  lockScreen: 'Lock screen',
  /** The day / night button (Pallav's wording). */
  switchToNight: 'Switch to night mode',
  switchToDay: 'Switch to day mode',
} as const;

export interface MockClock {
  /** Simulated delay for every mock call. Default 500 ms. */
  latencyMs?: number;
  /** Return true to make every call fail with NETWORK_OFFLINE. */
  offline?: () => boolean;
}

declare function setTimeout(callback: () => void, ms?: number): unknown;

let trace = 0;

/** How long a mock answer takes when the module passes no `latencyMs` (500 ms shows the skeletons; the local demo build turns it down, see docs/UI.md). */
let defaultMockLatencyMs = 500;
export function setDefaultMockLatency(ms: number): void {
  defaultMockLatencyMs = ms;
}

/**
 * Mock only: the signed-in hotel is a brand-new one (mock hotel id NEW_MOCK_HOTEL_ID, "Hotel Pearl, Surat"): every module mock then starts with
 * EMPTY lists (no bills, advances, cash, reservations, rooms, staff ...) so each screen shows its empty state and the "Set up your hotel" checklist
 * fills it. The shell sets this before any screen group loads (mock stores are built once per page load, so a different hotel needs a reload:
 * the mock sign-out reloads the page). Never read in real mode.
 */
export const NEW_MOCK_HOTEL_ID = 'h-new';
/**
 * Mock rule for "a brand-new hotel": every id that starts with NEW_MOCK_HOTEL_ID, i.e. the demo's Hotel Pearl ('h-new') and each hotel the
 * Platform console onboarded ('h-new-<platform hotel id>', ui-shared/auth-pallav/platformAccounts.ts). The one place this rule lives.
 */
export function isNewMockHotel(hotelId?: string | null): boolean {
  return typeof hotelId === 'string' && hotelId.startsWith(NEW_MOCK_HOTEL_ID);
}
let emptyMockHotel = false;
export function setMockEmptyHotel(on: boolean): void {
  emptyMockHotel = on;
}
export function mockEmptyHotel(): boolean {
  return emptyMockHotel;
}

/**
 * Real server: the signed-in hotel's own business names (session user.hotel.name, and foodName when the server sends it). While set, the
 * screens print these instead of the mock demo names (Hotel Sunrise / Sunrise Foods). The shell sets it at sign-in and clears it at sign-out.
 */
let sessionHotel: { hotel: string; food: string } | null = null;
export function setSessionHotelNames(h: { name: string; foodName?: string | null } | null): void {
  sessionHotel = h && h.name ? { hotel: h.name, food: h.foodName?.trim() || `${h.name} Food` } : null;
}
export function sessionHotelNames(): { hotel: string; food: string } | null {
  return sessionHotel;
}

/**
 * Mock only: sign-in attempts the auth mock (ui-shared/auth-pallav/mock.ts) saw that no account owns, kept for this page load (module level;
 * the mock sign-out's reload clears it). The auth mock records an unknown username as UNKNOWN_SIGN_IN_USERNAME, never the typed text; the
 * admin mock's sign-in history (admin.ts listSignIns) merges these rows as failed attempts. Tiny on purpose: the sign-in chunk imports it.
 */
export interface MockSignInAttempt {
  username: string;
  ok: boolean;
  reason?: string;
  /** Epoch ms. */
  at: number;
}
export const UNKNOWN_SIGN_IN_USERNAME = '(unknown)';
const signInAttempts: MockSignInAttempt[] = [];
export function recordMockSignInAttempt(a: { username: string; ok: boolean; reason?: string; at?: number }): void {
  signInAttempts.push({ username: a.username, ok: a.ok, ...(a.reason ? { reason: a.reason } : {}), at: a.at ?? Date.now() });
}
/** Oldest first, as recorded (copies). */
export function mockSignInAttempts(): ReadonlyArray<Readonly<MockSignInAttempt>> {
  return signInAttempts.map((a) => ({ ...a }));
}

/** Helper for module mocks: delay, offline check, then the result. */
export async function mockCall<T>(fn: () => DashResult<T>, clock: MockClock = {}): Promise<DashResult<T>> {
  if (clock.offline?.()) return mockError('NETWORK_OFFLINE');
  await new Promise<void>((r) => setTimeout(() => r(), clock.latencyMs ?? defaultMockLatencyMs));
  return fn();
}

export function mockError(
  code: DashErrorCode,
  fields?: Record<string, string>,
  extra?: { currentVersion?: number; message?: string },
): { ok: false; error: DashError } {
  const { message, ...rest } = extra ?? {};
  const hasRest = Object.keys(rest).length > 0;
  const details = fields || hasRest ? { ...(fields ? { fields } : {}), ...rest } : undefined;
  return { ok: false, error: { code, message: message ?? code, traceId: `mock-d-${++trace}`, details } };
}

/**
 * The server's own sentence for a refusal (Pallav's wording, e.g. "Only Admin users can unlock attendance."),
 * or null when the error carries only its code (then show dashErrorText[code]).
 */
export function serverSentence(error: DashError): string | null {
  return error.message && error.message !== error.code ? error.message : null;
}

export function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

/** Simple client-side paging/search for mock lists. */
export function pageOf<T>(all: T[], q: ListQuery, match: (item: T, search: string) => boolean): Page<T> {
  const s = (q.search ?? '').trim().toLowerCase();
  const filtered = s ? all.filter((x) => match(x, s)) : all;
  const pageSize = q.pageSize ?? 20;
  const page = Math.max(1, q.page ?? 1);
  return { items: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize };
}
