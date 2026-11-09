'use client';

// One mock store for every Companies screen, so a change on one screen shows on the others (the mock is loaded through
// lib/api/mockLoader.ts; setActor calls made before it has loaded are queued and run in order).
import { useEffect } from 'react';
import type { CompaniesApi } from '@shared/dashboards/companies';
import { createCompaniesRealApi } from '@/lib/api/adapters/companies';
import { lazyMock, loadMocks } from '@/lib/api/mockLoader';
import { chooseApi } from '@/lib/api/mode';
import type { Kpi, Tone } from '@shared/dashboards/common';
import type { HmsUser } from '@shared/auth-pallav/types';

/** `?data=s08` starts the profiles from Hotel Pallav's own demo rows. */
const wantsFixtures = typeof location !== 'undefined' && new URLSearchParams(location.search).get('data') === 's08';

/** The real /api/v1 server, or one mock store. `?data=s08` only seeds the mock. */
export const api: CompaniesApi = chooseApi(
  () => createCompaniesRealApi(),
  () => lazyMock(async () => {
    const m = await loadMocks();
    return m.createCompaniesApi(
      { offline: () => typeof navigator !== 'undefined' && navigator.onLine === false },
      wantsFixtures ? m.s08CompaniesSeed() : undefined,
    );
  }),
);

/** Tell the mock who is working (for "added by" and CRM history). */
export function useActor(user: HmsUser): void {
  useEffect(() => {
    // fullAccess: the mock's answer to a front-desk change of a shared company's GSTIN / name (403); a Hotel User is front desk
    api.setActor({ name: user.displayName, fullAccess: isAdmin(user) });
  }, [user]);
}

/** Pallav's isAdmin() (users.view) or isSuperAdmin(): the hotel roles above a Hotel User. */
export function isAdmin(user: HmsUser): boolean {
  return user.role === 'hotel_admin' || user.role === 'group_hotel_admin' || user.role === 'super_admin';
}

export function kpi(id: string, label: string, value: number, kind: Kpi['kind'], tone: Tone, icon: string): Kpi {
  return { id, label, value, kind, trend: null, tone, icon };
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
