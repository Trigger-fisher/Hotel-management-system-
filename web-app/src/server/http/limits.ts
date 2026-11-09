import "server-only";

// Throttles (A12). Pallav puts Laravel's `throttle:N,M` on some routes (sign-in 30/min, resend code 6/min, ...); the wrapper takes the
// same thing declaratively: `limits: [{ name: "login", max: 30, windowSeconds: 60, by: "ip" }]`. The counter lives behind an interface:
// the PostgreSQL one is platform.rate_limits (key_hash = HMAC of the key, window_start), the in-memory one below is the test double.
// Fixed windows, like Laravel's: the count restarts when the window ends.
export interface RateLimit {
  /** A short name, part of the counter key, so two routes never share a counter. */
  name: string;
  /** Requests allowed in the window (the one that makes the count max + 1 is refused). */
  max: number;
  windowSeconds: number;
  /** Whose counter: the signed-in person, the session, or the caller's address (the only choice for a public route). */
  by: "user" | "session" | "ip";
  /** The plain sentence a refused request carries (the screen shows it as it is). Left out = the standard "Too many requests". */
  message?: string;
}

/**
 * DEV ONLY relaxation of the SIGN-IN throttles (so live testing on a developer's PC is not locked out for an hour). It applies only when ALL hold:
 * NODE_ENV is "development", HMS_DEV_RELAX_LIMITS is "1" (set only in the git-ignored web-app/.env.local, never in .env.example or a deploy config),
 * the throttle is one of the sign-in family, and the caller is this PC (localhost, or no proxy header at all, which is how a direct dev request looks).
 * Production, test builds, any other flag value and any other address get the route's own max: it fails closed.
 */
export const DEV_RELAXED_MAX = 200;
const SIGN_IN_LIMITS: ReadonlySet<string> = new Set(["login", "login-ip"]);
const LOCAL_CALLERS: ReadonlySet<string> = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "unknown"]);

export function effectiveMax(limit: RateLimit, callerIp: string, env: { NODE_ENV?: string; HMS_DEV_RELAX_LIMITS?: string } = process.env): number {
  if (env.NODE_ENV === "development" && env.HMS_DEV_RELAX_LIMITS === "1" && limit.by === "ip" && SIGN_IN_LIMITS.has(limit.name) && LOCAL_CALLERS.has(callerIp)) return Math.max(limit.max, DEV_RELAXED_MAX);
  return limit.max;
}

interface RateLimitHit {
  count: number;
  /** When the window ends and the count starts again. */
  resetInSeconds: number;
}

export interface RateLimitStore {
  /** Counts one request against the key's current window and says where the count stands. */
  hit(key: string, windowSeconds: number): Promise<RateLimitHit>;
  /** The count in the key's current window, without counting a request. */
  peek(key: string, windowSeconds: number): Promise<number>;
  /** Forgets the key's counts (Pallav's RateLimiter::clear after a good sign-in). */
  reset(key: string): Promise<void>;
}

export function createMemoryRateLimitStore(now: () => number = Date.now): RateLimitStore & { clear(): void } {
  // each entry remembers when ITS window ends, so counters with different window lengths never disturb each other
  const counts = new Map<string, { count: number; endsAt: number }>();
  const windowOf = (windowSeconds: number): { start: number; end: number } => {
    const windowMs = windowSeconds * 1000;
    const start = Math.floor(now() / windowMs) * windowMs;
    return { start, end: start + windowMs };
  };
  return {
    clear: () => counts.clear(),
    async peek(key, windowSeconds) {
      return counts.get(`${key}|${windowOf(windowSeconds).start}`)?.count ?? 0;
    },
    async reset(key) {
      for (const k of [...counts.keys()]) if (k.startsWith(`${key}|`)) counts.delete(k);
    },
    async hit(key, windowSeconds) {
      const { start, end } = windowOf(windowSeconds);
      for (const [k, v] of counts) if (v.endsAt <= now()) counts.delete(k);
      const id = `${key}|${start}`;
      const entry = counts.get(id) ?? { count: 0, endsAt: end };
      entry.count += 1;
      counts.set(id, entry);
      return { count: entry.count, resetInSeconds: Math.max(1, Math.ceil((end - now()) / 1000)) };
    },
  };
}
