// The guest portal redesign over the real server (decision 52, docs/BACKEND.md section 18): the order page's info and the hotel's restaurant
// hours. Same TypeScript interfaces as guestPortal.mock.ts. (Add member was removed, decision 59.)
import type { GuestPortalApi, RestaurantApi, RestaurantHours } from '@shared/dashboards/guestPortal';
import { hotelParam } from '@shared/dashboards/portalHotel';

import * as api from '../client';

const BASE = '/guest';

export function createHttpGuestPortalApi(): GuestPortalApi {
  return {
    getOrderInfo: () => api.get(`${BASE}/order-info`, { hotel: hotelParam() }),
    // turning it off asks for the current password: not stored, so no idempotency key; a wrong password is a 401 that must not end the session
    setSignInCode: (enabled, password) =>
      api.dashMap<unknown, { signInCodeOn: boolean }>('PUT', '/auth/profile/sign-in-code', { body: enabled ? { enabled } : { enabled, password }, idempotent: false, keepSessionOn401: true }, () => ({ signInCodeOn: enabled })),
  };
}

export function createHttpRestaurantApi(): RestaurantApi {
  return {
    getHours: () => api.get(`/admin/restaurant-hours`),
    saveHours: (h: RestaurantHours) => api.put(`/admin/restaurant-hours`, { accepting: h.accepting, days: h.days.map((d) => ({ day: d.day, closed: d.closed, opens: d.opens, closes: d.closes })) }),
  };
}
