// A small world for the login tests: a hotel, Pallav's four built-in roles with their grants, a handful of people, the in-memory platform data,
// the REAL argon2id hasher (cheap parameters), the real routes, a movable clock, and helpers to read what the outbox mailed.
import { randomBytes, randomUUID } from "node:crypto";
import { createCatalog } from "../../../src/server/auth/catalog";
import { PERMISSION_CATALOG } from "../../../src/server/auth/catalog.generated";
import { createArgon2Hasher, type PasswordHasher } from "../../../src/server/auth/password";
import { SESSION_COOKIE } from "../../../src/server/auth/tokens";
import { configureAuth } from "../../../src/server/compose/auth";
import { parseHashKey } from "../../../src/server/crypto/hash";
import { createMemoryIdempotencyStore } from "../../../src/server/http/idempotency";
import { createMemoryRateLimitStore } from "../../../src/server/http/limits";
import { configureRoutes } from "../../../src/server/http/route";
import { createLogger } from "../../../src/server/logger";
import type { UserRecord } from "../../../src/server/repos/auth";
import { createMemoryAuth } from "../../../src/server/repos/memory/auth";
import { createAuthService } from "../../../src/server/services/auth/authService";
import { type MailPayload } from "../../../src/server/services/auth/mail";
import { createSessionResolver } from "../../../src/server/services/auth/sessionResolver";

export const HOTEL = "11111111-1111-4111-8111-111111111111";
export const PASSWORD = "Sunrise#2026x";
export const TEMP_PASSWORD = "Temp#Pass9876";
export const ORIGIN = "https://hms.test";

const catalog = createCatalog(PERMISSION_CATALOG);
export const hashKey = parseHashKey(randomBytes(32).toString("base64"));

/** Counts what the service asks of the hasher, so a test can prove an unknown username still costs a verify. */
export function countingHasher(inner: PasswordHasher): PasswordHasher & { calls: { hash: number; verify: number; dummy: number } } {
  const calls = { hash: 0, verify: 0, dummy: 0 };
  return {
    calls,
    hash: (p) => (calls.hash++, inner.hash(p)),
    verify: (e, p) => (calls.verify++, inner.verify(e, p)),
    dummyVerify: (p) => (calls.dummy++, inner.dummyVerify(p)),
  };
}

export type Who = "staff" | "anita" | "sonal" | "firsttime" | "guest" | "disabled" | "noemail" | "mihir";

export async function buildWorld(options: { onAccountLocked?: Parameters<typeof createAuthService>[0]["onAccountLocked"] } = {}) {
  const mem = createMemoryAuth();
  const hasher = countingHasher(createArgon2Hasher({ memoryCost: 1024, timeCost: 1, parallelism: 1 }));
  const clock = { at: new Date("2026-10-05T10:00:00+05:30") };
  const now = (): Date => new Date(clock.at.getTime());
  const rateLimits = createMemoryRateLimitStore(() => clock.at.getTime());
  const data = mem.data();

  data.hotels.push({ id: HOTEL, name: "Hotel Sunrise, Rajkot", group: { id: "g-1", name: "Sunrise Hotels Group" } });
  const roleOf = (key: string, level: number): string => {
    const id = randomUUID();
    data.roles.push({ id, hotelId: null, key, level, inherits: true });
    return id;
  };
  const viewer = roleOf("viewer", 1);
  const editor = roleOf("editor", 2);
  const admin = roleOf("admin", 3);
  const superAdmin = roleOf("super_admin", 4);
  // Pallav's seed grants (db/scripts/generate-platform-seeds.ts ROLE_GRANTS), as levels
  for (const [roleId, key, level] of [
    [viewer, "revenue", "view"], [viewer, "dashboard", "view"],
    [editor, "revenue", "edit"],
    [admin, "revenue", "full"], [admin, "users", "full"], [admin, "users.password", "full"], [admin, "system.backdate", "full"],
    [superAdmin, "system.force", "full"], [superAdmin, "users.set-password", "full"],
  ] as const) data.rolePermissions.push({ roleId, key, level });

  const hash = await hasher.hash(PASSWORD);
  const tempHash = await hasher.hash(TEMP_PASSWORD);
  const base = (over: Partial<UserRecord> & Pick<UserRecord, "username" | "roleId">): UserRecord => ({
    id: randomUUID(), email: `${over.username}@demo.hms`, mobile: null, displayName: over.username.toUpperCase(), passwordHash: hash, accountRole: "hotel_user",
    status: "active", mustChangePassword: false, passwordChangedAt: null, failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null,
    codeRequired: false, lastLoginAt: null, deletedAt: null, ...over,
  });
  const users: Record<Who, UserRecord> = {
    staff: base({ username: "staff", roleId: viewer }),
    anita: base({ username: "anita", roleId: admin, accountRole: "hotel_admin", codeRequired: true, displayName: "Anita Shah" }),
    sonal: base({ username: "sonal", roleId: superAdmin, accountRole: "hotel_admin", codeRequired: true }),
    firsttime: base({ username: "firsttime", roleId: editor, mustChangePassword: true, status: "invited", passwordHash: tempHash, codeRequired: false }),
    guest: base({ username: "guest", roleId: viewer, accountRole: "guest_user", codeRequired: false }),
    disabled: base({ username: "disabled", roleId: viewer, status: "disabled" }),
    noemail: base({ username: "noemail", roleId: admin, accountRole: "hotel_admin", codeRequired: true, email: null }),
    mihir: base({ username: "mihir", roleId: admin, accountRole: "super_admin", codeRequired: true }),
  };
  for (const u of Object.values(users)) {
    data.users.push(u);
    data.memberships.push({ userId: u.id, hotelId: HOTEL, roleId: null, status: "active", isDefault: true, subject: u.username === "guest" ? { kind: "guest", id: randomUUID() } : null });
  }
  // the platform owner has no hotel of its own
  data.memberships = data.memberships.filter((m) => m.userId !== users.mihir.id);

  const service = createAuthService({ unit: mem.unit, catalog, hasher, hashKey, rateLimits, now, onAccountLocked: options.onAccountLocked });
  // no session cache here: these flows check that a revoke, a block or a role change is seen by the very next request (the cache has its own test)
  const resolver = createSessionResolver({ unit: mem.unit, catalog, now, cacheMs: 0 });
  configureAuth({ unit: mem.unit, rateLimits, resolver, service });
  configureRoutes({
    resolveSession: resolver.resolveSession,
    touchSession: resolver.touchSession,
    catalog,
    idempotency: createMemoryIdempotencyStore(),
    logger: createLogger({ level: "silent", write: () => undefined }),
    rateLimits,
    clientIp: (r) => r.headers.get("x-test-ip") ?? "10.0.0.1",
  });

  /** Everything the outbox holds for a person, decrypted (address and payload), newest last. */
  const mailed = (userId: string, kind?: string): { kind: string; to: string; payload: MailPayload | null; status: string }[] =>
    mem.data().outbox
      .filter((o) => o.userId === userId && (!kind || o.kind === kind))
      .map((o) => ({ kind: o.kind, to: o.toEmail, payload: o.payload ? (JSON.parse(o.payload) as MailPayload) : null, status: o.status }));
  const lastCode = (userId: string, kind: "login_code" | "reset_code"): string => {
    const rows = mailed(userId, kind).filter((m) => m.payload?.code);
    return rows[rows.length - 1].payload?.code as string;
  };
  // a unit that throws is rolled back by REPLACING the data object, so a test must always read it fresh
  return { mem, get data() { return mem.data(); }, hasher, clock, rateLimits, users, mailed, lastCode, service, resolver, catalog };
}

export type World = Awaited<ReturnType<typeof buildWorld>>;

// ---- requests against the REAL route files ----
export interface Call {
  body?: unknown;
  cookie?: string;
  bearer?: string;
  ip?: string;
  origin?: string | null;
  headers?: Record<string, string>;
}
export function req(method: string, path: string, call: Call = {}): Request {
  const headers: Record<string, string> = { host: "hms.test", ...call.headers };
  if (call.origin !== null) headers.origin = call.origin ?? ORIGIN;
  if (call.cookie) headers.cookie = `${SESSION_COOKIE}=${call.cookie}`;
  if (call.bearer) headers.authorization = `Bearer ${call.bearer}`;
  if (call.ip) headers["x-test-ip"] = call.ip;
  if (call.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${ORIGIN}${path}`, { method, headers, body: call.body === undefined ? undefined : JSON.stringify(call.body) });
}
export const ctx = () => ({ params: Promise.resolve({}) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: bodies are asserted field by field
export const json = async (res: Response) => (await res.clone().json()) as any;
export const WEB = { platform: "web" as const, name: "Chrome on Windows" };

/** The session cookie a response set, or null. */
export function cookieOf(res: Response): string | null {
  const line = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!line) return null;
  const value = line.slice(SESSION_COOKIE.length + 1).split(";")[0];
  return value === "" ? null : value;
}
