// The in-memory mock of portalHotels.ts (dev and local-demo builds only): the company portal's three demo hotels with what the demo company owes each and has not read.
// Follows nothing in the sidebar (the summary is always the whole list: the selector shows every hotel). `failing` names hotels that are "unreachable", for the partial-answer state.
import type { DashResult, MockClock } from './common';
import { mockCall, ok } from './common';
import { mockUnreachableHotels } from './portalCursor.mock';
import type { GuestHotelsSummary, PortalHotelsSummary, PortalUnavailableHotel } from './portalHotels';

const HOTELS = [
  { hotelId: 'h-1', hotelName: 'Hotel Sunrise, Rajkot', phone: '0281 2456789', outstandingPaise: 4125000, openBills: 2, unreadNotifications: 2 },
  { hotelId: 'h-2', hotelName: 'Sunrise Residency, Surat', phone: '0261 2345678', outstandingPaise: 1980000, openBills: 2, unreadNotifications: 1 },
  { hotelId: 'h-3', hotelName: 'Lakeview Inn, Udaipur', phone: null, outstandingPaise: 1170000, openBills: 1, unreadNotifications: 0 },
];

export function createPortalHotelsMock(clock: MockClock = {}, options: { failing?: readonly string[] } = {}) {
  return {
    /** The selector's list with each hotel's balance and unread count. A hotel in `failing` is missing and named in `unavailable`. */
    summary(): Promise<DashResult<PortalHotelsSummary>> {
      return mockCall(() => {
        const down = new Set([...(options.failing ?? []), ...mockUnreachableHotels()]);
        const hotels = HOTELS.filter((h) => !down.has(h.hotelId)).map((h) => ({ hotelId: h.hotelId, name: h.hotelName, phone: h.phone, outstandingPaise: h.outstandingPaise, openBills: h.openBills, unreadNotifications: h.unreadNotifications }));
        const unavailable: PortalUnavailableHotel[] = HOTELS.filter((h) => down.has(h.hotelId)).map((h) => ({ hotelId: h.hotelId, hotelName: h.hotelName }));
        return ok({
          hotels,
          totals: { outstandingPaise: hotels.reduce((t, h) => t + h.outstandingPaise, 0), openBills: hotels.reduce((t, h) => t + h.openBills, 0), unreadNotifications: hotels.reduce((t, h) => t + h.unreadNotifications, 0) },
          unavailable,
        });
      }, clock);
    },

  };
}

/** The demo guest's hotels: the two of guest.mock.ts MOCK_HOTELS (decision 48), so the selector, the order chooser and guestApi.listHotels() agree. */
const GUEST_HOTELS = HOTELS.filter((h) => h.hotelId === 'h-1' || h.hotelId === 'h-2');

/** The guest portal's selector and app bar chip (`GET /guest/hotels/summary`): the demo guest's two hotels; it is staying at the first. */
export function createGuestHotelsMock(clock: MockClock = {}, options: { failing?: readonly string[] } = {}) {
  return {
    /** The guest portal's selector and app bar chip: the guest's two hotels; it is staying at the first. */
    summary(): Promise<DashResult<GuestHotelsSummary>> {
      return mockCall(() => {
        const down = new Set([...(options.failing ?? []), ...mockUnreachableHotels()]);
        const hotels = GUEST_HOTELS.filter((h) => !down.has(h.hotelId)).map((h, i) => ({ hotelId: h.hotelId, name: h.hotelName, phone: h.phone, outstandingPaise: Math.round(h.outstandingPaise / 10), openBills: h.openBills - 1, openRequests: i === 0 ? 1 : 0, inHouse: i === 0, roomNumber: i === 0 ? '204' : null }));
        const unavailable: PortalUnavailableHotel[] = GUEST_HOTELS.filter((h) => down.has(h.hotelId)).map((h) => ({ hotelId: h.hotelId, hotelName: h.hotelName }));
        return ok({ hotels, totals: { outstandingPaise: hotels.reduce((t, h) => t + h.outstandingPaise, 0), openBills: hotels.reduce((t, h) => t + h.openBills, 0), openRequests: hotels.reduce((t, h) => t + h.openRequests, 0) }, unavailable });
      }, clock);
    },
  };
}
