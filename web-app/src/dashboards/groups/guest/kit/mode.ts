// Online paying follows the hotel's payment set-up (MJ, 5 Nov 2026), done by the Super Admin in the Set-up centre: the server says per hotel whether online
// payment is available (`onlinePayment` on GET /guest/hotels). Without the flag (the demo) the mock pays. Where no online payment is available each place
// says "₹X to pay at the front desk" with Call.
import type { GuestHotel } from '@shared/dashboards/guest';

import { apiMode } from '@/lib/api/mode';

import { pickHotel, useGuestHotels } from './hotels';

type WithPayFlag = GuestHotel & { onlinePayment?: boolean };

/** The server's flag when it sent one, else the demo rule (mock pays, real server does not). */
export const canPayOnline = (flag?: boolean | null): boolean => (typeof flag === 'boolean' ? flag : apiMode() === 'mock');

/** Whether the guest can pay this hotel online now (the only hotel when none is named). */
export function useCanPayOnline(hotelId?: string | null): boolean {
  const { hotels } = useGuestHotels();
  const hotel = pickHotel(hotels, hotelId) as WithPayFlag | undefined;
  return canPayOnline(hotel?.onlinePayment);
}
