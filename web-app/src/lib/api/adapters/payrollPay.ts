// Payroll (pay half) over the real server: /api/v1/payroll/... (docs/api/payroll-pay.md).
// Payroll Master items and the payroll log use payroll/master and payroll/log (Super Admin only, checked by the service).
import type { DashResult, Page } from '@shared/dashboards/common';
import type { MasterView, LogQuery, LogResult, MasterItem, PaymentStatus, PayrollPayApi, Separation, SeparationStatus, SeparationSummary, SlipList, SlipSummary } from '@shared/dashboards/payrollPay';

import * as api from '../client';
import { deletedFlag, getEveryPage, lookupLimit, pick, snapPageSize } from './payrollShared';

const co = (companyId: string) => `/payroll/companies/${companyId}`;
const oneOf = <T extends string>(v: string | undefined, allowed: readonly T[]): T | undefined => (v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined);

/** The list queries every pay list shares (without the paging: getEveryPage adds it, fetching every page for the big pages the screens ask for). */
const listFilters = (q: { search?: string } | undefined) => ({ search: q?.search?.trim() });

/** Slips, Advances, Bonus, Resignations (docs/BACKEND.md 7.6 "Pay lists"): period, search, status and sort go to the server; `dir` only with a sort. */
const pagedFilters = (q: { period?: string; status?: string; search?: string; sort?: string; dir?: 'asc' | 'desc' } | undefined) => ({
  period: q?.period || undefined,
  status: q?.status || undefined,
  search: q?.search?.trim().slice(0, 100) || undefined,
  sort: q?.sort || undefined,
  dir: q?.sort ? q.dir : undefined,
});

/**
 * One page of a pay list, as the screen asks for it (10, 25, 50 or 100 rows; the server filters, sorts and pages). Only a caller that still
 * wants every row at once (the staff list's leavers, the letters picker, the recycle bins ask for 500 or 1000) is served page by page.
 */
function payList<T>(path: string, query: Record<string, string | number | undefined>, pageSize: number | undefined, page: number | undefined): Promise<DashResult<T>> {
  if (pageSize !== undefined && pageSize > 100) return getEveryPage<T>(path, query, pageSize, page);
  return api.get<T>(path, { ...query, page, pageSize: snapPageSize(pageSize) });
}

/** A count per status with every status present (0 when the answer leaves one out). */
const withEvery = <K extends string>(zero: Record<K, number>, got: Partial<Record<K, number>> | undefined): Record<K, number> => ({ ...zero, ...got });
const NO_SEPARATIONS: Record<SeparationStatus, number> = { Pending: 0, Accepted: 0, Relieved: 0 };
const NO_PAYMENTS: Record<PaymentStatus, number> = { Pending: 0, Processing: 0, 'On Hold': 0, 'Partially Paid': 0, Paid: 0, Failed: 0 };
/** The slips summary with every field and status present. */
const slipSummary = (s: Partial<SlipSummary> | undefined): SlipSummary => ({
  period: s?.period ?? null, slips: s?.slips ?? 0, people: s?.people ?? 0, netPaise: s?.netPaise ?? 0, paidPaise: s?.paidPaise ?? 0,
  outstandingPaise: s?.outstandingPaise ?? 0, byStatus: withEvery(NO_PAYMENTS, s?.byStatus), latestPeriod: s?.latestPeriod ?? null,
});

const REVISION_KEYS = ['effectiveDate', 'salaryPaise', 'designation', 'department', 'dailyWorkingHours', 'paymentMode', 'bankName', 'accountHolderName', 'accountNumber', 'ifscCode', 'branchName'] as const;
const PAYMENT_KEYS = ['version', 'status', 'paidPaise', 'paidOn', 'reference', 'remarks'] as const;
const BULK_KEYS = ['ids', 'versions', 'status', 'paidOn', 'reference'] as const;
const ADVANCE_KEYS = ['employeeId', 'date', 'amountPaise', 'recoveryType', 'instalmentPaise', 'remarks'] as const;
const BONUS_KEYS = ['employeeId', 'date', 'type', 'amountPaise', 'remarks'] as const;
const SEPARATION_KEYS = ['employeeId', 'type', 'resignationDate', 'lastWorkingDate', 'reason', 'remarks', 'status', 'documentName'] as const;
const REJOIN_KEYS = ['joiningDate', 'designation', 'department', 'salaryPaise', 'dailyWorkingHours', 'phone', 'contactCountry', 'address', 'paymentMode', 'bankName', 'accountHolderName', 'accountNumber', 'ifscCode', 'branchName'] as const;

export function createPayrollPayRealApi(): PayrollPayApi {
  return {
    // reference data
    listCompanies: () => api.get('/payroll/company-refs'),
    listEmployees: (cid, activeOnly = true) => api.get(`${co(cid)}/staff`, { activeOnly: String(activeOnly) }),
    masterChoices: (cid, list) => api.get(`${co(cid)}/masters/${list}`),

    // salary update
    listSalaryProfiles: (cid, q) => getEveryPage(`${co(cid)}/salary-profiles`, listFilters(q), q?.pageSize, q?.page),
    getSalaryProfile: (cid, employeeId) => api.get(`${co(cid)}/salary-profiles/${employeeId}`),
    reviseSalary: (cid, employeeId, i) => api.post(`${co(cid)}/salary-profiles/${employeeId}/revisions`, pick(i, REVISION_KEYS)),

    // payments
    processedPeriods: (cid) => api.get(`${co(cid)}/salary-periods`),
    // Asked a page at a time the server returns that page plus `page: {page, pageSize, total}`; the summary always counts the whole month.
    listPayments: (cid, period, q) =>
      api.get(`${co(cid)}/payments`, { period, page: q?.page, pageSize: q?.page === undefined ? undefined : snapPageSize(q.pageSize), status: q?.status, search: q?.search?.trim() || undefined, sort: q?.sort, dir: q?.dir }),
    lookupStaff: (cid, q) => api.get(`${co(cid)}/staff/lookup`, { q: q?.q?.trim() || undefined, limit: lookupLimit(q?.limit), activeOnly: q?.activeOnly === undefined ? undefined : String(q.activeOnly) }),
    updatePayment: (cid, id, i) => api.patch(`${co(cid)}/payments/${id}`, pick(i, PAYMENT_KEYS)),
    bulkUpdatePayments: (cid, i) => api.post(`${co(cid)}/payments/bulk`, pick(i, BULK_KEYS)),

    // slips (the page fields at the top level, plus the summary)
    listSlips: (cid, q) => payList<SlipList>(`${co(cid)}/slips`, pagedFilters(q), q?.pageSize, q?.page).then((r) => (r.ok ? { ok: true as const, data: { ...r.data, summary: slipSummary(r.data.summary) } } : r)),
    getSlip: (cid, id) => api.get(`${co(cid)}/slips/${id}`),

    // advances
    listAdvances: (cid, q) => payList(`${co(cid)}/advances`, { ...pagedFilters(q), tab: oneOf(q?.tab, ['all', 'open', 'settled']), deleted: deletedFlag(q?.deleted) }, q?.pageSize, q?.page),
    createAdvance: (cid, i) => api.post(`${co(cid)}/advances`, pick(i, ADVANCE_KEYS)),
    updateAdvance: (cid, id, i) => api.patch(`${co(cid)}/advances/${id}`, pick(i, ADVANCE_KEYS)),
    deleteAdvance: (cid, id) => api.del(`${co(cid)}/advances/${id}`),
    restoreAdvance: (cid, id) => api.post(`${co(cid)}/advances/${id}/restore`),
    purgeAdvance: (cid, id) => api.del(`${co(cid)}/advances/${id}/purge`),

    // bonus and incentive
    listBonus: (cid, q) => payList(`${co(cid)}/bonuses`, { ...pagedFilters(q), tab: oneOf(q?.tab, ['all', 'Bonus', 'Incentive']), deleted: deletedFlag(q?.deleted) }, q?.pageSize, q?.page),
    createBonus: (cid, i) => api.post(`${co(cid)}/bonuses`, pick(i, BONUS_KEYS)),
    updateBonus: (cid, id, i) => api.patch(`${co(cid)}/bonuses/${id}`, pick(i, BONUS_KEYS)),
    deleteBonus: (cid, id) => api.del(`${co(cid)}/bonuses/${id}`),
    restoreBonus: (cid, id) => api.post(`${co(cid)}/bonuses/${id}/restore`),
    purgeBonus: (cid, id) => api.del(`${co(cid)}/bonuses/${id}/purge`),

    // staff meals
    getMeals: (cid, period) => api.get(`${co(cid)}/meals`, { period }),
    addMealPrice: (cid, i) => api.post(`${co(cid)}/meals/prices`, { monthlyPaise: i.monthlyPaise, effectiveFrom: i.effectiveFrom }),
    deleteMealPrice: (cid, id) => api.del(`${co(cid)}/meals/prices/${id}`),
    startMeals: (cid, employeeId, i) => api.post(`${co(cid)}/meals/staff/${employeeId}`, { startsOn: i.startsOn, endsOn: i.endsOn }),
    stopMeals: (cid, periodId, endsOn) => api.patch(`${co(cid)}/meals/periods/${periodId}`, { endsOn }),
    deleteMealPeriod: (cid, periodId) => api.del(`${co(cid)}/meals/periods/${periodId}`),

    // reports
    periodReport: (cid, from, to, employeeId) => api.get(`${co(cid)}/reports/period`, { from, to, employeeId }),
    monthlyReport: (cid, period) => api.get(`${co(cid)}/reports/monthly`, { period }),

    // letters
    getLetterTemplate: (cid, kind) => api.get(`${co(cid)}/letters/${kind}`),
    saveLetterTemplate: (cid, kind, i) =>
      api.put(`${co(cid)}/letters/${kind}`, {
        subject: i.subject,
        sections: i.sections.map((s) => ({ id: s.id, label: s.label, text: s.text })),
        signatoryName: i.signatoryName,
        signatoryDesignation: i.signatoryDesignation,
      }),
    toggleLetterTemplate: (cid, kind) => api.post(`${co(cid)}/letters/${kind}/toggle`),
    deleteLetterTemplate: (cid, kind) => api.del(`${co(cid)}/letters/${kind}`),
    generateJoiningLetter: (cid, employeeId) => api.get(`${co(cid)}/employees/${employeeId}/joining-letter`),
    generateExperienceLetter: (cid, separationId) => api.get(`${co(cid)}/separations/${separationId}/experience-letter`),

    // resignations
    listSeparations: (cid, q) =>
      payList<{ page: Page<Separation>; summary: SeparationSummary }>(`${co(cid)}/separations`, { ...pagedFilters(q), tab: oneOf(q?.tab, ['all', 'notice', 'relieved', 'rejoined']), deleted: deletedFlag(q?.deleted) }, q?.pageSize, q?.page).then((r) =>
        r.ok ? { ok: true as const, data: { ...r.data, summary: { ...r.data.summary, byStatus: withEvery(NO_SEPARATIONS, r.data.summary.byStatus) } } } : r,
      ),
    createSeparation: (cid, i) => api.post(`${co(cid)}/separations`, pick(i, SEPARATION_KEYS)),
    updateSeparation: (cid, id, i) => api.patch(`${co(cid)}/separations/${id}`, pick(i, SEPARATION_KEYS)),
    deleteSeparation: (cid, id) => api.del(`${co(cid)}/separations/${id}`),
    restoreSeparation: (cid, id) => api.post(`${co(cid)}/separations/${id}/restore`),
    purgeSeparation: (cid, id) => api.del(`${co(cid)}/separations/${id}/purge`),
    rejoin: (cid, id, i) => api.post(`${co(cid)}/separations/${id}/rejoin`, pick(i, REJOIN_KEYS)),

    // payroll master (Super Admin; one list in a scope: 'all' or a payroll company id) and the payroll log (docs/BACKEND.md, payroll/master and payroll/log)
    getMaster: (scope, list) => api.get<MasterView>('/payroll/master', { scope, list }),
    createMasterItem: (scope, list, i) => api.post<MasterItem>(`/payroll/master/${list}`, pick(i, MASTER_ITEM_KEYS), { query: { scope } }),
    // The item is found in the scope it lives in: the screen passes the scope of the list it is showing.
    updateMasterItem: (id, i, scope = 'all') => api.patch<MasterItem>(`/payroll/master/items/${id}`, pick(i, MASTER_ITEM_KEYS), { query: { scope } }),
    toggleMasterItem: (id, scope = 'all') => api.post<MasterItem>(`/payroll/master/items/${id}/toggle`, {}, { query: { scope } }),
    deleteMasterItem: (id, scope = 'all') => api.del<{ id: string }>(`/payroll/master/items/${id}`, undefined, { query: { scope } }),
    listLog: (scope, q = {}) => listAllLog(scope, q),
  };
}

const MASTER_ITEM_KEYS = ['label', 'value'] as const;
/** The server's largest page; the screen filters and pages the log itself, so every page of the answer is fetched (at most 50 pages = 5,000 entries). */
const LOG_PAGE = 100;
const LOG_MAX_PAGES = 50;

async function listAllLog(scope: string, q: LogQuery): Promise<DashResult<LogResult>> {
  const filters = {
    scope,
    search: q.search?.trim() || undefined,
    view: q.view || undefined,
    action: q.action || undefined,
    entity: q.entity || undefined,
    status: q.status || undefined,
    user: q.user || undefined,
    from: q.from || undefined,
    to: q.to || undefined,
  };
  const first = await api.get<LogResult>('/payroll/log', { ...filters, page: 1, pageSize: LOG_PAGE });
  if (!first.ok) return first;
  const items = [...first.data.page.items];
  for (let page = 2; items.length < first.data.page.total && page <= LOG_MAX_PAGES; page += 1) {
    const next = await api.get<LogResult>('/payroll/log', { ...filters, page, pageSize: LOG_PAGE });
    if (!next.ok) return next;
    if (next.data.page.items.length === 0) break;
    items.push(...next.data.page.items);
  }
  return { ok: true, data: { ...first.data, page: { ...first.data.page, items, page: 1, pageSize: Math.max(items.length, 1) } } };
}
