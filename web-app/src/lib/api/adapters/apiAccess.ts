// API access keys (Platform settings > API access) against the real server: /api/v1/platform/api-tokens (platform migration 0129).
import type { ApiAccessApi, ApiAccessView, ApiKeyCreated } from '@shared/dashboards/apiAccess';

import { get, post, put } from '../client';

export function createHttpApiAccessApi(): ApiAccessApi {
  return {
    view: () => get<ApiAccessView>('/platform/api-tokens'),
    create: (input) => post<ApiKeyCreated>('/platform/api-tokens', input),
    revoke: (id) => post<{ revoked: boolean }>(`/platform/api-tokens/${encodeURIComponent(id)}/revoke`),
    revokeAll: (reason) => post<{ revoked: number }>('/platform/api-tokens/revoke-all', { reason }),
    setFullAccess: (input) => put<ApiAccessView['fullAccess']>('/platform/api-tokens/full-access', input),
  };
}
