// "All hotels" in the company portal (MJ, 18 Oct 2026, docs/plans/PORTAL-ALL-HOTELS-PLAN-2026-10-18.md; contract in docs/BACKEND.md "All hotels"). A login linked to several hotels reads
// them together with `?hotel=all` (the default) or one with `?hotel=<hotelId>`. The server reads each hotel in its own session, at most 25 hotels, 4 at a time, 10 seconds a hotel.
// A hotel that fails or runs late is left out of the answer and named in `unavailable` (its id and name, nothing else): show "Some hotels could not be reached" and the names.
// If NO hotel can be reached the call is 503 NETWORK_OFFLINE. Rows keep their flat `hotelId` / `hotelName`. Lists can be read with a cursor (below).
import type { createGuestHotelsMock, createPortalHotelsMock } from './portalHotels.mock';

/** The most linked hotels one call reads, how many at a time, and the seconds one hotel may take (the server's limits, for the screens' copy). */
export const PORTAL_MAX_HOTELS = 25;

/** A linked hotel that is missing from an answer. */
export interface PortalUnavailableHotel {
  hotelId: string;
  hotelName: string;
}

/** The sizes a cursor list accepts. */
export const PORTAL_CURSOR_LIMITS = [10, 25, 50, 100] as const;
export type PortalCursorLimit = (typeof PORTAL_CURSOR_LIMITS)[number];

/**
 * Cursor paging for the lists (due bills, payment history, ledger, notifications). Send `limit` (10, 25, 50 or 100) to read a list by cursor: the first request has no `cursor`; each
 * answer carries `nextCursor` (null on the last page), which is sent back as `cursor` with the SAME hotel, search and period. A cursor belongs to one login and one list; a cursor
 * that was changed, belongs to someone else or is used with other filters is a 422 on `cursor` ("start again from the first page"). Without `limit` the old `page` / `pageSize` still work.
 * The order is stable: newest date first, then hotel, then id, so a row never repeats or goes missing between pages.
 */
export interface PortalCursorQuery {
  cursor?: string;
  limit?: PortalCursorLimit;
}

/** What every "All hotels" list answer adds. `total` is over the hotels that answered. */
export interface PortalPartial {
  nextCursor?: string | null;
  /** Linked hotels missing from this answer (failed, ran late, or past the 25th). Empty when all answered. */
  unavailable?: PortalUnavailableHotel[];
}

/** One linked hotel on the selector: what the company owes it and what it has not read. */
export interface PortalHotelSummary {
  hotelId: string;
  name: string;
  /** The number to call (hotel profile phone, else the website reception phone), or null. */
  phone: string | null;
  /** Open bills' balance at this hotel, in paise. */
  outstandingPaise: number;
  openBills: number;
  unreadNotifications: number;
}

/** `GET /corporate/hotels/summary`: the selector's numbers. `GET /corporate/hotels` stays the cheap list the sidebar loads on every page. */
export interface PortalHotelsSummary {
  hotels: PortalHotelSummary[];
  /** Over the hotels that answered. */
  totals: { outstandingPaise: number; openBills: number; unreadNotifications: number };
  unavailable: PortalUnavailableHotel[];
}

/** One linked hotel on the GUEST portal's selector and app bar chip. */
export interface GuestHotelSummary {
  hotelId: string;
  name: string;
  phone: string | null;
  /** Open bills' balance at this hotel, in paise. */
  outstandingPaise: number;
  openBills: number;
  /** Requests to this hotel's front desk still waiting (only during a stay). */
  openRequests: number;
  /** Staying at this hotel now, and in which room. */
  inHouse: boolean;
  roomNumber: string | null;
}

/** `GET /guest/hotels/summary`: one call for the guest home screen and the chip. */
export interface GuestHotelsSummary {
  hotels: GuestHotelSummary[];
  totals: { outstandingPaise: number; openBills: number; openRequests: number };
  unavailable: PortalUnavailableHotel[];
}

/** The guest lists that take a cursor: GET /guest/bills and /guest/history (with `tab` and `search`, which the cursor is bound to). */
export type GuestCursorQuery = PortalCursorQuery;

export type PortalHotelsApi = ReturnType<typeof createPortalHotelsMock>;
export type GuestHotelsApi = ReturnType<typeof createGuestHotelsMock>;
