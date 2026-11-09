// The Group Hotel Admin's payments page over the real server: GET /group/payments. Same TypeScript interface as groupPayments.mock.ts.
import type { GroupPaymentsApi } from '@shared/dashboards/groupPayments';

import * as api from '../client';

export function createHttpGroupPaymentsApi(): GroupPaymentsApi {
  return { overview: () => api.get('/group/payments') };
}