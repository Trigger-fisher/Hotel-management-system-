import "server-only";
import type { Catalog } from "../../auth/catalog";
import { buildPermissionSnapshot } from "../../auth/permissions";
import type { SessionResolver, VerifiedSession } from "../../auth/session";
import { isIP } from "node:net";
import { API_HOTEL_HEADER, hashApiToken, readBearer } from "../../auth/apiTokens";
import { AppError } from "../../errors";
import { clientAddress } from "../../http/clientAddress";
import { SESSION_COOKIE, SESSION_TOKEN_SHAPE, hasSignedOutMark, hashSessionToken, readCookie } from "../../auth/tokens";

const HOTEL_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
import type { AccessRecord, PlatformUnit } from "../../repos/auth";
import { closeVisits } from "./authService";
import { maxLifeEnd, pastMaxLife, WEB_IDLE_MINUTES } from "./policy";

// The real SessionResolver: the session cookie -> the person's VerifiedSession for the hotel the session was opened in.
// Everything the engine needs (the effective permissions, the role key and level, the record scope) is read from the database in ONE statement
// (access.loadBySession, no transaction around it), and the answer is kept in this process for SESSION_CACHE_MS (10 s) keyed by the token's hash, so a
// burst of requests from one browser (a page opening its lists) costs one database round trip, not one per request; requests for the same token that
// arrive while that read is still running wait for it instead of asking again. A revoked session, a role change or a block therefore takes effect within
// ten seconds (sign-out clears the cookie, so it is immediate for the person). Platform, super and group accounts are NOT cached: their Enter-hotel visit (started,
// extended or ended on any instance) must apply on the very next request, in the shell seed, the session answer and every route alike, and a cached copy on
// another Vercel instance would keep acting on a hotel after an Exit (forgetSession reaches only this process). Their burst still shares one in-flight read.
// The token itself is never stored, only its SHA-256.
//
// What ends a session here: revoked, past its expiry (120 idle minutes), the account deleted, disabled or waiting for approval,
// blocked by an administrator, or the session's hotel no longer active (suspended, archived: Platform console). A TIMED LOCK caused by someone else's wrong attempts does NOT end it (MJ #13: a stranger's failures must never sign the
// owner out); only an admin block does, and that revokes the sessions when it is set.
/** How long a resolved session is trusted without asking the database again. */
export const SESSION_CACHE_MS = 10_000;
/** Sessions kept at once (the oldest go first). */
const SESSION_CACHE_MAX = 2000;

/** The access record each VerifiedSession was built from (for a visit, the visited hotel's record), so GET /auth/session and the shell seed need not load it again. */
const accessBySession = new WeakMap<VerifiedSession, AccessRecord>();
/** Every resolver's cache in this process, so a change of the session time limits reaches the next request at once (other instances within SESSION_CACHE_MS). */
const liveCaches = new Set<Map<string, unknown>>();
export function forgetAllSessions(): void {
  for (const c of liveCaches) c.clear();
}
const PLATFORM_ROLES = new Set<string>(["platform_admin", "super_admin", "group_hotel_admin"]);

export function createSessionResolver(deps: { unit: PlatformUnit; catalog: Catalog; now: () => Date; cacheMs?: number; /** The server's hash key: needed to look an API key up (without it every API key is refused). */ hashKey?: () => Buffer; /** A presented API key is a honeytoken (a fake key we planted): told to the security layer, best effort. */ onHoneyKey?: (use: { label: string; ip: string | null; country: string | null }) => void; /** Which honeytoken a key is (services/security/honeypot.ts), else null. */ honeyKeyLabel?: (key: Buffer, presented: string) => string | null; /** The country Cloudflare reported for the request (a hint for alerts only). */ edgeCountry?: (request: Request) => string | null }): {
  resolveSession: SessionResolver;
  touchSession: (s: VerifiedSession) => Promise<void>;
  forgetSession: (sessionId: string) => void;
  /** The access record a resolved session was built from (a cached session is the same object, so it still has one); null for a session this resolver did not make. */
  accessOf: (s: VerifiedSession) => AccessRecord | null;
  endedReason: (request: Request) => Promise<"SESSION_REPLACED" | "SESSION_REVOKED" | "SESSION_EXPIRED" | null>;
} {
  const { unit, catalog, now } = deps;
  const cacheMs = deps.cacheMs ?? SESSION_CACHE_MS;
  const cache = new Map<string, { until: number; session: VerifiedSession }>();
  liveCaches.add(cache);
  /** The database reads still running, by token hash: a second request for the same token awaits the first one's answer. */
  const pending = new Map<string, Promise<VerifiedSession | null>>();

  function remember(hash: string, session: VerifiedSession, at: Date): void {
    if (cacheMs <= 0) return;
    // a platform, super or group account is read fresh every time: see the note at the top
    if (PLATFORM_ROLES.has(session.accountRole)) return;
    if (cache.size >= SESSION_CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(hash, { until: at.getTime() + cacheMs, session });
  }

  function made(session: VerifiedSession, access: AccessRecord): VerifiedSession {
    accessBySession.set(session, access);
    return session;
  }

  /**
   * An API access key (platform.api_tokens): acts through the Super Admin who made it, as that person is NOW (an account that is no longer an active Super Admin kills its keys).
   * Never cached: a revoke, an expiry, the "full keys" switch and the address list take effect on the very next call. A key that is wrong, expired, revoked or called from an address
   * outside its list is a plain 401 (no hint which); the "full keys are off" and "no such hotel" answers say so, because only the holder of a valid key can see them.
   * Scope: platform = the console; hotel = its one hotel; all = the console plus the hotel named in the X-HMS-Hotel header. A READ key in a hotel is served like an Enter-hotel visit
   * (a READ ONLY transaction); a FULL key in a hotel is the hotel's SuperAdmin permission role, able to write.
   */
  async function resolveToken(request: Request, token: string): Promise<VerifiedSession | null> {
    let key: Buffer | undefined;
    try {
      key = deps.hashKey?.();
    } catch {
      key = undefined;
    }
    if (!key) return null;
    const at = now();
    // a honeytoken (security/docs/SECURITY-INTEGRATION-PLAN-2026-11-01.md section 8): never in the key table, so it never works; trying it is the alarm
    const honey = deps.honeyKeyLabel?.(key, token) ?? null;
    if (honey !== null) {
      const seenBy = clientAddress(request);
      try {
        deps.onHoneyKey?.({ label: honey, ip: seenBy !== null && isIP(seenBy) ? seenBy : null, country: deps.edgeCountry?.(request) ?? null });
      } catch {
        // an alert that cannot be raised never changes the answer
      }
      return null;
    }
    const hash = hashApiToken(key, token);
    // the key's address allow-list is checked against the entry the trusted proxy added, never one the caller wrote (http/clientAddress.ts)
    const seen = clientAddress(request);
    const ip = seen !== null && isIP(seen) ? seen : null;
    return unit.run(async (r): Promise<VerifiedSession | null> => {
      let rec;
      try {
        rec = await r.apiTokens.byHash(hash);
      } catch {
        return null; // the table is not there yet (migration 0129 not applied): no key works
      }
      if (!rec || rec.revokedAt !== null || rec.expiresAt <= at) return null;
      if (rec.ipAllow.length > 0 && (ip === null || !rec.ipAllow.includes(ip))) return null;
      if (rec.level === "full" && !(await r.apiTokens.fullAccessEnabled())) throw new AppError("FORBIDDEN", "Full access keys are switched off.");
      const access = await r.access.load(rec.createdBy, null);
      if (!access) return null;
      const u = access.user;
      if (u.accountRole !== "super_admin" || u.deletedAt !== null || u.status === "disabled" || u.status === "pending_approval" || u.blockedAt !== null) return null;
      let hotelId: string | null = rec.scope === "hotel" ? rec.hotelId : null;
      if (rec.scope === "all") {
        const named = (request.headers.get(API_HOTEL_HEADER) ?? "").trim().toLowerCase();
        if (named !== "") {
          if (!HOTEL_ID_SHAPE.test(named)) throw new AppError("VALIDATION_FAILED", undefined, { fields: { "X-HMS-Hotel": "Not a hotel id" } });
          hotelId = named;
        }
      }
      const token = { id: rec.id, name: rec.name, level: rec.level, scope: rec.scope, testMode: rec.testMode, callsPerMinute: rec.callsPerMinute, ip, newIp: ip !== null && !rec.ipSeen.includes(ip) } as const;
      const who = { userId: u.id, username: u.username, accountRole: u.accountRole, sessionId: rec.id, client: "token", expiresAt: rec.expiresAt, token } as const;
      let session: VerifiedSession;
      if (hotelId === null) {
        session = made({ ...who, hotelId: "", roleId: access.role.id, roleKey: access.role.key, roleLevel: access.role.level, permissions: buildPermissionSnapshot({ catalog, roleGrants: access.grants, userOverrides: access.overrides }) }, access);
      } else {
        const inside = await r.access.loadVisit(u.id, hotelId);
        if (!inside?.hotel || !["active", "suspended"].includes(inside.hotel.status ?? "active")) throw new AppError("NOT_FOUND", "No such hotel.");
        session = made({
          ...who, hotelId: inside.hotel.id, roleId: inside.role.id, roleKey: inside.role.key, roleLevel: inside.role.level, permissions: buildPermissionSnapshot({ catalog, roleGrants: inside.grants, userOverrides: [] }),
          // a read key is a visit (the database transaction is READ ONLY and the wrapper refuses writes); a full key is the hotel's SuperAdmin and can write
          ...(rec.level !== "full" ? { visit: { id: `token:${rec.id}`, hotelId: inside.hotel.id, hotelName: inside.hotel.name, expiresAt: rec.expiresAt, access: "view" as const, by: "super_admin" as const } } : {}),
        }, inside);
      }
      await r.apiTokens.recordUse(rec.id, { at, day: at.toISOString().slice(0, 10), ip });
      return session;
    });
  }

  /** The database's answer for one token hash: one statement, every rule applied in order, the result remembered. */
  async function resolveFresh(hash: string, at: Date): Promise<VerifiedSession | null> {
    const found = await unit.read((r) => r.access.loadBySession(hash, at));
    if (!found) return null;
    const { session: row, access } = found;
    if (row.revokedAt !== null || row.expiresAt <= at) return null;
    if (!access) return null;
    const u = access.user;
    if (u.deletedAt !== null || u.status === "disabled" || u.status === "pending_approval" || u.blockedAt !== null) return null;
    // activity slides the idle window, but never past the absolute lifetime the Super Admin set for this user kind (read in the same statement, so a change applies at the next request)
    const lifeEnds = maxLifeEnd(row.issuedAt, u.accountRole, found.sessionLimits ?? null);
    if (at.getTime() >= lifeEnds.getTime()) return null;
    const expiresAt = lifeEnds < row.expiresAt ? lifeEnds : row.expiresAt;
    const rechecked = row.recheckedAt ? { recheckedAt: row.recheckedAt } : {};
    // a hotel suspended, archived (or otherwise not active) after the sign-in ends the session at the next request (the console also revokes them)
    if (access.hotel && (access.hotel.status ?? "active") !== "active") return null;
    // Platform staff INSIDE a hotel (Enter hotel, BACKEND.md 14.7): while a visit bound to this session is active, the session is that hotel's, with its
    // SuperAdmin permission role, and carries `visit` so the route wrapper refuses every write to a hotel route. Anything else about the visit being wrong
    // (ended, past its 60 minutes, the hotel gone or no longer live) simply leaves the person in the platform console.
    if (PLATFORM_ROLES.has(u.accountRole)) {
      const { visit, visitAccess: inside } = found;
      if (visit && inside?.hotel && ["active", "suspended"].includes(inside.hotel.status ?? "active")) {
        const session = made({
          userId: u.id,
          username: u.username,
          hotelId: inside.hotel.id,
          accountRole: u.accountRole,
          roleId: inside.role.id,
          roleKey: inside.role.key,
          roleLevel: inside.role.level,
          permissions: buildPermissionSnapshot({ catalog, roleGrants: inside.grants, userOverrides: [] }),
          sessionId: row.id,
          client: row.client,
          expiresAt,
          lifeEndsAt: lifeEnds,
          visit: { id: visit.id, hotelId: visit.hotelId, hotelName: visit.hotelName, expiresAt: visit.expiresAt, access: visit.access, by: u.accountRole },
          ...(row.lockedAt ? { locked: true } : {}),
          ...rechecked,
        }, inside);
        remember(hash, session, at);
        return session;
      }
    }
    // a guest or company portal account holds no hotel module at all, whatever its role or overrides say: its portal works through the record scope
    const portal = u.accountRole === "guest_user" || u.accountRole === "corporate_user";
    const permissions = portal ? {} : buildPermissionSnapshot({ catalog, roleGrants: access.grants, userOverrides: access.overrides });
    const session = made({
      userId: u.id,
      username: u.username,
      hotelId: access.hotel?.id ?? "",
      accountRole: u.accountRole,
      roleId: access.role.id,
      roleKey: access.role.key,
      roleLevel: access.role.level,
      permissions,
      sessionId: row.id,
      client: row.client,
      expiresAt,
      lifeEndsAt: lifeEnds,
      ...(access.scope ? { scope: access.scope } : {}),
      ...(row.lockedAt ? { locked: true } : {}),
      ...rechecked,
    }, access);
    remember(hash, session, at);
    return session;
  }

  /** One database read per token at a time: a request that arrives while the read runs awaits the same answer. */
  function lookup(hash: string, at: Date): Promise<VerifiedSession | null> {
    const running = pending.get(hash);
    if (running) return running;
    const read = resolveFresh(hash, at).finally(() => pending.delete(hash));
    pending.set(hash, read);
    return read;
  }

  async function resolveSession(request: Request, options?: { fresh?: boolean }): Promise<VerifiedSession | null> {
    // a bearer is an API key and nothing else: a wrong one is NOT retried as a cookie (so a stray cookie cannot rescue, or be mistaken for, a key)
    const bearer = readBearer(request);
    if (bearer.kind === "bad") return null;
    if (bearer.kind === "token") return resolveToken(request, bearer.token);
    const fromCookie = readCookie(request, SESSION_COOKIE);
    const token = fromCookie !== null && SESSION_TOKEN_SHAPE.test(fromCookie) ? fromCookie : null;
    if (token === null) return null;
    const at = now();
    const hash = hashSessionToken(token);
    // the browser marked this session signed out (lib/auth/signOut.ts: it showed the sign-in page without waiting): it ends here, whichever request comes first
    if (hasSignedOutMark(request)) {
      cache.delete(hash);
      await unit.run(async (r) => {
        const row = await r.sessions.byTokenHash(hash);
        if (!row || row.revokedAt !== null) return;
        await r.sessions.revokeById(row.id, "logout", at);
        await r.events.event({ userId: row.userId, hotelId: row.hotelId, event: "logout", ip: null, userAgent: null, detail: { by: "sign-out mark" }, at });
        await closeVisits(r, row.id, row.userId, null, at);
      });
      return null;
    }
    if (options?.fresh) cache.delete(hash);
    const hit = cache.get(hash);
    if (hit) {
      if (hit.until > at.getTime() && hit.session.expiresAt && hit.session.expiresAt > at) return hit.session;
      cache.delete(hash);
    }
    return lookup(hash, at);
  }

  /** Drops a session from the cache (sign-out, revoke, block; a platform account's visit changes find nothing to drop, as it is never cached). */
  function forgetSession(sessionId: string): void {
    for (const [k, v] of cache) if (v.session.sessionId === sessionId) cache.delete(k);
  }

  const accessOf = (session: VerifiedSession): AccessRecord | null => accessBySession.get(session) ?? null;

  /**
   * Real activity moves a session's idle window forward (at most once a minute). The cached copy learns the new expiry BEFORE the write goes out, so the other
   * requests of one burst in this process see it and return early: one UPDATE per minute, not one per request. The route wrapper runs this after the answer.
   */
  async function touchSession(session: VerifiedSession): Promise<void> {
    if (session.client !== "web") return;
    const at = now();
    const cached = [...cache].filter(([, v]) => v.session.sessionId === session.sessionId);
    const current = cached[0]?.[1].session.expiresAt ?? session.expiresAt;
    if (current && current.getTime() - at.getTime() > (WEB_IDLE_MINUTES * 60 - 60) * 1000) return;
    const idleEnd = at.getTime() + WEB_IDLE_MINUTES * 60_000;
    // the idle window never slides past the kind's absolute lifetime
    const lifeEnd = session.lifeEndsAt?.getTime() ?? idleEnd;
    if (lifeEnd <= at.getTime() || (current && current.getTime() >= lifeEnd)) return;
    const expiresAt = new Date(Math.min(idleEnd, lifeEnd));
    for (const [k, v] of cached) {
      const next: VerifiedSession = { ...v.session, expiresAt };
      const access = accessBySession.get(v.session);
      if (access) accessBySession.set(next, access);
      cache.set(k, { until: v.until, session: next });
    }
    await unit.run((r) => r.sessions.update(session.sessionId, { lastSeenAt: at, expiresAt }));
  }

  /**
   * Why the session named by this request's cookie is over, for the page drawn after it (resolveSession said no): replaced (the person signed in on another
   * device), revoked (an admin, a block, a password change, an account or hotel no longer active) or expired. Null when there is no session cookie, or the
   * session was signed out on purpose (the person then simply sees the sign-in page). One read, no transaction, like resolveSession.
   */
  async function endedReason(request: Request): Promise<"SESSION_REPLACED" | "SESSION_REVOKED" | "SESSION_EXPIRED" | null> {
    const fromCookie = readCookie(request, SESSION_COOKIE);
    const token = fromCookie !== null && SESSION_TOKEN_SHAPE.test(fromCookie) ? fromCookie : null;
    if (token === null) return null;
    // signed out on purpose (the browser's sign-out mark): the plain sign-in page, not "your session ended"
    if (hasSignedOutMark(request)) return null;
    const at = now();
    const row = await unit.read((r) => r.sessions.byTokenHash(hashSessionToken(token)));
    if (!row) return "SESSION_EXPIRED";
    if (row.revokedReason === "logout") return null;
    if (row.revokedReason === "replaced") return "SESSION_REPLACED";
    if (row.revokedReason === "admin" || row.revokedReason === "blocked" || row.revokedReason === "password_changed") return "SESSION_REVOKED";
    if (row.revokedAt === null && row.expiresAt > at) {
      // past the absolute lifetime of the person's kind: an ordinary "your session ended", not "your account changed"
      const { u, limits } = await unit.read(async (r) => ({ u: await r.users.byId(row.userId), limits: (await r.access.security()).sessionMinutes }));
      if (u && pastMaxLife(row.issuedAt, u.accountRole, at, limits)) return "SESSION_EXPIRED";
      // not revoked and not past its time, yet refused: the account or its hotel was stopped
      return "SESSION_REVOKED";
    }
    return "SESSION_EXPIRED";
  }

  return { resolveSession, touchSession, forgetSession, accessOf, endedReason };
}
