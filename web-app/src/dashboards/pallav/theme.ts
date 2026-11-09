// Day / night, as Pallav does it (pms-ui.js): <html data-theme="light|dark">, two states. HMS (MJ, 5 Nov 2026): day unless the person turned night on with the
// moon button; the device's setting is never followed. The choice is remembered per user (ui-shared/dashboards/preferences.ts), the browser copy only avoids a flash.
import type { UiTheme } from '@shared/dashboards/preferences';
import { lazyMock, loadMocks } from '@/lib/api/mockLoader';
import { chooseApi } from '@/lib/api/mode';
import { createHttpPreferencesApi, type PreferencesApi } from '@/lib/api/adapters/preferences';

const BROWSER_KEY = 'pms-theme';

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private window */
    }
  },
};

const apis = new Map<string, PreferencesApi>();
export function preferencesFor(userId: string) {
  let api = apis.get(userId);
  if (!api) {
    api = chooseApi(
      () => createHttpPreferencesApi(),
      () => lazyMock(async () => (await loadMocks()).createPreferencesApi(userId, store)),
      { guard: false },
    );
    apis.set(userId, api);
  }
  return api;
}

export function browserTheme(): UiTheme | null {
  const v = store.get(BROWSER_KEY);
  return v === 'light' || v === 'dark' ? v : null;
}

export function applyTheme(theme: UiTheme): void {
  document.documentElement.dataset.theme = theme;
  document.dispatchEvent(new CustomEvent('pms:theme', { detail: { theme } }));
}

/** First paint: the browser copy, else day. The person's saved choice then wins (see `adoptSavedTheme`). */
export function startTheme(): UiTheme {
  const theme = browserTheme() ?? 'light';
  applyTheme(theme);
  return theme;
}

/** After sign-in: the person's saved value wins on every device; a person who never chose night gets day (not the last person's choice on this browser). */
export async function adoptSavedTheme(userId: string): Promise<UiTheme | null> {
  const res = await preferencesFor(userId).getPreferences();
  if (!res.ok) return null;
  const theme: UiTheme = res.data.uiTheme === 'dark' ? 'dark' : 'light';
  store.set(BROWSER_KEY, theme);
  applyTheme(theme);
  return theme;
}

/** The moon / sun button. Applies at once and saves for the person. */
export function chooseTheme(userId: string, theme: UiTheme): void {
  store.set(BROWSER_KEY, theme);
  applyTheme(theme);
  void preferencesFor(userId).updatePreferences({ uiTheme: theme });
}
