// The signed-in person's own display preferences (MJ 2026-10-06): the day / night choice is remembered per user.
// Server: PATCH /api/v1/profile/preferences { ui_theme: 'light' | 'dark' | null } (Worker B builds it). Until then this mock keeps it
// in whatever small store the app hands in (the web uses localStorage, keyed by user).
import type { DashResult } from './common';

export type UiTheme = 'light' | 'dark';

export interface ProfilePreferences {
  /** null = no choice yet: follow the device on the first visit. */
  uiTheme: UiTheme | null;
}

export interface PreferencesStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/** GET and PATCH /api/v1/profile/preferences: the same shape for the real client (web-app lib/api/adapters/preferences.ts) and the mock. */
export interface PreferencesApi {
  getPreferences(): Promise<DashResult<ProfilePreferences>>;
  /** Only the fields sent change. */
  updatePreferences(patch: Partial<ProfilePreferences>): Promise<DashResult<ProfilePreferences>>;
}
