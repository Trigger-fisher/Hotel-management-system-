'use client';

// One corporate API per browser session, shared by every corporate screen: the real /api/v1/corporate server (lib/api/adapters/corporate.ts)
// or one in-memory mock, so a payment or a new team member shows up on the other screens too (see lib/api/mode.ts; the mock is loaded
// through lib/api/mockLoader.ts).
import { MOCK_TODAY } from '@shared/dashboards/corporate';

import { createHttpCorporateApi } from '@/lib/api/adapters/corporate';
import { lazyMock, loadMocks } from '@/lib/api/mockLoader';
import { chooseApi } from '@/lib/api/mode';

import { portalToday } from '../portal/today';

export const corporateApi = chooseApi(
  createHttpCorporateApi,
  () =>
    lazyMock(async () => {
      const { createCorporateApi, withPortalDemo } = await loadMocks();
      return withPortalDemo(createCorporateApi({ offline: () => typeof navigator !== 'undefined' && navigator.onLine === false }), 'company');
    }),
);

/** The day bills count as overdue from and room searches start at. */
export const corporateToday = (): string => portalToday(MOCK_TODAY);
