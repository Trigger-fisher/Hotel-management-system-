'use client';

// One event tells every guest screen that the guest's data changed (an order placed, a bill paid, the preview's stage switched): `gg:refresh` on window.
// The badges store refreshes on it; a page calls `useGuestRefresh(reload)` to reload its own reads.
import { useEffect, useRef } from 'react';

export const GG_REFRESH = 'gg:refresh';

/** Tells every guest screen to read again (after a payment, an order, a profile save). */
export function refreshGuest(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(GG_REFRESH));
}

/** Calls `reload` whenever `refreshGuest()` is called (the latest `reload` is used; no resubscribe on every render). */
export function useGuestRefresh(reload: () => void): void {
  const latest = useRef(reload);
  useEffect(() => {
    latest.current = reload;
  });
  useEffect(() => {
    const on = () => latest.current();
    window.addEventListener(GG_REFRESH, on);
    return () => window.removeEventListener(GG_REFRESH, on);
  }, []);
}
