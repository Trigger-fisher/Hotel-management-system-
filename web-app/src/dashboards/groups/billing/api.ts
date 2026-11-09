'use client';

// One billing API for the whole session. Real mode talks to /api/v1/billing (lib/api/adapters/billing.ts); mock mode keeps one in-memory
// mock, so a change shows on every billing screen. `?data=s08` (dev preview) loads Hotel Pallav's own scratch demo rows into the mock instead.
// The mock and the demo rows are loaded through lib/api/mockLoader.ts (never part of a normal production build).
import { createHttpBillingApi } from '@/lib/api/adapters/billing';
import { lazyMock, loadMocks } from '@/lib/api/mockLoader';
import { chooseApi } from '@/lib/api/mode';
import type { BillingApi } from '@shared/dashboards/billing';

const wantsFixtures = typeof location !== 'undefined' && new URLSearchParams(location.search).get('data') === 's08';

const mockBillingApi = () =>
  lazyMock<BillingApi>(async () => {
    const m = await loadMocks();
    return m.createBillingApi(
      { offline: () => typeof navigator !== 'undefined' && navigator.onLine === false },
      wantsFixtures ? m.s08BillingFixtures() : undefined,
    );
  });

export const billingApi = chooseApi(createHttpBillingApi, mockBillingApi);
