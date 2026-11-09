// API access keys in the mock preview: keys exist only on a real server (a key in a browser demo would be meaningless), so the mock shows an empty list and refuses to make one,
// with a plain sentence. The screen's layout and texts can still be looked at.
import type { DashResult } from './common';
import type { ApiAccessApi, ApiAccessView } from './apiAccess';
import { API_ACCESS_LIMITS } from './apiAccess';

const REAL_ONLY = 'API keys can only be made on the real server, not in the demo.';
const refused = <T>(): Promise<DashResult<T>> => Promise.resolve({ ok: false, error: { code: 'CONFLICT', message: REAL_ONLY, traceId: 'mock' } } as DashResult<T>);

export function createApiAccessMock(): ApiAccessApi {
  const view: ApiAccessView = { keys: [], fullAccess: { enabled: false, changedAt: null, changedByName: null, reason: null }, activeCount: 0, maxActive: API_ACCESS_LIMITS.maxActive };
  return {
    view: () => Promise.resolve({ ok: true, data: view }),
    create: () => refused(),
    revoke: () => refused(),
    revokeAll: () => refused(),
    setFullAccess: () => refused(),
  };
}
