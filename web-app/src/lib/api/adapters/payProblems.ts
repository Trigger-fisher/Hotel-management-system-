// Problems with online payments over the real server (docs: services/razorpay/disputeService.ts). Same TypeScript interfaces as payProblems.mock.ts. The guest and the company
// portals share one shape; the portal's hotel choice picks the hotel ("All hotels" shows the first linked hotel: a problem is always about one hotel's payment).
import type { DisputesApi, PayProblemsApi } from '@shared/dashboards/payProblems';
import { hotelParam } from '@shared/dashboards/portalHotel';

import * as api from '../client';

const one = (hotel?: string): string | undefined => {
  const h = hotel ?? hotelParam();
  return h === undefined || h === '' || h === 'all' ? undefined : h;
};

export function createHttpPayProblemsApi(base: '/guest' | '/corporate'): PayProblemsApi {
  return {
    listPayments: (q) => api.get(`${base}/razorpay/payments`, { hotel: one(q.hotel), status: q.status, page: q.page }),
    listProblems: (q) => api.get(`${base}/razorpay/problems`, { hotel: one(q.hotel), status: q.status, paymentId: q.paymentId, page: q.page }),
    raise: (input) => api.post(`${base}/razorpay/problems`, { ...input, hotel: one(input.hotel) }),
    withdraw: (id, hotel) => api.post(`${base}/razorpay/problems/${encodeURIComponent(id)}/withdraw`, undefined, { query: { hotel: one(hotel) } }),
  };
}

export function createHttpDisputesApi(): DisputesApi {
  return {
    list: (q) => api.get('/admin/razorpay/disputes', { status: q.status, paymentId: q.paymentId, page: q.page }),
    respond: (id, input) => api.post(`/admin/razorpay/disputes/${encodeURIComponent(id)}/respond`, input),
  };
}
