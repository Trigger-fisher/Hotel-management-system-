// Daily Cash over /api/v1: Revenue (`/revenue/deposits`), Expenses (`/expense/entries`), `/cash/lookups` and Shift Handover (`/handover`, handover.ts).
// Same TypeScript interface as the mock (`createCashApi`); the actor argument is ignored (the server reads the session).
import type { CashApi, CashDeposit, CashExpense, CashList, CashLookups, DepositInput, DepositQuery, ExpenseInput, ExpenseQuery } from '@shared/dashboards/cash';

import { del, get, patch, post } from '../client';
import { createHttpHandoverApi, type HandoverApi } from './handover';

/** The list params the server accepts (anything else is a 422). `tab` has no meaning here. */
function listParams(q: DepositQuery | ExpenseQuery) {
  const book = q.book && q.book !== 'all' ? q.book : undefined;
  const kind = 'kind' in q && q.kind && q.kind !== 'all' ? q.kind : undefined;
  const deleted = 'deleted' in q && q.deleted === 'only' ? 'only' : undefined;
  return { book, kind, deleted, search: q.search?.trim() || undefined, from: q.from, to: q.to, sort: q.sort, dir: q.dir, page: q.page, pageSize: q.pageSize };
}

export function createHttpCashApi(handovers: HandoverApi = createHttpHandoverApi()): CashApi {
  return {
    getLookups: () => get<CashLookups>('/cash/lookups'),

    listDeposits: (q = {}) => get<CashList<CashDeposit>>('/revenue/deposits', listParams(q)),
    getDeposit: (id) => get<CashDeposit>(`/revenue/deposits/${id}`),
    createDeposit: (input: DepositInput) => post<CashDeposit>('/revenue/deposits', { ...input, version: undefined }),
    updateDeposit: (id, input: DepositInput) => patch<CashDeposit>(`/revenue/deposits/${id}`, input),
    deleteDeposit: (id, _actor, version) => del<{ id: string }>(`/revenue/deposits/${id}`, { version }),
    // The mock restores without a version; the server wants the one the person saw, so read it first.
    restoreDeposit: async (id) => {
      const cur = await get<CashDeposit>(`/revenue/deposits/${id}`);
      return cur.ok ? post<CashDeposit>(`/revenue/deposits/${id}/restore`, { version: cur.data.version }) : cur;
    },
    purgeDeposit: (id) => del<{ id: string }>(`/revenue/deposits/${id}/purge`),

    listExpenses: (q = {}) => get<CashList<CashExpense>>('/expense/entries', listParams(q)),
    getExpense: (id) => get<CashExpense>(`/expense/entries/${id}`),
    createExpense: (input: ExpenseInput) => post<CashExpense>('/expense/entries', { ...input, version: undefined }),
    updateExpense: (id, input: ExpenseInput) => patch<CashExpense>(`/expense/entries/${id}`, input),
    deleteExpense: (id, _actor, version) => del<{ id: string }>(`/expense/entries/${id}`, { version }),

    ...handovers,
  };
}
