'use client';

// A short-lived history entry for something that sits over the page (decision 71: the guest portal's bottom sheets), so the phone's Back button closes it
// instead of leaving the page. The same idea as the phone page search (PhoneSearch.tsx, which keeps its own copy unchanged): opening adds one entry with the
// same address and the same page stack; Back takes it away and calls `onPop`; closing by the sheet's own X, Esc or backdrop steps back out of the entry.
// The shell (RoleDashboard) asks two things: `isTempClosing()` in its popstate handler (that step was only the sheet closing: same page, no refetch), and
// `onTempEntry()` before it adds a page (a page opened while a sheet's entry is current replaces that entry, so no extra Back is left behind).
// One entry at a time: a second overlay opened while one is active takes the entry over.

interface Active {
  id: string;
  onPop: () => void;
}

let active: Active | null = null;
let closingAt = 0;

function handlePop(): void {
  const was = active;
  active = null;
  closingAt = Date.now();
  window.removeEventListener('popstate', handlePop);
  was?.onPop();
}

/** Adds the entry for `id`; Back calls `onPop` once. While another overlay's entry is active, that entry is taken over (one step back still closes it). */
export function pushTempEntry(id: string, onPop: () => void): boolean {
  if (typeof window === 'undefined') return false;
  if (active) {
    if (active.id !== id && (window.history.state as { hmsTemp?: string } | null)?.hmsTemp === active.id) {
      window.history.replaceState({ ...((window.history.state as object | null) ?? {}), hmsTemp: id }, '', window.location.pathname + window.location.search);
    }
    active = { id, onPop };
    return true;
  }
  window.history.pushState({ ...((window.history.state as object | null) ?? {}), hmsTemp: id }, '', window.location.pathname + window.location.search);
  active = { id, onPop };
  window.addEventListener('popstate', handlePop);
  return true;
}

/**
 * The thing closed by itself (X, Esc, backdrop, done): steps back out of its entry when that entry is still the current one. When a page change already
 * replaced the entry, nothing moves.
 */
export function closeTempEntry(id: string): void {
  if (typeof window === 'undefined') return;
  if (active?.id === id) {
    active = null;
    window.removeEventListener('popstate', handlePop);
  }
  if ((window.history.state as { hmsTemp?: string } | null)?.hmsTemp === id) {
    closingAt = Date.now();
    window.history.back();
  }
}

/** The shell asks in its popstate handler: was this step only an overlay closing (one is active now, or one closed in the last half second)? */
export const isTempClosing = (): boolean => active !== null || Date.now() - closingAt < 500;

/** The shell asks before it adds a page: is the current entry an overlay's own (then the new page replaces it instead of stacking on top)? */
export const onTempEntry = (): boolean => typeof window !== 'undefined' && Boolean((window.history.state as { hmsTemp?: string } | null)?.hmsTemp);
