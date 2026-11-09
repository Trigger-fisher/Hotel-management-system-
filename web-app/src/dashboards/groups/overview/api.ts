'use client';

// The real /api/v1 server, or one in-memory overview mock per browser session, shared by the overview screens (the mock is loaded
// through lib/api/mockLoader.ts).
import type { OverviewApi } from '@shared/dashboards/overview';
import { createOverviewRealApi } from '@/lib/api/adapters/overview';
import { lazyMock, loadMocks } from '@/lib/api/mockLoader';
import { chooseApi } from '@/lib/api/mode';

export const overviewApi: OverviewApi = chooseApi(
  () => createOverviewRealApi(),
  () => lazyMock(async () => (await loadMocks()).createOverviewApi({
    offline: () => typeof navigator !== 'undefined' && navigator.onLine === false,
  })),
);
