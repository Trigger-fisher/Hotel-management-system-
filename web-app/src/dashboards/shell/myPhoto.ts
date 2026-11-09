'use client';

// The signed-in person's own photo address for the shell (sidebar chip, top-bar user menu, phone More sheet) and My profile: one small store for the tab.
// groups/admin/profilePhoto.ts reads it from the server and changes it; this file has no API so the shell stays light.
import { useSyncExternalStore } from 'react';

let url: string | null = null;
const subs = new Set<() => void>();
const subscribe = (l: () => void) => {
  subs.add(l);
  return () => {
    subs.delete(l);
  };
};

export function setMyPhoto(next: string | null): void {
  if (next === url) return;
  url = next;
  for (const s of subs) s();
}

/** The photo's address, or null (then the initials show). */
export const useMyPhoto = (): string | null => useSyncExternalStore(subscribe, () => url, () => null);