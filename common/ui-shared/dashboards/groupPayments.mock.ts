// In-memory mock of the group payments page (groupPayments.ts): the open hotels of the demo group (platform.mock.ts g-1, Sunrise Group); dev and the local demo build only.
import { mockCall, ok, type MockClock } from './common';
import type { GroupPaymentRow, GroupPaymentsApi, GroupPaymentsHotel } from './groupPayments';

const iso = (hoursAgo: number): string => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();

export function createGroupPaymentsMock(clock: MockClock = {}): GroupPaymentsApi {
  const hotels: GroupPaymentsHotel[] = [
    { hotelId: 'h-2', hotelName: 'Sunrise Residency', todayPaise: 1_250_000, monthPaise: 9_840_000, failed: 2, refundedPaise: 420_000, payments: 41, openProblems: 2 },
    { hotelId: 'h-5', hotelName: 'Harbour Court', todayPaise: 184_000, monthPaise: 664_000, failed: 1, refundedPaise: 0, payments: 3, openProblems: 1 },
  ];
  const recent: GroupPaymentRow[] = [
    { hotelId: 'h-2', hotelName: 'Sunrise Residency', paymentId: 'pay_Rg41kT07mVc2Ha', business: 'hotel', status: 'captured', method: 'upi', amountPaise: 1_250_000, amountRefundedPaise: 0, description: 'Advance for booking', at: iso(1) },
    { hotelId: 'h-5', hotelName: 'Harbour Court', paymentId: 'pay_Rg42nW18pXd3Jb', business: 'food', status: 'captured', method: 'card', amountPaise: 184_000, amountRefundedPaise: 0, description: 'Room service', at: iso(3) },
    { hotelId: 'h-5', hotelName: 'Harbour Court', paymentId: 'pay_Rg43qY29rZe4Kc', business: 'hotel', status: 'failed', method: 'upi', amountPaise: 300_000, amountRefundedPaise: 0, description: 'Bill payment', at: iso(5) },
    { hotelId: 'h-2', hotelName: 'Sunrise Residency', paymentId: 'pay_Rg44sA30tBf5Ld', business: 'hotel', status: 'refunded', method: 'card', amountPaise: 120_000, amountRefundedPaise: 120_000, description: 'Cancelled stay', at: iso(26) },
  ];
  const totals = { todayPaise: hotels.reduce((n, h) => n + h.todayPaise, 0), monthPaise: hotels.reduce((n, h) => n + h.monthPaise, 0), failed: hotels.reduce((n, h) => n + h.failed, 0), refundedPaise: hotels.reduce((n, h) => n + h.refundedPaise, 0), openProblems: hotels.reduce((n, h) => n + h.openProblems, 0) };
  return { overview: () => mockCall(() => ok({ hotels: structuredClone(hotels), totals, recent: structuredClone(recent), unavailable: [] }), clock) };
}
