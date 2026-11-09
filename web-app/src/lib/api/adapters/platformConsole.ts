// The Platform console's hotels, invitations, public onboarding, users, audit and sign-in history over the real server
// (docs/BACKEND.md section 14; contract ui-shared/dashboards/platform.ts). lib/api/adapters/platform.ts spreads this in.
// The server answers in the contract's own shapes ({ data } / { error }), so each method is a request plus the query/body keys of the table.
// Routes are "planned" until Backend pushes P2 (hotels), P3 (invitations, onboarding, approval) and P5 (users, audit, sign-ins): until then
// the server answers 404 and the screen shows its error. Shared helpers: ./platform/shared.
// The public onboarding calls (getInvitationByToken, submitOnboarding) need no session: keepSessionOn401 so a refused token never ends a
// signed-in tab's session, and details.serverCode (EXPIRED / ALREADY_SUBMITTED / CANCELLED / NOT_FOUND) is kept for the friendly pages.
import type { DashError, DashResult } from '@shared/dashboards/common';
import type {
  PlatformAuditQuery,
  PlatformHotelQuery,
  PlatformInvitationQuery,
  PlatformOnboardingForm,
  PlatformSignInQuery,
  PlatformUserQuery,
} from '@shared/dashboards/platform';

import { API_BASE, buildQuery, get, http, post, toDashError, type RawError } from '../client';
import { getEveryPage } from './payrollShared';
import { filterValue, platformPath, searchWord, seg, type PlatformApi } from './platform/shared';

type PlatformConsoleRealApi = Pick<
  PlatformApi,
  // hotels (+ the overview tiles)
  | 'getOverview' | 'listHotels' | 'getHotel' | 'suspendHotel' | 'reactivateHotel' | 'approveHotel' | 'rejectHotel' | 'archiveHotel' | 'restoreHotel'
  // invitations
  | 'listInvitations' | 'listDevLinks' | 'sendInvitation' | 'resendInvitation' | 'cancelInvitation'
  // public onboarding (no sign-in)
  | 'getInvitationByToken' | 'submitOnboarding'
  // users
  | 'listUsers' | 'disableUser' | 'enableUser' | 'unlockUser' | 'resetUserPassword'
  // activity, audit, sign-ins
  | 'listActivity' | 'listAudit' | 'listSignIns'
>;

type Query = Record<string, string | number | boolean | null | undefined>;

/* ------------------------------------------------------------------ the query strings of each list */

const hotelQuery = (q: PlatformHotelQuery): Query => ({
  search: searchWord(q.search),
  status: filterValue(q.status),
  kind: filterValue(q.kind),
  groupId: q.groupId || undefined,
  createdMonth: q.createdMonth || undefined,
});

const invitationQuery = (q: PlatformInvitationQuery): Query => ({
  search: searchWord(q.search),
  status: filterValue(q.status),
  type: filterValue(q.type),
  groupId: q.groupId || undefined,
});

const userQuery = (q: PlatformUserQuery): Query => ({
  search: searchWord(q.search),
  level: filterValue(q.level),
  status: filterValue(q.status),
  hotelId: q.hotelId || undefined,
  groupId: q.groupId || undefined,
});

/** The audit list and its CSV export share these filters (from / to are IST dates, YYYY-MM-DD). */
const auditFilters = (q: PlatformAuditQuery): Query => ({
  search: searchWord(q.search),
  from: q.from || undefined,
  to: q.to || undefined,
  action: filterValue(q.action),
  hotelId: q.hotelId || undefined,
  actor: q.actor || undefined,
});

const signInQuery = (q: PlatformSignInQuery): Query => ({ search: searchWord(q.search), result: filterValue(q.result) });

/* ------------------------------------------------------------------ the public onboarding calls */

/** A refused public call as the contract's DashError: the server's details.serverCode is kept (client.ts drops it when the code is the same). */
function publicError(e: RawError): DashError {
  const err = toDashError(e);
  const sc = (e.details as { serverCode?: unknown } | undefined)?.serverCode;
  if (typeof sc === 'string' && sc) return { ...err, details: { ...err.details, serverCode: sc } };
  return err;
}

async function publicCall<T>(method: 'GET' | 'POST', token: string, body?: unknown): Promise<DashResult<T>> {
  const r = await http<T>(method, `/onboarding/${seg(token)}`, { body, keepSessionOn401: true });
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: publicError(r.error) };
}

/* ------------------------------------------------------------------ audit CSV (real server only) */

/**
 * GET /platform/audit/export (Super Admin): the server's CSV of every row the filters match (50,000 at most; the export is itself audited).
 * client.ts expects JSON, so this is its own fetch. The mock builds its CSV in the screen from the filtered rows instead.
 */
export async function exportAuditCsvReal(q: PlatformAuditQuery = {}): Promise<DashResult<{ filename: string; csv: string }>> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, error: { code: 'NETWORK_OFFLINE', message: 'NETWORK_OFFLINE', traceId: 'no-trace' } };
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/platform/audit/export${buildQuery(auditFilters(q))}`, { method: 'GET', headers: { Accept: 'text/csv, application/json' }, credentials: 'same-origin', cache: 'no-store' });
  } catch {
    return { ok: false, error: { code: 'SERVER_ERROR', message: 'SERVER_ERROR', traceId: 'no-trace' } };
  }
  const traceId = res.headers.get('x-trace-id') ?? 'no-trace';
  if (res.ok) {
    const csv = await res.text();
    const named = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get('content-disposition') ?? '')?.[1];
    return { ok: true, data: { filename: named ? decodeURIComponent(named) : 'audit-log.csv', csv } };
  }
  type ErrorBody = { error?: { code?: unknown; message?: unknown; traceId?: unknown; details?: RawError['details'] } } | null;
  const json = await res.json().then(
    (x: unknown) => x as ErrorBody,
    () => null as ErrorBody, // not JSON
  );
  const e = json?.error;
  return {
    ok: false,
    error: toDashError({
      status: res.status,
      code: typeof e?.code === 'string' ? e.code : 'SERVER_ERROR',
      message: typeof e?.message === 'string' ? e.message : 'SERVER_ERROR',
      traceId: typeof e?.traceId === 'string' ? e.traceId : traceId,
      ...(e?.details ? { details: e.details } : {}),
    }),
  };
}

/* ------------------------------------------------------------------ the adapter */

export function createPlatformConsoleRealApi(): PlatformConsoleRealApi {
  return {
    // hotels
    getOverview: () => get(platformPath('overview')),
    // Lists: the screens may ask for one very large page and filter it themselves: getEveryPage joins pages of 100 (the server's largest).
    listHotels: (q = {}) => getEveryPage(platformPath('hotels'), hotelQuery(q), q.pageSize, q.page),
    getHotel: (id) => get(platformPath('hotels', id)),
    suspendHotel: (id, reason) => post(platformPath('hotels', id, 'suspend'), reason?.trim() ? { reason: reason.trim() } : {}),
    reactivateHotel: (id) => post(platformPath('hotels', id, 'reactivate')),
    approveHotel: (id) => post(platformPath('hotels', id, 'approve')),
    rejectHotel: (id, reason) => post(platformPath('hotels', id, 'reject'), { reason }),
    archiveHotel: (id, reason) => post(platformPath('hotels', id, 'archive'), reason?.trim() ? { reason: reason.trim() } : {}),
    restoreHotel: (id) => post(platformPath('hotels', id, 'restore')),

    // invitations (lists never carry the token; the link goes by email)
    listInvitations: (q = {}) => getEveryPage(platformPath('invitations'), invitationQuery(q), q.pageSize, q.page),
    listDevLinks: () => Promise.resolve({ ok: true as const, data: [] }),
    sendInvitation: (input) =>
      post(platformPath('invitations'), {
        ...(input.type ? { type: input.type } : {}),
        hotelName: input.hotelName,
        contactName: input.contactName,
        email: input.email,
        ...(input.groupId ? { groupId: input.groupId } : {}),
      }),
    resendInvitation: (id) => post(platformPath('invitations', id, 'resend')),
    cancelInvitation: (id) => post(platformPath('invitations', id, 'cancel')),

    // public onboarding (no sign-in)
    getInvitationByToken: (token) => publicCall('GET', token),
    submitOnboarding: (token, form: PlatformOnboardingForm) => publicCall('POST', token, form),

    // users (Super Admin)
    listUsers: (q = {}) => getEveryPage(platformPath('users'), userQuery(q), q.pageSize, q.page),
    disableUser: (id) => post(platformPath('users', id, 'disable')),
    enableUser: (id) => post(platformPath('users', id, 'enable')),
    unlockUser: (id) => post(platformPath('users', id, 'unlock')),
    resetUserPassword: (id) => post(platformPath('users', id, 'reset-password')),

    // activity, audit, sign-ins
    listActivity: (q = {}) => getEveryPage(platformPath('activity'), { hotelId: q.hotelId || undefined, groupId: q.groupId || undefined, search: searchWord(q.search) }, q.pageSize, q.page),
    listAudit: (q = {}) => getEveryPage(platformPath('audit'), auditFilters(q), q.pageSize, q.page),
    listSignIns: (q = {}) => getEveryPage(platformPath('sign-ins'), signInQuery(q), q.pageSize, q.page),
  };
}
