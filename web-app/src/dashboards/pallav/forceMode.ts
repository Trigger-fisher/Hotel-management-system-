'use client';

// Force mode (Pallav ForceMode): validation and record locks off for the account, shown in the header and a banner.
// Mock: kept for the browser session only. The screens read it with `useForceMode()` when they honour it.
import { useSyncExternalStore } from 'react';

let on = false;
try {
  on = sessionStorage.getItem('hms.forceMode') === '1';
} catch {
  /* no storage */
}
const listeners = new Set<() => void>();

function set(next: boolean) {
  on = next;
  try {
    sessionStorage.setItem('hms.forceMode', next ? '1' : '0');
  } catch {
    /* no storage */
  }
  listeners.forEach((l) => l());
}

export function useForceMode(): { on: boolean; set: (v: boolean) => void } {
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => on,
    () => false,
  );
  return { on: value, set };
}
