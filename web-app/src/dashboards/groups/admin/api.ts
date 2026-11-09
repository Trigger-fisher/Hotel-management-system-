'use client';

// One store for every Administration screen, so a change shows on the others: the real /api/v1 server or the mock (see lib/api/mode.ts,
// loaded through lib/api/mockLoader.ts; setActor calls made before the mock has loaded are queued and run in order).
import type { HmsUser } from '@shared/auth-pallav/types';

import { createAdminRealApi } from '@/lib/api/adapters/admin';
import { lazyMock, loadMocks } from '@/lib/api/mockLoader';
import { chooseApi } from '@/lib/api/mode';

export const adminApi = chooseApi(
  () => createAdminRealApi(),
  () => lazyMock(async () => (await loadMocks()).createAdminApi({ offline: () => typeof navigator !== 'undefined' && navigator.onLine === false })),
);

/**
 * Settings, the recycle bin and Razorpay are the hotel SuperAdmin's only (Pallav `superadmin` middleware). The server's hint for
 * "holds the hotel's SuperAdmin role" is the `system.recycle` ability (server/auth/access.ts canUseRecycleBin), so a hotel_admin account
 * with that role passes too.
 */
export function isSuperAdmin(role: string, abilities?: readonly string[]): boolean {
  return role === 'super_admin' || Boolean(abilities?.includes('system.recycle'));
}

/** Tells the mock who is working (the real adapter ignores it: the server reads the session). */
export function useAdminActor(user: Pick<HmsUser, 'role' | 'abilities' | 'username' | 'displayName'>): boolean {
  const superAdmin = isSuperAdmin(user.role, user.abilities);
  adminApi.setActor({ superAdmin, username: user.username, name: user.displayName, role: user.role });
  return superAdmin;
}
