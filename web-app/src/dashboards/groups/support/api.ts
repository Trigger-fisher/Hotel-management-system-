'use client';

// Customer support, the hotel desk's inbox (Front Office > Guest messages, hidden from the menu since MJ removed guest messages on 18 Oct; the code stays).
// Real server: lib/api/adapters/support.ts; the mock is one store.
import type { SupportApi } from '@shared/dashboards/supportRequests';

import { createHttpSupportApi } from '@/lib/api/adapters/support';
import { lazyMock, loadMocks } from '@/lib/api/mockLoader';
import { chooseApi } from '@/lib/api/mode';

export const deskSupportApi: SupportApi['desk'] = chooseApi(
  () => createHttpSupportApi().desk,
  () => lazyMock(async () => (await loadMocks()).createSupportMock().desk),
);