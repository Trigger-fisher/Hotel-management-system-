'use client';

// The portals' hotel summaries (what is owed at each hotel, unread notices or open requests, the guest's room), for the shared selector. Real server or the mock;
// in a dev build `window.__portalFailing = ['h-2']` (or `?mockDown=h-2`) makes that hotel "unreachable" so the partial-answer note can be seen.
import type { GuestHotelsApi, PortalHotelsApi } from '@shared/dashboards/portalHotels';

import { createHttpGuestHotelsApi, createHttpPortalHotelsApi } from '@/lib/api/adapters/portalHotels';
import { lazyMock, loadMocks } from '@/lib/api/mockLoader';
import { chooseApi } from '@/lib/api/mode';

const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
const failing = () => (globalThis as { __portalFailing?: string[] }).__portalFailing ?? [];

export const portalHotelsApi: PortalHotelsApi = chooseApi(
  () => createHttpPortalHotelsApi(),
  () =>
    lazyMock(async () => {
      const m = await loadMocks();
      return { summary: () => m.createPortalHotelsMock({ offline }, { failing: failing() }).summary() };
    }),
);

export const guestHotelsApi: GuestHotelsApi = chooseApi(
  () => createHttpGuestHotelsApi(),
  () =>
    lazyMock(async () => {
      const m = await loadMocks();
      return {
        summary: async () => {
          const res = await m.createGuestHotelsMock({ offline }, { failing: failing() }).summary();
          // decision 71: the hotel's preview stages (arriving, checked out, no stay) have the demo guest in no room anywhere (the stage lives in the guest api)
          const { guestMockInHouse } = await import('../guest/api');
          if (!res.ok || guestMockInHouse()) return res;
          return { ...res, data: { ...res.data, hotels: res.data.hotels.map((h) => ({ ...h, inHouse: false, roomNumber: null, openRequests: 0 })) } };
        },
      };
    }),
);