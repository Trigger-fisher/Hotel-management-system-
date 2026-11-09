// The Central tabs of the Platform console against the real server: /api/v1/platform/central (ui-shared/dashboards/central.ts). Reads for Platform Admin and Super Admin; the writes
// (create, edit, delete, restore, refresh) are the Super Admin's.
import { centralTabPath, type CentralApi, type CentralPage, type CentralQuery, type CentralTab } from '@shared/dashboards/central';

import { del, get, patch, post } from '../client';

const BASE = '/platform/central';
const at = (tab: CentralTab, id?: string, action?: string): string => `${BASE}/${centralTabPath[tab]}${id ? `/${id}` : ''}${action ? `/${action}` : ''}`;

export function createHttpCentralApi(): CentralApi {
  const list = <T>(tab: CentralTab, q: CentralQuery) => get<CentralPage<T>>(at(tab), { search: q.search, page: q.page, pageSize: q.pageSize, deleted: q.deleted ? 1 : undefined });
  return {
    logins: (q) => list('logins', q),
    guests: (q) => list('guests', q),
    companies: (q) => list('companies', q),
    gst: (q) => list('gst', q),
    lookups: (q) => list('lookups', q),
    login: (id) => get(at('logins', id)),
    guest: (id) => get(at('guests', id)),
    company: (id) => get(at('companies', id)),
    gstRecord: (id) => get(at('gst', id)),
    lookup: (id) => get(at('lookups', id)),
    reveal: (input) => post(`${BASE}/reveal`, input),
    createLogin: (input) => post(at('logins'), input),
    updateLogin: (id, p) => patch(at('logins', id), p),
    deleteLogin: (id, input) => del(at('logins', id), input),
    createGuest: (input) => post(at('guests'), input),
    updateGuest: (id, p) => patch(at('guests', id), p),
    deleteGuest: (id, input) => del(at('guests', id), input),
    restoreGuest: (id) => post(at('guests', id, 'restore'), {}),
    createCompany: (input) => post(at('companies'), input),
    updateCompany: (id, p) => patch(at('companies', id), p),
    deleteCompany: (id, input) => del(at('companies', id), input),
    restoreCompany: (id) => post(at('companies', id, 'restore'), {}),
    createGst: (gstin) => post(at('gst'), { gstin }),
    refreshGst: (id) => post(at('gst', id, 'refresh'), {}),
    deleteGst: (id, input) => del(at('gst', id), input),
    restoreGst: (id) => post(at('gst', id, 'restore'), {}),
  };
}
