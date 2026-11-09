// In-memory mock of problems with online payments (payProblems.ts): one shared store, so a problem a guest or a company raises is what the hotel's Disputes tab shows,
// and the hotel's answer is what they read. Each payment belongs to one payer: the guest portal sees only the guest's payments and problems, the company portal only
// the company's (as the server does). Seeded with a few payments; dev and the local demo build only.
import { mockCall, mockError, ok, type MockClock } from './common';
import type { DisputesApi, MyPayment, PayProblemsApi, PayProblemsPayer, PayProblemsPortalMock, Problem, ProblemStatus, RaiseInput } from './payProblems';

const iso = (daysAgo: number): string => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

export interface PayProblemsStore {
  payments: (MyPayment & { payer: PayProblemsPayer })[];
  problems: Problem[];
}

export function seedPayProblems(): PayProblemsStore {
  return {
    payments: [
      { payer: 'guest', paymentId: 'pay_Qx81aL02kPd9Zt', business: 'hotel', status: 'captured', method: 'upi', amountPaise: 1250000, amountRefundedPaise: 0, description: 'Advance for booking', paidAt: iso(3), createdAt: iso(3) },
      { payer: 'guest', paymentId: 'pay_Qx82bM13lQe0Au', business: 'food', status: 'captured', method: 'card', amountPaise: 184000, amountRefundedPaise: 50000, description: 'Room service', paidAt: iso(1), createdAt: iso(1) },
      { payer: 'guest', paymentId: 'pay_Qx83cN24mRf1Bv', business: 'hotel', status: 'failed', method: 'upi', amountPaise: 300000, amountRefundedPaise: 0, description: 'Bill payment', paidAt: null, createdAt: iso(5) },
      { payer: 'company', paymentId: 'pay_Qx84dP35nSg2Cw', business: 'hotel', status: 'captured', method: 'upi', amountPaise: 200000, amountRefundedPaise: 0, description: 'Advance for bill HS-2102', paidAt: iso(4), createdAt: iso(4) },
      { payer: 'company', paymentId: 'pay_Qx85eQ46oTh3Dx', business: 'hotel', status: 'failed', method: 'netbanking', amountPaise: 1440000, amountRefundedPaise: 0, description: 'Bill HS-2078', paidAt: null, createdAt: iso(2) },
    ],
    problems: [],
  };
}

const PAGE = 25;
const slice = <T>(all: T[], page = 1) => ({ items: all.slice((page - 1) * PAGE, page * PAGE), total: all.length, page, pageSize: PAGE });
const view = ({ payer: _payer, ...p }: PayProblemsStore['payments'][number]): MyPayment => ({ ...p });

/** The portal side of the mock for one payer: only that payer's payments, and the problems raised on them. */
function portalFor(clock: MockClock, shared: PayProblemsStore, payer: PayProblemsPayer): PayProblemsApi {
  const mine = () => shared.payments.filter((p) => p.payer === payer);
  const isMine = (problem: Problem) => mine().some((p) => p.paymentId === problem.paymentId && p.business === problem.business);
  return {
    listPayments: (q) => mockCall(() => ok(slice(mine().filter((p) => !q.status || p.status === q.status).map(view), q.page)), clock),
    listProblems: (q) => mockCall(() => ok(slice(shared.problems.filter((p) => isMine(p) && (!q.status || q.status === 'all' || p.status === q.status) && (!q.paymentId || p.paymentId === q.paymentId)), q.page)), clock),
    raise: (input: RaiseInput) =>
      mockCall(() => {
        const payment = mine().find((p) => p.paymentId === input.paymentId && p.business === input.business);
        if (!payment) return mockError('NOT_FOUND');
        if (input.title.trim().length < 3) return mockError('VALIDATION_FAILED', { title: 'A short title is needed.' });
        if (input.message.trim().length < 5) return mockError('VALIDATION_FAILED', { message: 'Please tell us what went wrong.' });
        if (payment.status === 'created') return mockError('CONFLICT', undefined, { message: 'That payment has not been taken yet, so there is nothing to raise.' });
        if (shared.problems.filter((p) => p.paymentId === payment.paymentId && p.status === 'open').length >= 3) return mockError('CONFLICT', undefined, { message: 'There are already open problems on this payment. Please wait for the hotel\'s answer.' });
        const left = payment.amountPaise - payment.amountRefundedPaise;
        if (input.amountPaise != null && input.amountPaise > left) return mockError('VALIDATION_FAILED', { amountPaise: 'That is more than is left on this payment.' });
        const created: Problem = {
          id: `rd-${shared.problems.length + 1}`,
          number: `RD-${String(shared.problems.length + 1).padStart(8, '0')}`,
          business: payment.business,
          paymentId: payment.paymentId,
          kind: input.kind,
          status: 'open',
          title: input.title.trim(),
          message: input.message.trim(),
          amountPaise: input.amountPaise ?? (input.kind === 'refund_request' ? left : null),
          reply: null,
          repliedAt: null,
          repliedByName: null,
          createdAt: new Date().toISOString(),
        };
        shared.problems.unshift(created);
        return ok(structuredClone(created));
      }, clock),
    withdraw: (id) =>
      mockCall(() => {
        const p = shared.problems.find((x) => x.id === id && isMine(x));
        if (!p) return mockError('NOT_FOUND');
        if (p.status !== 'open') return mockError('CONFLICT', undefined, { message: 'The hotel has already answered this, so it cannot be taken back.' });
        p.status = 'withdrawn';
        return ok(structuredClone(p));
      }, clock),
  };
}

export function createPayProblemsMock(clock: MockClock = {}, shared: PayProblemsStore = seedPayProblems()): DisputesApi & PayProblemsPortalMock & { state: PayProblemsStore } {
  const portals = { guest: portalFor(clock, shared, 'guest'), company: portalFor(clock, shared, 'company') };
  return {
    state: shared,
    listPaymentsOf: (payer, q) => portals[payer].listPayments(q),
    listProblemsOf: (payer, q) => portals[payer].listProblems(q),
    raiseAs: (payer, input) => portals[payer].raise(input),
    withdrawAs: (payer, id) => portals[payer].withdraw(id),
    list: (q) =>
      mockCall(() => {
        const status = (q.status ?? 'open') as ProblemStatus | 'all';
        const found = shared.problems.filter((p) => (status === 'all' || p.status === status) && (!q.paymentId || p.paymentId === q.paymentId));
        return ok({ ...slice(found, q.page), openCount: shared.problems.filter((p) => p.status === 'open').length });
      }, clock),
    respond: (id, input) =>
      mockCall(() => {
        const p = shared.problems.find((x) => x.id === id);
        if (!p) return mockError('NOT_FOUND');
        if (p.status === 'closed' || p.status === 'withdrawn') return mockError('CONFLICT', undefined, { message: `This problem is ${p.status}.` });
        const reply = (input.reply ?? '').trim();
        if (input.status === 'answered' && reply.length < 2) return mockError('VALIDATION_FAILED', { reply: 'Write the answer the guest will read.' });
        p.status = input.status;
        if (reply) p.reply = reply;
        p.repliedAt = new Date().toISOString();
        p.repliedByName = 'Front desk';
        return ok(structuredClone(p));
      }, clock),
  };
}
