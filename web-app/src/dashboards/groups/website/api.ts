'use client';

// One store for every Website screen, so a change shows on the others: the real /api/v1 server or the mock (see lib/api/mode.ts,
// loaded through lib/api/mockLoader.ts).
import { createWebsiteRealApi } from '@/lib/api/adapters/website';
import { lazyMock, loadMocks } from '@/lib/api/mockLoader';
import { chooseApi } from '@/lib/api/mode';

export const webApi = chooseApi(
  () => createWebsiteRealApi(),
  () => lazyMock(async () => (await loadMocks()).createWebsiteApi({ offline: () => typeof navigator !== 'undefined' && navigator.onLine === false })),
);
