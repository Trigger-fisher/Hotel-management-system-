'use client';

// One mock API for the whole session, so new, edited and deleted entries stay while the app is open.
// `?data=s08` (dev preview) starts it from Hotel Pallav's own scratch demo rows, to compare a screen with Pallav on the same data.
// The mock and the demo rows are loaded through lib/api/mockLoader.ts (never part of a normal production build).
import { createHttpCashApi } from '@/lib/api/adapters/cash';
import { lazyMock, loadMocks } from '@/lib/api/mockLoader';
import { chooseApi } from '@/lib/api/mode';

const wantsFixtures = typeof location !== 'undefined' && new URLSearchParams(location.search).get('data') === 's08';

const mockCashApi = () =>
  lazyMock(async () => {
    const m = await loadMocks();
    return m.createCashApi(
      { offline: () => typeof navigator !== 'undefined' && navigator.onLine === false },
      wantsFixtures ? m.s08CashSeed() : undefined,
    );
  });

// Revenue, Expenses and Shift Handover go to the server in real mode.
export const cashApi = chooseApi(() => createHttpCashApi(), mockCashApi);
