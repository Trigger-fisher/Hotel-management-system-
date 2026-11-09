// The shell as it was last drawn (brand, signed-in person, menu, header, theme): a browser that had a dashboard open draws the REAL sidebar and
// top bar from this copy on the next reload, before the session answer or any data arrives (SnapshotShell.tsx), so a refresh never shows a
// blank rail. Written whenever the dashboard's shell changes, cleared with the shell flag when the session ends (sign-out, expiry, switch user).
// Only what the frame draws is kept: names and labels, never a token, a balance or a figure. Every storage access is guarded.
import type { Role } from '@shared/auth/types';
import type { NavSection } from '@shared/dashboards/nav';

export const SHELL_SNAPSHOT_KEY = 'hms-shell-snap';

export interface ShellSnapshot {
  v: 1;
  brandName: string;
  user: { id: string; displayName: string; role: Role };
  sections: NavSection[];
  activeId: string;
  header: { icon: string; eyebrow: string; title: string };
  theme: 'light' | 'dark';
  /** The portals (guest, company) draw their hotel selector under the brand; the snapshot leaves the space. */
  portal: boolean;
}

let last = '';

export function saveShellSnapshot(s: ShellSnapshot): void {
  try {
    const text = JSON.stringify(s);
    if (text === last) return;
    last = text;
    localStorage.setItem(SHELL_SNAPSHOT_KEY, text);
  } catch {
    /* blocked storage: the next reload shows the outline instead */
  }
}

export function clearShellSnapshot(): void {
  last = '';
  try {
    localStorage.removeItem(SHELL_SNAPSHOT_KEY);
  } catch {
    /* nothing to clear */
  }
}

// The same text gives the same object (useSyncExternalStore needs a stable snapshot).
let cached: { raw: string; value: ShellSnapshot | null } = { raw: '', value: null };

export function readShellSnapshot(): ShellSnapshot | null {
  try {
    const raw = localStorage.getItem(SHELL_SNAPSHOT_KEY) ?? '';
    if (raw === cached.raw) return cached.value;
    let value: ShellSnapshot | null = null;
    if (raw) {
      const s = JSON.parse(raw) as Partial<ShellSnapshot>;
      if (s.v === 1 && s.brandName && s.user?.displayName && Array.isArray(s.sections) && s.header) value = s as ShellSnapshot;
    }
    cached = { raw, value };
    return value;
  } catch {
    return null;
  }
}
