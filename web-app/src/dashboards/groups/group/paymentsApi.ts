'use client';

// The group payments page's api: the real server or the mock (lib/api/mode.ts).
import type { GroupPaymentsApi } from '@shared/dashboards/groupPayments';

import { createHttpGroupPaymentsApi } from '@/lib/api/adapters/groupPayments';
import { lazyMock, loadMocks } from '@/lib/api/mockLoader';
import { chooseApi } from '@/lib/api/mode';

export const groupPaymentsApi = chooseApi(createHttpGroupPaymentsApi, (): GroupPaymentsApi => lazyMock(async () => (await loadMocks()).createGroupPaymentsMock()));