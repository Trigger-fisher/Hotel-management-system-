// Problems with online payments (MJ, 2 Nov 2026): a guest or a company raises a dispute, asks for a refund or asks a question about ONE of its own online payments (Razorpay);
// the hotel it was raised at answers. Contract: GET /guest|corporate/razorpay/payments, GET and POST /guest|corporate/razorpay/problems, POST .../problems/:id/withdraw, and for the
// hotel GET /admin/razorpay/disputes, POST /admin/razorpay/disputes/:id/respond. The mock is payProblems.mock.ts (loaded only through lib/api/mockLoader.ts).
import type { DashResult, Page } from './common';

export type ProblemKind = 'dispute' | 'refund_request' | 'question';
export type ProblemStatus = 'open' | 'answered' | 'closed' | 'withdrawn';
export type PayBusiness = 'hotel' | 'food';

/** One of the login's own online payments: the money and the state, never the Razorpay body or its fee. */
export interface MyPayment {
  paymentId: string;
  business: PayBusiness;
  /** Razorpay's word: created, authorized, captured, failed, refunded. */
  status: string;
  method: string | null;
  amountPaise: number;
  amountRefundedPaise: number;
  description: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface Problem {
  id: string;
  number: string;
  business: PayBusiness;
  paymentId: string;
  kind: ProblemKind;
  status: ProblemStatus;
  title: string;
  message: string;
  amountPaise: number | null;
  reply: string | null;
  repliedAt: string | null;
  repliedByName: string | null;
  createdAt: string;
}

export interface RaiseInput {
  hotel?: string;
  business: PayBusiness;
  paymentId: string;
  kind: ProblemKind;
  title: string;
  message: string;
  amountPaise?: number | null;
}

/** The guest's and the company's side: their own payments and their own problems. */
export interface PayProblemsApi {
  listPayments(q: { hotel?: string; status?: string; page?: number }): Promise<DashResult<Page<MyPayment>>>;
  listProblems(q: { hotel?: string; status?: ProblemStatus | 'all'; paymentId?: string; page?: number }): Promise<DashResult<Page<Problem>>>;
  raise(input: RaiseInput): Promise<DashResult<Problem>>;
  withdraw(id: string, hotel?: string): Promise<DashResult<Problem>>;
}

/** Who made an online payment: each portal sees only its own payer's payments. */
export type PayProblemsPayer = 'guest' | 'company';

/** The demo's portal calls, the payer first (flat, so the lazily loaded demo store can forward them). */
export interface PayProblemsPortalMock {
  listPaymentsOf(payer: PayProblemsPayer, q: Parameters<PayProblemsApi['listPayments']>[0]): ReturnType<PayProblemsApi['listPayments']>;
  listProblemsOf(payer: PayProblemsPayer, q: Parameters<PayProblemsApi['listProblems']>[0]): ReturnType<PayProblemsApi['listProblems']>;
  raiseAs(payer: PayProblemsPayer, input: RaiseInput): ReturnType<PayProblemsApi['raise']>;
  withdrawAs(payer: PayProblemsPayer, id: string): ReturnType<PayProblemsApi['withdraw']>;
}

/** The hotel's side: the problems raised at this hotel, and the answer. */
export interface DisputesApi {
  list(q: { status?: ProblemStatus | 'all'; paymentId?: string; page?: number }): Promise<DashResult<Page<Problem> & { openCount: number }>>;
  respond(id: string, input: { status: 'answered' | 'closed'; reply?: string | null }): Promise<DashResult<Problem>>;
}

export const payProblemsCopy = {
  title: 'Online payments and support',
  sub: 'Your online payments, and a place to raise a problem with any of them. The hotel answers here.',
  paymentsTitle: 'Payments',
  problemsTitle: 'Problems',
  noPayments: { title: 'No online payments yet', text: 'A payment you make online shows here, with a way to raise a problem if something is wrong.' },
  noProblems: { title: 'No problems raised', text: 'If a payment looks wrong, raise it from the payment. The hotel answers on this page.' },
  raise: 'Raise a problem',
  raiseFor: (id: string) => `Payment ${id}`,
  kinds: { dispute: 'I do not recognise this charge', refund_request: 'I want a refund', question: 'I have a question' } as Record<ProblemKind, string>,
  kindShort: { dispute: 'Dispute', refund_request: 'Refund request', question: 'Question' } as Record<ProblemKind, string>,
  status: { open: 'Waiting for the hotel', answered: 'Answered', closed: 'Closed', withdrawn: 'Taken back' } as Record<ProblemStatus, string>,
  payStatus: { captured: 'Paid', authorized: 'Waiting', failed: 'Failed', refunded: 'Refunded', created: 'Started' } as Record<string, string>,
  partlyRefunded: 'Partly refunded',
  form: {
    kind: 'What is the problem?',
    title: 'In a few words',
    titleHint: 'Charged twice',
    message: 'Tell us what happened',
    amount: 'Amount in question (rupees, optional)',
    send: 'Send to the hotel',
    cancel: 'Cancel',
  },
  withdraw: 'Take it back',
  reply: (by: string | null) => (by ? `Answer from ${by}` : 'Answer from the hotel'),
  sent: 'Sent. The hotel will answer here.',
  withdrawn: 'Taken back.',
} as const;

export const payProblemsAdminCopy = {
  title: 'Disputes',
  sub: 'Problems guests and companies raised about their online payments at this hotel. Answer them here; a refund is made from the payment.',
  empty: { title: 'No disputes', text: 'When a guest or a company raises a problem with an online payment, it shows here.' },
  filters: [['open', 'Waiting'], ['answered', 'Answered'], ['closed', 'Closed'], ['all', 'All']] as [ProblemStatus | 'all', string][],
  answer: 'Answer',
  answerPlaceholder: 'Write the answer the guest will read',
  send: 'Send answer',
  closeOnly: 'Close without an answer',
  sentOk: 'Answer sent.',
  closedOk: 'Closed.',
} as const;
