// The Platform console (Platform Admin + Super Admin) over the real server: one PlatformApi assembled from the section adapters.
// Same interface as the mock (createPlatformApi in ui-shared/dashboards/platform.ts). The mock-only parts have no real twin: the
// PlatformMockHooks (the server creates and approves the admin accounts itself), the tab store (PlatformKeep), setActor (the server knows
// who is signed in) and resetToSeed (there is no demo data to reset). Who writes which section and which route each method waits for:
// docs/sessions/reports/PLATFORM-REAL-WIRING.md. A method with no route yet answers NOT_FOUND "No route yet" (notYet).
import { createPlatformConsoleRealApi } from './platformConsole';
import { createAnnouncementsRealApi } from './platform/announcements';
import { createHotelMailRealApi } from './platform/hotelMail';
import { createArchivedRealApi } from './platform/archived';
import { createEnterRealApi } from './platform/enter';
import { createGroupsRealApi } from './platform/groups';
import { createHealthRealApi } from './platform/health';
import { createHotelAdminsRealApi } from './platform/hotelAdmins';
import { createPlatformStaffRealApi } from './platform/platformStaff';
import { createSettingsRealApi } from './platform/settings';
import type { PlatformApi } from './platform/shared';

export * from './platform/shared';

export function createHttpPlatformApi(): PlatformApi {
  return {
    // Frontend 2: hotels, invitations, public onboarding, users, activity / audit / sign-ins
    ...createPlatformConsoleRealApi(),
    // Frontend 1
    ...createGroupsRealApi(),
    ...createHotelAdminsRealApi(),
    ...createPlatformStaffRealApi(),
    ...createHealthRealApi(),
    ...createSettingsRealApi(),
    ...createArchivedRealApi(),
    ...createAnnouncementsRealApi(),
    ...createHotelMailRealApi(),
    ...createEnterRealApi(),
    /** Mock only: the real server takes the actor from the session cookie. */
    setActor: () => undefined,
    /** Mock only: nothing to reset on the real server. */
    resetToSeed: () => undefined,
  };
}
