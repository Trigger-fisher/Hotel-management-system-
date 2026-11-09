'use client';

// One Front Office API per browser session. Real mode talks to /api/v1/front-office (lib/api/adapters/frontOffice.ts); mock mode keeps one
// in-memory mock, so check-in and check-out show on the board. `?data=s08` (dev preview) starts the mock from Hotel Pallav's own scratch demo rows.
// The mock and the demo rows are loaded through lib/api/mockLoader.ts (never part of a normal production build).
import { createHttpFrontOfficeApi } from '@/lib/api/adapters/frontOffice';
import { lazyMock, loadMocks } from '@/lib/api/mockLoader';
import { chooseApi } from '@/lib/api/mode';

function mockFrontOfficeApi() {
  return lazyMock(async () => {
    const m = await loadMocks();
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('data') === 's08') {
      m.loadFrontOfficeStore(m.s08FrontOfficeStore());
    }
    return m.createFrontOfficeApi({ offline: () => typeof navigator !== 'undefined' && navigator.onLine === false });
  });
}

export const foApi = chooseApi(createHttpFrontOfficeApi, mockFrontOfficeApi);
