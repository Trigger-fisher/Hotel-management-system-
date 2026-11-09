// The guest portal (role guest_user) over the real server: /api/v1/guest/* (docs/BACKEND.md, server/services/guest/guestService.ts).
// Same TypeScript interface as the mock (`createGuestApi`). The server's DTOs ARE the ui-shared types (a bill also carries its own `totals`),
// so every call passes straight through; only the strict queries and bodies are trimmed here.
// While online payment is off the server refuses paying, ordering and emailing a copy with a sentence (422): the screens show it.
import type { BillList, GuestApi, GuestHotel, HistoryList } from '@shared/dashboards/guest';
import { PORTAL_ALL_HOTELS, hotelParam } from '@shared/dashboards/portalHotel';

import * as api from '../client';
import { snapPageSize } from './payrollShared';
import type { PortalCursorQuery } from '@shared/dashboards/portalHotels';

const id = encodeURIComponent;
const BASE = '/guest';

const BILL_TABS = ['open', 'paid', 'cancelled', 'all'] as const;
const HISTORY_TABS = ['all', 'charges', 'payments'] as const;
const oneOf = <T extends string>(v: string | undefined, allowed: readonly T[]): T | undefined => (v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined);

/** Decision 48: the sidebar's hotel choice rides on the portal's reads as `?hotel=` (left out for "all", the server's default). */
const hotelQuery = (extra: Record<string, string | number | undefined> = {}): Record<string, string | number | undefined> => ({ ...extra, hotel: hotelParam() });

/** Decision 71: a page's own hotel chips (`q.hotel`) win over the sidebar's choice for that list only; "all" sends no hotel (the server's default). */
const listHotel = (q: { hotel?: string }): string | undefined => (q.hotel === undefined ? hotelParam() : q.hotel === PORTAL_ALL_HOTELS ? undefined : q.hotel);

/** Cursor paging when the screen asks for it (`limit`, the "All hotels" lists), else the old page / pageSize. */
const paging = (q: { page?: number; pageSize?: number } & PortalCursorQuery): Record<string, string | number | undefined> =>
  q.limit ? { limit: q.limit, cursor: q.cursor } : { page: q.page, pageSize: snapPageSize(q.pageSize) };

export function createHttpGuestApi(): GuestApi {
  return {
    listHotels: () => api.get<GuestHotel[]>(`${BASE}/hotels`),
    getOverview: (q = {}) => api.get(`${BASE}/overview`, { hotel: listHotel(q) }),

    listBills: (q) =>
      api.get<BillList>(`${BASE}/bills`, { search: q.search?.trim() || undefined, tab: oneOf(q.tab, BILL_TABS), ...paging(q), hotel: listHotel(q) }),
    // the bill's own hotel when the screen knows it (a page's hotel chips may differ from the sidebar), else the sidebar's choice
    getBill: (bid, hotelId) => api.get(`${BASE}/bills/${id(bid)}`, { hotel: hotelId ?? hotelParam() }),
    payBills: (billIds) => api.post(`${BASE}/bills/pay`, { billIds }),
    emailBill: (bid, hotelId) => api.post(`${BASE}/bills/${id(bid)}/email`, undefined, { query: { hotel: hotelId ?? hotelParam() } }),

    listHistory: (q) =>
      api.get<HistoryList>(`${BASE}/history`, { search: q.search?.trim() || undefined, tab: oneOf(q.tab, HISTORY_TABS), ...paging(q), hotel: listHotel(q) }),

    // decision 71: the menu route reads the hotel from `?hotel=` (forHotel), like the order it is placed with
    getMenu: () => api.get(`${BASE}/menu`, hotelQuery()),
    listScheduledOrders: () => api.get(`${BASE}/orders/scheduled`, hotelQuery()),
    placeOrder: (req) => api.post(`${BASE}/orders`, { qty: req.qty, payWith: req.payWith, note: req.note, scheduledFor: req.scheduledFor }, { query: { hotel: hotelParam() } }),

    getProfile: () => api.get(`${BASE}/profile`),
    updateProfile: (input) =>
      api.put(`${BASE}/profile`, {
        name: input.name, email: input.email, city: input.city, address: input.address,
        idProofType: input.idProofType, idProofNumber: input.idProofNumber, notifyEmail: input.notifyEmail,
      }),
    // the password route is not idempotent-keyed on the server (a retry must re-check the current password)
    changePassword: (input) => api.put(`${BASE}/password`, { current: input.current, next: input.next, confirm: input.confirm }, { idempotent: false }),
  };
}
