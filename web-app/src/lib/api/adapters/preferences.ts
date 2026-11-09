// The signed-in person's own preferences over the real server: GET and PATCH /api/v1/profile/preferences (docs/api/admin.md).
import type { PreferencesApi, ProfilePreferences } from '@shared/dashboards/preferences';

import * as api from '../client';

export type { PreferencesApi };

export function createHttpPreferencesApi(): PreferencesApi {
  return {
    getPreferences: () => api.get<ProfilePreferences>('/profile/preferences'),
    updatePreferences: (changes) => api.patch<ProfilePreferences>('/profile/preferences', changes),
  };
}
