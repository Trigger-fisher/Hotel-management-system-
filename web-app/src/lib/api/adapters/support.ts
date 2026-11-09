// Customer support over the real server (docs/BACKEND.md "Customer support"): the hotel desk's inbox (GET /front-office/support, POST /front-office/support/{id}/respond).
// The guest side was removed on 18 Oct 2026.
import type { SupportApi } from '@shared/dashboards/supportRequests';

import * as api from '../client';
import { snapPageSize } from './payrollShared';

export function createHttpSupportApi(): SupportApi {
  return {
    desk: {
      list: (q = {}) => api.get('/front-office/support', { status: q.status, search: q.search?.trim() || undefined, page: q.page, pageSize: snapPageSize(q.pageSize) }),
      respond: (id, input) => api.post(`/front-office/support/${encodeURIComponent(id)}/respond`, input),
    },
  } as SupportApi;
}