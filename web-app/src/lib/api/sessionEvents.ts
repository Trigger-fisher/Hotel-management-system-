// "The server says this session is over" (a 401 from any call). The sign-in flow listens once and returns to the sign-in screen;
// the client emits it at most once per second, so a page that fires ten calls at once ends the session once.
type Listener = (code: string) => void;

const listeners = new Set<Listener>();
let last = 0;

export function onSessionEnded(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function emitSessionEnded(code: string): void {
  const now = Date.now();
  if (now - last < 1000) return;
  last = now;
  listeners.forEach((fn) => fn(code));
}

/** "The server says this screen is locked" (a 423 SCREEN_LOCKED from any call, e.g. the lock was set in another tab): the flow shows the lock screen. */
const lockListeners = new Set<() => void>();

export function onScreenLocked(fn: () => void): () => void {
  lockListeners.add(fn);
  return () => {
    lockListeners.delete(fn);
  };
}

export function emitScreenLocked(): void {
  lockListeners.forEach((fn) => fn());
}
