// Billing (bills, guest advances, debit bills) over the real server: /api/v1/billing/... (docs/BACKEND.md, docs/specs/billing-*.md).
// Same TypeScript interface as the mock (`createBillingApi`). The server's DTOs ARE the ui-shared types (Advance, Bill, AdvanceList, BillList,
// BillingOptions, BillPreview, AdvancePreview), so most calls pass straight through; only the strict bodies and queries are trimmed here.
import type { DashResult, LookupItem } from '@shared/dashboards/common';
import type {
  Advance, AdvanceInput, AdvanceList, AdvanceQuery, BillingApi, BillingCompany, BillInput, BillList, BillQuery, RefundInput, SettleInput,
} from '@shared/dashboards/billing';

import * as api from '../client';
import { pick, snapPageSize } from './payrollShared';

const id = encodeURIComponent;
const ADV = '/billing/advances';
const BILL = '/billing/bills';

const ADVANCE_SORTS = ['paymentDate', 'receiptNumber', 'guestName', 'totalAmountPaise', 'balancePaise'] as const;
const BILL_SORTS = ['billDate', 'billNumber', 'guestName', 'totalPaise', 'balancePaise'] as const;
const oneOf = <T extends string>(v: string | undefined, allowed: readonly T[]): T | undefined => (v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined);

/** The list params the server accepts (anything else is a 422). */
function listParams(q: AdvanceQuery | BillQuery, sorts: readonly string[]) {
  return {
    tab: q.tab && q.tab !== 'all' ? q.tab : undefined,
    search: q.search?.trim() || undefined,
    mode: q.mode || undefined,
    companyId: q.companyId || undefined,
    month: q.month || undefined,
    from: q.from || undefined,
    to: q.to || undefined,
    sort: oneOf(q.sort, sorts),
    dir: q.dir,
    page: q.page,
    pageSize: snapPageSize(q.pageSize),
    deleted: 'deleted' in q && q.deleted === 'only' ? 'only' : undefined,
  };
}

const ADVANCE_KEYS = ['receiptNo', 'paymentDate', 'guestName', 'mobile', 'companyId', 'roomNo', 'covers', 'hotelPaise', 'foodPaise', 'hotelMode', 'foodMode', 'referenceName', 'referenceMobile', 'instruction'] as const;
const REFUND_KEYS = ['date', 'hotelPaise', 'foodPaise', 'hotelMode', 'foodMode', 'toName', 'toMobile', 'note'] as const;
const HOTEL_KEYS = ['plan', 'roomPaise', 'planPaise', 'extraBedPaise', 'laundryPaise', 'vpoPaise', 'gstPaise', 'mode'] as const;
const FOOD_KEYS = ['foodPaise', 'planPaise', 'laundryPaise', 'gstPaise', 'mode'] as const;
const STAY_KEYS = ['from', 'to', 'plan', 'persons'] as const;
const BILL_KEYS = ['billNo', 'billDate', 'grNo', 'advanceId', 'guestName', 'mobile', 'address', 'gstin', 'companyId', 'roomNo', 'persons', 'arrivalAt', 'departureAt', 'referenceName', 'referenceMobile', 'instruction'] as const;
const INSTALLMENT_KEYS = ['date', 'hotelPaise', 'hotelMode', 'foodPaise', 'foodMode'] as const;

const billBody = (i: BillInput) => ({
  ...pick(i, BILL_KEYS),
  hotel: pick(i.hotel, HOTEL_KEYS),
  food: pick(i.food, FOOD_KEYS),
  stay: i.stay.map((s) => pick(s, STAY_KEYS)),
});

const settleBody = (i: SettleInput) => ({
  installments: i.installments.map((x) => pick(x, INSTALLMENT_KEYS)),
  referenceName: i.referenceName,
  referenceMobile: i.referenceMobile,
  instruction: i.instruction,
  version: i.version,
});

/**
 * Company names for the pickers. Billing has no company route of its own: the Companies LOOKUP (max 50, GSTIN in `hint`) is used.
 * A billing clerk without Companies access gets the names the advances list offers in its filter (no GSTIN there).
 */
async function listCompanies(): Promise<DashResult<BillingCompany[]>> {
  const r = await api.get<LookupItem[]>('/companies/lookup', { limit: 50 });
  if (r.ok) return { ok: true, data: r.data.map((c) => ({ id: c.id, name: c.label, gstin: c.hint ?? '' })) };
  const list = await api.get<AdvanceList>(ADV, { pageSize: 10 });
  return list.ok ? { ok: true, data: list.data.options.companies.map((c) => ({ id: c.id, name: c.name, gstin: '' })) } : r;
}

export function createHttpBillingApi(): BillingApi {
  return {
    listCompanies,

    // advances
    listAdvances: (q = {}) => api.get<AdvanceList>(ADV, listParams(q, ADVANCE_SORTS)),
    getAdvance: (aid) => api.get(`${ADV}/${id(aid)}`),
    listOpenAdvances: () => api.get(`${ADV}/open`),
    createAdvance: (input: AdvanceInput) => api.post(ADV, pick(input, ADVANCE_KEYS)),
    updateAdvance: (aid, input: AdvanceInput) => api.patch(`${ADV}/${id(aid)}`, { ...pick(input, ADVANCE_KEYS), version: input.version }),
    deleteAdvance: (aid, version) => api.del(`${ADV}/${id(aid)}`, { version }),
    refundAdvance: (aid, input: RefundInput) => api.post(`${ADV}/${id(aid)}/refund`, { ...pick(input, REFUND_KEYS), version: input.version }),
    undoRefund: (aid, version) => api.del(`${ADV}/${id(aid)}/refund`, { version }),
    // The server wants the version the person saw. Without one it is looked up in the recycle-bin list (GET by id does not return deleted rows).
    restoreAdvance: async (aid, version) => {
      if (version !== undefined) return api.post<Advance>(`${ADV}/${id(aid)}/restore`, { version });
      for (let page = 1; page <= 50; page++) {
        const bin = await api.get<AdvanceList>(ADV, { deleted: 'only', page, pageSize: 100 });
        if (!bin.ok) return bin;
        const row = bin.data.page.items.find((a) => a.id === aid);
        if (row) return api.post<Advance>(`${ADV}/${id(aid)}/restore`, { version: row.version });
        if (page * bin.data.page.pageSize >= bin.data.page.total) break;
      }
      return { ok: false, error: { code: 'NOT_FOUND', message: 'This advance is not in the recycle bin.', traceId: 'no-trace' } };
    },
    purgeAdvance: (aid) => api.del(`${ADV}/${id(aid)}/purge`),
    getAdvancePreview: (aid) => api.get(`${ADV}/${id(aid)}/preview`),
    emailAdvance: (aid, to) => api.post(`${ADV}/${id(aid)}/email`, to ? { to } : {}),
    emailBill: (bid, to) => api.post(`${BILL}/${id(bid)}/email`, to ? { to } : {}),

    // bills (debit bills are bills paid by Debit: same list, settled through /settlement)
    listBills: (q = {}) => api.get<BillList>(BILL, listParams(q, BILL_SORTS)),
    getBill: (bid) => api.get(`${BILL}/${id(bid)}`),
    createBill: (input) => api.post(BILL, billBody(input)),
    updateBill: (bid, input) => api.patch(`${BILL}/${id(bid)}`, { ...billBody(input), version: input.version }),
    deleteBill: (bid, version) => api.del(`${BILL}/${id(bid)}`, { version }),
    settleBill: (bid, input) => api.post(`${BILL}/${id(bid)}/settlement`, settleBody(input)),
    reverseSettlement: (bid, version) => api.del(`${BILL}/${id(bid)}/settlement`, { version }),
    getBillingOptions: () => api.get('/billing/options'),
    getBillPreview: (bid) => api.get(`${BILL}/${id(bid)}/preview`),
  };
}
