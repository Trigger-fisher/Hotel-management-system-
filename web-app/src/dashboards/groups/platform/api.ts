'use client';

// One store for every Platform console screen, so a change shows on the others (mock mode; real mode talks to the server, most routes not there yet).
// In mock mode the onboarding admins are mirrored into the auth mock, so an approved admin can sign in (and a rejected / archived one cannot).
// Mock + dev / local-demo only (the quick-login gate): the store is kept in this tab's sessionStorage (tabKeep), so the reload the mock
// sign-out does keeps every hotel, invitation, group, account and log entry made meanwhile. resetPlatformDemo goes back to the seed.
// The mock (and its sessionStorage key, PLATFORM_KEEP_KEY) is loaded through lib/api/mockLoader.ts; setActor / resetToSeed calls made before
// it has loaded are queued and run in order.
import type { PlatformKeep, PlatformMockHooks, PlatformSnapshot } from '@shared/dashboards/platform';
import { mockApprovePlatformAdmin, mockBlockPlatformAdmin, mockRegisterPlatformAdmin, mockResetPlatformAdmins, quickLoginAllowed } from '@/lib/auth/api';
import { createHttpPlatformApi } from '@/lib/api/adapters/platform';
import { lazyMock, loadMocks } from '@/lib/api/mockLoader';
import { apiMode, chooseApi } from '@/lib/api/mode';

const authHooks: PlatformMockHooks =
  apiMode() === 'mock'
    ? {
        onAdminSubmitted: ({ hotelId, hotelName, kind, groupId, admin }) => mockRegisterPlatformAdmin({ hotelId, hotelName, kind, groupId, admin }),
        onApproved: ({ hotelId, username }) => mockApprovePlatformAdmin(hotelId, username),
        onRejected: ({ hotelId, username }) => mockBlockPlatformAdmin(hotelId, username),
        onArchived: ({ hotelId, username }) => mockBlockPlatformAdmin(hotelId, username),
      }
    : {};

/** Is the demo store kept / resettable here? Mock mode in a dev or local-demo build only (the quick-login gate). */
export const platformDemoKept = (): boolean => quickLoginAllowed();

/** This tab's sessionStorage, every access guarded: blocked or missing storage just means the store lives for this page only. */
function tabKeep(PLATFORM_KEEP_KEY: string): PlatformKeep | undefined {
  if (!platformDemoKept()) return undefined;
  return {
    load: () => {
      try {
        const raw = sessionStorage.getItem(PLATFORM_KEEP_KEY);
        // The shape (and version) is checked by createPlatformApi: a wrong one is ignored.
        return raw ? (JSON.parse(raw) as PlatformSnapshot) : null;
      } catch {
        return null;
      }
    },
    save: (snapshot) => {
      try {
        sessionStorage.setItem(PLATFORM_KEEP_KEY, JSON.stringify(snapshot));
      } catch {
        // private window, storage full or blocked: kept for this page only
      }
    },
    clear: () => {
      try {
        sessionStorage.removeItem(PLATFORM_KEEP_KEY);
      } catch {
        // blocked: nothing to clear
      }
    },
  };
}

// Real mode: lib/api/adapters/platform.ts (no mock hooks, no tab store). Mock mode: exactly the store above.
export const platformApi = chooseApi(createHttpPlatformApi, () =>
  lazyMock(async () => {
    const m = await loadMocks();
    return m.createPlatformApi({ offline: () => typeof navigator !== 'undefined' && navigator.onLine === false, ...authHooks }, tabKeep(m.PLATFORM_KEEP_KEY));
  }),
);

/**
 * Mock only (Super Admin's "Reset demo data"): forgets this tab's saved console store and puts it back to the seed, and forgets the
 * onboarded admins' sign-in accounts (auth mock). Does nothing outside the gate. The caller reloads its data afterwards.
 */
export function resetPlatformDemo(): void {
  if (!platformDemoKept()) return;
  platformApi.resetToSeed();
  mockResetPlatformAdmins();
}
