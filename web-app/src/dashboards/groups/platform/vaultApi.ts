'use client';

// The hotel vault's calls (platform 0168): the real server answers /api/v1/platform/hotels/{id}/vault; the mock keeps items in this tab only (a demo, nothing locked).
import type { DashResult } from '@shared/dashboards/common';
import type { VaultInput, VaultItem, VaultSecret } from '@shared/dashboards/vault';

import * as client from '@/lib/api/client';
import { chooseApi } from '@/lib/api/mode';
import { demoRecheckRefusal, demoRechecked } from './recheckApi';

export interface VaultApi {
  list(hotelId: string): Promise<DashResult<VaultItem[]>>;
  add(hotelId: string, input: VaultInput): Promise<DashResult<VaultItem>>;
  change(hotelId: string, id: string, input: VaultInput): Promise<DashResult<VaultItem>>;
  remove(hotelId: string, id: string): Promise<DashResult<{ id: string }>>;
  reveal(hotelId: string, id: string): Promise<DashResult<VaultSecret>>;
}

const base = (hotelId: string) => `/platform/hotels/${encodeURIComponent(hotelId)}/vault`;

function mockVault(): VaultApi {
  const items = new Map<string, { hotelId: string; item: VaultItem; secret: VaultSecret }>();
  const ok = <T>(data: T): DashResult<T> => ({ ok: true, data });
  const missing = <T>(): DashResult<T> => ({ ok: false, error: { code: 'NOT_FOUND', message: 'Not found', traceId: 'mock' } });
  const put = (hotelId: string, id: string, input: VaultInput, before?: VaultSecret): VaultItem => {
    const secret = { secret: input.secret === undefined ? (before?.secret ?? null) : input.secret || null, notes: input.notes === undefined ? (before?.notes ?? null) : input.notes || null };
    const item: VaultItem = {
      id, kind: input.kind, title: input.title.trim(), username: input.username?.trim() || null, url: input.url?.trim() || null, hasSecret: secret.secret !== null, hasNotes: secret.notes !== null,
      expiresOn: input.expiresOn || null, updatedAt: new Date().toISOString(), updatedBy: 'You',
    };
    items.set(id, { hotelId, item, secret });
    return item;
  };
  return {
    async list(hotelId) {
      return ok([...items.values()].filter((x) => x.hotelId === hotelId).map((x) => x.item).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    },
    async add(hotelId, input) {
      return ok(put(hotelId, `mock-${Date.now()}-${items.size}`, input));
    },
    async change(hotelId, id, input) {
      const x = items.get(id);
      return x && x.hotelId === hotelId ? ok(put(hotelId, id, input, x.secret)) : missing();
    },
    async remove(hotelId, id) {
      const x = items.get(id);
      if (!x || x.hotelId !== hotelId) return missing();
      items.delete(id);
      return ok({ id });
    },
    async reveal(hotelId, id) {
      if (!demoRechecked()) return demoRecheckRefusal();
      const x = items.get(id);
      return x && x.hotelId === hotelId ? ok(x.secret) : missing();
    },
  };
}

export const vaultApi: VaultApi = chooseApi<VaultApi>(
  () => ({
    list: (hotelId) => client.get<VaultItem[]>(base(hotelId), undefined, undefined, { fresh: true }),
    add: (hotelId, input) => client.post<VaultItem>(base(hotelId), input),
    change: (hotelId, id, input) => client.patch<VaultItem>(`${base(hotelId)}/${encodeURIComponent(id)}`, input),
    remove: (hotelId, id) => client.del<{ id: string }>(`${base(hotelId)}/${encodeURIComponent(id)}`),
    reveal: (hotelId, id) => client.post<VaultSecret>(`${base(hotelId)}/${encodeURIComponent(id)}/reveal`),
  }),
  mockVault,
);
