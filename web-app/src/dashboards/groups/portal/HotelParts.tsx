'use client';

// Pieces of the "All hotels" view that the Company portal's lists share: the Hotel filter chips above a list and the small note for a partial answer
// (some linked hotels could not be reached: never an error, the rest of the list is shown). The chips set the same one choice as the sidebar selector.
import { PORTAL_ALL_HOTELS, portalHotelStore } from '@shared/dashboards/portalHotel';
import { portalHotelCopyByLanguage } from '@shared/dashboards/portalHotel.lang';
import type { PortalUnavailableHotel } from '@shared/dashboards/portalHotels';

import { useAsync } from '@/components/ui';
import { Bi, FilterMenu, ListTabs } from '@/dashboards/pallav/ui';
import { corporateApi } from '../corporate/api';
import { guestApi } from '../guest/api';
import { usePortalHotel } from './HotelSwitch';
import { useCopy, tr } from '@/lib/i18n/language';

/** "All hotels" and one chip per linked hotel; nothing when the login is linked to fewer than two hotels. */
export function HotelChips({ kind = 'corporate' }: { kind?: 'corporate' | 'guest' }) {
  return <HotelPills hotels={useLinkedHotels(kind)} />;
}

/** `HotelChips` for a list that already read the hotels (`useLinkedHotels`). */
export function HotelPills({ hotels }: { hotels: { hotelId: string; name: string }[] }) {
  const portalHotelCopy = useCopy(portalHotelCopyByLanguage);
  const choice = usePortalHotel();
  if (hotels.length < 2) return null;
  return (
    <ListTabs
      label={portalHotelCopy.filter}
      look="pills"
      className="mb-3"
      active={choice}
      onChange={(id) => portalHotelStore.set(id)}
      tabs={[{ id: PORTAL_ALL_HOTELS, label: portalHotelCopy.all }, ...hotels.map((h) => ({ id: h.hotelId, label: h.name }))]}
    />
  );
}

/** The same choice as `HotelChips`, as the hotel pages' "Narrow down" menu (desktop parity: goes inside a `FilterBar`); nothing under two hotels. */
export function HotelFilter({ hotels }: { hotels: { hotelId: string; name: string }[] }) {
  const portalHotelCopy = useCopy(portalHotelCopyByLanguage);
  const choice = usePortalHotel();
  if (hotels.length < 2) return null;
  return (
    <FilterMenu
      label={tr("Hotel")}
      icon="building"
      any={portalHotelCopy.all}
      ariaLabel={portalHotelCopy.filter}
      value={choice === PORTAL_ALL_HOTELS ? '' : choice}
      options={hotels.map((h) => ({ value: h.hotelId, label: h.name }))}
      onChange={(v) => portalHotelStore.set(v || PORTAL_ALL_HOTELS)}
    />
  );
}

/** The hotels the login is linked to (empty while the list loads), for `HotelFilter`: a list draws its filter bar only when there is something to narrow. */
export function useLinkedHotels(kind: 'corporate' | 'guest' = 'corporate'): { hotelId: string; name: string }[] {
  const list = useAsync(() => (kind === 'guest' ? guestApi.listHotels() : corporateApi.listHotels()), [kind]);
  return list.state.status === 'ready' ? list.state.data : [];
}

/** A partial answer: "1 hotel could not be reached" with the names, as a quiet note. */
export function UnavailableNote({ hotels }: { hotels: PortalUnavailableHotel[] | undefined }) {
  const portalHotelCopy = useCopy(portalHotelCopyByLanguage);
  if (!hotels || hotels.length === 0) return null;
  return (
    <div className="alert alert-warning d-flex align-items-start gap-2 py-2 small" role="status" data-testid="hotels-unavailable">
      <Bi name="info-circle" className="mt-1" />
      <span>
        <strong>{portalHotelCopy.unavailableTitle(hotels.length)}.</strong> {portalHotelCopy.unavailableBody(hotels.map((h) => h.hotelName))}
      </span>
    </div>
  );
}