// The company portal (role corporate_user) over the real server: /api/v1/corporate/* (docs/BACKEND.md, server/services/corporate/corporateService.ts).
// Same TypeScript interface as the mock (`createCorporateApi`). The server's DTOs ARE the ui-shared types, so every call passes straight through;
// only the strict queries and bodies are trimmed here. The company is the session's own record scope, never an input.
// While online payment is off the server refuses paying with a sentence (409). Booking, the team list and the old overview, bills, payments and ledger routes were removed.
import type { CorpDashboard, CorporateApi, DueBillsPage, LedgerAccountPage, PaymentHistoryPage, PortalProfile } from '@shared/dashboards/corporate';
import { hotelParam } from '@shared/dashboards/portalHotel';

import * as api from '../client';
import { snapPageSize } from './payrollShared';

const id = encodeURIComponent;
const BASE = '/corporate';

/** Decision 48: the sidebar's hotel choice rides on every portal call as `?hotel=` (left out for "all", the server's default). */
/** Cursor paging when the screen asks for it (`limit`), else the old page / pageSize. */
const paging = (q: { page?: number; pageSize?: number; limit?: number; cursor?: string }): Record<string, string | number | undefined> =>
  q.limit ? { limit: q.limit, cursor: q.cursor } : { page: q.page, pageSize: snapPageSize(q.pageSize) };
const hotelQuery =(extra: Record<string, string | number | undefined> = {}): Record<string, string | number | undefined> => ({ ...extra, hotel: hotelParam() });

export function createHttpCorporateApi(): CorporateApi {
  return {
    listHotels: () => api.get<{ hotelId: string; name: string }[]>(`${BASE}/hotels`),
    getDashboard: () => api.get<CorpDashboard>(`${BASE}/dashboard`, hotelQuery()),
    listDueBills: (q) => api.get<DueBillsPage>(`${BASE}/accounts/due-bills`, hotelQuery({ search: q.search?.trim() || undefined, ...paging(q) })),
    listPaymentHistory: (q) => api.get<PaymentHistoryPage>(`${BASE}/accounts/payment-history`, hotelQuery({ search: q.search?.trim() || undefined, ...paging(q) })),
    getLedgerAccount: (q) => api.get<LedgerAccountPage>(`${BASE}/accounts/ledger`, hotelQuery({ period: q.period, search: q.search?.trim() || undefined, ...paging(q) })),
    getPortalProfile: (hotelId) => api.get<PortalProfile>(`${BASE}/profile`, { hotel: hotelId }),
    savePortalProfile: (hotelId, input) => api.put<PortalProfile>(`${BASE}/profile`, input, { query: { hotel: hotelId }, idempotent: false }),

    getBill: (bid) => api.get(`${BASE}/bills/${id(bid)}`, hotelQuery()),
    payDues: (businesses) => api.post(`${BASE}/dues/pay`, { businesses }),
    payBill: (bid) => api.post(`${BASE}/bills/${id(bid)}/pay`),

  };
}
