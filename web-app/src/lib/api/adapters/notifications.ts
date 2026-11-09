// Notifications over the real server: the hotel's /api/v1/companies/notifications and the company portal's /api/v1/corporate/notifications
// (docs/BACKEND.md "Notifications"). Same TypeScript interfaces as the mocks (createNotificationsMock, createPortalNotificationsMock); the server's DTOs are the ui-shared types.
import type { NotificationsApi, PortalNotificationsApi } from '@shared/dashboards/notifications';
import { hotelParam } from '@shared/dashboards/portalHotel';

import * as api from '../client';
import { snapPageSize } from './payrollShared';

const id = encodeURIComponent;
const HOTEL = '/companies/notifications';
const PORTAL = '/corporate/notifications';
/** The portal's page sizes are 10, 25 or 50 (the server refuses another one). */
const portalPageSize = (n: number | undefined): number | undefined => (n === undefined ? undefined : n <= 10 ? 10 : n <= 25 ? 25 : 50);

export function createHttpNotificationsApi(): NotificationsApi {
  return {
    list: (q = {}) => api.get(HOTEL, { search: q.search?.trim() || undefined, status: q.status, page: q.page, pageSize: snapPageSize(q.pageSize) }),
    get: (nid) => api.get(`${HOTEL}/${id(nid)}`),
    send: (input) => api.post(HOTEL, input),
    withdraw: (nid) => api.post(`${HOTEL}/${id(nid)}/withdraw`),
  };
}

/** The sidebar's hotel choice rides on every portal call as `?hotel=` (left out for "all"). */
export function createHttpPortalNotificationsApi(): PortalNotificationsApi {
  return {
    list: (q = {}) => api.get(PORTAL, { unread: q.unread ? 'true' : undefined, read: q.read ? 'true' : undefined, search: q.search?.trim() || undefined, hotel: q.hotel ?? hotelParam(), ...(q.limit ? { limit: q.limit, cursor: q.cursor } : { page: q.page, pageSize: portalPageSize(q.pageSize) }) }),
    unreadCount: () => api.get(`${PORTAL}/unread-count`, { hotel: hotelParam() }),
    markRead: (nid) => api.post(`${PORTAL}/${id(nid)}/read`),
    markAllRead: () => api.post(`${PORTAL}/read-all`, undefined, { query: { hotel: hotelParam() } }),
  };
}