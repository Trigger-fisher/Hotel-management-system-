'use client';

// "Something is refreshing in the background" (R48): every `useAsync` that keeps old data on screen while it loads the new data counts here, and the shell shows one
// slim progress line at the top of the page while the count is above zero. Nothing blanks, nothing moves; the person sees that the page is being brought up to date.
import { useSyncExternalStore } from 'react';

let active = 0;
// The progress line stays visible a little after the last refresh ended, so a quick refresh is still seen.
const HOLD_MS = 500;
let holdUntil = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

let failedAt = 0;
const failListeners = new Set<() => void>();

export const refreshActivity = {
  /** A background refresh failed and the old data stays on screen: the shell says so for a few seconds. */
  fail(): void {
    failedAt = Date.now();
    failListeners.forEach((l) => l());
    setTimeout(() => failListeners.forEach((l) => l()), 4100);
  },
  failedRecently: (): boolean => Date.now() - failedAt < 4000,
  subscribeFail(l: () => void): () => void {
    failListeners.add(l);
    return () => {
      failListeners.delete(l);
    };
  },
  /** A refresh started; call the returned function when it ends. */
  begin(): () => void {
    active += 1;
    emit();
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      active = Math.max(0, active - 1);
      if (active === 0) {
        holdUntil = Date.now() + HOLD_MS;
        setTimeout(emit, HOLD_MS + 20);
      }
      emit();
    };
  },
  isActive: (): boolean => active > 0,
  isShown: (): boolean => active > 0 || Date.now() < holdUntil,
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

/** True while any page data is refreshing behind old data. */
export function useRefreshing(): boolean {
  return useSyncExternalStore(refreshActivity.subscribe, refreshActivity.isShown, () => false);
}

/** True for a few seconds after a background refresh failed (the old data is still shown). */
export function useRefreshFailed(): boolean {
  return useSyncExternalStore(refreshActivity.subscribeFail, refreshActivity.failedRecently, () => false);
}
