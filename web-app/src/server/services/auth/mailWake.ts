import "server-only";

// "A mail was just queued": the services that write to the outbox say so here, and the mail worker (compose/mail.ts) listens, so a sign-in code or an enquiry mail
// leaves within a second of being queued instead of waiting for the next timer tick or the next cron call. No payload travels here: only the fact. Nothing
// subscribed (tests, a bare setup) means nothing happens.
//
// The listeners live on globalThis, not in a module variable: Next.js builds the server start (instrumentation) and each route as separate bundles, and each bundle would get its OWN
// copy of a module variable. The worker subscribed in one copy and a sign-in or reset route called touch() on another copy with nobody listening, so a mail waited for the daily cron
// (1 Nov 2026: three password-reset mails stayed "pending" with no attempt). globalThis is one object per process, shared by every bundle.
type Listener = () => void;
const KEY = Symbol.for("hms.mailWake.listeners");
const NUDGE = Symbol.for("hms.mailWake.lastNudge");
const store = globalThis as unknown as { [KEY]?: Set<Listener>; [NUDGE]?: number };
const listeners: Set<Listener> = (store[KEY] ??= new Set<Listener>());

export const mailWake = {
  /** A mail was queued (inside or right after the unit that wrote it). */
  touch(): void {
    for (const l of [...listeners]) {
      try {
        l();
      } catch {
        // a listener's failure never reaches the request that queued the mail
      }
    }
  },
  /**
   * The same wake, at most once a minute, from any signed-in request (http/route.ts): on a serverless host the queue is only worked right after a request, so a mail that must be tried
   * again (it failed once, or the hotel's day was full) would otherwise wait for the daily cron. One nudge a minute per server process is enough and costs one small query.
   */
  nudge(minMs = 60_000): void {
    const t = Date.now();
    if (t - (store[NUDGE] ?? 0) < minMs) return;
    store[NUDGE] = t;
    mailWake.touch();
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};
