// Administration over the real server: /api/v1/admin/* and the signed-in person's own /api/v1/profile/* (docs/api/admin.md).
// Same interface as the mock (createAdminApi). What the server has no route for answers NOT_FOUND "No route yet" (notYet) and is listed in the session report.
import type {
  AdminPortalOption, BackupStatus, ExpenseCatalog, RazorpayOverview, RazorpayRefundResult, RazorpayCheckResult, RazorpayRefundItem, RazorpayLinkItem, RazorpaySettlementItem, RazorpayOutcome,AdminProfile, AdminProfileInput, AdminRole, AdminRoleInput, AdminUser, AdminUserInput, AdminUserStats, AccountChange, ErrorState, HealthCheck, HealthState,
  LiveDevice, LogLevel, MasterItemInput, MasterItemResult, MasterList, MasterRailEntry, PasswordChangeInput, PlanRate, PlanRateInput, PlanRatesPanel, RecycleItem, RecycleResult,
  SettingGroup, SettingsMap, SettingsOverview, SettingsValues, SignInList, SignInQuery, SystemErrorItem, SystemLogEntry, SystemOverview, AdminApi,
} from '@shared/dashboards/admin';
import type { SystemLogRow } from '@shared/dashboards/adminSystem';
import type { ListQuery, Page } from '@shared/dashboards/common';
import { HOTEL_MAIL_CONNECTION_TEST, type MailConnectionTest } from '@shared/dashboards/conversations';
import type { MailSenderIdentity } from '@shared/dashboards/mailProviders';

import * as api from '../client';
import { getEveryPage, snapPageSize } from './payrollShared';

export type { AdminApi };

const enc = encodeURIComponent;

/** The server's profile may have never had a password change (null); the screen reads an empty value as "never". */
/** The server calls the switch `codeRequired` (decision 46); the screen keeps `emailedCode`. */
interface ServerProfile extends Omit<AdminProfile, 'passwordChangedAt' | 'emailedCode'> { passwordChangedAt: string | null; codeRequired?: boolean; emailedCode?: boolean }
const toProfile = (p: ServerProfile): AdminProfile => ({ ...p, passwordChangedAt: p.passwordChangedAt ?? '', emailedCode: p.codeRequired ?? p.emailedCode ?? false });

/** The server keeps the full Bootstrap Icons class ("bi-person"); the contract and the screens use the bare name ("person"). */
const bareIcon = (icon: string | undefined) => (icon ? icon.replace(/^bi\s+/, '').replace(/^bi-/, '') : undefined);
const fullIcon = (icon: string | undefined) => (icon ? (icon.startsWith('bi-') ? icon : `bi-${icon}`) : undefined);
const toRole = (r: AdminRole): AdminRole => {
  const icon = bareIcon(r.icon);
  const { icon: _drop, ...rest } = r;
  void _drop;
  return icon ? { ...rest, icon } : rest;
};
/** Only the keys the server's roleBody knows (strict); the look and `inherits` only when given (absent = unchanged on an edit). */
const roleBody = (i: AdminRoleInput) => ({
  name: i.name,
  description: i.description,
  levels: i.levels,
  ...(i.icon ? { icon: fullIcon(i.icon) } : {}),
  ...(i.accent ? { accent: i.accent } : {}),
  ...(i.inherits !== undefined ? { inherits: i.inherits } : {}),
});

// ---- System Health over /system/health and /system/errors, mapped onto the older AdminApi system shapes (no screen reads these today; the system
// screens go through groups/admin/systemApi.ts and adapters/systemAdmin.ts).
interface ServerCheck { name: string; label: string; icon: string; status: HealthState; message: string; latencyMs: number | null; uptime: number | null; checkedAt: string }
interface ServerFault { id: string; exception: string; feature: string; message: string; occurrences: number; lastSeen: string; method: string | null; path: string | null; userName: string | null; file: string; line: number; trace: string | null; resolvedBy: string | null; resolved: boolean }
interface ServerHealth { overall: 'healthy' | 'degraded' | 'down'; checks: ServerCheck[]; openErrors: number; recentErrors: ServerFault[] }
interface ServerFaults { page: Page<ServerFault>; counts: { open: number; resolved: number }; features: string[] }

const toCheck = (c: ServerCheck): HealthCheck => ({ id: c.name, name: c.label, state: c.status, detail: c.message, checkedAt: c.checkedAt });
const toErrorItem = (e: ServerFault): SystemErrorItem => ({ id: e.id, message: e.message || e.exception, where: e.path ? `${e.method ?? ''} /${e.path.replace(/^\//, '')}`.trim() : e.feature, count: e.occurrences, firstAt: e.lastSeen, lastAt: e.lastSeen, state: e.resolved ? 'resolved' : 'open', resolvedBy: e.resolvedBy });

export function createAdminRealApi(): AdminApi {
  const scope = (s: string | undefined) => ({ scope: s });

  return {
    // ---------------- users
    listUsers: (q: ListQuery = {}) =>
      getEveryPage<{ page: Page<AdminUser>; stats: AdminUserStats }>('/admin/users', { search: q.search, tab: q.tab }, q.pageSize, q.page),
    getUser: (id) => api.get<AdminUser>(`/admin/users/${enc(id)}`),
    createUser: (i: AdminUserInput) => api.dashMap<{ user: AdminUser }, AdminUser>('POST', '/admin/users', { body: i }, (r) => r.user),
    updateUser: (id, i: AdminUserInput) => api.dashMap<{ user: AdminUser }, AdminUser>('PUT', `/admin/users/${enc(id)}`, { body: i }, (r) => r.user),
    toggleUser: (id) => api.dashMap<{ user: AdminUser }, AdminUser>('POST', `/admin/users/${enc(id)}/toggle`, {}, (r) => r.user),
    unlockUser: (id) => api.dashMap<{ user: AdminUser }, AdminUser>('POST', `/admin/users/${enc(id)}/unlock`, {}, (r) => r.user),
    /** Decision 47: link a portal account to its guest or company record (PUT), unlink it (DELETE); the candidates for the picker (active records only). */
    listPortalOptions: (id: string, q?: string) => api.dashMap<{ items: AdminPortalOption[] }, AdminPortalOption[]>('GET', `/admin/users/${enc(id)}/portal-link/options`, { query: { q: q?.trim() || undefined } }, (r) => r.items),
    linkPortal: (id: string, input: { kind: 'guest' | 'company'; recordId: string }) => api.put<AdminUser>(`/admin/users/${enc(id)}/portal-link`, input),
    unlinkPortal: (id: string) => api.del<AdminUser>(`/admin/users/${enc(id)}/portal-link`),
    emailNewPassword: (id) => api.dashMap<{ user: AdminUser }, { to: string }>('POST', `/admin/users/${enc(id)}/reset-password`, {}, (r) => ({ to: r.user.email })),
    deleteUser: (id) => api.del<{ id: string }>(`/admin/users/${enc(id)}`),

    // ---------------- roles
    listRoles: () => api.dashMap<AdminRole[], AdminRole[]>('GET', '/admin/roles', {}, (rs) => rs.map(toRole)),
    createRole: (i: AdminRoleInput) => api.dashMap<AdminRole, AdminRole>('POST', '/admin/roles', { body: roleBody(i) }, toRole),
    updateRole: (id, i: AdminRoleInput) => api.dashMap<AdminRole, AdminRole>('PUT', `/admin/roles/${enc(id)}`, { body: roleBody(i) }, toRole),
    /** Every role once, SuperAdmin first (the server refuses anything else). */
    reorderRoles: (ids: string[]) => api.dashMap<AdminRole[], AdminRole[]>('PUT', '/admin/roles/order', { body: { order: ids } }, (rs) => rs.map(toRole)),
    deleteRole: (id) => api.del<{ id: string }>(`/admin/roles/${enc(id)}`),

    // ---------------- master data
    listMasterRail: () => api.get<MasterRailEntry[]>('/admin/masters'),
    getMasterList: (key, askedScope) => api.get<MasterList>(`/admin/masters/${enc(key)}`, scope(askedScope)),
    createMasterItem: (key, askedScope, input: MasterItemInput) => api.post<MasterItemResult>(`/admin/masters/${enc(key)}/items`, input, { query: scope(askedScope) }),
    updateMasterItem: (id, askedScope, input: MasterItemInput) => api.patch<MasterItemResult>(`/admin/masters/items/${enc(id)}`, input, { query: scope(askedScope) }),
    toggleMasterItem: (id, askedScope) => api.post<MasterItemResult>(`/admin/masters/items/${enc(id)}/toggle`, {}, { query: scope(askedScope) }),
    moveMasterItem: (id, direction) => api.post<{ id: string; moved: boolean }>(`/admin/masters/items/${enc(id)}/move`, { direction }),
    deleteMasterItem: (id, askedScope) => api.del<{ id: string; message: string }>(`/admin/masters/items/${enc(id)}`, undefined, { query: scope(askedScope) }),
    deleteMasterSet: (key) => api.del<{ key: string; message: string }>(`/admin/masters/${enc(key)}`),

    // expense catalogue (docs/BACKEND.md 14b): categories with priced items of one business list (expense_catalog_hotel / expense_catalog_food)
    getExpenseCatalog: (key, askedScope) => api.get<ExpenseCatalog>(`/admin/masters/${enc(key)}/catalog`, scope(askedScope)),
    saveCatalogCategory: (key, askedScope, id, name) =>
      id
        ? api.patch<{ category: { id: string; name: string }; message: string }>(`/admin/masters/catalog/categories/${enc(id)}`, { name }, { query: scope(askedScope) })
        : api.post<{ category: { id: string; name: string }; message: string }>(`/admin/masters/${enc(key)}/catalog/categories`, { name }, { query: scope(askedScope) }),
    deleteCatalogCategory: (id, askedScope) => api.del<{ id: string; message: string }>(`/admin/masters/catalog/categories/${enc(id)}`, undefined, { query: scope(askedScope) }),
    saveCatalogItem: (categoryId, askedScope, id, input) =>
      id
        ? api.patch<{ item: { id: string; name: string; pricePaise: number }; message: string }>(`/admin/masters/catalog/items/${enc(id)}`, { name: input.name, pricePaise: input.pricePaise }, { query: scope(askedScope) })
        : api.post<{ item: { id: string; name: string; pricePaise: number }; message: string }>(`/admin/masters/catalog/categories/${enc(categoryId)}/items`, { name: input.name, pricePaise: input.pricePaise }, { query: scope(askedScope) }),
    deleteCatalogItem: (id, askedScope) => api.del<{ id: string; message: string }>(`/admin/masters/catalog/items/${enc(id)}`, undefined, { query: scope(askedScope) }),

    // ---------------- plan rates
    getPlanRates: () => api.get<PlanRatesPanel>('/admin/plan-rates'),
    savePlanRate: (i: PlanRateInput) => api.post<{ rate: PlanRate; message: string }>('/admin/plan-rates', i),
    deletePlanRate: (id) => api.del<{ id: string; message: string }>(`/admin/plan-rates/${enc(id)}`),

    // ---------------- settings
    getSettings: (tab) => api.get<SettingsOverview>('/admin/settings', { tab }),
    getSettingsMap: () => api.get<SettingsMap>('/admin/settings/map'),
    saveSettings: (group, values: SettingsValues, clear?: readonly string[]) => api.patch<{ group: SettingGroup; message: string }>(`/admin/settings/${enc(group)}`, { values, ...(clear && clear.length > 0 ? { clear: [...clear] } : {}) }),
    checkEmailDomain: () => api.post<MailSenderIdentity>('/admin/settings/email/check-domain', {}),
    testEmail: (to?: string) => api.post<{ sent: boolean; to: string; message: string; at: string; hint?: string }>('/admin/settings/email/test', to ? { to } : {}),
    /** Decision 66: signs in to the saved mailbox for reading and sending (fixed sentences only). Not idempotent: the route keeps no copy (idempotency "off"). */
    startMailConnectionTest: () => api.dashMap<MailConnectionTest, MailConnectionTest>('POST', HOTEL_MAIL_CONNECTION_TEST, { body: {}, idempotent: false }, (r) => r),
    // Backup & Restore (Super Admin). connect / test / run are honest 409 stubs on the server until Google Drive is linked: the screen shows their sentence.
    getBackupStatus: () => api.get<BackupStatus>('/admin/backup'),
    connectDrive: () => api.post<BackupStatus>('/admin/backup/connect', {}),
    disconnectDrive: () => api.post<BackupStatus>('/admin/backup/disconnect', {}),
    testBackup: () => api.post<{ message: string }>('/admin/backup/test', {}),
    runBackup: () => api.post<BackupStatus & { message: string }>('/admin/backup/run', {}),

    // ---------------- recycle bin
    listRecycle: (q: ListQuery = {}) => api.get<Page<RecycleItem>>('/admin/recycle', { search: q.search, page: q.page, pageSize: snapPageSize(q.pageSize ?? 100) }),
    restoreRecycle: (key, id) => api.post<RecycleResult>(`/admin/recycle/${enc(key)}/${enc(id)}/restore`, {}),
    purgeRecycle: (key, id) => api.del<RecycleResult>(`/admin/recycle/${enc(key)}/${enc(id)}`),

    // ---------------- Razorpay payments received by webhook
    // The server's list takes only the page (no business / status / search yet; its payments list is empty until the webhook exists).
    listRazorpay: (q) => api.get<RazorpayOverview>('/admin/razorpay', {
      page: q?.page, pageSize: snapPageSize(q?.pageSize),
      business: q?.business && q.business !== 'all' ? q.business : undefined, status: q?.status && q.status !== 'all' ? q.status : undefined,
      method: q?.method || undefined, search: q?.search?.trim() || undefined,
    }),
    refundRazorpay: (business, paymentId, input) => api.post<RazorpayRefundResult>(`/admin/razorpay/payments/${enc(business)}/${enc(paymentId)}/refund`, input),
    checkRazorpay: (business, paymentId) => api.get<RazorpayCheckResult>(`/admin/razorpay/payments/${enc(business)}/${enc(paymentId)}/status`),
    listRazorpayRefunds: (business) => api.get<{ items: RazorpayRefundItem[]; page: number }>('/admin/razorpay/refunds', { business }),
    listRazorpayLinks: (business) => api.get<{ items: RazorpayLinkItem[]; page: number }>('/admin/razorpay/payment-links', { business }),
    createRazorpayLink: (input) => api.post<{ link: RazorpayLinkItem; message: string }>('/admin/razorpay/payment-links', input),
    cancelRazorpayLink: (business, linkId) => api.post<{ link: RazorpayLinkItem; message: string }>(`/admin/razorpay/payment-links/${enc(business)}/${enc(linkId)}/cancel`, {}),
    resendRazorpayLink: (business, linkId, medium) => api.post<RazorpayOutcome>(`/admin/razorpay/payment-links/${enc(business)}/${enc(linkId)}/resend`, { medium }),
    listRazorpaySettlements: (business) => api.get<{ items: RazorpaySettlementItem[]; page: number }>('/admin/razorpay/settlements', { business }),
    /** The server decides who the caller is from the session; nothing to tell it. */
    setActor: () => undefined,

    // ---------------- system health (the older summary shapes; the system screens use createSystemAdminRealApi)
    getSystem: () =>
      api.dashMap<ServerHealth, SystemOverview>('GET', '/system/health', {}, (h) => ({ checks: h.checks.map(toCheck), openErrors: h.openErrors, logToday: 0, uptimeLabel: '', version: '' })),
    runChecks: () => api.dashMap<{ checks: ServerCheck[] }, HealthCheck[]>('POST', '/system/health/checks', {}, (r) => r.checks.map(toCheck)),
    listErrors: (q: ListQuery = {}) =>
      api.dashMap<ServerFaults, Page<SystemErrorItem>>('GET', '/system/errors', { query: { show: q.tab === 'resolved' || q.tab === 'all' ? q.tab : 'open', page: q.page, pageSize: snapPageSize(q.pageSize) } }, (r) => ({ ...r.page, items: r.page.items.map(toErrorItem) })),
    setErrorState: (id, state: ErrorState) =>
      api.dashMap<{ fault: ServerFault }, SystemErrorItem>('POST', `/system/errors/${enc(id)}/${state === 'resolved' ? 'resolve' : 'reopen'}`, {}, (r) => toErrorItem(r.fault)),
    listLog: (q: ListQuery & { level?: LogLevel | '' } = {}) =>
      api.dashMap<Page<SystemLogRow>, Page<SystemLogEntry>>(
        'GET',
        '/system/log',
        { query: { search: q.search?.trim(), status: q.level === 'error' ? 'failed' : q.level ? 'success' : undefined, page: q.page, pageSize: snapPageSize(q.pageSize) } },
        (r) => ({ ...r, items: r.items.map((l) => ({ id: String(l.id), at: l.at, level: l.status === 'failed' ? 'error' : 'info', source: l.module, message: l.summary })) }),
      ),

    // ---------------- profile
    getProfile: () => api.dashMap<ServerProfile, AdminProfile>('GET', '/profile', {}, toProfile),
    updateProfile: (i: AdminProfileInput) => api.dashMap<{ profile: ServerProfile }, AdminProfile>('PUT', '/profile', { body: i }, (r) => toProfile(r.profile)),
    listAccountChanges: () => api.get<AccountChange[]>('/profile/changes'),
    listDevices: () => api.get<LiveDevice[]>('/profile/devices'),
    /** Decision 46: the person's own choice, a SET answered with the profile. Turning it OFF carries the current password (not stored: no idempotency key). A wrong password is a 401 on the field password: it must not end the session. */
    setMySignInCode: (enabled: boolean, password?: string) =>
      api.dashMap<ServerProfile, AdminProfile>('PUT', '/auth/profile/sign-in-code', { body: enabled ? { enabled } : { enabled, password }, idempotent: false, keepSessionOn401: true }, toProfile),
    /** A wrong current password is a 422 on `current`; the person's other sessions end. Not idempotent (nothing about a password is stored). */
    changePassword: (i: PasswordChangeInput) =>
      api.dashMap<{ changedAt: string; message: string }, { changedAt: string }>('PUT', '/profile/password', { body: { current: i.current, next: i.next, confirm: i.confirm }, idempotent: false }, (r) => ({ changedAt: r.changedAt })),
    listSignIns: (q: SignInQuery = {}) => getEveryPage<SignInList>('/profile/sign-ins', { search: q.search, ip: q.ip }, q.pageSize, q.page),
    deleteSignIn: (id) => api.del<{ id: string }>(`/profile/sign-ins/${enc(id)}`),
  };
}
