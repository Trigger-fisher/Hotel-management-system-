// API access keys (platform migration 0129; docs/plans/API-ACCESS-TOKENS-PLAN-2026-10-18.md), end to end on the in-memory double: the real management routes, the real session
// resolver and the real route wrapper. What must hold: only a keyed hash is stored and the key is shown once; a read key never writes; a full key needs the Super Admin's switch,
// an IP list, a reason and a short life, and stops the moment the switch goes off; scope is enforced; the deny list holds for every key (and a route-inventory check keeps it
// complete); revoke, revoke all, expiry, the address list and a disabled creator kill a key at once; a wrong bearer is never rescued by a cookie; test mode queues no mail and
// nothing else outside; every write, refusal and first use from a new address is audited as "API token: <name>"; the per-key limit holds.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, test } from "node:test";
import { GET as keysGet, POST as keysCreate } from "../../src/app/api/v1/platform/api-tokens/route";
import { POST as keyRevoke } from "../../src/app/api/v1/platform/api-tokens/[id]/revoke/route";
import { POST as keysRevokeAll } from "../../src/app/api/v1/platform/api-tokens/revoke-all/route";
import { POST as keysTest } from "../../src/app/api/v1/platform/api-tokens/test/route";
import { PUT as fullAccessPut } from "../../src/app/api/v1/platform/api-tokens/full-access/route";
import { GET as settingsGet, PUT as settingsPut } from "../../src/app/api/v1/platform/settings/route";
import { API_TOKEN_SHAPE, readBearer, tokenCallVerdict, tokenPathVerdict } from "../../src/server/auth/apiTokens";
import { createArgon2Hasher } from "../../src/server/auth/password";
import { SESSION_COOKIE, hashSessionToken, newSessionToken } from "../../src/server/auth/tokens";
import { buildPlatformServices, configurePlatform } from "../../src/server/compose/platform";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createRouteFactory, type RouteDeps } from "../../src/server/http/wrapper";
import { createLogger } from "../../src/server/logger";
import { createMemoryProvisioner } from "../../src/server/provisioner/memory";
import type { UserRecord } from "../../src/server/repos/auth";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { createMemoryPlatformConsole, type MemHotelMeta } from "../../src/server/repos/memory/platformConsole";
import { inTestMode } from "../../src/server/runtime/testMode";
import { createCredentialService } from "../../src/server/services/auth/credentialService";
import { createSessionResolver } from "../../src/server/services/auth/sessionResolver";
import { catalog } from "./helpers/session";

const ORIGIN = "https://hms.test";
const IP = "203.0.113.7";
const OTHER_IP = "198.51.100.9";
const hasher = createArgon2Hasher({ memoryCost: 1024, timeCost: 1, parallelism: 1 });
const HASH_KEY = randomBytes(32);
let clock = new Date("2026-10-18T10:00:00+05:30");
const now = (): Date => new Date(clock.getTime());
const H = { sunrise: randomUUID(), gir: randomUUID() };
const U: Record<string, string> = {};
const COOKIES: Record<string, string> = {};
type World = ReturnType<typeof build>;
let w: World;

function build() {
  const auth = createMemoryAuth();
  const cons = createMemoryPlatformConsole(auth);
  const data = auth.data();
  // the hotel's built-in SuperAdmin permission role: what a key (like an Enter-hotel visit) gets inside a hotel
  data.roles.push({ id: randomUUID(), hotelId: null, key: "super_admin", level: 4, inherits: true });
  // every person has a permission role (the access lookup needs one), as in the other platform tests
  const viewer = randomUUID();
  data.roles.push({ id: viewer, hotelId: null, key: "viewer", level: 1, inherits: true });
  const meta = (slug: string): MemHotelMeta => ({
    slug, city: "Rajkot", state: "Gujarat", gstin: "24ABCDE1234F1Z5", timeZone: "Asia/Kolkata", createdAt: new Date("2026-06-01T10:00:00+05:30"), provisionedAt: new Date("2026-06-01T10:00:00+05:30"),
    submittedAt: null, approvedAt: null, rejectedAt: null, rejectReason: null, suspendedAt: null, suspendReason: null, archivedAt: null, archiveReason: null, restoreUntil: null,
    statusBeforeArchive: null, lastActivityAt: null, deletedAt: null,
  });
  for (const [id, name, slug] of [[H.sunrise, "Hotel Sunrise", "hotel-sunrise"], [H.gir, "Gir Lodge", "gir-lodge"]] as const) {
    data.hotels.push({ id, name, status: "active" } as never);
    cons.data.hotels.set(id, meta(slug));
  }
  const person = (key: string, over: Partial<UserRecord>): void => {
    const id = randomUUID();
    U[key] = id;
    data.users.push({
      id, username: key, email: `${key}@demo.hms`, mobile: null, displayName: key.toUpperCase(), passwordHash: "x", accountRole: "hotel_user", status: "active", mustChangePassword: false,
      passwordChangedAt: null, failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null, codeRequired: false, lastLoginAt: null, deletedAt: null, roleId: viewer, ...over,
    });
    cons.data.accountMeta.set(id, { createdAt: new Date("2026-09-01T10:00:00+05:30"), createdBy: null });
    const token = newSessionToken();
    COOKIES[key] = token;
    data.sessions.push({
      id: randomUUID(), userId: id, hotelId: null, client: "web", tokenHash: hashSessionToken(token), deviceLabel: null, userAgent: null, ip: null,
      issuedAt: now(), lastSeenAt: now(), expiresAt: new Date(now().getTime() + 120 * 60_000), revokedAt: null, revokedReason: null,
    });
  };
  person("sa", { accountRole: "super_admin", displayName: "Sonal Super" });
  person("pa", { accountRole: "platform_admin", displayName: "Priya Platform" });
  const services = buildPlatformServices({
    unit: cons.unit, credentials: (repos) => createCredentialService({ unit: { run: (work) => work(repos.auth) }, hasher, now }), now, hasher, publicUrl: ORIGIN,
    newToken: () => randomBytes(8).toString("hex"), hashKey: HASH_KEY, provisioner: createMemoryProvisioner({ auth: () => auth.data(), console: () => cons.data, now }),
  });
  configurePlatform(services);
  const resolver = createSessionResolver({ unit: auth.unit, catalog, now, hashKey: () => HASH_KEY });
  const deps: RouteDeps = {
    resolveSession: resolver.resolveSession,
    catalog,
    idempotency: createMemoryIdempotencyStore(),
    logger: createLogger({ level: "silent", write: () => undefined }),
    onTokenEvent: (session, request, traceId, event) => services.apiTokens.recordEvent(session, request, traceId, event),
  };
  configureRoutes(deps);
  return { auth, cons, services, resolver, deps };
}

beforeEach(() => {
  clock = new Date("2026-10-18T10:00:00+05:30");
  w = build();
});

type Route = (r: Request, c: { params: Promise<Record<string, string>> }) => Promise<Response>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: bodies are asserted field by field
type Answer = { status: number; data: any; error: any };
/** A call as the person in the browser (cookie) or with a key (bearer, from an address). */
async function call(route: Route, method: string, url: string, as: { cookie?: string; key?: string; ip?: string; hotel?: string; bearer?: string }, opts: { body?: unknown; params?: Record<string, string> } = {}): Promise<Answer> {
  const h: Record<string, string> = { host: "hms.test", "user-agent": "node-test/1.0" };
  if (as.cookie) {
    h.cookie = `${SESSION_COOKIE}=${COOKIES[as.cookie]}`;
    h.origin = ORIGIN;
  }
  if (as.key) h.authorization = `Bearer ${as.key}`;
  if (as.bearer) h.authorization = as.bearer;
  h["x-forwarded-for"] = as.ip ?? IP;
  if (as.hotel) h["x-hms-hotel"] = as.hotel;
  if (opts.body !== undefined) h["content-type"] = "application/json";
  const res = await route(new Request(`${ORIGIN}${url}`, { method, headers: h, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), { params: Promise.resolve(opts.params ?? {}) });
  const j = (await res.json()) as { data?: unknown; error?: unknown };
  return { status: res.status, data: j.data, error: j.error };
}
const KEYS = "/api/v1/platform/api-tokens";
const asSa = { cookie: "sa" };
const readKey = (over: Record<string, unknown> = {}) => ({ name: "Claude testing", level: "read", scope: "platform", expiresInHours: 24 * 7, ipAllow: [], ...over });
const fullKey = (over: Record<string, unknown> = {}) => ({ name: "Load test", level: "full", scope: "all", expiresInHours: 6, ipAllow: [IP], reason: "Load test on staging", confirmFull: true, ...over });
async function makeKey(body: Record<string, unknown>): Promise<string> {
  const r = await call(keysCreate, "POST", KEYS, asSa, { body });
  assert.equal(r.status, 201, JSON.stringify(r.error));
  return r.data.key as string;
}
async function fullOn(): Promise<void> {
  const r = await call(fullAccessPut, "PUT", `${KEYS}/full-access`, asSa, { body: { enabled: true, reason: "Heavy testing this week", confirm: true } });
  assert.equal(r.status, 200, JSON.stringify(r.error));
}
const audit = (action: string) => w.cons.data.audit.filter((a) => a.action === action);
const settingsBody = async (key: string) => {
  const r = await call(settingsGet, "GET", "/api/v1/platform/settings", { key });
  return { defaultGstPercent: r.data.defaultGstPercent, defaultTimeZone: r.data.defaultTimeZone };
};

/** A tiny route through the real wrapper, to see what a key's session looks like inside a handler and to queue a mail from inside one. */
function probeRoutes() {
  const f = createRouteFactory(w.deps);
  const look = f.route({ permission: "session", handler: async ({ session }) => ({ data: { hotelId: session.hotelId, visit: session.visit !== undefined, client: session.client, testMode: inTestMode() } }) });
  const mail = f.route({
    permission: "session",
    handler: async () => {
      await w.auth.unit.run((r) => r.outbox.enqueue({ userId: null, kind: "login_code", toEmail: "someone@example.test", template: "login-code", payload: "{}" }, now()));
      return { data: { queued: true } };
    },
  });
  return { look: look as Route, mail: mail as Route };
}

describe("the pure rules", () => {
  test("a bearer must have the key's exact shape; anything else is 'bad', never a cookie fallback", () => {
    const req = (auth?: string) => new Request(ORIGIN, { headers: auth ? { authorization: auth } : {} });
    assert.equal(readBearer(req()).kind, "none");
    assert.equal(readBearer(req("Bearer nope")).kind, "bad");
    assert.equal(readBearer(req("Basic abc")).kind, "bad");
    const key = `hms_pat_${"a".repeat(43)}`;
    assert.ok(API_TOKEN_SHAPE.test(key));
    assert.deepEqual(readBearer(req(`Bearer ${key}`)), { kind: "token", token: key });
  });

  test("the deny list holds for every key; the scope and the level decide the rest; test mode blocks test emails", () => {
    for (const p of ["/api/v1/auth/session", "/api/v1/auth/sign-in", "/api/v1/profile/password", "/api/v1/platform/api-tokens", "/api/v1/platform/api-tokens/x/revoke", "/api/v1/admin/razorpay/payment-links",
      "/api/v1/admin/backup/run", "/api/v1/platform/hotels/x/export", "/api/v1/platform/hotels/x/delete-permanently", "/api/v1/platform/users/x/reset-password", "/api/v1/front-office/stays/x/id-photo",
      "/api/v1/cron/mail", "/api/v1/payroll/companies/x/salary-profiles", "/api/v1/platform/invitations", "/api/v1/guest/profile"]) {
      assert.equal(tokenPathVerdict(p).allowed, false, p);
      assert.equal(tokenCallVerdict({ level: "full", scope: "all", testMode: false }, "GET", p).allowed, false, p);
    }
    const v = (level: "read" | "full", scope: "platform" | "hotel" | "all", method: string, p: string, testMode = true) => tokenCallVerdict({ level, scope, testMode }, method, p).allowed;
    assert.equal(v("read", "platform", "GET", "/api/v1/platform/hotels"), true);
    assert.equal(v("read", "platform", "PUT", "/api/v1/platform/settings"), false, "a read key never writes");
    assert.equal(v("read", "platform", "GET", "/api/v1/rooms"), false, "a console key does not reach hotels");
    assert.equal(v("read", "hotel", "GET", "/api/v1/platform/hotels"), false, "a one-hotel key does not reach the console");
    assert.equal(v("full", "hotel", "POST", "/api/v1/front-office/stays"), true, "a full key writes in its hotel");
    assert.equal(v("full", "all", "POST", "/api/v1/platform/hotels/x/suspend"), true, "and on the console with scope all");
    assert.equal(v("full", "platform", "POST", "/api/v1/platform/settings/smtp-test"), false, "test mode: no test email");
  });

  test("no key writes lasting access (review round 2, M3): accounts, the mail server and identities, webhook keys, hotel visits; reading them follows the key's level", () => {
    const full = (method: string, p: string) => tokenCallVerdict({ level: "full", scope: "all", testMode: false }, method, p);
    for (const [method, p] of [
      ["POST", "/api/v1/platform/staff"], ["POST", "/api/v1/platform/staff/x/disable"], ["POST", "/api/v1/platform/staff/x/enable"], ["PUT", "/api/v1/platform/staff/x/hotel-access"],
      ["POST", "/api/v1/platform/hotel-admins/x/enable"], ["POST", "/api/v1/platform/hotel-admins/x/unlock"], ["POST", "/api/v1/platform/hotels/x/admins"],
      ["POST", "/api/v1/platform/users/x/disable"], ["POST", "/api/v1/platform/users/x/enable"], ["PUT", "/api/v1/platform/groups/x/admin"], ["POST", "/api/v1/group/hotel-admins/x/enable"],
      ["PUT", "/api/v1/platform/settings"], ["POST", "/api/v1/platform/settings/smtp-test"], ["PUT", "/api/v1/platform/mail-identities/platform"], ["POST", "/api/v1/platform/mail-identities/platform/check"],
      ["POST", "/api/v1/platform/mail-safety/webhooks/ses/rotate"], ["POST", "/api/v1/platform/hotels/x/enter"], ["POST", "/api/v1/platform/hotels/x/extend"], ["POST", "/api/v1/group/hotels/x/enter"],
    ] as const) {
      const r = full(method, p);
      assert.equal(r.allowed, false, `${method} ${p}`);
    }
    assert.deepEqual(full("POST", "/api/v1/platform/staff"), { allowed: false, why: "Accounts are managed in the browser, never with an API key." });
    for (const p of ["/api/v1/platform/staff", "/api/v1/platform/settings", "/api/v1/platform/mail-identities/platform"]) assert.equal(full("GET", p).allowed, true, `reading ${p} stays open`);
  });

  test("write inventory: every console or group write route that touches accounts, mail settings or visits is refused to every key, or listed here with the reason", () => {
    const LASTING = /\/(staff|hotel-admins|users|admins?|settings|mail-identities|webhooks|enter|exit|extend|hotel-access)(\/|$)/;
    const ALLOWED: Record<string, string> = {};
    const root = path.join(__dirname, "..", "..", "src", "app", "api", "v1");
    const writes: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name === "route.ts" && /export const (POST|PUT|PATCH|DELETE)\b/.test(readFileSync(p, "utf8"))) writes.push(`/api/v1/${path.relative(root, dir).split(path.sep).join("/")}`.replace(/\[[^\]]+\]/g, "x"));
      }
    };
    walk(path.join(root, "platform"));
    walk(path.join(root, "group"));
    const open = writes.filter((r) => LASTING.test(r) && !(r in ALLOWED) && tokenCallVerdict({ level: "full", scope: "all", testMode: false }, "POST", r).allowed);
    assert.deepEqual(open, [], "add each to WRITE_DENIED in server/auth/apiTokens.ts, or to ALLOWED here with the reason");
  });

  test("route inventory: every route whose address looks sensitive is either denied to keys or listed here as safe, with the reason", () => {
    const RISKY = /(image|photo|media|upload|scan|proof|download|export|backup|credential|secret|razorpay|payment|password|reset|portal-link|sign-in|session|profile|cron|worker|invitation|onboarding|token|salary|slip|letter|login)/;
    const SAFE: Record<string, string> = {
      "/api/v1/webhooks/razorpay/x/x": "Razorpay's own call: no session, so no key is ever read; it is signed with the business's webhook secret",
      "/api/v1/public/hotels/x/media/x": "a public route (the hotel website's own photos): no session, so no key is ever read",
      "/api/v1/website/media/x": "the hotel's own website photos (public on its website anyway)",
      "/api/v1/website/photos": "the hotel's own website photo gallery",
      "/api/v1/website/photos/x": "the hotel's own website photo gallery",
      "/api/v1/website/photos/x/move": "the hotel's own website photo gallery",
      "/api/v1/admin/menu/images/x": "the restaurant menu's photos",
    "/api/v1/admin/menu/items/x/photo": "a room-service menu item's photo (the same photo every guest sees on the menu)",
    };
    const root = path.join(__dirname, "..", "..", "src", "app", "api", "v1");
    const routes: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name === "route.ts") routes.push(`/api/v1/${path.relative(root, dir).split(path.sep).join("/")}`.replace(/\[[^\]]+\]/g, "x").replace(/\/$/, ""));
      }
    };
    walk(root);
    assert.ok(routes.length > 300, "found the route files");
    const unclassified = routes.filter((r) => RISKY.test(r) && tokenPathVerdict(r).allowed && !(r in SAFE));
    assert.deepEqual(unclassified, [], "deny these in server/auth/apiTokens.ts DENIED, or list them in SAFE with the reason");
  });

  test("Conversations (decision 66): no key reads or sends a hotel's or the platform's messages, at any level or scope", () => {
    const MUST_DENY = ["/api/v1/conversations", "/api/v1/conversations/x/messages/x/attachments/0", "/api/v1/platform/conversations", "/api/v1/platform/conversations/mailbox"];
    for (const p of MUST_DENY) {
      assert.equal(tokenPathVerdict(p).allowed, false, p);
      for (const scope of ["hotel", "platform", "all"] as const) assert.equal(tokenCallVerdict({ level: "full", scope, testMode: false }, "GET", p).allowed, false, `${scope} ${p}`);
    }
    // every route file under the two hubs is covered
    const root = path.join(__dirname, "..", "..", "src", "app", "api", "v1");
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name === "route.ts") found.push(`/api/v1/${path.relative(root, dir).split(path.sep).join("/")}`.replace(/\[[^\]]+\]/g, "x"));
      }
    };
    walk(path.join(root, "conversations"));
    walk(path.join(root, "platform", "conversations"));
    assert.ok(found.length >= 38, `found ${found.length} Conversations routes`);
    assert.deepEqual(found.filter((r) => tokenPathVerdict(r).allowed), []);
  });

  test("My mailbox (platform 0178, 0179): no key reads or sends a personal mailbox, at any level or scope; every route file under it is covered", () => {
    const MUST_DENY = ["/api/v1/my-mailbox/address", "/api/v1/my-mailbox/mail", "/api/v1/my-mailbox/mail/x/messages/x/attachments/0", "/api/v1/my-mailbox/mail/sync"];
    for (const p of MUST_DENY) {
      assert.equal(tokenPathVerdict(p).allowed, false, p);
      for (const scope of ["hotel", "platform", "all"] as const) for (const method of ["GET", "PUT", "DELETE"]) assert.equal(tokenCallVerdict({ level: "full", scope, testMode: false }, method, p).allowed, false, `${scope} ${method} ${p}`);
    }
    const root = path.join(__dirname, "..", "..", "src", "app", "api", "v1", "my-mailbox");
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name === "route.ts") found.push(`/api/v1/my-mailbox/${path.relative(root, dir).split(path.sep).join("/")}`.replace(/\[[^\]]+\]/g, "x").replace(/\/$/, ""));
      }
    };
    walk(root);
    assert.ok(found.length >= 19, `found ${found.length} My mailbox routes`);
    assert.deepEqual(found.filter((r) => tokenPathVerdict(r).allowed), []);
  });
});

describe("making, listing and revoking keys (Super Admin, browser only)", () => {
  test("a key is shown once; only a keyed hash is stored; the list never shows it; the audit names it, never the key", async () => {
    const r = await call(keysCreate, "POST", KEYS, asSa, { body: readKey({ ipAllow: [IP] }) });
    assert.equal(r.status, 201);
    const key = r.data.key as string;
    assert.ok(API_TOKEN_SHAPE.test(key));
    assert.equal(r.data.apiKey.prefix, key.slice(0, 12));
    const everything = JSON.stringify({ auth: w.auth.data(), audit: w.cons.data.audit });
    assert.ok(!everything.includes(key), "the key is stored nowhere");
    const list = await call(keysGet, "GET", KEYS, asSa);
    assert.ok(!JSON.stringify(list.data).includes(key), "the list never shows it");
    assert.deepEqual([list.data.keys.length, list.data.keys[0].status, list.data.activeCount, list.data.fullAccess.enabled], [1, "active", 1, false]);
    const a = audit("api_token_created").at(-1)!;
    assert.deepEqual([a.actorName, a.targetLabel, a.result], ["Sonal Super", "Claude testing", "success"]);
    assert.ok(!JSON.stringify(a).includes(key));
  });

  test("Test a key (the Set-up centre's API step): a plain answer for a working key, a wrong one and a revoked one; Super Admin only; the key is never stored", async () => {
    const key = await makeKey(readKey());
    const ok = await call(keysTest, "POST", `${KEYS}/test`, asSa, { body: { token: key } });
    assert.equal(ok.data.ok, true);
    assert.match(ok.data.message, /^This key works for /);
    const wrong = await call(keysTest, "POST", `${KEYS}/test`, asSa, { body: { token: `${key}x` } });
    assert.equal(wrong.data.ok, false);
    assert.equal((await call(keysTest, "POST", `${KEYS}/test`, { cookie: "pa" }, { body: { token: key } })).status, 403);
    assert.ok(!JSON.stringify({ auth: w.auth.data(), audit: w.cons.data.audit }).includes(key));
  });

  test("only a Super Admin may manage keys; a key may never manage keys (not even list them)", async () => {
    assert.equal((await call(keysGet, "GET", KEYS, { cookie: "pa" })).status, 403);
    assert.equal((await call(keysCreate, "POST", KEYS, { cookie: "pa" }, { body: readKey() })).status, 403);
    const key = await makeKey(readKey());
    for (const [route, method, body] of [[keysGet, "GET", undefined], [keysCreate, "POST", readKey()], [keysRevokeAll, "POST", { reason: "trying" }]] as const) {
      const r = await call(route as Route, method, KEYS, { key }, { body });
      assert.equal(r.status, 403, `${method} with a key`);
    }
  });

  test("the form is checked on the server: expiry choices, addresses, hotel, at most 5 active keys", async () => {
    assert.equal((await call(keysCreate, "POST", KEYS, asSa, { body: readKey({ expiresInHours: 24 * 60 }) })).status, 422);
    assert.equal((await call(keysCreate, "POST", KEYS, asSa, { body: readKey({ ipAllow: ["not-an-ip"] }) })).status, 422);
    assert.equal((await call(keysCreate, "POST", KEYS, asSa, { body: readKey({ scope: "hotel" }) })).status, 422, "a one-hotel key names its hotel");
    assert.equal((await call(keysCreate, "POST", KEYS, asSa, { body: readKey({ scope: "hotel", hotelId: randomUUID() }) })).status, 422, "a hotel that does not exist");
    for (let i = 0; i < 5; i++) await makeKey(readKey({ name: `k${i}` }));
    const sixth = await call(keysCreate, "POST", KEYS, asSa, { body: readKey({ name: "k6" }) });
    assert.equal(sixth.status, 409);
  });

  test("revoke and revoke all take effect on the very next call", async () => {
    const one = await makeKey(readKey({ name: "one" }));
    const two = await makeKey(readKey({ name: "two" }));
    assert.equal((await call(settingsGet, "GET", "/api/v1/platform/settings", { key: one })).status, 200);
    const id = (await call(keysGet, "GET", KEYS, asSa)).data.keys.find((k: { name: string }) => k.name === "one").id;
    assert.deepEqual((await call(keyRevoke, "POST", `${KEYS}/${id}/revoke`, asSa, { params: { id } })).data, { revoked: true });
    assert.equal((await call(settingsGet, "GET", "/api/v1/platform/settings", { key: one })).status, 401);
    assert.equal((await call(settingsGet, "GET", "/api/v1/platform/settings", { key: two })).status, 200);
    assert.deepEqual((await call(keysRevokeAll, "POST", `${KEYS}/revoke-all`, asSa, { body: { reason: "Testing is over" } })).data, { revoked: 1 });
    assert.equal((await call(settingsGet, "GET", "/api/v1/platform/settings", { key: two })).status, 401);
    assert.equal(audit("api_token_revoked").length, 2);
  });
});

describe("calling with a read key", () => {
  test("reads the console; every write is refused and audited as the key; the deny list holds", async () => {
    const key = await makeKey(readKey());
    const r = await call(settingsGet, "GET", "/api/v1/platform/settings", { key });
    assert.equal(r.status, 200);
    const put = await call(settingsPut, "PUT", "/api/v1/platform/settings", { key }, { body: await settingsBody(key) });
    assert.deepEqual([put.status, put.error.message], [403, "This API key is read only."]);
    const refused = audit("api_token_refused").at(-1)!;
    assert.deepEqual([refused.actorName, refused.result, refused.targetLabel], ["API token: Claude testing", "failed", "PUT /api/v1/platform/settings"]);
  });

  test("expired, outside its address list, a disabled creator, a wrong bearer: a plain 401, and a cookie never rescues a wrong bearer", async () => {
    const key = await makeKey(readKey({ ipAllow: [IP], expiresInHours: 24 }));
    assert.equal((await call(settingsGet, "GET", "/api/v1/platform/settings", { key, ip: OTHER_IP })).status, 401, "outside the address list");
    assert.equal((await call(settingsGet, "GET", "/api/v1/platform/settings", { key, ip: IP })).status, 200);
    // R3-6: the address is the entry the proxy ADDED (the last), never one the caller wrote in front of it
    assert.equal((await call(settingsGet, "GET", "/api/v1/platform/settings", { key, ip: `${IP}, ${OTHER_IP}` })).status, 401, "a caller who wrote the allowed address first is still the address the proxy saw");
    assert.equal((await call(settingsGet, "GET", "/api/v1/platform/settings", { key, ip: `${OTHER_IP}, ${IP}` })).status, 200, "what the caller wrote in front does not matter");
    assert.equal((await call(settingsGet, "GET", "/api/v1/platform/settings", { cookie: "sa", bearer: "Bearer wrong" })).status, 401, "no cookie fallback");
    assert.equal((await call(settingsGet, "GET", "/api/v1/platform/settings", { bearer: `Bearer hms_pat_${"z".repeat(43)}` })).status, 401, "an unknown key");
    w.auth.data().users.find((u) => u.id === U.sa)!.status = "disabled";
    assert.equal((await call(settingsGet, "GET", "/api/v1/platform/settings", { key })).status, 401, "the creator is no longer an active Super Admin");
    w.auth.data().users.find((u) => u.id === U.sa)!.status = "active";
    clock = new Date(clock.getTime() + 25 * 3_600_000);
    assert.equal((await call(settingsGet, "GET", "/api/v1/platform/settings", { key })).status, 401, "expired");
  });

  test("in a hotel a read key is a read-only visit; a one-hotel key reaches only its hotel; scope all names the hotel per call", async () => {
    const { look } = probeRoutes();
    const one = await makeKey(readKey({ name: "one hotel", scope: "hotel", hotelId: H.sunrise }));
    const r = await call(look, "GET", "/api/v1/rooms", { key: one });
    assert.deepEqual(r.data, { hotelId: H.sunrise, visit: true, client: "token", testMode: true }, "read keys run in test mode too (they cannot write anyway)");
    assert.equal((await call(settingsGet, "GET", "/api/v1/platform/settings", { key: one })).status, 403, "not the console");
    const all = await makeKey(readKey({ name: "all", scope: "all" }));
    assert.deepEqual((await call(look, "GET", "/api/v1/rooms", { key: all, hotel: H.gir })).data, { hotelId: H.gir, visit: true, client: "token", testMode: true });
    assert.equal((await call(look, "GET", "/api/v1/rooms", { key: all, hotel: "not-a-hotel" })).status, 422);
    assert.equal((await call(look, "GET", "/api/v1/rooms", { key: all, hotel: randomUUID() })).status, 404);
  });

  test("a first use from a new address is audited once; the per-key limit holds", async () => {
    const key = await makeKey(readKey());
    for (let i = 0; i < 3; i++) await call(settingsGet, "GET", "/api/v1/platform/settings", { key, ip: IP });
    await call(settingsGet, "GET", "/api/v1/platform/settings", { key, ip: OTHER_IP });
    assert.deepEqual(audit("api_token_new_ip").map((a) => a.reason), [`First use from ${IP}`, `First use from ${OTHER_IP}`]);
    const row = w.auth.data().apiTokens[0]!;
    assert.deepEqual([row.callsCount, row.lastIp, row.ipSeen], [4, OTHER_IP, [IP, OTHER_IP]]);
    let limited = 0;
    for (let i = 0; i < 70; i++) if ((await call(settingsGet, "GET", "/api/v1/platform/settings", { key })).status === 429) limited++;
    assert.ok(limited > 0, "60 calls a minute for a read key");
  });
});

describe("full access keys", () => {
  test("need the Super Admin's switch (with a reason and a confirmation), an address, a reason, a confirmation and at most 24 hours", async () => {
    assert.equal((await call(keysCreate, "POST", KEYS, asSa, { body: fullKey() })).status, 409, "the switch is off");
    assert.equal((await call(fullAccessPut, "PUT", `${KEYS}/full-access`, asSa, { body: { enabled: true, reason: "Heavy testing", confirm: false } })).status, 422);
    assert.equal((await call(fullAccessPut, "PUT", `${KEYS}/full-access`, { cookie: "pa" }, { body: { enabled: true, reason: "Heavy testing", confirm: true } })).status, 403, "Super Admin only");
    await fullOn();
    assert.equal(audit("api_token_full_access").at(-1)!.reason, "Heavy testing this week");
    assert.equal((await call(keysCreate, "POST", KEYS, asSa, { body: fullKey({ ipAllow: [] }) })).status, 422, "an address is required");
    assert.equal((await call(keysCreate, "POST", KEYS, asSa, { body: fullKey({ reason: null }) })).status, 422, "a reason is required");
    assert.equal((await call(keysCreate, "POST", KEYS, asSa, { body: fullKey({ confirmFull: false }) })).status, 422, "the second confirmation");
    assert.equal((await call(keysCreate, "POST", KEYS, asSa, { body: fullKey({ expiresInHours: 48 }) })).status, 422, "at most 24 hours");
    assert.equal((await call(keysCreate, "POST", KEYS, asSa, { body: fullKey({ testMode: false }) })).status, 422, "test mode off needs its own reason");
    assert.equal((await call(keysCreate, "POST", KEYS, asSa, { body: fullKey() })).status, 201);
  });

  test("writes on the console and in a hotel, every write audited as the key; stops the moment the switch goes off", async () => {
    await fullOn();
    const key = await makeKey(fullKey());
    // the platform settings (its mail server among them) are never a key's to change (review round 2, M3): refused, and the refusal is on record
    const put = await call(settingsPut, "PUT", "/api/v1/platform/settings", { key }, { body: { ...(await settingsBody(key)), defaultGstPercent: 12 } });
    assert.deepEqual([put.status, put.error.message], [403, "The platform settings and its mail server are changed in the browser, never with an API key."]);
    assert.equal(audit("api_token_refused").at(-1)?.targetLabel, "PUT /api/v1/platform/settings");
    assert.equal(audit("settings_updated").length, 0, "nothing changed");
    // another console write goes through, audited as the key
    const { look, mail } = probeRoutes();
    assert.equal((await call(mail, "POST", "/api/v1/platform/anything", { key })).status, 200);
    const write = audit("api_token_write").at(-1)!;
    assert.deepEqual([write.actorName, write.targetLabel, write.result, write.reason], ["API token: Load test", "POST /api/v1/platform/anything", "success", "Answer 200 (test mode)"]);
    assert.deepEqual((await call(look, "POST", "/api/v1/rooms", { key, hotel: H.sunrise })).data, { hotelId: H.sunrise, visit: false, client: "token", testMode: true }, "a full key in a hotel is not a read-only visit");
    await call(fullAccessPut, "PUT", `${KEYS}/full-access`, asSa, { body: { enabled: false, reason: "Testing finished", confirm: false } });
    const off = await call(settingsGet, "GET", "/api/v1/platform/settings", { key });
    assert.deepEqual([off.status, off.error.message], [403, "Full access keys are switched off."]);
  });

  test("test mode: a call queues no mail (the same call with the browser does); test mode off queues as usual", async () => {
    await fullOn();
    const { mail } = probeRoutes();
    const testKey = await makeKey(fullKey({ name: "test mode" }));
    assert.equal((await call(mail, "POST", "/api/v1/platform/anything", { key: testKey })).status, 200);
    assert.equal(w.auth.data().outbox.length, 0, "no mail queued in test mode");
    await call(mail, "POST", "/api/v1/platform/anything", { cookie: "sa" });
    assert.equal(w.auth.data().outbox.length, 1, "the browser's call queues it");
    const realKey = await makeKey(fullKey({ name: "real", testMode: false, testModeOffReason: "Checking real mail on staging" }));
    await call(mail, "POST", "/api/v1/platform/anything", { key: realKey });
    assert.equal(w.auth.data().outbox.length, 2, "test mode off: queued");
  });
});

describe("AI keys (platform 0187, MJ 4 Nov 2026): read only, everything readable except secrets, no expiry", () => {
  const aiKey = (over: Record<string, unknown> = {}) => ({ name: "Developer AI", level: "ai", scope: "all", ipAllow: [], reason: "The AI developer's assistant", confirmFull: true, ...over });

  test("the private routes a read key may not use are open to an AI key; secrets and action routes stay blocked; it never writes", () => {
    const ai = { level: "ai" as const, scope: "all" as const };
    const read = { level: "read" as const, scope: "all" as const };
    for (const p of ["/api/v1/conversations/whatsapp", "/api/v1/platform/conversations/whatsapp", "/api/v1/platform/whatsapp/lines", "/api/v1/my-mailbox", "/api/v1/payroll/companies/x/salary-profiles", "/api/v1/front-office/stays/x/id-photo", "/api/v1/platform/central", "/api/v1/platform/profiles"]) {
      assert.equal(tokenCallVerdict(ai, "GET", p).allowed, true, `ai: ${p}`);
      assert.equal(tokenCallVerdict(read, "GET", p).allowed, false, `read: ${p}`);
    }
    for (const p of ["/api/v1/auth/sign-in", "/api/v1/platform/api-tokens", "/api/v1/admin/backup", "/api/v1/cron/mail", "/api/v1/platform/invitations", "/api/v1/onboarding/x", "/api/v1/gst/lookup", "/api/v1/admin/razorpay/x", "/api/v1/guest/profile"]) {
      assert.equal(tokenCallVerdict(ai, "GET", p).allowed, false, `still blocked: ${p}`);
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) assert.deepEqual(tokenCallVerdict(ai, method, "/api/v1/platform/hotels"), { allowed: false, why: "This API key is read only." }, method);
    assert.equal(tokenPathVerdict("/api/v1/conversations", "ai").allowed, true);
    assert.equal(tokenPathVerdict("/api/v1/conversations").allowed, false, "the default is the strict list");
  });

  test("made by the Super Admin with a reason and a confirmation, for the console and every hotel; 600 calls a minute; no expiry; shown once", async () => {
    for (const bad of [{ scope: "platform" }, { scope: "hotel", hotelId: H.sunrise }, { reason: null }, { confirmFull: false }, { callsPerMinute: 5 }, { testMode: false }]) {
      const r = await call(keysCreate, "POST", KEYS, asSa, { body: aiKey(bad) });
      assert.equal(r.status, 422, JSON.stringify(bad));
    }
    const made = await call(keysCreate, "POST", KEYS, asSa, { body: aiKey() });
    assert.equal(made.status, 201, JSON.stringify(made.error));
    assert.match(made.data.key as string, API_TOKEN_SHAPE);
    const k = made.data.apiKey;
    assert.deepEqual([k.level, k.scope, k.callsPerMinute, k.status], ["ai", "all", 600, "active"]);
    assert.ok(k.expiresInHours > 24 * 3000, "about ten years");
    assert.equal(w.auth.data().apiTokens[0]!.tokenHash.length, 64, "only a hash is stored");
    assert.equal(audit("api_token_created").length, 1);
  });

  test("it reads the console and any hotel (a read-only visit), never writes, keeps working for years, and stops the moment it is revoked", async () => {
    const { look } = probeRoutes();
    const key = await makeKey(aiKey());
    assert.equal((await call(settingsGet, "GET", "/api/v1/platform/settings", { key })).status, 200);
    assert.deepEqual((await call(look, "GET", "/api/v1/rooms", { key, hotel: H.gir })).data, { hotelId: H.gir, visit: true, client: "token", testMode: true }, "a read-only transaction in the named hotel");
    const put = await call(settingsPut, "PUT", "/api/v1/platform/settings", { key }, { body: await settingsBody(key) });
    assert.deepEqual([put.status, put.error.message], [403, "This API key is read only."]);
    clock = new Date("2030-10-18T10:00:00+05:30");
    assert.equal((await call(settingsGet, "GET", "/api/v1/platform/settings", { key })).status, 200, "four years later");
    clock = new Date("2026-10-18T10:00:00+05:30");
    const id = (await call(keysGet, "GET", KEYS, asSa)).data.keys.find((x: { level: string }) => x.level === "ai").id;
    assert.deepEqual((await call(keyRevoke, "POST", `${KEYS}/${id}/revoke`, asSa, { params: { id } })).data, { revoked: true });
    assert.equal((await call(settingsGet, "GET", "/api/v1/platform/settings", { key })).status, 401);
  });
});