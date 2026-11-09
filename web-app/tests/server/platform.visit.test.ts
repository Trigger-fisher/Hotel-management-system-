// Enter hotel and the server-side READ-ONLY guard (P4; docs/BACKEND.md 14.1 and 14.7), through the REAL route files and the REAL session resolver on the
// in-memory double: a written reason, 60 minutes, the session that becomes the hotel's while the visit lasts, the route wrapper that refuses every write to a
// hotel route (whatever the client), the audit rows stamped with the visit, and everything that ends the visit (exit, a new visit, the 60 minutes).
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import { DELETE as depositDelete, PATCH as depositPatch } from "../../src/app/api/v1/revenue/deposits/[id]/route";
import { GET as depositsGet, POST as depositsPost } from "../../src/app/api/v1/revenue/deposits/route";
import { POST as enterRoute } from "../../src/app/api/v1/platform/hotels/[id]/enter/route";
import { POST as exitRoute } from "../../src/app/api/v1/platform/hotels/[id]/exit/route";
import { POST as extendRoute } from "../../src/app/api/v1/platform/hotels/[id]/extend/route";
import { GET as hotelAccessGet, PUT as hotelAccessPut } from "../../src/app/api/v1/platform/staff/[id]/hotel-access/route";
import { POST as adminUsersPost } from "../../src/app/api/v1/admin/users/route";
import { POST as suspendRoute } from "../../src/app/api/v1/platform/hotels/[id]/suspend/route";
import { GET as activityRoute } from "../../src/app/api/v1/platform/activity/route";
import { GET as sessionGet } from "../../src/app/api/v1/auth/session/route";
import { GET as profileGet } from "../../src/app/api/v1/profile/route";
import { GET as preferencesGet } from "../../src/app/api/v1/profile/preferences/route";
import { buildAdminServices, configureAdmin } from "../../src/server/compose/admin";
import { configureAuth } from "../../src/server/compose/auth";
import { parseHashKey } from "../../src/server/crypto/hash";
import { createMemoryRateLimitStore } from "../../src/server/http/limits";
import { createMemoryAdminPlatform } from "../../src/server/repos/memory/adminPlatform";
import { createMemoryAdminUsers } from "../../src/server/repos/memory/adminUsers";
import { createAuthService } from "../../src/server/services/auth/authService";
import { createArgon2Hasher } from "../../src/server/auth/password";
import { SESSION_COOKIE, hashSessionToken, newSessionToken } from "../../src/server/auth/tokens";
import { buildPlatformServices, configurePlatform } from "../../src/server/compose/platform";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import type { VerifiedSession } from "../../src/server/auth/session";
import { configureRoutes, route } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { createMemoryProvisioner } from "../../src/server/provisioner/memory";
import type { UserRecord } from "../../src/server/repos/auth";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { createMemoryPlatformConsole, type MemHotelMeta } from "../../src/server/repos/memory/platformConsole";
import { createCredentialService } from "../../src/server/services/auth/credentialService";
import { createSessionResolver, SESSION_CACHE_MS } from "../../src/server/services/auth/sessionResolver";
import { catalog } from "./helpers/session";

const ORIGIN = "https://hms.test";
const hasher = createArgon2Hasher({ memoryCost: 1024, timeCost: 1, parallelism: 1 });
let clock = new Date("2026-10-05T10:00:00+05:30");
const now = (): Date => new Date(clock.getTime());
const H = { sunrise: randomUUID(), gir: randomUUID(), pending: randomUUID(), old: randomUUID() };
const U: Record<string, string> = {};
const TOKENS: Record<string, string> = {};
type World = ReturnType<typeof build>;
let w: World;
/** A test makes the intent row fail (the audit log is away) to see that the write is then not made. */
let intentOverride: ((session: VerifiedSession, request: Request, traceId: string) => Promise<void>) | null = null;

/** `cacheMs`: 0 for the flows (a change in the data must be seen by the very next request); the cache has its own test below. */
function build(cacheMs = 0) {
  const auth = createMemoryAuth();
  const cons = createMemoryPlatformConsole(auth);
  const data = auth.data();
  const role = (key: string, level: number): string => {
    const id = randomUUID();
    data.roles.push({ id, hotelId: null, key, level, inherits: true });
    return id;
  };
  const viewer = role("viewer", 1);
  const superRole = role("super_admin", 4);
  // platform staff hold a placeholder role with no hotel permission at all (and no hotel: withHotel refuses an empty hotel id on the real database)
  const placeholder = randomUUID();
  data.roles.push({ id: placeholder, hotelId: null, key: "platform_placeholder", level: 0, inherits: false });
  data.rolePermissions.push({ roleId: superRole, key: "revenue", level: "full" }, { roleId: viewer, key: "revenue", level: "view" });
  const meta = (slug: string, over: Partial<MemHotelMeta> = {}): MemHotelMeta => ({
    slug, city: "Rajkot", state: "Gujarat", gstin: "24ABCDE1234F1Z5", timeZone: "Asia/Kolkata", createdAt: new Date("2026-09-01T10:00:00+05:30"), provisionedAt: new Date("2026-09-01T10:00:00+05:30"),
    submittedAt: null, approvedAt: null, rejectedAt: null, rejectReason: null, suspendedAt: null, suspendReason: null, archivedAt: null, archiveReason: null, restoreUntil: null,
    statusBeforeArchive: null, lastActivityAt: null, deletedAt: null, ...over,
  });
  const hotel = (id: string, name: string, status: string, slug: string, over: Partial<MemHotelMeta> = {}): void => {
    data.hotels.push({ id, name, status } as never);
    cons.data.hotels.set(id, meta(slug, over));
  };
  hotel(H.sunrise, "Hotel Sunrise", "active", "hotel-sunrise");
  hotel(H.gir, "Gir Forest Lodge", "suspended", "gir-forest-lodge", { suspendedAt: new Date("2026-09-20T10:00:00+05:30"), suspendReason: "Unpaid" });
  hotel(H.pending, "Moonlight Inn", "pending_approval", "moonlight-inn", { provisionedAt: null });
  hotel(H.old, "Old Palace", "archived", "old-palace", { archivedAt: new Date("2026-09-25T10:00:00+05:30"), restoreUntil: new Date("2026-12-24T10:00:00+05:30"), statusBeforeArchive: "active" });
  const person = (key: string, over: Partial<UserRecord>): void => {
    const id = randomUUID();
    U[key] = id;
    data.users.push({
      id, username: key, email: `${key}@demo.hms`, mobile: null, displayName: key.toUpperCase(), passwordHash: "x", accountRole: "hotel_user", status: "active", mustChangePassword: false,
      passwordChangedAt: null, failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null, codeRequired: false, lastLoginAt: null, deletedAt: null, roleId: viewer, ...over,
    });
    cons.data.accountMeta.set(id, { createdAt: new Date("2026-09-01T10:00:00+05:30"), createdBy: null });
    const token = newSessionToken();
    TOKENS[key] = token;
    data.sessions.push({
      id: randomUUID(), userId: id, hotelId: key === "staff" ? H.sunrise : null, client: "web", tokenHash: hashSessionToken(token), deviceLabel: null, userAgent: null, ip: null,
      issuedAt: now(), lastSeenAt: now(), expiresAt: new Date(now().getTime() + 120 * 60_000), revokedAt: null, revokedReason: null,
    });
  };
  person("pa", { accountRole: "platform_admin", roleId: placeholder, displayName: "Priya Platform", codeRequired: true });
  person("sa", { accountRole: "super_admin", roleId: placeholder, displayName: "Sonal Super", codeRequired: true });
  person("staff", { accountRole: "hotel_user", roleId: viewer });
  data.memberships.push({ userId: U.staff, hotelId: H.sunrise, roleId: null, status: "active", isDefault: true, subject: null });
  const provisioner = createMemoryProvisioner({ auth: () => auth.data(), console: () => cons.data, now });
  const resolver = createSessionResolver({ unit: auth.unit, catalog, now, cacheMs });
  const services = buildPlatformServices({
    unit: cons.unit, credentials: (repos) => createCredentialService({ unit: { run: (work) => work(repos.auth) }, hasher, now }), now, hasher, publicUrl: ORIGIN,
    newToken: () => randomBytes(8).toString("hex"), hashKey: randomBytes(32), provisioner,
    // as compose/platform.ts wires it: a visit started or ended forgets the session in the resolver's cache
    forgetSession: resolver.forgetSession,
  });
  configurePlatform(services);
  const rateLimits = createMemoryRateLimitStore(() => clock.getTime());
  configureAuth({ unit: auth.unit, rateLimits, resolver, service: createAuthService({ unit: auth.unit, catalog, hasher, hashKey: parseHashKey(randomBytes(32).toString("base64")), rateLimits, now }) });
  configureAdmin(buildAdminServices({ catalog, now } as never, createMemoryAdminPlatform().unit, { unit: createMemoryAdminUsers(auth).unit, credentials: createCredentialService({ unit: auth.unit, hasher, now }) }));
  configureRoutes({
    resolveSession: resolver.resolveSession,
    catalog,
    idempotency: createMemoryIdempotencyStore(),
    logger: createLogger({ level: "silent", write: () => undefined }),
    onVisitWriteRefused: (session, request, traceId) => services.visits.recordRefusedWrite(session, request, traceId),
    onVisitWriteIntent: (session, request, traceId) => (intentOverride ?? services.visits.recordIntent)(session, request, traceId),
    onVisitWrite: (session, request, traceId, status) => services.visits.recordWrite(session, request, traceId, status),
  });
  return { auth, cons, resolver };
}

beforeEach(() => {
  intentOverride = null;
  clock = new Date("2026-10-05T10:00:00+05:30");
  w = build();
});

type Route = (r: Request, c: { params: Promise<Record<string, string>> }) => Promise<Response>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: bodies are asserted field by field
async function call(route: Route, method: string, path: string, who: string, opts: { body?: unknown; params?: Record<string, string> } = {}): Promise<{ status: number; data: any; error: any }> {
  const h: Record<string, string> = { host: "hms.test", origin: ORIGIN, "user-agent": "node-test/1.0", cookie: `${SESSION_COOKIE}=${TOKENS[who]}` };
  if (opts.body !== undefined) h["content-type"] = "application/json";
  const res = await route(new Request(`${ORIGIN}${path}`, { method, headers: h, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), { params: Promise.resolve(opts.params ?? {}) });
  const j = await res.json();
  return { status: res.status, data: j.data, error: j.error };
}
const enter = (hotelId: string, reason: unknown, who = "pa") => call(enterRoute, "POST", `/api/v1/platform/hotels/${hotelId}/enter`, who, { body: { reason }, params: { id: hotelId } });
const leave = (hotelId: string, who = "pa") => call(exitRoute, "POST", `/api/v1/platform/hotels/${hotelId}/exit`, who, { params: { id: hotelId } });
const readDeposits = (who = "pa") => call(depositsGet, "GET", "/api/v1/revenue/deposits", who);
const auditOf = (action: string) => w.cons.data.audit.filter((a) => a.action === action);

describe("Enter hotel", () => {
  test("a written reason of 5 to 500 characters is required; staff may not; an unknown hotel is 404; only a live hotel can be entered", async () => {
    for (const reason of ["", "   ", "abcd", "x".repeat(501)]) {
      const r = await enter(H.sunrise, reason);
      assert.equal(r.status, 422, JSON.stringify(reason).slice(0, 12));
      assert.ok(r.error.details.fields.reason);
    }
    assert.equal((await enter(H.sunrise, "Support ticket 4412", "staff")).status, 403);
    assert.equal((await enter(randomUUID(), "Support ticket 4412")).status, 404);
    for (const id of [H.pending, H.old]) {
      const r = await enter(id, "Support ticket 4412");
      assert.equal(r.status, 409);
      assert.equal(r.error.message, "This hotel is not live (waiting for approval, rejected or archived), so it cannot be entered.");
    }
    assert.equal(w.auth.data().visits.length, 0, "nothing was started by a refusal");
    assert.equal((await enter(H.sunrise, { not: "text" })).status, 422);
  });

  test("entering starts a 60-minute read-only visit, audited with the visit; a suspended hotel can be entered too; Super Admin as well", async () => {
    const r = await enter(H.sunrise, "  Support ticket 4412  ");
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.hotel, { id: H.sunrise, name: "Hotel Sunrise", slug: "hotel-sunrise", status: "active" });
    assert.equal(r.data.readOnly, true);
    assert.equal(new Date(r.data.expiresAt).getTime() - clock.getTime(), 60 * 60_000);
    const v = w.auth.data().visits[0];
    assert.deepEqual([v.userId, v.hotelId, v.reason, v.endedAt, v.ip], [U.pa, H.sunrise, "Support ticket 4412", null, null]);
    assert.equal(v.sessionId, w.auth.data().sessions.find((s) => s.userId === U.pa)!.id, "bound to the platform session");
    const a = auditOf("hotel_entered").at(-1)!;
    assert.deepEqual([a.id, a.visitId, a.hotelId, a.reason, a.actorName, a.actorRole, a.result], [r.data.auditId, v.id, H.sunrise, "Support ticket 4412", "Priya Platform", "platform_admin", "success"]);
    assert.equal(r.data.visitId, v.id);
    assert.equal((await enter(H.gir, "Billing dispute 77", "sa")).status, 200, "a suspended hotel is live too");
  });
});

describe("the session cache and visits", () => {
  test("with a caching resolver (SESSION_CACHE_MS) the very next request after Enter shows the visit, and after Exit none: the visit forgets the cached session", async () => {
    w = build(SESSION_CACHE_MS);
    const resolve = () => w.resolver.resolveSession(new Request(`${ORIGIN}/api/v1/x`, { headers: { cookie: `${SESSION_COOKIE}=${TOKENS.pa}` } }));
    assert.equal((await resolve())?.hotelId, "", "cached outside any hotel");
    assert.equal((await enter(H.sunrise, "Support ticket 4412")).status, 200);
    assert.deepEqual([(await resolve())?.hotelId, (await resolve())?.visit?.hotelName], [H.sunrise, "Hotel Sunrise"]);
    assert.equal((await readDeposits()).status, 200);
    assert.equal((await leave(H.sunrise)).status, 200);
    assert.deepEqual([(await resolve())?.hotelId, (await resolve())?.visit], ["", undefined]);
    assert.equal((await readDeposits()).status, 403);
  });
});

describe("inside the hotel: read only, enforced by the server", () => {
  test("without a visit a platform user has no hotel; inside, reads work as the hotel's SuperAdmin and every write is refused with the audit", async () => {
    assert.equal((await readDeposits()).status, 403, "no hotel before Enter");
    await enter(H.sunrise, "Support ticket 4412");
    const read = await readDeposits();
    assert.equal(read.status, 200);
    assert.equal(w.auth.data().visits[0].endedAt, null);
    const post = await call(depositsPost, "POST", "/api/v1/revenue/deposits", "pa", { body: { anything: 1 } });
    assert.equal(post.status, 403);
    assert.equal(post.error.code, "FORBIDDEN");
    assert.equal(post.error.message, "You are viewing Hotel Sunrise as platform staff. This is read-only.");
    const id = randomUUID();
    assert.equal((await call(depositPatch, "PATCH", `/api/v1/revenue/deposits/${id}`, "pa", { body: {}, params: { id } })).status, 403);
    assert.equal((await call(depositDelete, "DELETE", `/api/v1/revenue/deposits/${id}`, "pa", { body: { version: 1 }, params: { id } })).status, 403);
    const refused = auditOf("hotel_write_refused");
    assert.equal(refused.length, 3);
    assert.deepEqual([refused[0].result, refused[0].hotelId, refused[0].visitId, refused[0].actorName, refused[0].reason, refused[0].targetLabel], ["failed", H.sunrise, w.auth.data().visits[0].id, "Priya Platform", "POST /api/v1/revenue/deposits", "Hotel Sunrise"]);
    assert.equal((await readDeposits()).status, 200, "reading still works after a refusal");
  });

  test("the platform console itself stays writable inside a hotel (the person is still platform staff)", async () => {
    await enter(H.sunrise, "Support ticket 4412");
    const r = await call(suspendRoute, "POST", `/api/v1/platform/hotels/${H.gir}/suspend`, "pa", { body: {}, params: { id: H.gir } });
    assert.equal(r.status, 409, "refused by the status machine (already suspended), not by the read-only guard");
    assert.equal(auditOf("hotel_write_refused").length, 0);
    const act = await call(activityRoute, "GET", "/api/v1/platform/activity", "pa");
    assert.equal(act.status, 200);
  });

  test("hotel staff are not affected: their own session is the hotel's, not read only", async () => {
    const r = await call(depositsPost, "POST", "/api/v1/revenue/deposits", "staff", { body: { anything: 1 } });
    assert.notEqual(r.status, 401);
    assert.equal(auditOf("hotel_write_refused").length, 0, "the guard never touched a normal session");
    assert.ok(r.status === 403 || r.status === 422, `refused by permission or validation, not by the visit (${r.status})`);
  });

  test("a different hotel is never reachable through the visit: the session is that one hotel", async () => {
    await enter(H.sunrise, "Support ticket 4412");
    const s = await w.auth.unit.run((r) => r.sessions.byTokenHash(hashSessionToken(TOKENS.pa)));
    assert.equal(s?.hotelId, null, "the stored session did not change; the hotel comes from the visit");
    const resolved = await createSessionResolver({ unit: w.auth.unit, catalog, now }).resolveSession(new Request(`${ORIGIN}/api/v1/x`, { headers: { cookie: `${SESSION_COOKIE}=${TOKENS.pa}` } }));
    assert.deepEqual([resolved?.hotelId, resolved?.roleKey, resolved?.accountRole, resolved?.visit?.hotelName], [H.sunrise, "super_admin", "platform_admin", "Hotel Sunrise"]);
  });
});

describe("the web app's boot sequence inside a visit", () => {
  test("/auth/session, /profile and /profile/preferences keep answering as the platform person, with the visited hotel's context and the visit's server expiry", async () => {
    const before = await call(sessionGet, "GET", "/api/v1/auth/session", "pa");
    assert.equal(before.status, 200);
    assert.equal(before.data.visit, undefined);
    const entered = await enter(H.sunrise, "Support ticket 4412");
    const s = await call(sessionGet, "GET", "/api/v1/auth/session", "pa");
    assert.equal(s.status, 200, JSON.stringify(s.error));
    assert.deepEqual([s.data.user.id, s.data.user.role, s.data.user.hotel], [U.pa, "platform_admin", { id: H.sunrise, name: "Hotel Sunrise", foodName: "Hotel Sunrise Food" }]);
    assert.ok(s.data.user.abilities, "the hotel's SuperAdmin abilities");
    assert.deepEqual(s.data.visit, { id: entered.data.visitId, hotelId: H.sunrise, hotelName: "Hotel Sunrise", expiresAt: entered.data.expiresAt, readOnly: true, access: "view" });
    const p = await call(profileGet, "GET", "/api/v1/profile", "pa");
    assert.equal(p.status, 200, JSON.stringify(p.error));
    assert.equal(p.data.name, "Priya Platform");
    assert.equal((await call(preferencesGet, "GET", "/api/v1/profile/preferences", "pa")).status, 200);
    assert.equal((await readDeposits()).status, 200);
    await leave(H.sunrise);
    const after = await call(sessionGet, "GET", "/api/v1/auth/session", "pa");
    assert.equal(after.status, 200);
    assert.equal(after.data.visit, undefined);
    assert.equal(after.data.user.hotel, null);
    assert.equal((await call(profileGet, "GET", "/api/v1/profile", "pa")).status, 200, "the profile works outside a visit too");
  });
});

describe("leaving", () => {
  test("Exit ends the visit (audited once), the hotel is gone again, and a second exit changes nothing", async () => {
    const e = await enter(H.sunrise, "Support ticket 4412");
    const out = await leave(H.sunrise);
    assert.equal(out.status, 200);
    assert.equal(out.data.visitId, e.data.visitId);
    assert.ok(out.data.auditId);
    const v = w.auth.data().visits[0];
    assert.deepEqual([v.endedReason, v.endedBy], ["exit", U.pa]);
    assert.equal(auditOf("hotel_exited").length, 1);
    assert.equal(auditOf("hotel_exited")[0].visitId, v.id);
    assert.equal((await readDeposits()).status, 403, "back to the console only");
    const again = await leave(H.sunrise);
    assert.equal(again.status, 200);
    assert.equal(again.data.auditId, undefined);
    assert.equal(auditOf("hotel_exited").length, 1);
    assert.equal((await leave(randomUUID())).status, 404);
  });

  test("the 60 minutes end the visit by themselves; entering again starts a new one", async () => {
    await enter(H.sunrise, "Support ticket 4412");
    clock = new Date(clock.getTime() + 59 * 60_000);
    assert.equal((await readDeposits()).status, 200);
    clock = new Date(clock.getTime() + 2 * 60_000);
    assert.equal((await readDeposits()).status, 403, "past the hour: no hotel any more");
    // the platform session itself is still valid (idle window 120 minutes from issue): the console answers
    assert.equal((await call(activityRoute, "GET", "/api/v1/platform/activity", "pa")).status, 200);
    const again = await enter(H.sunrise, "Second look at the ticket");
    assert.equal(again.status, 200);
    assert.equal(w.auth.data().visits.length, 2);
    assert.equal(w.auth.data().visits[0].endedReason, "expired", "the stale one was closed by the new visit");
    assert.equal(auditOf("hotel_exited").length, 0, "no 'left' row for a visit that simply ran out");
  });

  test("entering another hotel closes the first (with its left row): one visit at a time", async () => {
    const first = await enter(H.sunrise, "Support ticket 4412");
    const second = await enter(H.gir, "Billing dispute 77");
    assert.equal(second.status, 200);
    const visits = w.auth.data().visits;
    assert.equal(visits.filter((v) => v.endedAt === null).length, 1);
    assert.deepEqual([visits[0].endedReason, visits[0].hotelId], ["replaced", H.sunrise]);
    assert.equal(auditOf("hotel_exited").length, 1);
    assert.equal(auditOf("hotel_exited")[0].visitId, first.data.visitId);
    const resolved = await createSessionResolver({ unit: w.auth.unit, catalog, now }).resolveSession(new Request(`${ORIGIN}/x`, { headers: { cookie: `${SESSION_COOKIE}=${TOKENS.pa}` } }));
    assert.equal(resolved?.hotelId, H.gir);
  });

  test("a hotel that stops being live ends the visit's effect at once; a revoked session ends it too", async () => {
    await enter(H.sunrise, "Support ticket 4412");
    w.auth.data().hotels.find((h) => h.id === H.sunrise)!.status = "archived";
    assert.equal((await readDeposits()).status, 403);
    w.auth.data().hotels.find((h) => h.id === H.sunrise)!.status = "active";
    assert.equal((await readDeposits()).status, 200);
    const session = w.auth.data().sessions.find((s) => s.userId === U.pa)!;
    session.revokedAt = now();
    assert.equal((await readDeposits()).status, 401);
  });
});

describe("access levels (platform 0135): view and full visits, the deny lists, Extend 60 minutes, a platform admin's hotel access", () => {
  const extend = (hotelId: string, who = "pa") => call(extendRoute, "POST", `/api/v1/platform/hotels/${hotelId}/extend`, who, { params: { id: hotelId } });
  const access = (who: string, id: string, body?: unknown) =>
    body === undefined ? call(hotelAccessGet, "GET", `/api/v1/platform/staff/${id}/hotel-access`, who, { params: { id } }) : call(hotelAccessPut, "PUT", `/api/v1/platform/staff/${id}/hotel-access`, who, { body, params: { id } });
  const usersPost = (who: string) => call(adminUsersPost, "POST", "/api/v1/admin/users", who, { body: {} });

  test("the Super Admin's visit is FULL: hotel writes pass the guard (and land in both logs' trail), the deny list still holds", async () => {
    const e = await enter(H.sunrise, "Fixing a bill for the owner", "sa");
    assert.deepEqual([e.status, e.data.readOnly, e.data.access], [200, false, "full"]);
    const s = await call(sessionGet, "GET", "/api/v1/auth/session", "sa");
    assert.deepEqual([s.data.visit.readOnly, s.data.visit.access], [false, "full"]);
    const post = await call(depositsPost, "POST", "/api/v1/revenue/deposits", "sa", { body: { anything: 1 } });
    assert.equal(post.status, 422, "past the visit guard: refused by the form's own validation");
    assert.equal(auditOf("hotel_write_refused").length, 0);
    const wrote = auditOf("hotel_write");
    assert.equal(wrote.length, 1);
    assert.deepEqual([wrote[0].hotelId, wrote[0].visitId, wrote[0].actorName, wrote[0].reason, wrote[0].result], [H.sunrise, e.data.visitId, "Sonal Super", "POST /api/v1/revenue/deposits (422)", "failed"]);
    // accounts: the Super Admin's full visit reaches the users screen (its own rules decide); a platform admin's never does (below)
    assert.notEqual((await usersPost("sa")).error?.message, "Accounts and roles cannot be changed by platform staff during a visit.");
    assert.equal(auditOf("hotel_write_refused").length, 0);
  });

  test("a platform admin: view by default; none refuses entry (audited); chosen hotels only; never full (MJ, 5 Nov 2026: full power is the Super Admin's only)", async () => {
    // the default (no row): view, all hotels
    const v = await enter(H.sunrise, "Support ticket 4412");
    assert.deepEqual([v.data.readOnly, v.data.access], [true, "view"]);
    assert.equal((await call(depositsPost, "POST", "/api/v1/revenue/deposits", "pa", { body: { anything: 1 } })).status, 403);
    await leave(H.sunrise);
    // none
    assert.equal((await access("sa", U.pa, { level: "none", allHotels: true, reason: "On leave this week" })).status, 200);
    const refused = await enter(H.sunrise, "Support ticket 4412");
    assert.deepEqual([refused.status, refused.error.message], [403, "The Super Admin has not given you access to hotels."]);
    // full is never given to a platform admin
    assert.equal((await access("sa", U.pa, { level: "full", allHotels: false, hotelIds: [H.gir], reason: "Covers the Gir night desk" })).status, 422);
    // view on Gir only: Sunrise (another hotel) is refused, Gir is view only
    assert.equal((await access("sa", U.pa, { level: "view", allHotels: false, hotelIds: [H.gir], reason: "Covers the Gir night desk" })).status, 200);
    assert.equal((await enter(H.sunrise, "Support ticket 4412")).status, 403, "outside the chosen hotels");
    const seen = await enter(H.gir, "Night desk cover");
    assert.deepEqual([seen.status, seen.data.access, seen.data.readOnly], [200, "view", true]);
    assert.equal((await call(depositsPost, "POST", "/api/v1/revenue/deposits", "pa", { body: { anything: 1 } })).status, 403, "a hotel write is refused");
    assert.equal((await usersPost("pa")).status, 403, "accounts and roles never");
    const ext = await extend(H.gir);
    assert.deepEqual([ext.status, ext.data.access], [200, "view"]);
    assert.equal((await call(depositsPost, "POST", "/api/v1/revenue/deposits", "pa", { body: { anything: 1 } })).status, 403);
  });

  test("Extend 60 minutes: the visit is not stretched; it ends as extended and a linked one starts (same reason and access), audited; no visit, no extension", async () => {
    assert.equal((await extend(H.sunrise, "sa")).status, 409, "nothing to extend");
    const e = await enter(H.sunrise, "Month-end check", "sa");
    clock = new Date(clock.getTime() + 50 * 60_000);
    const x = await extend(H.sunrise, "sa");
    assert.equal(x.status, 200);
    assert.equal(new Date(x.data.expiresAt).getTime() - clock.getTime(), 60 * 60_000);
    assert.equal(x.data.access, "full");
    const [old, next] = w.auth.data().visits;
    assert.deepEqual([old.id, old.endedReason, old.endedBy], [e.data.visitId, "extended", U.sa]);
    assert.deepEqual([next.id, next.reason, next.access, next.extendedFrom, next.endedAt], [x.data.visitId, "Month-end check", "full", old.id, null]);
    const a = auditOf("hotel_visit_extended");
    assert.deepEqual([a.length, a[0].visitId, a[0].hotelId], [1, next.id, H.sunrise]);
    clock = new Date(clock.getTime() + 30 * 60_000);
    assert.equal((await readDeposits("sa")).status, 200, "80 minutes after entering, still inside");
    assert.equal((await extend(H.gir, "sa")).status, 409, "only the hotel being visited");
  });

  test("hotel access: Super Admin only, a platform admin's account only, validated and audited", async () => {
    const got = await access("sa", U.pa);
    assert.deepEqual(got.data, { userId: U.pa, level: "view", allHotels: true, hotelIds: [], reason: null, updatedBy: null, updatedAt: null });
    assert.equal((await access("pa", U.pa)).status, 403);
    assert.equal((await access("pa", U.pa, { level: "full", allHotels: true, reason: "Raising myself" })).status, 403);
    assert.equal((await access("sa", U.sa)).status, 404, "a Super Admin has no such setting");
    assert.equal((await access("sa", randomUUID())).status, 404);
    assert.equal((await access("sa", U.pa, { level: "full", allHotels: false, hotelIds: [H.gir], reason: "Night desk" })).status, 422, "full is the Super Admin's only");
    assert.equal((await access("sa", U.pa, { level: "view", allHotels: true, reason: "abc" })).status, 422);
    assert.equal((await access("sa", U.pa, { level: "view", allHotels: false, hotelIds: [], reason: "Night desk" })).status, 422);
    assert.equal((await access("sa", U.pa, { level: "view", allHotels: false, hotelIds: [randomUUID()], reason: "Night desk" })).status, 422);
    const set = await access("sa", U.pa, { level: "view", allHotels: false, hotelIds: [H.gir, H.gir], reason: "Night desk" });
    assert.deepEqual([set.status, set.data.level, set.data.hotelIds, set.data.updatedBy], [200, "view", [H.gir], "Sonal Super"]);
    const a = auditOf("platform_admin_access_changed").filter((x) => x.result === "success");
    assert.equal(a.length, 1);
    assert.ok(auditOf("platform_admin_access_changed").some((x) => x.result === "failed" && x.actorName === "Priya Platform"), "the platform admin's own attempt is on record");
    assert.deepEqual([a[0].entityId, a[0].reason, a[0].targetLabel], [U.pa, "Night desk", "Priya Platform"]);
  });
});

describe("a full visit's write is recorded BEFORE it is done (security review round 3, R3-8)", () => {
  let ran = 0;
  const probe = route({ permission: "session", handler: async () => ({ data: { ran: ++ran } }) });
  const post = (who: string) => call(probe, "POST", "/api/v1/front-office/probe", who);
  const rowsOf = (...actions: string[]) => w.cons.data.audit.map((a, i) => ({ a, i })).filter((x) => actions.includes(x.a.action));

  test("the intent row (who, hotel, route, time) is written first, the result row after it with the same trace and visit; both are kept", async () => {
    ran = 0;
    const e = await enter(H.sunrise, "Fixing a bill for the owner", "sa");
    const r = await post("sa");
    assert.deepEqual([r.status, ran], [200, 1]);
    const [started, wrote] = [rowsOf("hotel_write_started"), rowsOf("hotel_write")];
    assert.deepEqual([started.length, wrote.length], [1, 1]);
    assert.ok(started[0].i < wrote[0].i, "the intent comes first");
    assert.deepEqual([started[0].a.hotelId, started[0].a.visitId, started[0].a.actorName, started[0].a.reason, started[0].a.result], [H.sunrise, e.data.visitId, "Sonal Super", "POST /api/v1/front-office/probe", "success"]);
    assert.deepEqual([wrote[0].a.reason, wrote[0].a.result, wrote[0].a.visitId], ["POST /api/v1/front-office/probe (200)", "success", e.data.visitId]);
    assert.equal(started[0].a.traceId, wrote[0].a.traceId, "one trace id ties the two rows");
  });

  test("when the intent row cannot be written the change is NOT made (500); the result row still says it failed", async () => {
    ran = 0;
    await enter(H.sunrise, "Fixing a bill for the owner", "sa");
    intentOverride = async () => {
      throw new Error("the audit log is away");
    };
    const r = await post("sa");
    assert.deepEqual([r.status, ran], [500, 0]);
    assert.equal(rowsOf("hotel_write_started").length, 0);
    assert.deepEqual(rowsOf("hotel_write").map((x) => [x.a.result, x.a.reason]), [["failed", "POST /api/v1/front-office/probe (500)"]]);
  });

  test("a write that fails in its handler leaves the intent row and a failed result row (nothing lost, nothing hidden)", async () => {
    await enter(H.sunrise, "Fixing a bill for the owner", "sa");
    const boom = route({ permission: "session", handler: async () => { throw new Error("the hotel's database went away"); } });
    const r = await call(boom, "POST", "/api/v1/front-office/boom", "sa");
    assert.equal(r.status, 500);
    assert.deepEqual([rowsOf("hotel_write_started").length, rowsOf("hotel_write").map((x) => x.a.result)], [1, ["failed"]]);
  });

  test("nothing is written for what is not a hotel write: a read, a console write, a view visit's refused write", async () => {
    ran = 0;
    await enter(H.sunrise, "Looking only", "pa");
    assert.equal((await call(depositsGet, "GET", "/api/v1/revenue/deposits", "pa")).status, 200);
    assert.equal((await post("pa")).status, 403, "a view visit still cannot write");
    assert.deepEqual([ran, rowsOf("hotel_write_started").length, rowsOf("hotel_write").length, rowsOf("hotel_write_refused").length], [0, 0, 0, 1]);
    const console = await call(suspendRoute, "POST", `/api/v1/platform/hotels/${H.gir}/suspend`, "pa", { body: {}, params: { id: H.gir } });
    assert.equal(console.status, 409, "a console write is the console's own business");
    assert.equal(rowsOf("hotel_write_started").length, 0);
  });
});