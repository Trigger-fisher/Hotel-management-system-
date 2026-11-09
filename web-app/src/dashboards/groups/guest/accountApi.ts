'use client';

// The guest's own account calls of Round 3 d (docs/BACKEND.md "Guest profile and sign-ins") that the GuestApi does not carry: the sign-in list, from the real
// server or the mock (lib/api/mode.ts).
import type { GuestAccountApi } from '@shared/dashboards/guestAccount';

import * as api from '@/lib/api/client';
import { lazyMock, loadMocks } from '@/lib/api/mockLoader';
import { chooseApi } from '@/lib/api/mode';

export const guestAccountApi: GuestAccountApi = chooseApi(
  (): GuestAccountApi => ({ signIns: (q = {}) => api.get('/guest/sign-ins', { page: q.page, pageSize: q.pageSize }) }),
  () => lazyMock(async () => (await loadMocks()).createGuestAccountMock()),
);