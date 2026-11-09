'use client';

// The guest portal redesign's calls (order info and the sign-in code setting) and the hotel's restaurant hours: the real server or the mock (lib/api/mode.ts).
// The mock says "not staying" for any guest who is not the demo guest (a new account has no stay), and for the demo guest outside a stay (decision 71 stages).
import type { GuestPortalApi, RestaurantApi } from '@shared/dashboards/guestPortal';

import { createHttpGuestPortalApi, createHttpRestaurantApi } from '@/lib/api/adapters/guestPortal';
import { lazyMock, loadMocks } from '@/lib/api/mockLoader';
import { chooseApi } from '@/lib/api/mode';

import { guestMockInHouse } from './api';

let portal: GuestPortalApi | null = null;
let portalFor: boolean | null = null;

function portalMock(): GuestPortalApi {
  // the demo guest in a stage with a stay going on (decision 71: the preview's stage switcher)
  const staying = guestMockInHouse();
  if (!portal || portalFor !== staying) {
    portalFor = staying;
    portal = lazyMock(async () => (await loadMocks()).createGuestPortalMock({ staying }));
  }
  return portal;
}

export const guestPortalApi = chooseApi(createHttpGuestPortalApi, (): GuestPortalApi => ({
  getOrderInfo: () => portalMock().getOrderInfo(),
  setSignInCode: (e, pw) => portalMock().setSignInCode(e, pw),
}));

export const restaurantApi = chooseApi(createHttpRestaurantApi, (): RestaurantApi => {
  const m = lazyMock(async () => (await loadMocks()).createRestaurantMock());
  return { getHours: () => m.getHours(), saveHours: (h) => m.saveHours(h) };
});
