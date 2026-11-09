'use client';

// The System Log, Force Log and System Health store: the real /api/v1/system/* or the in-memory mock (lib/api/mode.ts), loaded through lib/api/mockLoader.ts.
import { MOCK_TODAY } from '@shared/dashboards/payrollPay';
import { createSystemAdminRealApi } from '@/lib/api/adapters/systemAdmin';
import { lazyMock, loadMocks } from '@/lib/api/mockLoader';
import { apiMode, chooseApi } from '@/lib/api/mode';
import { portalToday } from '../portal/today';

export const systemApi = chooseApi(
  () => createSystemAdminRealApi(),
  () => lazyMock(async () => (await loadMocks()).createSystemAdminMock()),
);

/** Today "YYYY-MM-DD": the mock's fixed date in mock mode, the hotel's IST date against the real server. */
export const systemToday = (): string => portalToday(MOCK_TODAY);

/** "Now" in ms for the "3 hours ago" words: noon of the mock's day in mock mode, the clock against the real server. */
export const systemNow = (): number => (apiMode() === 'real' ? Date.now() : new Date(`${MOCK_TODAY}T12:00:00+05:30`).getTime());
