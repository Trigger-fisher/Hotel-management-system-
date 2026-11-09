// Sign-out without waiting (MJ, 18 Oct: "logging out is too slow"). The sign-in page is shown at once; the server is told in the background:
//  1. the browser marks the session signed out (the `__Host-hms_out` cookie, server/auth/tokens.ts): from now on EVERY request that still carries the session
//     cookie ends that session on the server (services/auth/sessionResolver.ts) and is answered as signed out, so nothing of the old account can load again;
//  2. POST /api/v1/auth/sign-out goes with `keepalive` (it is sent even when the tab closes right away), tried again a few times while the network is away.
// A new sign-in clears the mark. The live site answered a sign-out in 0.5 to 3 seconds (a cold function and the database), and the screen used to wait for it.
// The remembered GET answers of the account (lib/api/getCache.ts) are forgotten at the same time: nothing of it stays in memory for the next person at the PC.
import { clearGetCache } from '../api/getCache';
import { setTabLocked } from './screenLock';

const MARK = '__Host-hms_out';
const TRIES_MS = [0, 1500, 5000, 15000];

/** Sets the sign-out mark (no secret in it). */
export function markSignedOut(): void {
  try {
    document.cookie = `${MARK}=1; Path=/; Secure; SameSite=Lax`;
  } catch {
    // cookies blocked: the background request below still ends the session
  }
}

/** Sends the sign-out in the background: any answer from the server ends the tries (a 401 means the mark already ended the session). */
export function sendSignOut(): void {
  let attempt = 0;
  const tryOnce = (): void => {
    void fetch('/api/v1/auth/sign-out', { method: 'POST', credentials: 'same-origin', cache: 'no-store', keepalive: true })
      .then(() => undefined)
      .catch(() => {
        attempt += 1;
        if (attempt < TRIES_MS.length) setTimeout(tryOnce, TRIES_MS[attempt]);
      });
  };
  tryOnce();
}

/** Both, in this order: the mark first, so even the background request itself ends the session on the server. The GET memory goes too. */
export function signOutInBackground(): void {
  clearGetCache();
  setTabLocked(false);
  markSignedOut();
  sendSignOut();
}
