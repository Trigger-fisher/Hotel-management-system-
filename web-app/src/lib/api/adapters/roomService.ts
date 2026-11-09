// Room service with a status over the real server (docs/BACKEND.md "Room service"): the guest's orders (GET /guest/orders, POST /guest/orders/{id}/cancel, both with
// ?hotel=) and the hotel desk's queue (GET /front-office/room-service/orders, POST .../{id}/status and .../{id}/cancel, GET/PUT .../settings).
import type { RoomServiceApi } from '@shared/dashboards/roomService';
import { hotelParam } from '@shared/dashboards/portalHotel';

import * as api from '../client';
import { snapPageSize } from './payrollShared';

const id = encodeURIComponent;
const DESK = '/front-office/room-service';

export function createHttpRoomServiceApi(): RoomServiceApi {
  return {
    guest: {
      list: () => api.get('/guest/orders', { hotel: hotelParam() }),
      // the order's own hotel, whatever the sidebar shows
      cancel: (orderId: string, hotelId?: string) => api.post(`/guest/orders/${id(orderId)}/cancel`, undefined, { query: { hotel: hotelId ?? hotelParam() } }),
    },
    desk: {
      list: (q = {}) => api.get(`${DESK}/orders`, { status: q.status, source: q.source, search: q.search?.trim() || undefined, page: q.page, pageSize: snapPageSize(q.pageSize) }),
      pos: () => api.get(`${DESK}/pos`),
      place: (input) => api.post(`${DESK}/orders`, input),
      setStatus: (orderId, status) => api.post(`${DESK}/orders/${id(orderId)}/status`, { status }),
      cancel: (orderId, reason) => api.post(`${DESK}/orders/${id(orderId)}/cancel`, { reason }),
      settings: () => api.get(`${DESK}/settings`),
      saveSettings: (input) => api.put(`${DESK}/settings`, input),
    },
  } as RoomServiceApi;
}