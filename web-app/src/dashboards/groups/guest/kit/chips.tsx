'use client';

// Choosing on a guest page (decision 71): segments that switch between two menu pages (Bills | Payments), filter chips with counts, and the page's own hotel
// chips. Chips are local page state: they never write the address or the sidebar's hotel choice, so Home and Room service are never filtered behind the guest's back.
import type { ReactNode } from 'react';

import { PORTAL_ALL_HOTELS } from '@shared/dashboards/portalHotel';
import { portalHotelCopyByLanguage } from '@shared/dashboards/portalHotel.lang';
import { billsCopyByLanguage } from '@shared/dashboards/guestCopy/bills.lang';

import { SegTabs } from '@/dashboards/pallav/ui';

import { usePortalHotel } from '../../portal/HotelSwitch';
import { useGuestHotels } from './hotels';
import { useCopy, tr } from '@/lib/i18n/language';

export interface GgChipItem {
  id: string;
  label: ReactNode;
  /** A count after the label ("To pay 3"); leave out for none. */
  count?: number;
  /** coral count (something to pay). */
  tone?: 'warn';
}

/** A row of filter chips (one chosen), scrolling sideways on a narrow phone. */
export function GgChips({ items, value, onChange, label, className = '' }: { items: GgChipItem[]; value: string; onChange: (id: string) => void; label: string; className?: string }) {
  return (
    <div className={`gg-chips ${className}`.trim()} role="group" aria-label={label}>
      {items.map((it) => (
        // check-shared-ignore: a filter chip (aria-pressed toggle), the guest kit's own control
        <button key={it.id} type="button" className={`gg-chipbtn${value === it.id ? ' on' : ''}`} aria-pressed={value === it.id} onClick={() => onChange(it.id)}>
          <span>{it.label}</span>
          {it.count !== undefined ? <span className={`gg-chipcount${it.tone === 'warn' && it.count > 0 ? ' warn' : ''}`}>{it.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/**
 * The page's own hotel chips ("All hotels", then each hotel), shown only when the guest has two hotels or more. `value` is "all" or a hotel id: pass it as
 * `hotel` on that page's list calls (guestApi.listBills / listHistory). Start it with `useHotelChoice()`.
 */
export function GgHotelChips({ value, onChange }: { value: string; onChange: (hotel: string) => void }) {
  const portalHotelCopy = useCopy(portalHotelCopyByLanguage);
  const { hotels } = useGuestHotels();
  if (hotels.length < 2) return null;
  const items: GgChipItem[] = [{ id: PORTAL_ALL_HOTELS, label: portalHotelCopy.all }, ...hotels.map((h) => ({ id: h.hotelId, label: h.name }))];
  return <GgChips items={items} value={items.some((i) => i.id === value) ? value : PORTAL_ALL_HOTELS} onChange={onChange} label={portalHotelCopy.filter} className="gg-hotelchips" />;
}

/** The page's hotel: MJ, 26 Oct 2026, "the hotel is selected from the drop-down in the side menu only", so a page follows the side menu's choice and has no
 *  hotel chips of its own (GgHotelChips is no longer placed on any page). The setter is kept for the callers' shape and does nothing. */
const keepSidebar = (): void => undefined;
export function useHotelChoice(): [string, (hotel: string) => void] {
  return [usePortalHotel(), keepSidebar];
}

export interface GgSegmentItem {
  id: string;
  label: string;
  icon?: string;
}

/** Segments (the portal's segmented control): one chosen; `onSelect` usually navigates to another menu page. */
export function GgSegments({ items, active, onSelect, label }: { items: GgSegmentItem[]; active: string; onSelect: (id: string) => void; label: string }) {
  return (
    <div className="gg-segments">
      <SegTabs tabs={items} active={active} onChange={(id) => id !== active && onSelect(id)} label={label} />
    </div>
  );
}

/** Bills | Payments: the two money pages as one place. Switching is a menu move (the stack is replaced, no Back arrow). */
export function MoneySegments({ active, navigate }: { active: 'guest.bills' | 'guest.history'; navigate: (viewId: string) => void }) {
  const billsCopy = useCopy(billsCopyByLanguage);
  return (
    <GgSegments
      items={[
        { id: 'guest.bills', label: billsCopy.segments.bills },
        { id: 'guest.history', label: billsCopy.segments.payments },
      ]}
      active={active}
      onSelect={navigate}
      label={tr("Money")}
    />
  );
}
