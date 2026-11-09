'use client';

// My vault's calls (platform 0190): the real server answers /api/v1/platform/my-vault for its owner only; the demo keeps items in memory in this tab (nothing locked, nothing kept).
import type { DashResult } from '@shared/dashboards/common';
import type { PersonalVaultInput, PersonalVaultItem, PersonalVaultKind } from '@shared/dashboards/personalVault';
import type { VaultSecret } from '@shared/dashboards/vault';

import * as client from '@/lib/api/client';
import { chooseApi } from '@/lib/api/mode';
import type { VaultPanelApi } from './HotelVault';
import { demoRecheckRefusal, demoRechecked } from './recheckApi';

const BASE = '/platform/my-vault';

function mockPersonalVault(): VaultPanelApi<PersonalVaultKind> {
  const items = new Map<string, { item: PersonalVaultItem; secret: VaultSecret }>();
  const ok = <T,>(data: T): DashResult<T> => ({ ok: true, data });
  const missing = <T,>(): DashResult<T> => ({ ok: false, error: { code: 'NOT_FOUND', message: 'Not found', traceId: 'mock' } });
  const put = (id: string, input: PersonalVaultInput, before?: VaultSecret): PersonalVaultItem => {
    const secret = { secret: input.secret === undefined ? (before?.secret ?? null) : input.secret || null, notes: input.notes === undefined ? (before?.notes ?? null) : input.notes || null };
    const item: PersonalVaultItem = {
      id, kind: input.kind, title: input.title.trim(), username: input.username?.trim() || null, url: input.url?.trim() || null, hasSecret: secret.secret !== null, hasNotes: secret.notes !== null,
      expiresOn: input.expiresOn || null, updatedAt: new Date().toISOString(), updatedBy: 'You',
    };
    items.set(id, { item, secret });
    return item;
  };
  return {
    async list() {
      return ok([...items.values()].map((x) => x.item).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    },
    async add(input) {
      if (!input.title.trim()) return { ok: false, error: { code: 'VALIDATION_FAILED', message: 'Give it a name.', traceId: 'mock', details: { fields: { title: 'Give it a name.' } } } };
      return ok(put(`mock-${Date.now()}-${items.size}`, input));
    },
    async change(id, input) {
      const x = items.get(id);
      return x ? ok(put(id, input, x.secret)) : missing();
    },
    async remove(id) {
      if (!items.delete(id)) return missing();
      return ok({ id });
    },
    async reveal(id) {
      if (!demoRechecked()) return demoRecheckRefusal();
      const x = items.get(id);
      return x ? ok(x.secret) : missing();
    },
  };
}

export const personalVaultApi: VaultPanelApi<PersonalVaultKind> = chooseApi<VaultPanelApi<PersonalVaultKind>>(
  () => ({
    list: () => client.get<PersonalVaultItem[]>(BASE, undefined, undefined, { fresh: true }),
    add: (input) => client.post<PersonalVaultItem>(BASE, input),
    change: (id, input) => client.patch<PersonalVaultItem>(`${BASE}/${encodeURIComponent(id)}`, input),
    remove: (id) => client.del<{ id: string }>(`${BASE}/${encodeURIComponent(id)}`),
    reveal: (id) => client.post<VaultSecret>(`${BASE}/${encodeURIComponent(id)}/reveal`),
  }),
  mockPersonalVault,
);
