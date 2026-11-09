// Restoring a signed-in person after a page reload: the live session cookie is asked for the user (GET /auth/session; it does not extend the idle
// window). A session answers with the same user as after sign-in. ONLY an answer that says the session is over (401: expired, revoked, replaced) means
// "sign in"; a server that is still waking up (a cold start of the database or the host), a network hiccup or a timeout is retried a few times. If the bounded
// retries still cannot reach the server, the page offers retry and keeps the person on the sign-in restore path (decision 49).
import type { ApiResult, Session } from "@shared/auth-pallav";

const SESSION_OVER = new Set(["SESSION_EXPIRED", "SESSION_REVOKED", "SESSION_REPLACED"]);

export interface RestoreOptions {
  /** How many times the server is asked in all (default 5). */
  attempts?: number;
  /** Waits between tries, in milliseconds (default 800, 1600, 3200, 6400). */
  delaysMs?: readonly number[];
  /** Maximum time spent restoring before the app shows its retry screen (default 15 seconds). */
  timeoutMs?: number;
  /** Maximum time for one session request (default 5 seconds). */
  requestTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** What the start-up check found: a live session, a session that is over (sign in), or a server that could not be reached after every try (the session may be fine). */
export type RestoreOutcome =
  | { kind: "session"; session: Session }
  | { kind: "over"; code: "SESSION_EXPIRED" | "SESSION_REVOKED" | "SESSION_REPLACED" }
  | { kind: "unreachable" };

export async function restoreOutcome(api: { getSession(signal?: AbortSignal): Promise<ApiResult<Session>> }, opts: RestoreOptions = {}): Promise<RestoreOutcome> {
  const attempts = opts.attempts ?? 5;
  const delays = opts.delaysMs ?? [800, 1600, 3200, 6400];
  const timeoutMs = Math.max(1, opts.timeoutMs ?? 15_000);
  const requestTimeoutMs = Math.max(1, opts.requestTimeoutMs ?? 5_000);
  const deadline = Date.now() + timeoutMs;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let i = 0; i < attempts; i += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const r = await Promise.race([
        api.getSession(controller.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("Session restore request timed out"));
          }, Math.min(requestTimeoutMs, remaining));
        }),
      ]);
      if (r.ok) return { kind: "session", session: r.data };
      if (SESSION_OVER.has(r.error.code)) return { kind: "over", code: r.error.code as "SESSION_EXPIRED" | "SESSION_REVOKED" | "SESSION_REPLACED" };
    } catch {
      // an exception is a failed try, like a network error
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    if (i < attempts - 1) {
      const waitMs = Math.min(delays[Math.min(i, delays.length - 1)] ?? 0, Math.max(0, deadline - Date.now()));
      if (waitMs > 0) await sleep(waitMs);
    }
  }
  return { kind: "unreachable" };
}

/** The session, or null for both "over" and "unreachable" (kept for callers that only need to know whether a session came back). */
export async function restoreSession(api: { getSession(signal?: AbortSignal): Promise<ApiResult<Session>> }, opts: RestoreOptions = {}): Promise<Session | null> {
  const r = await restoreOutcome(api, opts);
  return r.kind === "session" ? r.session : null;
}
