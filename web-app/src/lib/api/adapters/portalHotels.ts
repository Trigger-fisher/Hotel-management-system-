// The portals' hotel summaries over the real server: GET /api/v1/corporate/hotels/summary and GET /api/v1/guest/hotels/summary (the selector's numbers).
// The sidebar's cheap lists stay GET /corporate/hotels and /guest/hotels.
import type { GuestHotelsApi, PortalHotelsApi } from '@shared/dashboards/portalHotels';

import * as api from '../client';

export function createHttpPortalHotelsApi(): PortalHotelsApi {
  return {
    summary: () => api.get('/corporate/hotels/summary'),
  };
}

export function createHttpGuestHotelsApi(): GuestHotelsApi {
  return {
    summary: () => api.get('/guest/hotels/summary'),
  };
}