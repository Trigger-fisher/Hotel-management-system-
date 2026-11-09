// Shift Handover over /api/v1/handover (Pallav ShiftHandoverController): list with the numbers on top, one, new, edit (with the version the person
// saw), delete to the recycle bin (with the version), and the form's options. Same signatures as the mock's handover calls; the actor argument is
// ignored (the server reads the session). The printed handover is GET /handover/{id}/pdf (HANDOVER_PDF below).
import type { CashApi, HandoverInput, HandoverList, HandoverOptions, ShiftHandover } from '@shared/dashboards/cash';
import type { DashResult, ListQuery } from '@shared/dashboards/common';

import { del, get, patch, post } from '../client';
import { snapPageSize } from './payrollShared';

export type HandoverApi = Pick<CashApi, 'listHandovers' | 'getHandover' | 'createHandover' | 'updateHandover' | 'deleteHandover' | 'getHandoverOptions'>;

/** The real PDF of one handover (opened with openPdf). */
export const HANDOVER_PDF = (id: string) => `/api/v1/handover/${encodeURIComponent(id)}/pdf`;

const enc = encodeURIComponent;
const SORTS = ['at', 'entryNo', 'totalPaise'];

/** The body the server accepts (strict: an unknown key is a 422). */
const fields = (i: HandoverInput) => ({ shift: i.shift, handedToId: i.handedToId, counts: i.counts, notes: i.notes, instructions: i.instructions, stamp: i.stamp });

/** The version the person saw; when the caller has none (an old screen), the current one is read first. */
async function versionOf(id: string, known: number | undefined): Promise<DashResult<number>> {
  if (known !== undefined) return { ok: true, data: known };
  const cur = await get<ShiftHandover>(`/handover/${enc(id)}`);
  return cur.ok ? { ok: true, data: cur.data.version ?? 1 } : cur;
}

export function createHttpHandoverApi(): HandoverApi {
  return {
    listHandovers: (q: ListQuery = {}) =>
      get<HandoverList>('/handover', {
        search: q.search?.trim() || undefined,
        from: q.from,
        to: q.to,
        sort: q.sort && SORTS.includes(q.sort) ? q.sort : undefined,
        dir: q.dir,
        page: q.page,
        pageSize: snapPageSize(q.pageSize),
      }),
    getHandover: (id: string) => get<ShiftHandover>(`/handover/${enc(id)}`),
    createHandover: (input: HandoverInput) => post<ShiftHandover>('/handover', fields(input)),
    updateHandover: async (id: string, input: HandoverInput) => {
      const v = await versionOf(id, input.version);
      return v.ok ? patch<ShiftHandover>(`/handover/${enc(id)}`, { ...fields(input), version: v.data }) : v;
    },
    deleteHandover: async (id: string, _actor, version?: number) => {
      const v = await versionOf(id, version);
      return v.ok ? del<{ id: string }>(`/handover/${enc(id)}`, { version: v.data }) : v;
    },
    getHandoverOptions: () => get<HandoverOptions>('/handover/options'),
  };
}
