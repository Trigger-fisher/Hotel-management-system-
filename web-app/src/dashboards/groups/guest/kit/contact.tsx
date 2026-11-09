'use client';

// Calling the hotel (moved here from guest/parts.tsx, decision 71; parts.tsx re-exports them during the move): the reception phone of the hotel in question and
// the Call button. A phone that is not known draws nothing: never a made-up number.
import { PORTAL_ALL_HOTELS } from '@shared/dashboards/portalHotel';

import { PortalButton } from '@/dashboards/pallav/ui';

import { usePortalHotel } from '../../portal/HotelSwitch';
import { pickHotel, useGuestHotels } from './hotels';

/** The reception phone of the hotel in question: the hotel chosen in the sidebar, else `hotelId`, else the only hotel; null when it is not known. */
export function useReceptionPhone(hotelId?: string | null): string | null {
  const { state, hotels } = useGuestHotels();
  const chosen = usePortalHotel();
  if (state.status !== 'ready') return null;
  const hotel = pickHotel(hotels, chosen !== PORTAL_ALL_HOTELS ? chosen : hotelId);
  const phone = hotel?.phone?.trim();
  return phone ? phoneText(phone) : null;
}

/** An Indian number as the rest of the app writes it, "+91 98765 00001"; any other number as given. */
export function phoneText(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits.length === 11 && digits.startsWith('0') ? digits.slice(1) : digits;
  return local.length === 10 && /^[6-9]/.test(local) ? `+91 ${local.slice(0, 5)} ${local.slice(5)}` : phone;
}

/** "tel:" address of a phone as people write it. */
export const telHref = (phone: string): string => `tel:${phone.replace(/[^\d+]/g, '')}`;

/** A button that dials the hotel's reception (nothing when the phone is not known). `showNumber` adds " · +91 98765 00001" to the label. */
export function CallReception({ phone, label = 'Call reception', className, showNumber = true, variant = 'line' }: { phone: string | null; label?: string; className?: string; showNumber?: boolean; variant?: 'line' | 'solid' }) {
  if (!phone) return null;
  return (
    <PortalButton
      variant={variant}
      icon="telephone"
      className={className}
      onClick={() => {
        window.location.href = telHref(phone);
      }}
    >
      {showNumber ? `${label} · ${phone}` : label}
    </PortalButton>
  );
}
