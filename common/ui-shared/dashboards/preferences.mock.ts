// The in-memory mock of preferences.ts (dev and local-demo builds only): loaded through ui-shared/mocks (web-app/src/lib/api/mockLoader.ts), never by app code.
import type { MockClock, DashResult } from './common';
import { mockError, ok } from './common';
import type { PreferencesApi, PreferencesStore, ProfilePreferences } from './preferences';

export function createPreferencesApi(userId: string, store: PreferencesStore, clock: MockClock = {}): PreferencesApi {
  const key = `hms.preferences.${userId}`;
  const read = (): ProfilePreferences => {
    try {
      const raw = store.get(key);
      const v = raw ? (JSON.parse(raw) as Partial<ProfilePreferences>) : {};
      return { uiTheme: v.uiTheme === 'light' || v.uiTheme === 'dark' ? v.uiTheme : null };
    } catch {
      return { uiTheme: null };
    }
  };
  const offline = () => clock.offline?.() === true;
  return {
    /** GET /api/v1/profile/preferences */
    getPreferences: async (): Promise<DashResult<ProfilePreferences>> => (offline() ? mockError('NETWORK_OFFLINE') : ok(read())),
    /** PATCH /api/v1/profile/preferences (only the fields sent change). */
    updatePreferences: async (patch: Partial<ProfilePreferences>): Promise<DashResult<ProfilePreferences>> => {
      if (offline()) return mockError('NETWORK_OFFLINE');
      if (patch.uiTheme !== undefined && patch.uiTheme !== null && patch.uiTheme !== 'light' && patch.uiTheme !== 'dark') {
        return mockError('VALIDATION_FAILED', { uiTheme: 'Choose day or night.' });
      }
      const next = { ...read(), ...patch };
      try {
        store.set(key, JSON.stringify(next));
      } catch {
        /* a private window: the choice lasts until the page closes */
      }
      return ok(next);
    },
  };
}
