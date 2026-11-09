'use client';

// The hotels the guest login is linked to (GET /guest/hotels), for the kit: the hotel chips, the reception phone, the hotel card's slug (D4) and the shell's
// "show the sidebar selector only with two hotels" rule. A plain read per caller: the real server's GET memory (lib/api/getCache.ts) shares one request.
import type { GuestHotel } from '@shared/dashboards/guest';
import { PORTAL_ALL_HOTELS } from '@shared/dashboards/portalHotel';

import { useAsync } from '@/components/ui';
import type { AsyncState } from '@/components/ui/useAsync';

import { guestApi } from '../api';

const NONE = Promise.resolve({ ok: true as const, data: [] as GuestHotel[] });

/** The linked hotels (state + reload). `enabled` false reads nothing (another role's shell). */
export function useGuestHotels(enabled = true): { state: AsyncState<GuestHotel[]>; reload: () => void; hotels: GuestHotel[] } {
  const { state, reload } = useAsync(() => (enabled ? guestApi.listHotels() : NONE), [enabled]);
  return { state, reload, hotels: state.status === 'ready' ? state.data : [] };
}

/** How many hotels the guest is linked to (0 while loading or on an error). */
export function useGuestHotelCount(enabled: boolean): number {
  return useGuestHotels(enabled).hotels.length;
}

/** The hotel in question: `hotelId` when given and linked, else the only hotel; undefined when it is not known. */
export function pickHotel(hotels: readonly GuestHotel[], hotelId?: string | null): GuestHotel | undefined {
  const want = hotelId && hotelId !== PORTAL_ALL_HOTELS ? hotelId : undefined;
  return (want ? hotels.find((h) => h.hotelId === want) : undefined) ?? (hotels.length === 1 ? hotels[0] : undefined);
}
