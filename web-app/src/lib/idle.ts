// Side work of the first second (speed, 24 Oct 2026): the seeded session re-check, the person's photo, the announcements. Each waits until the browser is idle,
// or `ms` at the latest, so the first screen's own data request is on its way before any of them starts.

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/** Runs `fn` once, when the browser is idle or after `ms` milliseconds at the latest (the first of the two). Returns a function that cancels a run that has not started. */
export function deferIdle(fn: () => void, ms: number): () => void {
  const w = typeof window === 'undefined' ? undefined : (window as IdleWindow);
  if (w?.requestIdleCallback) {
    const handle = w.requestIdleCallback(fn, { timeout: ms });
    return () => w.cancelIdleCallback?.(handle);
  }
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
}
