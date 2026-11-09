'use client';

// The website's demo requests (platform 0169): the real server answers /api/v1/platform/demo-requests; the mock keeps an empty list in this tab (no visitor ever fills it there).
import type { DashResult } from '@shared/dashboards/common';
import type { DemoRequest, DemoRequestPage, DemoRequestStatus } from '@shared/dashboards/demoRequests';

import * as client from '@/lib/api/client';
import { chooseApi } from '@/lib/api/mode';

export interface DemoRequestsApi {
  list(q: { status: DemoRequestStatus | 'all'; page: number; pageSize: number }): Promise<DashResult<DemoRequestPage>>;
  setStatus(id: string, status: DemoRequestStatus): Promise<DashResult<DemoRequest>>;
}

function mockDemoRequests(): DemoRequestsApi {
  return {
    async list(q) {
      return { ok: true, data: { items: [], total: 0, page: q.page, pageSize: q.pageSize, counts: { new: 0, contacted: 0, closed: 0 } } };
    },
    async setStatus() {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Not found', traceId: 'mock' } };
    },
  };
}

export const demoRequestsApi: DemoRequestsApi = chooseApi<DemoRequestsApi>(
  () => ({
    list: (q) => client.get<DemoRequestPage>('/platform/demo-requests', { status: q.status, page: String(q.page), pageSize: String(q.pageSize) }, undefined, { fresh: true }),
    setStatus: (id, status) => client.patch<DemoRequest>(`/platform/demo-requests/${encodeURIComponent(id)}`, { status }),
  }),
  mockDemoRequests,
);
