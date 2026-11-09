'use client';

// One Guest API for the whole web session: the real /api/v1/guest server (lib/api/adapters/guest.ts) or the in-memory mock, so bills paid or
// orders placed stay changed on every guest screen (see lib/api/mode.ts).
// The mock keeps one store per signed-in guest: the demo guest (quick login "guest") gets Amit Joshi's stay, bills and history; anyone else
// (a guest who just made an account) gets their own name and an empty account, kept in the tab's sessionStorage so a reload does not
// lose it (mock only, see tabKeep). index.ts tells this module who is signed in. Each store is loaded through lib/api/mockLoader.ts.
import type { HmsUser } from '@shared/auth-pallav/types';
import { GUEST_TODAY, type GuestApi, type GuestKeep } from '@shared/dashboards/guest';
import type { GuestStage } from '@shared/dashboards/guestStage';

import { createHttpGuestApi } from '@/lib/api/adapters/guest';
import { mockSetGuestPassword, quickLoginAllowed } from '@/lib/auth/api';
import { lazyMock, loadMocks } from '@/lib/api/mockLoader';
import { chooseApi } from '@/lib/api/mode';

import { portalToday } from '../portal/today';

/** The demo guest of the mock sign-in (ui-shared/auth-pallav/mock.ts, username "guest"): the one account with the seeded data. */
const DEMO_GUEST_ID = 'u-guest';

let signedIn: HmsUser | null = null;
const stores = new Map<string, GuestApi>();

/** Called by every guest screen (index.ts) with its `user` prop, before any call is made. */
export function bindGuestUser(user: HmsUser): void {
  signedIn = user;
}

/** Mock only: whether the signed-in guest is the demo guest, the one with a stay going on. */
export const currentGuestIsDemo = (): boolean => !signedIn || signedIn.id === DEMO_GUEST_ID;

// ---- Decision 71: the demo guest's stage (mock only) ----
// The hotel's portal preview shows each stage (arriving, in stay, check-out day, checked out, no stay) on the demo guest's data. Real server: ignored.
let scenario: GuestStage = 'staying';

/** Mock only: the stage the demo guest is shown in. */
export const guestScenario = (): GuestStage => scenario;

/** Mock only: shows the demo guest in another stage; every guest screen reloads its data (the `gg:refresh` event, kit/refresh.ts). */
export function setGuestScenario(next: GuestStage): void {
  if (next === scenario) return;
  scenario = next;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('gg:refresh'));
}

/** Mock only: whether the demo guest is in house in the current stage (room service, live orders, the order info). */
export const guestMockInHouse = (): boolean => currentGuestIsDemo() && (scenario === 'staying' || scenario === 'checkoutDay');

/** The hotel's portal preview runs the guest screens as the demo guest (its sample data), whoever is signed in to the hotel. Mock only. */
export const asDemoGuest = (user: HmsUser): HmsUser => ({ ...user, id: DEMO_GUEST_ID, displayName: 'Amit Joshi', username: 'guest' });

const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/**
 * A registered guest's store survives a page reload (mock only, same gate as the mock sign-in that keeps their account): it is saved in
 * this tab's sessionStorage. Every access is guarded: blocked or missing storage just means the store starts empty again.
 */
function tabKeep(userId: string): GuestKeep | undefined {
  if (!quickLoginAllowed()) return undefined;
  const key = `hms-mock-guest-store:${userId}`;
  return {
    load: () => {
      try {
        const raw = sessionStorage.getItem(key);
        return raw ? (JSON.parse(raw) as unknown) : null;
      } catch {
        return null;
      }
    },
    save: (snapshot) => {
      try {
        sessionStorage.setItem(key, JSON.stringify(snapshot));
      } catch {
        // private window, storage full or blocked: kept for this page only
      }
    },
  };
}

function store(): GuestApi {
  const u = signedIn;
  const key = u?.id ?? DEMO_GUEST_ID;
  let api = stores.get(key);
  if (!api) {
    const keep = u && u.id !== DEMO_GUEST_ID ? tabKeep(u.id) : undefined;
    api = lazyMock(async () => {
      const { createGuestApi, withPortalDemo } = await loadMocks();
      return withPortalDemo(
        !u || u.id === DEMO_GUEST_ID
          ? createGuestApi({ offline }, undefined, undefined, { scenario: guestScenario })
          : createGuestApi({ offline }, { id: `g-${u.id}`, name: u.displayName, mobile: u.username ?? '', email: u.email ?? '' }, keep),
        'guest',
      );
    });
    stores.set(key, api);
  }
  return api;
}

/** The mock, routed to the signed-in guest's own store on every call. */
function createUserMock(): GuestApi {
  return {
    listHotels: () => store().listHotels(),
    getOverview: (q) => store().getOverview(q),
    listBills: (q) => store().listBills(q),
    getBill: (id, hotelId) => store().getBill(id, hotelId),
    payBills: (ids) => store().payBills(ids),
    emailBill: (id, hotelId) => store().emailBill(id, hotelId),
    listHistory: (q) => store().listHistory(q),
    getMenu: () => store().getMenu(),
    listScheduledOrders: () => store().listScheduledOrders(),
    placeOrder: (req) => store().placeOrder(req),
    getProfile: () => store().getProfile(),
    updateProfile: (input) => store().updateProfile(input),
    changePassword: async (input) => {
      const who = signedIn;
      const res = await store().changePassword(input);
      // a registered guest signs in with this password from now on (the mock sign-in keeps its own copy)
      if (res.ok && who && who.id !== DEMO_GUEST_ID && who.username) mockSetGuestPassword(who.username, input.next);
      return res;
    },
  };
}

export const guestApi = chooseApi(createHttpGuestApi, createUserMock);

/** The day bills turn overdue from, history says "Today" for, and room searches start at. */
export const guestToday = (): string => portalToday(GUEST_TODAY);
