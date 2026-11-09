// Online payments across the hotels of a group (MJ, 2 Nov 2026), for the Group Hotel Admin: GET /group/payments. Read only. The mock is groupPayments.mock.ts (loaded only through lib/api/mockLoader.ts).
import type { DashResult } from './common';

export interface GroupPaymentsHotel {
  hotelId: string;
  hotelName: string;
  todayPaise: number;
  monthPaise: number;
  failed: number;
  refundedPaise: number;
  /** Payments kept (hotel and restaurant together). */
  payments: number;
  /** Problems guests and companies raised that this hotel has not answered yet. */
  openProblems: number;
}

export interface GroupPaymentRow {
  hotelId: string;
  hotelName: string;
  paymentId: string;
  business: 'hotel' | 'food';
  status: string;
  method: string | null;
  amountPaise: number;
  amountRefundedPaise: number;
  description: string | null;
  at: string;
}

export interface GroupPaymentsOverview {
  hotels: GroupPaymentsHotel[];
  totals: { todayPaise: number; monthPaise: number; failed: number; refundedPaise: number; openProblems: number };
  recent: GroupPaymentRow[];
  /** A hotel that could not be read just now; the rest are shown. */
  unavailable: { hotelId: string; hotelName: string }[];
}

export interface GroupPaymentsApi {
  overview(): Promise<DashResult<GroupPaymentsOverview>>;
}

export const groupPaymentsCopy = {
  title: 'Online payments',
  sub: 'What came in at each hotel of your group, and the problems waiting for an answer. To refund or answer one, open that hotel.',
  tiles: { today: 'Collected today', month: 'This month', failed: 'Failed', problems: 'Problems waiting' },
  hotelsTitle: 'Hotels',
  recentTitle: 'Newest payments',
  openHotel: 'Open hotel',
  noHotels: { title: 'No hotels yet', text: 'The hotels of your group show here once they take online payments.' },
  noPayments: { title: 'No online payments yet', text: 'Payments taken at your hotels show here.' },
  unavailable: (names: string[]) => `${names.join(', ')} could not be read just now. The others are shown.`,
  payStatus: { captured: 'Paid', authorized: 'Waiting', failed: 'Failed', refunded: 'Refunded', created: 'Started' } as Record<string, string>,
} as const;