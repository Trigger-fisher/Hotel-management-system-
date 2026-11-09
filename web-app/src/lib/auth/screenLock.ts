// The screen lock as this tab remembers it, next to the server's (sessions.locked_at): a reload or a tab restored by the browser opens on the
// lock screen even before the server answers, and in mock mode (no server) this is the lock. Storage can be missing or throw: then only the server's lock counts.
import type { ApiResult, Session } from "@shared/auth-pallav";

const KEY = "hms-screen-locked";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function store(): Store | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function setTabLocked(locked: boolean, s: Store | null = store()): void {
  try {
    if (locked) s?.setItem(KEY, "1");
    else s?.removeItem(KEY);
  } catch {
    /* storage refused: the server's lock still holds */
  }
}

export function tabLocked(s: Store | null = store()): boolean {
  try {
    return s?.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** A session answer marked locked when the server says so or this tab was locked. */
export function withLock(r: ApiResult<Session>, s: Store | null = store()): ApiResult<Session> {
  if (!r.ok) return r;
  return r.data.locked || tabLocked(s) ? { ok: true, data: { ...r.data, locked: true } } : r;
}
