'use client';

// One api for problems with online payments, for the guest portal, the company portal and the hotel's Disputes tab: the real server or the mock (lib/api/mode.ts). The three share one
// mock store, so a problem raised in a portal is what the hotel's Disputes tab lists, and the hotel's answer is what the portal reads; each portal sees only its own payments.
import type { DisputesApi, PayProblemsApi, PayProblemsPayer, PayProblemsPortalMock } from '@shared/dashboards/payProblems';

import { createHttpDisputesApi, createHttpPayProblemsApi } from '@/lib/api/adapters/payProblems';
import { lazyMock, loadMocks } from '@/lib/api/mockLoader';
import { chooseApi } from '@/lib/api/mode';

type Mock = DisputesApi & PayProblemsPortalMock;
let mock: Mock | null = null;
const shared = (): Mock => (mock ??= lazyMock(async () => (await loadMocks()).createPayProblemsMock()));

const portalMock = (payer: PayProblemsPayer) => (): PayProblemsApi => ({
  listPayments: (q) => shared().listPaymentsOf(payer, q),
  listProblems: (q) => shared().listProblemsOf(payer, q),
  raise: (i) => shared().raiseAs(payer, i),
  withdraw: (id) => shared().withdrawAs(payer, id),
});

export const guestPayProblemsApi = chooseApi(() => createHttpPayProblemsApi('/guest'), portalMock('guest'));
export const corporatePayProblemsApi = chooseApi(() => createHttpPayProblemsApi('/corporate'), portalMock('company'));
export const disputesApi = chooseApi(createHttpDisputesApi, (): DisputesApi => ({ list: (q) => shared().list(q), respond: (id, i) => shared().respond(id, i) }));
