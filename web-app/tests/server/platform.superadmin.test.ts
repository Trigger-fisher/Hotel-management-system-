// The Super Admin extras of the Platform console (P5; docs/BACKEND.md 14.5 and 14.6), through the REAL route files on the in-memory double:
// actions on users and on platform staff, the audit log and its CSV, the sign-in history, health, settings, archived hotels, export and the
// permanent delete. Every refusal is audited as failed.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeEach, describe, test } from "node:test";
import { POST as userDisable } from "../../src/app/api/v1/platform/users/[id]/disable/route";
import { POST as userEnable } from "../../src/app/api/v1/platform/users/[id]/enable/route";
import { POST as userReset } from "../../src/app/api/v1/platform/users/[id]/reset-password/route";
import { POST as userUnlock } from "../../src/app/api/v1/platform/users/[id]/unlock/route";
import { GET as staffList, POST as staffCreate } from "../../src/app/api/v1/platform/staff/route";
import { POST as staffDisable } from "../../src/app/api/v1/platform/staff/[id]/disable/route";
import { POST as staffEnable } from "../../src/app/api/v1/platform/staff/[id]/enable/route";
import { POST as staffReset } from "../../src/app/api/v1/platform/staff/[id]/reset-password/route";
import { POST as staffUnlock } from "../../src/app/api/v1/platform/staff/[id]/unlock/route";
import { GET as auditGet } from "../../src/app/api/v1/platform/audit/route";
import { GET as auditExport } from "../../src/app/api/v1/platform/audit/export/route";
import { GET as signInsGet } from "../../src/app/api/v1/platform/sign-ins/route";
import { GET as settingsGet, PUT as settingsPut } from "../../src/app/api/v1/platform/settings/route";
import { GET as securityGet, PUT as securityPut } from "../../src/app/api/v1/platform/security/route";
import { GET as healthGet } from "../../src/app/api/v1/platform/health/route";
import { POST as healthCheck } from "../../src/app/api/v1/platform/health/check/route";
import { GET as archivedGet } from "../../src/app/api/v1/platform/archived-hotels/route";
import { POST as hotelExport } from "../../src/app/api/v1/platform/hotels/[id]/export/route";
import { POST as hotelDelete } from "../../src/app/api/v1/platform/hotels/[id]/delete-permanently/route";
import { POST as hotelSuspend } from "../../src/app/api/v1/platform/hotels/[id]/suspend/route";
import { GET as annList, POST as annCreate } from "../../src/app/api/v1/platform/announcements/route";
import { POST as annEnd } from "../../src/app/api/v1/platform/announcements/[id]/end/route";
import { HOTEL_OVERRIDE_KEYS } from "../../src/server/services/whatsapp/rulesService";
import { GET as annUnread } from "../../src/app/api/v1/overview/announcements/route";
import { POST as annDismiss } from "../../src/app/api/v1/overview/announcements/[id]/dismiss/route";
import { createArgon2Hasher } from "../../src/server/auth/password";
import { SESSION_COOKIE, hashSessionToken, newSessionToken } from "../../src/server/auth/tokens";
import { buildPlatformServices, configurePlatform } from "../../src/server/compose/platform";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { createMemoryProvisioner } from "../../src/server/provisioner/memory";
import type { UserRecord } from "../../src/server/repos/auth";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { createMemoryPlatformConsole, type MemHotelMeta } from "../../src/server/repos/memory/platformConsole";
import { createCredentialService } from "../../src/server/services/auth/credentialService";
import { createSessionResolver } from "../../src/server/services/auth/sessionResolver";
import { catalog, makeSession } from "./helpers/session";

const ORIGIN = "https://hms.test";
const hasher = createArgon2Hasher({ memoryCost: 1024, timeCost: 1, parallelism: 1 });
let clock = new Date("2026-10-05T10:00:00+05:30");
const now = (): Date => new Date(clock.getTime());
const H = { sunrise: randomUUID(), gir: randomUUID(), pending: randomUUID(), old: randomUUID(), ready: randomUUID() };
const U: Record<string, string> = {};
const TOKENS: Record<string, string> = {};
type World = ReturnType<typeof build>;
let w: World;

function build() {
  const auth = createMemoryAuth();
  const cons = createMemoryPlatformConsole(auth);
  const data = auth.data();
  const role = (key: string, level: number): string => {
    const id = randomUUID();
    data.roles.push({ id, hotelId: null, key, level, inherits: true });
    return id;
  };
  const viewer = role("viewer", 1);
  const admin = role("admin", 3);
  const meta = (slug: string, over: Partial<MemHotelMeta> = {}): MemHotelMeta => ({
    slug, city: "Rajkot", state: "Gujarat", gstin: "24ABCDE1234F1Z5", timeZone: "Asia/Kolkata", createdAt: new Date("2026-06-01T10:00:00+05:30"), provisionedAt: new Date("2026-06-01T10:00:00+05:30"),
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
  // archived 100 days ago: the 90-day grace is over
  hotel(H.old, "Old Palace", "archived", "old-palace", { archivedAt: new Date("2026-06-27T10:00:00+05:30"), restoreUntil: new Date("2026-09-25T10:00:00+05:30"), statusBeforeArchive: "active", archiveReason: "Closed down" });
  // archived 10 days ago: still inside the grace period
  hotel(H.ready, "Fresh Archive", "archived", "fresh-archive", { archivedAt: new Date("2026-09-25T10:00:00+05:30"), restoreUntil: new Date("2026-12-24T10:00:00+05:30"), statusBeforeArchive: "active" });
  const person = (key: string, over: Partial<UserRecord>, hotelId: string | null = null, roleId = viewer): void => {
    const id = randomUUID();
    U[key] = id;
    data.users.push({
      id, username: key, email: `${key}@demo.hms`, mobile: null, displayName: key.toUpperCase(), passwordHash: "x", accountRole: "hotel_user", status: "active", mustChangePassword: false,
      passwordChangedAt: null, failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null, codeRequired: false, lastLoginAt: null, deletedAt: null, roleId, ...over,
    });
    cons.data.accountMeta.set(id, { createdAt: new Date("2026-09-01T10:00:00+05:30"), createdBy: null });
    if (hotelId) data.memberships.push({ userId: id, hotelId, roleId: null, status: "active", isDefault: true, subject: null });
    const token = newSessionToken();
    TOKENS[key] = token;
    data.sessions.push({
      id: randomUUID(), userId: id, hotelId, client: "web", tokenHash: hashSessionToken(token), deviceLabel: null, userAgent: null, ip: null,
      issuedAt: now(), lastSeenAt: now(), expiresAt: new Date(now().getTime() + 120 * 60_000), revokedAt: null, revokedReason: null,
    });
  };
  person("sa", { accountRole: "super_admin", displayName: "Sonal Super", codeRequired: true });
  person("pa", { accountRole: "platform_admin", displayName: "Priya Platform", codeRequired: true });
  person("pa2", { accountRole: "platform_admin", displayName: "Pooja Platform", codeRequired: true });
  person("ha", { accountRole: "hotel_admin", displayName: "Hari Admin", codeRequired: true, email: "hari@demo.hms" }, H.sunrise, admin);
  person("hu", { accountRole: "hotel_user", displayName: "Hema User" }, H.sunrise);
  person("locked", { accountRole: "hotel_user", displayName: "Lata Locked", lockedUntil: new Date("2026-10-05T12:00:00+05:30"), failedAttempts: 5, lockLevel: 1 }, H.sunrise);
  person("off", { accountRole: "hotel_user", displayName: "Omkar Off", status: "disabled" }, H.sunrise);
  person("gadm", { accountRole: "group_hotel_admin", displayName: "Gita GroupAdmin", codeRequired: true });
  person("guest", { accountRole: "guest_user", displayName: "Gus Guest" });
  person("oldadm", { accountRole: "hotel_admin", displayName: "Olga OldAdmin" }, H.old, admin);
  person("waiting", { accountRole: "hotel_admin", displayName: "Wilma Waiting", status: "pending_approval" }, H.pending);
  const provisioner = createMemoryProvisioner({ auth: () => auth.data(), console: () => cons.data, now });
  const services = buildPlatformServices({
    unit: cons.unit, credentials: (repos) => createCredentialService({ unit: { run: (work) => work(repos.auth) }, hasher, now }), now, hasher, publicUrl: ORIGIN,
    newToken: () => randomBytes(8).toString("hex"), hashKey: randomBytes(32), provisioner,
    // P1: the month's bills per hotel; a hotel left out of the map shows no figure
    billsThisMonth: async (ids) => new Map(ids.filter((id) => id === H.gir).map((id) => [id, { count: 7, billedPaise: 4_200_000 }])),
  });
  configurePlatform(services);
  const resolver = createSessionResolver({ unit: auth.unit, catalog, now });
  configureRoutes({
    resolveSession: resolver.resolveSession,
    catalog,
    idempotency: createMemoryIdempotencyStore(),
    logger: createLogger({ level: "silent", write: () => undefined }),
  });
  return { auth, cons, provisioner, services };
}

beforeEach(() => {
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
const act = (route: Route, kind: "users" | "staff", verb: string, target: string, who: string) => call(route, "POST", `/api/v1/platform/${kind}/${U[target] ?? target}/${verb}`, who, { params: { id: U[target] ?? target } });
const auditOf = (action: string) => w.cons.data.audit.filter((a) => a.action === action);
const row = (key: string) => w.auth.data().users.find((u) => u.id === U[key])!;

describe("actions on users (any level)", () => {
  test("disable ends the sessions and is audited; enable brings it back; a repeat is a 409 with the plain sentence", async () => {
    const r = await act(userDisable, "users", "disable", "hu", "sa");
    assert.equal(r.status, 200);
    assert.equal(r.data.status, "disabled");
    assert.equal(row("hu").status, "disabled");
    assert.ok(w.auth.data().sessions.filter((s) => s.userId === U.hu).every((s) => s.revokedAt !== null), "its sessions ended");
    const a = auditOf("user_disabled").at(-1)!;
    assert.deepEqual([a.result, a.actorName, a.targetLabel, a.hotelId, a.entityId], ["success", "Sonal Super", "Hema User", H.sunrise, U.hu]);
    const again = await act(userDisable, "users", "disable", "hu", "sa");
    assert.deepEqual([again.status, again.error.message], [409, "This account is already disabled."]);
    const on = await act(userEnable, "users", "enable", "hu", "sa");
    assert.deepEqual([on.status, on.data.status], [200, "active"]);
    assert.equal((await act(userEnable, "users", "enable", "hu", "sa")).error.message, "This account is not disabled.");
  });

  test("a waiting account cannot be disabled or reset; a disabled one cannot be reset; nobody is found for an unknown id", async () => {
    assert.equal((await act(userDisable, "users", "disable", "waiting", "sa")).error.message, "This account waits for its hotel to be approved.");
    assert.equal((await act(userReset, "users", "reset-password", "waiting", "sa")).status, 409);
    assert.equal((await act(userReset, "users", "reset-password", "off", "sa")).error.message, "Enable this account first, then reset its password.");
    assert.equal((await act(userDisable, "users", "disable", randomUUID(), "sa")).status, 404);
  });

  test("unlock needs a locked account; reset mails a temporary password and never returns it", async () => {
    assert.equal((await act(userUnlock, "users", "unlock", "hu", "sa")).error.message, "This account is not locked.");
    const un = await act(userUnlock, "users", "unlock", "locked", "sa");
    assert.deepEqual([un.status, un.data.status], [200, "active"]);
    assert.equal(row("locked").lockedUntil, null);
    const re = await act(userReset, "users", "reset-password", "ha", "sa");
    assert.equal(re.status, 200);
    assert.equal(re.data.message, "A temporary password was sent to hari@demo.hms.");
    assert.ok(re.data.tempPasswordNote);
    assert.ok(!JSON.stringify(re.data).includes("x"), "no hash anywhere");
    assert.equal(w.auth.data().outbox.some((m) => m.userId === U.ha), true, "the mail is queued with the action");
    assert.equal(auditOf("user_password_reset").length, 1);
  });

  test("the last active Super Admin cannot be disabled (audited as failed); with a second one it can", async () => {
    const r = await act(userDisable, "users", "disable", "sa", "sa");
    assert.deepEqual([r.status, r.error.message], [409, "This is the only active Super Admin. Make another Super Admin first."]);
    const f = auditOf("user_disabled").at(-1)!;
    assert.deepEqual([f.result, f.reason], ["failed", "This is the only active Super Admin. Make another Super Admin first."]);
    assert.equal(row("sa").status, "active");
    row("pa2").accountRole = "super_admin";
    const ok = await act(userDisable, "users", "disable", "sa", "pa2");
    assert.deepEqual([ok.status, ok.data.status], [200, "disabled"]);
  });

  test("every write on users is Super Admin only: a Platform Admin gets 403 (audited) on every action and every target, staff levels included; other roles get 403 too", async () => {
    let failed = 0;
    for (const target of ["hu", "ha", "locked", "sa", "pa2"]) {
      for (const [route, verb] of [[userDisable, "disable"], [userEnable, "enable"], [userUnlock, "unlock"], [userReset, "reset-password"]] as const) {
        const r = await act(route, "users", verb, target, "pa");
        assert.deepEqual([r.status, r.error.message], [403, "Only the Super Admin can do this."], `${verb} ${target}`);
        failed += 1;
      }
      assert.equal(row(target).status, "active");
    }
    assert.equal(auditOf("user_disabled").filter((a) => a.result === "failed").length, 5);
    assert.equal(auditOf("user_password_reset").filter((a) => a.result === "failed").length, 5);
    assert.equal(failed, 20);
    assert.equal(row("locked").lockedUntil !== null, true, "nothing was unlocked");
    assert.equal(w.auth.data().outbox.length, 0, "no mail was queued by a refused reset");
    assert.equal((await act(userDisable, "users", "disable", "hu", "ha")).status, 403);
    assert.equal((await act(userDisable, "users", "disable", "hu", "hu")).status, 403);
  });
});

describe("platform staff (Super Admin only)", () => {
  test("lists Platform Admins only, with counts, isYou and the number of active Super Admins; a Platform Admin gets 403", async () => {
    const r = await call(staffList, "GET", "/api/v1/platform/staff", "sa");
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.items.map((s: { name: string }) => s.name), ["Pooja Platform", "Priya Platform"]);
    assert.deepEqual([r.data.counts, r.data.superAdminCount, r.data.items[0].role, r.data.items[0].isYou], [{ all: 2, active: 2, locked: 0, disabled: 0 }, 1, "platform_admin", false]);
    assert.equal((await call(staffList, "GET", "/api/v1/platform/staff?status=disabled", "sa")).data.total, 0);
    assert.equal((await call(staffList, "GET", "/api/v1/platform/staff?search=pooja", "sa")).data.total, 1);
    const no = await call(staffList, "GET", "/api/v1/platform/staff", "pa");
    assert.deepEqual([no.status, no.error.message], [403, "Only the Super Admin can do this."]);
    assert.equal((await call(staffList, "GET", "/api/v1/platform/staff", "ha")).status, 403);
  });

  test("create makes a Platform Admin (always that role), mails a temporary password, audits it; duplicates and bad fields are field errors", async () => {
    const body = { name: "Nila New", username: "nila.new", email: "Nila@Demo.HMS", mobile: "98765 43210" };
    const r = await call(staffCreate, "POST", "/api/v1/platform/staff", "sa", { body });
    assert.equal(r.status, 201, JSON.stringify(r.error));
    assert.deepEqual([r.data.staff.role, r.data.staff.status, r.data.staff.username, r.data.staff.email, r.data.staff.mobile], ["platform_admin", "active", "nila.new", "nila@demo.hms", "9876543210"]);
    const made = w.auth.data().users.find((u) => u.username === "nila.new")!;
    assert.deepEqual([made.accountRole, made.codeRequired, made.status], ["platform_admin", false, "invited"]);
    assert.equal(w.auth.data().memberships.some((m) => m.userId === made.id), false, "no hotel");
    assert.equal(w.auth.data().outbox.some((m) => m.userId === made.id), true);
    assert.equal(auditOf("staff_created").at(-1)?.targetLabel, "Nila New");
    const dup = await call(staffCreate, "POST", "/api/v1/platform/staff", "sa", { body });
    assert.equal(dup.status, 422);
    assert.ok(dup.error.details.fields.username && dup.error.details.fields.email && dup.error.details.fields.mobile);
    const bad = await call(staffCreate, "POST", "/api/v1/platform/staff", "sa", { body: { name: "", username: "x", email: "nope", mobile: "1" } });
    assert.equal(bad.status, 422);
    assert.deepEqual(Object.keys(bad.error.details.fields).sort(), ["email", "mobile", "name", "username"]);
    assert.equal((await call(staffCreate, "POST", "/api/v1/platform/staff", "sa", { body: { ...body, role: "super_admin" } })).status, 422, "no role field is accepted");
    const refused = await call(staffCreate, "POST", "/api/v1/platform/staff", "pa", { body: { ...body, username: "other.one", email: "o@demo.hms", mobile: "9876543211" } });
    assert.equal(refused.status, 403);
    assert.equal(auditOf("staff_created").filter((a) => a.result === "failed").length, 1);
  });

  test("disable, enable, unlock and reset work on Platform Admins only: a Super Admin or a hotel user is a 404 'not a Platform Admin'; PA is refused", async () => {
    const d = await act(staffDisable, "staff", "disable", "pa2", "sa");
    assert.deepEqual([d.status, d.data.status], [200, "disabled"]);
    assert.equal((await act(staffReset, "staff", "reset-password", "pa2", "sa")).error.message, "Enable this account first, then reset its password.");
    assert.equal((await act(staffEnable, "staff", "enable", "pa2", "sa")).data.status, "active");
    assert.equal((await act(staffUnlock, "staff", "unlock", "pa2", "sa")).error.message, "This account is not locked.");
    const reset = await act(staffReset, "staff", "reset-password", "pa2", "sa");
    assert.equal(reset.data.staff.name, "Pooja Platform");
    assert.equal(reset.data.message, "A temporary password was sent to pa2@demo.hms.");
    for (const target of ["sa", "hu"]) {
      const r = await act(staffDisable, "staff", "disable", target, "sa");
      assert.deepEqual([r.status, r.error.message], [404, "This account is not a Platform Admin."]);
    }
    assert.equal((await act(staffDisable, "staff", "disable", "pa2", "pa")).status, 403);
    assert.equal(row("pa2").status, "active");
  });
});

async function raw(route: Route, path: string, who: string): Promise<Response> {
  const h: Record<string, string> = { host: "hms.test", origin: ORIGIN, "user-agent": "node-test/1.0", cookie: `${SESSION_COOKIE}=${TOKENS[who]}` };
  return route(new Request(`${ORIGIN}${path}`, { method: "GET", headers: h }), { params: Promise.resolve({}) });
}
const get = (route: Route, path: string, who = "sa") => call(route, "GET", path, who);
const post = (route: Route, path: string, who: string, body?: unknown, id?: string) => call(route, "POST", path, who, { ...(body === undefined ? {} : { body }), ...(id ? { params: { id } } : {}) });
const blankAudit = { actorUserId: null, actorName: "System", actorRole: null, action: "hotel_approved", entity: "hotel" as const, entityId: null, hotelId: null, groupId: null, targetLabel: "X", reason: null, result: "success" as const, before: null, after: null, ip: null, userAgent: null, traceId: null };

describe("the audit log", () => {
  test("lists platform actions with refused ones, labels, levels and filters; actors for the filter; Super Admin only", async () => {
    await post(hotelSuspend, `/api/v1/platform/hotels/${H.sunrise}/suspend`, "pa", {}, H.sunrise);
    await act(userDisable, "users", "disable", "hu", "sa");
    await act(userDisable, "users", "disable", "sa", "sa"); // refused: the only Super Admin
    const r = await get(auditGet, "/api/v1/platform/audit");
    assert.equal(r.status, 200, JSON.stringify(r.error));
    assert.equal(r.data.total, 3);
    assert.deepEqual(r.data.items.map((e: { action: string; result: string }) => [e.action, e.result]), [["user_disabled", "failed"], ["user_disabled", "success"], ["hotel_suspended", "success"]]);
    const refused = r.data.items[0];
    assert.deepEqual([refused.actionLabel, refused.actorName, refused.actorRole, refused.reason, refused.insideHotel], ["User disabled", "Sonal Super", "super_admin", "This is the only active Super Admin. Make another Super Admin first.", false]);
    assert.equal(r.data.items[2].actorRole, "platform_admin");
    assert.match(r.data.items[2].text, /Hotel Sunrise/);
    assert.deepEqual(r.data.actors, ["Priya Platform", "Sonal Super"]);
    assert.equal((await get(auditGet, "/api/v1/platform/audit?action=hotel_suspended")).data.total, 1);
    assert.equal((await get(auditGet, "/api/v1/platform/audit?action=all")).data.total, 3);
    assert.equal((await get(auditGet, `/api/v1/platform/audit?actor=${encodeURIComponent("Priya Platform")}`)).data.total, 1);
    assert.equal((await get(auditGet, `/api/v1/platform/audit?hotelId=${H.sunrise}`)).data.total, 2, "the suspension and the disabled user of that hotel");
    assert.equal((await get(auditGet, "/api/v1/platform/audit?search=sunrise")).data.total, 2);
    assert.equal((await get(auditGet, "/api/v1/platform/audit?search=disabled%20hema")).data.total, 1, "words are matched together over what the screen shows");
    assert.equal((await get(auditGet, "/api/v1/platform/audit?pageSize=10&page=2")).data.items.length, 0);
    assert.equal((await get(auditGet, "/api/v1/platform/audit?from=2026-10-05&to=2026-10-05")).data.total, 3, "IST dates, both ends inclusive");
    assert.equal((await get(auditGet, "/api/v1/platform/audit?from=2026-10-06")).data.total, 0);
    assert.equal((await get(auditGet, "/api/v1/platform/audit?to=2026-10-04")).data.total, 0);
    for (const q of ["from=2026-13-40", "from=yesterday", "from=2026-10-06&to=2026-10-05", "action=%3Bdrop", "pageSize=7"]) assert.equal((await get(auditGet, `/api/v1/platform/audit?${q}`)).status, 422, q);
    const no = await get(auditGet, "/api/v1/platform/audit", "pa");
    assert.deepEqual([no.status, no.error.message], [403, "Only the Super Admin can do this."]);
    assert.equal((await get(auditGet, "/api/v1/platform/audit", "oldadm")).status, 401, "a session of an archived hotel is already over");
  });

  test("the IST day boundary: 00:30 IST on the 6th is the 6th, 23:30 IST on the 5th is the 5th", async () => {
    w.cons.data.audit.push({ ...blankAudit, at: new Date("2026-10-05T23:30:00+05:30"), id: randomUUID() }, { ...blankAudit, at: new Date("2026-10-06T00:30:00+05:30"), id: randomUUID() });
    assert.equal((await get(auditGet, "/api/v1/platform/audit?from=2026-10-06&to=2026-10-06")).data.total, 1);
    assert.equal((await get(auditGet, "/api/v1/platform/audit?from=2026-10-05&to=2026-10-05")).data.total, 1);
  });

  test("the CSV: same filters, attachment, BOM, formula cells quoted, the export is itself audited; Super Admin only (a refusal is audited)", async () => {
    await act(userDisable, "users", "disable", "hu", "sa");
    w.cons.data.audit.push({ ...blankAudit, actorName: "=SUM(A1)", targetLabel: '+cmd|"x", y', reason: "-1", at: now(), id: randomUUID() });
    const res = await raw(auditExport, "/api/v1/platform/audit/export?action=hotel_approved", "sa");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /^text\/csv/);
    assert.match(res.headers.get("content-disposition") ?? "", /^attachment; filename="audit-log-2026-10-05\.csv"$/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "UTF-8 byte-order mark for Excel");
    const text = `﻿${new TextDecoder().decode(bytes)}`;
    assert.ok(text.startsWith("﻿When (IST),Who,Role,Action,On,Hotel,Group,What happened,Result,Reason,Inside hotel,IP address,Browser\r\n"));
    const lines = text.trim().split("\r\n");
    assert.equal(lines.length, 2, "header plus the one hotel_approved row");
    assert.ok(lines[1].includes("'=SUM(A1)") && lines[1].includes(`"'+cmd|""x"", y"`) && lines[1].includes(",'-1,"), lines[1]);
    const logged = auditOf("audit_exported").at(-1)!;
    assert.deepEqual([logged.result, logged.entity, logged.actorName], ["success", "platform", "Sonal Super"]);
    assert.match(String(logged.reason), /^1 entry; action hotel_approved$/);
    const all = await (await raw(auditExport, "/api/v1/platform/audit/export", "sa")).text();
    assert.ok(all.includes("Audit log exported"), "the earlier export shows in the next one");
    const denied = await raw(auditExport, "/api/v1/platform/audit/export", "pa");
    assert.equal(denied.status, 403);
    assert.equal(auditOf("audit_exported").filter((a) => a.result === "failed").length, 1);
    assert.equal((await raw(auditExport, "/api/v1/platform/audit/export?from=nope", "sa")).status, 422);
  });

  test("a huge log is cut at 50,000 rows with a note, and the export still records itself", async () => {
    for (let i = 0; i < 50_010; i++) w.cons.data.audit.push({ ...blankAudit, at: new Date(now().getTime() - i * 1000), id: randomUUID() });
    const lines = (await (await raw(auditExport, "/api/v1/platform/audit/export", "sa")).text()).trim().split("\r\n");
    assert.equal(lines.length, 1 + 50_000 + 1);
    assert.match(lines.at(-1) ?? "", /^The file stops at 50000 entries/);
    assert.match(String(auditOf("audit_exported").at(-1)?.reason), /^50000 entries/);
  });
});

describe("sign-in history", () => {
  test("success, failed (wrong password, unknown username, disabled, hotel suspended), code, locked; counts follow the search; unknown shows (unknown)", async () => {
    const ev = w.auth.data().events;
    const at = (m: number) => new Date(now().getTime() - m * 60_000);
    ev.push(
      { userId: U.hu, hotelId: H.sunrise, event: "login_success", ip: "10.0.0.1", userAgent: null, detail: { client: "web" }, at: at(50) },
      { userId: U.hu, hotelId: null, event: "login_failed", ip: "10.0.0.2", userAgent: null, detail: { via: "sign-in" }, at: at(40) },
      { userId: null, hotelId: null, event: "login_failed", ip: "10.0.0.3", userAgent: null, detail: { via: "sign-in", known: false }, at: at(30) },
      { userId: U.off, hotelId: null, event: "login_failed", ip: "10.0.0.4", userAgent: null, detail: { via: "sign-in", reason: "disabled" }, at: at(20) },
      { userId: U.ha, hotelId: null, event: "login_failed", ip: "10.0.0.5", userAgent: null, detail: { via: "sign-in", reason: "hotel_suspended" }, at: at(15) },
      { userId: U.ha, hotelId: null, event: "code_failed", ip: "10.0.0.5", userAgent: null, detail: { attempts: 1 }, at: at(12) },
      { userId: U.locked, hotelId: null, event: "account_locked", ip: "10.0.0.6", userAgent: null, detail: { minutes: 15 }, at: at(10) },
      { userId: U.hu, hotelId: null, event: "password_changed", ip: null, userAgent: null, detail: null, at: at(5) },
    );
    const r = await get(signInsGet, "/api/v1/platform/sign-ins");
    assert.equal(r.status, 200, JSON.stringify(r.error));
    assert.deepEqual(r.data.counts, { all: 7, success: 1, failed: 5, locked: 1 });
    assert.deepEqual(r.data.items.map((s: { username: string; result: string; reason: string | null }) => [s.username, s.result, s.reason]), [
      ["locked", "locked", "Locked after 5 wrong passwords."],
      ["ha", "failed", "Wrong emailed code."],
      ["ha", "failed", "The hotel is suspended."],
      ["off", "failed", "The account is disabled."],
      ["(unknown)", "failed", "No account with this username."],
      ["hu", "failed", "Wrong password."],
      ["hu", "success", null],
    ]);
    assert.deepEqual([r.data.items[4].name, r.data.items[4].level, r.data.items[0].level, r.data.items[0].hotelName, r.data.items[6].hotelName, r.data.items[6].ip], [null, null, "hotel_user", "Hotel Sunrise", "Hotel Sunrise", "10.0.0.1"]);
    assert.equal((await get(signInsGet, "/api/v1/platform/sign-ins?result=failed")).data.total, 5);
    const s = await get(signInsGet, "/api/v1/platform/sign-ins?search=10.0.0.5");
    assert.deepEqual([s.data.total, s.data.counts], [2, { all: 2, success: 0, failed: 2, locked: 0 }]);
    assert.equal((await get(signInsGet, "/api/v1/platform/sign-ins?result=bogus")).status, 422);
    assert.equal((await get(signInsGet, "/api/v1/platform/sign-ins", "pa")).status, 403);
  });
});

describe("platform settings", () => {
  test("defaults, partial save, validation, audit with what changed, nothing audited when nothing changed, Super Admin only", async () => {
    const d = await get(settingsGet, "/api/v1/platform/settings");
    assert.equal(d.status, 200);
    assert.deepEqual([d.data.defaultGstPercent, d.data.defaultTimeZone, d.data.invitationValidHours, d.data.mailFromName, d.data.mailFromEmail, d.data.twoStepForPlatformRoles, d.data.updatedAt, d.data.updatedBy], [5, "Asia/Kolkata", 168, "EasyHotelSolutions", "", true, null, null]);
    assert.deepEqual(d.data.newHotelRoles.map((r: { key: string; enabled: boolean; locked: boolean }) => [r.key, r.enabled, r.locked]), [["super_admin", true, true], ["admin", true, false], ["editor", true, false], ["viewer", true, false]]);
    const put = (body: unknown, who = "sa") => call(settingsPut, "PUT", "/api/v1/platform/settings", who, { body });
    const r = await put({ defaultGstPercent: 12, roleKeys: ["admin"], mailFromEmail: " Desk@Hotel.IN ", mailFromName: " Hello " });
    assert.equal(r.status, 200, JSON.stringify(r.error));
    assert.deepEqual([r.data.defaultGstPercent, r.data.defaultTimeZone, r.data.mailFromEmail, r.data.mailFromName, r.data.updatedBy], [12, "Asia/Kolkata", "desk@hotel.in", "Hello", "Sonal Super"]);
    assert.deepEqual(r.data.newHotelRoles.map((x: { key: string; enabled: boolean }) => [x.key, x.enabled]), [["super_admin", true], ["admin", true], ["editor", false], ["viewer", false]], "Super Admin is always kept");
    const a = auditOf("settings_updated");
    assert.equal(a.length, 1);
    assert.equal(a[0].reason, "roles for new hotels, default GST, mail sender");
    assert.equal((await put({ defaultGstPercent: 12, mailFromName: "Hello" })).status, 200);
    assert.equal(auditOf("settings_updated").length, 1, "no change, no audit entry");
    const bad = await put({ defaultGstPercent: 7, defaultTimeZone: "Mars/Base", mailFromName: "  ", mailFromEmail: "nope", roleKeys: ["owner"] });
    assert.equal(bad.status, 422);
    assert.deepEqual(Object.keys(bad.error.details.fields).sort(), ["defaultGstPercent", "defaultTimeZone", "mailFromEmail", "mailFromName", "roleKeys"]);
    assert.equal((await put({ invitationValidHours: 1 })).status, 422, "the invitation validity is not an input");
    assert.equal((await put({ twoStepForPlatformRoles: false })).status, 422, "the 2-step rule is not an input");
    assert.equal((await put({ defaultGstPercent: 5 }, "pa")).status, 403);
    assert.equal(auditOf("settings_updated").filter((x) => x.result === "failed").length, 1);
    // how long the files of an email stay after the send: one hour until the Super Admin sets another, whole hours from 1 to 72
    assert.equal((await get(settingsGet, "/api/v1/platform/settings")).data.mailFilesKeepHours, 1);
    const keep = await put({ mailFilesKeepHours: 6 });
    assert.equal(keep.status, 200, JSON.stringify(keep.error));
    assert.equal(keep.data.mailFilesKeepHours, 6);
    assert.match(auditOf("settings_updated").at(-1)?.reason ?? "", /Email files are kept 6 hours/);
    for (const v of [0, 73, 1.5, -2]) assert.equal((await put({ mailFilesKeepHours: v })).status, 422, String(v));
    assert.equal((await put({ mailFilesKeepHours: 3 }, "pa")).status, 403);
    assert.equal((await get(settingsGet, "/api/v1/platform/settings", "pa")).status, 403);
    assert.equal((await get(settingsGet, "/api/v1/platform/settings")).data.defaultGstPercent, 12, "kept");
  });

  test("Sign-in security through the real route (MJ, 5 Nov 2026): Super Admin reads and saves; Platform Admin, hotel staff, group admin and guest are refused; the general settings route cannot set it", async () => {
    const url = "/api/v1/platform/security";
    const d = await get(securityGet, url);
    assert.equal(d.status, 200);
    assert.deepEqual([d.data.sessionMinutes.hotel_user, d.data.sessionMinutes.guest_user, d.data.tempPasswordMinutes], [720, 10_080, 30]);
    const saved = await call(securityPut, "PUT", url, "sa",{ body: { sessionMinutes: { hotel_admin: 240 }, tempPasswordMinutes: 60 } });
    assert.equal(saved.status, 200, JSON.stringify(saved.error));
    assert.deepEqual([saved.data.sessionMinutes.hotel_admin, saved.data.tempPasswordMinutes, saved.data.updatedBy], [240, 60, "Sonal Super"]);
    assert.equal(auditOf("settings_updated").filter((a) => a.result === "success").at(-1)?.reason, "Hotel Admin signed in for 4 hours, Temporary password works for 1 hour");
    for (const who of ["pa", "ha", "hu", "gadm", "guest"]) {
      assert.equal((await call(securityPut, "PUT", url, who, { body: { sessionMinutes: { hotel_admin: 15 } } })).status, 403, `${who} saves`);
      assert.equal((await get(securityGet, url, who)).status, 403, `${who} reads`);
    }
    assert.equal((await call(securityPut, "PUT", url, "sa", { body: { sessionMinutes: { hotel_admin: 14 } } })).status, 422);
    assert.equal((await call(securityPut, "PUT", url, "sa", { body: { sessionMinutes: { owner: 60 } } })).status, 422, "only the seven user kinds");
    assert.equal((await call(settingsPut, "PUT", "/api/v1/platform/settings", "sa", { body: { sessionMinutes: { hotel_admin: 15 } } })).status, 422);
    assert.equal((await get(securityGet, url)).data.sessionMinutes.hotel_admin, 240, "kept");
  });
});

describe("platform health", () => {
  test("pending is what the provisioner counted from the SET of files (a gap is not pending); an applied row with no file is flagged on its own", async () => {
    w.provisioner.inspection[H.gir] = { migrationsApplied: 19, migrationsPending: 0, unknownMigrations: 0, databaseMs: 10 };
    w.provisioner.inspection[H.sunrise] = { migrationsApplied: 21, migrationsPending: 1, unknownMigrations: 2, databaseMs: 10 };
    const r = await get(healthGet, "/api/v1/platform/health");
    assert.equal(r.status, 200, JSON.stringify(r.error));
    const [gir, sunrise] = r.data.rows;
    assert.deepEqual([gir.migrationsApplied, gir.migrationsPending], [19, 0], "19 rows against a latest file number of 20 is not pending when the files say so");
    assert.ok(!gir.problems.some((p: string) => /waiting to be applied|does not know/.test(p)));
    assert.deepEqual([sunrise.migrationsPending, sunrise.problems.filter((p: string) => /waiting to be applied|does not know/.test(p))], [1, ["1 database change is waiting to be applied.", "The database has 2 changes this server does not know (applied by a newer version, or a file was removed)."]]);
    delete w.provisioner.inspection[H.gir];
    delete w.provisioner.inspection[H.sunrise];
  });
  test("one row per live hotel; pending migrations, a slow or down database and failing mail are flagged; the check is audited; Super Admin only", async () => {
    w.provisioner.inspection[H.gir] = { migrationsApplied: 18, databaseMs: 900 };
    const r = await get(healthGet, "/api/v1/platform/health");
    assert.equal(r.status, 200, JSON.stringify(r.error));
    assert.equal(r.data.latestMigration, 20);
    assert.deepEqual(r.data.rows.map((x: { hotelName: string }) => x.hotelName), ["Gir Forest Lodge", "Hotel Sunrise"], "only live hotels (active, suspended)");
    const gir = r.data.rows[0];
    assert.deepEqual([gir.hotelStatus, gir.migrationsApplied, gir.migrationsPending, gir.database, gir.databaseMs, gir.status], ["suspended", 18, 2, "slow", 900, "attention"]);
    assert.deepEqual(gir.problems, ["The database answers slowly.", "2 database changes are waiting to be applied.", "No backup has been taken yet.", "Nobody from this hotel has used EasyHotelSolutions yet."]);
    assert.equal(gir.lastActivityAt, null);
    assert.deepEqual(r.data.tiles, { healthy: 0, attention: 2, noBackup: 2, pendingMigrations: 1 });
    w.provisioner.inspection[H.sunrise] = { migrationsApplied: 0, databaseMs: null };
    w.auth.data().outbox.push({ id: randomUUID(), userId: U.hu, kind: "login_code", toEmail: "x@y.z", template: "login_code", payload: null, status: "failed", attempts: 5, nextAttemptAt: now(), sentAt: null, createdAt: now() } as never);
    const down = (await get(healthGet, "/api/v1/platform/health")).data.rows[1];
    assert.deepEqual([down.database, down.databaseMs, down.mail, down.status], ["down", null, "failing", "down"]);
    assert.ok(down.problems.includes("Emails from this hotel are not being sent."));
    // a mail of the hotel's OWN sender (0118) that failed flags the hotel too, with no person on the row
    w.auth.data().outbox.push({ id: randomUUID(), userId: null, hotelId: H.gir, kind: "enquiry_new", toEmail: "x@y.z", template: "enquiry-new", payload: null, status: "failed", attempts: 5, nextAttemptAt: now(), sentAt: null, createdAt: now() } as never);
    w.cons.data.hotels.get(H.gir)!.lastActivityAt = new Date(now().getTime() - 20 * 86_400_000);
    const girAgain = (await get(healthGet, "/api/v1/platform/health")).data.rows[0];
    assert.deepEqual([girAgain.mail, girAgain.lastActivityAt?.slice(0, 10), girAgain.problems.at(-1)], ["failing", "2026-09-15", "Nobody from this hotel has used EasyHotelSolutions for 20 days."]);
    assert.deepEqual([girAgain.bills, (await get(healthGet, "/api/v1/platform/health")).data.rows[1].bills], [{ count: 7, billedPaise: 4_200_000 }, null], "bills this month: read for Gir, not readable for Sunrise");
    // T6: the newest nightly copy is the row's Last backup; none = "no backup yet", older than 2 days = "more than 2 days old"; P1: storage per hotel from the catalog
    w.cons.data.storageBytes.set(H.gir, 48_234_496);
    await w.cons.unit.run((repos) => repos.backups.record({ hotelId: H.gir, status: "ready", fileName: "backup-2026-10-10-abcdef12.ndjson.gz", fileRef: `backups/${H.gir}/backup-2026-10-10-abcdef12.ndjson.gz`, byteSize: 1024, sha256: "b".repeat(64), tableCount: 70, rowCount: 900, startedAt: new Date(now().getTime() - 3 * 86_400_000), finishedAt: new Date(now().getTime() - 3 * 86_400_000) }));
    await w.cons.unit.run((repos) => repos.backups.record({ hotelId: H.gir, status: "failed", errorCode: "read", startedAt: now(), finishedAt: now() }));
    const backed = (await get(healthGet, "/api/v1/platform/health")).data;
    assert.deepEqual([backed.rows[0].lastBackupAt?.slice(0, 10), backed.rows[0].storageBytes, backed.rows[1].lastBackupAt, backed.rows[1].storageBytes], ["2026-10-02", 48_234_496, null, null]);
    assert.ok(backed.rows[0].problems.includes("The last backup is more than 2 days old.") && !backed.rows[0].problems.includes("No backup has been taken yet."));
    assert.equal(backed.tiles.noBackup, 1);
    await w.cons.unit.run((repos) => repos.backups.record({ hotelId: H.gir, status: "ready", fileName: "backup-2026-10-13-abcdef12.ndjson.gz", fileRef: "x", byteSize: 1, sha256: "c".repeat(64), tableCount: 1, rowCount: 1, startedAt: now(), finishedAt: now() }));
    const fresh = (await get(healthGet, "/api/v1/platform/health")).data.rows[0];
    assert.ok(!fresh.problems.some((p: string) => p.includes("backup")), fresh.problems.join(" | "));
    assert.equal(auditOf("health_checked").length, 0, "reading is not audited");
    const c = await post(healthCheck, "/api/v1/platform/health/check", "sa");
    assert.equal(c.status, 200);
    assert.equal(auditOf("health_checked").length, 1);
    assert.match(String(auditOf("health_checked")[0].reason), /^0 healthy, 2 need attention\.$/);
    assert.equal((await post(healthCheck, "/api/v1/platform/health/check", "pa")).status, 403);
    assert.equal((await get(healthGet, "/api/v1/platform/health", "pa")).status, 403);
  });

  test("where the owner-side look is not configured the page still answers (numbers 0, the platform database's own time)", async () => {
    w.provisioner.unconfigured = true;
    const r = await get(healthGet, "/api/v1/platform/health");
    assert.equal(r.status, 200);
    assert.deepEqual([r.data.latestMigration, r.data.rows[0].migrationsApplied, r.data.rows[0].migrationsPending, r.data.rows[0].database, r.data.rows[0].databaseMs], [0, 0, 0, "ok", 1]);
  });
});

describe("archived hotels, export and permanent delete", () => {
  test("the list: newest archive first, grace days, who archived, export state; search", async () => {
    w.cons.data.audit.push({ ...blankAudit, actorUserId: U.sa, actorName: "Sonal Super", actorRole: "super_admin", action: "hotel_archived", entityId: H.old, hotelId: H.old, targetLabel: "Old Palace", reason: "Closed down", at: new Date("2026-06-27T10:00:00+05:30"), id: randomUUID() });
    const r = await get(archivedGet, "/api/v1/platform/archived-hotels");
    assert.equal(r.status, 200, JSON.stringify(r.error));
    assert.deepEqual(r.data.map((h: { name: string }) => h.name), ["Fresh Archive", "Old Palace"]);
    const [fresh, old] = r.data;
    assert.deepEqual([fresh.daysLeft, fresh.canRestore, fresh.canDelete, fresh.graceDays, fresh.exportedAt, fresh.archivedBy], [80, true, false, 90, null, "Unknown"]);
    assert.deepEqual([old.daysLeft, old.canRestore, old.canDelete, old.archivedBy, old.reason, old.adminCount], [0, false, false, "Sonal Super", "Closed down", 1]);
    assert.equal((await get(archivedGet, "/api/v1/platform/archived-hotels?search=palace")).data.length, 1);
    assert.equal((await get(archivedGet, "/api/v1/platform/archived-hotels?search=closed%20down")).data.length, 1);
    assert.equal((await get(archivedGet, "/api/v1/platform/archived-hotels", "pa")).status, 403);
  });

  test("export: any hotel, audited, kept as a ready export; a failure or a missing worker is a plain 500 and audited as failed; PA 403", async () => {
    const ok = await post(hotelExport, `/api/v1/platform/hotels/${H.sunrise}/export`, "sa", undefined, H.sunrise);
    assert.equal(ok.status, 200, JSON.stringify(ok.error));
    assert.match(ok.data.fileName, /^hotel-sunrise-export-2026-10-05-[0-9a-f]{8}\.ndjson\.gz$/);
    assert.deepEqual([ok.data.hotelId, typeof ok.data.exportedAt, ok.data.message], [H.sunrise, "string", "Export prepared"]);
    assert.equal(w.cons.data.exports.length, 1);
    assert.equal(auditOf("hotel_exported").at(-1)?.reason, ok.data.fileName);
    w.provisioner.failExport = true;
    const bad = await post(hotelExport, `/api/v1/platform/hotels/${H.sunrise}/export`, "sa", undefined, H.sunrise);
    assert.deepEqual([bad.status, bad.error.code], [500, "SERVER_ERROR"]);
    assert.equal(w.cons.data.exports.length, 1, "a failed export leaves no record");
    w.provisioner.unconfigured = true;
    assert.equal((await post(hotelExport, `/api/v1/platform/hotels/${H.sunrise}/export`, "sa", undefined, H.sunrise)).status, 500);
    assert.equal(auditOf("hotel_exported").filter((a) => a.result === "failed").length, 2);
    assert.equal((await post(hotelExport, `/api/v1/platform/hotels/${randomUUID()}/export`, "sa", undefined, randomUUID())).status, 404);
    assert.equal((await post(hotelExport, `/api/v1/platform/hotels/${H.sunrise}/export`, "pa", undefined, H.sunrise)).status, 403);
  });

  const del = (id: string, slug: unknown, who = "sa") => post(hotelDelete, `/api/v1/platform/hotels/${id}/delete-permanently`, who, { confirmSlug: slug }, id);
  const exportOld = () => post(hotelExport, `/api/v1/platform/hotels/${H.old}/export`, "sa", undefined, H.old);

  test("every rule refuses with the plain sentence and an audited failed row: not archived, grace not over, no export, wrong address, Platform Admin", async () => {
    assert.deepEqual((await del(H.sunrise, "hotel-sunrise")).error.message, "Only an archived hotel can be deleted permanently.");
    const inGrace = await del(H.ready, "fresh-archive");
    assert.deepEqual([inGrace.status, inGrace.error.message], [409, "This hotel is still in its grace period (80 days left)."]);
    assert.equal((await del(H.old, "old-palace")).error.message, "Export the hotel’s data before deleting it.");
    await exportOld();
    const wrong = await del(H.old, "old-palac");
    assert.deepEqual([wrong.status, wrong.error.details.fields.confirmSlug], [422, "The address does not match. Type it exactly as shown."]);
    assert.equal((await del(H.old, "")).status, 422);
    assert.equal((await del(H.old, "old-palace", "pa")).status, 403);
    assert.equal((await del(randomUUID(), "x")).status, 404);
    assert.equal(auditOf("hotel_deleted").filter((a) => a.result === "failed").length, 6);
    assert.equal(w.cons.data.deletions.length, 0);
    assert.equal(w.provisioner.dropped.length, 0, "nothing was dropped by a refusal");
    assert.equal((await get(archivedGet, "/api/v1/platform/archived-hotels")).data.length, 2);
  });

  test("the delete: the record and the audit are written, the hotel leaves every list, its accounts are closed, then the schema is dropped; a second delete is a 404", async () => {
    await exportOld();
    const listed = (await get(archivedGet, "/api/v1/platform/archived-hotels")).data.find((h: { id: string }) => h.id === H.old);
    assert.deepEqual([listed.canDelete, listed.exportFileName?.startsWith("old-palace-export-")], [true, true]);
    const r = await del(H.old, " old-palace ");
    assert.equal(r.status, 200, JSON.stringify(r.error));
    assert.deepEqual(r.data, { hotelId: H.old, name: "Old Palace", message: "Old Palace was deleted for good." });
    const rec = w.cons.data.deletions[0];
    assert.deepEqual([rec.hotelId, rec.slug, rec.confirmSlug, rec.deletedBy, rec.schemaName], [H.old, "old-palace", "old-palace", U.sa, `hotel_${H.old.replace(/-/g, "")}`]);
    assert.deepEqual(w.provisioner.dropped, [`${H.old}:${rec.schemaName}`]);
    const a = auditOf("hotel_deleted").at(-1)!;
    assert.deepEqual([a.result, a.hotelId, a.after], ["success", H.old, { accountsClosed: 1, export: listed.exportFileName }]);
    assert.equal(w.auth.data().hotels.find((h) => h.id === H.old)?.status, "deleted");
    assert.ok(w.cons.data.hotels.get(H.old)?.deletedAt);
    assert.equal(row("oldadm").deletedAt !== null, true, "the hotel's only-here account is closed");
    assert.ok(w.auth.data().sessions.filter((s) => s.userId === U.oldadm).every((s) => s.revokedAt !== null));
    assert.deepEqual((await get(archivedGet, "/api/v1/platform/archived-hotels")).data.map((h: { id: string }) => h.id), [H.ready]);
    assert.ok(w.cons.data.statusHistory.some((x) => x.hotelId === H.old && x.fromStatus === "archived" && x.toStatus === "deleted" && x.changedBy === U.sa));
    assert.equal((await del(H.old, "old-palace")).status, 404);
    assert.equal((await post(hotelExport, `/api/v1/platform/hotels/${H.old}/export`, "sa", undefined, H.old)).status, 404);
  });

  test("a worker that is not set up refuses BEFORE anything is recorded; a drop that fails after the record keeps the record and says so", async () => {
    await exportOld();
    w.provisioner.unconfigured = true;
    const no = await del(H.old, "old-palace");
    assert.deepEqual([no.status, no.error.message], [500, "Deleting a hotel is not set up on this server yet."]);
    assert.equal(w.cons.data.deletions.length, 0);
    assert.equal(w.auth.data().hotels.find((h) => h.id === H.old)?.status, "archived");
    w.provisioner.unconfigured = false;
    w.provisioner.failDrop = true;
    const half = await del(H.old, "old-palace");
    assert.equal(half.status, 500);
    assert.match(half.error.message, /was deleted from the platform, but its stored data could not be removed yet/);
    assert.equal(w.cons.data.deletions.length, 1, "the deletion record stays");
    assert.equal(w.auth.data().hotels.find((h) => h.id === H.old)?.status, "deleted");
    assert.equal(auditOf("hotel_deleted").filter((x) => x.result === "success").length, 1);
    assert.equal(auditOf("hotel_deleted").filter((x) => x.result === "failed").length >= 2, true);
  });

  test("a group's link to the hotel is removed with a history row", async () => {
    const gid = randomUUID();
    w.cons.data.groups.push({ id: gid, name: "Palace Group", slug: "palace-group", status: "active", adminUserId: null, createdAt: now(), deletedAt: null, legalName: null, gstin: null, address: null, city: null, state: null, pin: null, phone: null, email: null, submittedAt: null, approvedAt: null, rejectedAt: null, rejectReason: null });
    w.cons.data.members.push({ groupId: gid, hotelId: H.old, linkedBy: null, createdAt: now() });
    await exportOld();
    assert.equal((await del(H.old, "old-palace")).status, 200);
    assert.equal(w.cons.data.members.some((m) => m.hotelId === H.old), false);
    assert.ok(w.cons.data.groupHistory.some((x) => x.groupId === gid && x.event === "hotel_unlinked" && x.hotelId === H.old));
  });
});

describe("announcements to the hotels (P4)", () => {
  const body = (over: Record<string, unknown> = {}) => ({ title: " Maintenance on Sunday night ", body: "HMS is away from 1:00 to 1:30 am IST.", audience: "admins", ...over });
  const create = (b: unknown, who = "sa") => call(annCreate, "POST", "/api/v1/platform/announcements", who, { body: b });
  const end = (id: string, who = "sa") => call(annEnd, "POST", `/api/v1/platform/announcements/${id}/end`, who, { params: { id } });
  const unread = (who: string) => call(annUnread, "GET", "/api/v1/overview/announcements", who);
  const dismiss = (id: string, who: string) => call(annDismiss, "POST", `/api/v1/overview/announcements/${id}/dismiss`, who, { params: { id } });
  /** The hotel people need the dashboard to read announcements: the viewer and admin roles get it. */
  const grantDashboard = () => {
    for (const r of w.auth.data().roles) w.auth.data().rolePermissions.push({ roleId: r.id, key: "dashboard", level: "view" });
  };

  test("the Super Admin publishes one (trimmed, audited, last day optional), lists them newest first; a Platform Admin is refused and audited; the input is checked", async () => {
    const r = await create(body({ endsOn: "2026-10-20" }));
    assert.equal(r.status, 201, JSON.stringify(r.error));
    assert.deepEqual([r.data.title, r.data.audience, r.data.state, r.data.endsAt, r.data.endedAt, r.data.createdBy, r.data.reads], ["Maintenance on Sunday night", "admins", "live", "2026-10-20T18:29:59.000Z", null, "Sonal Super", 0]);
    const second = await create(body({ title: "New: GST Summary report", body: "Reports > GST Summary.", audience: "everyone" }));
    assert.equal(second.status, 201);
    const list = await call(annList, "GET", "/api/v1/platform/announcements", "sa");
    assert.deepEqual(list.data.map((a: { title: string; endsAt: string | null }) => [a.title, a.endsAt]), [["New: GST Summary report", null], ["Maintenance on Sunday night", "2026-10-20T18:29:59.000Z"]]);
    const a = auditOf("announcement_created");
    assert.equal(a.length, 2);
    assert.deepEqual([a[0].result, a[0].actorName, a[0].targetLabel, a[0].entityId, a[0].after], ["success", "Sonal Super", "Maintenance on Sunday night", r.data.id, { audience: "admins", important: false, endsOn: "2026-10-20" }]);
    assert.equal((await create(body(), "pa")).status, 403);
    assert.equal(auditOf("announcement_created").filter((x) => x.result === "failed").length, 1);
    assert.equal((await call(annList, "GET", "/api/v1/platform/announcements", "pa")).status, 403);
    const bad = await create(body({ title: "  ", body: "", endsOn: "2026-10-04" }));
    assert.equal(bad.status, 422);
    assert.deepEqual(bad.error.details.fields, { title: "Give the announcement a title.", body: "Write the message.", endsOn: "The last day must be today or later." });
    assert.equal((await create(body({ title: "x".repeat(121) }))).error.details.fields.title, "Keep the title under 120 characters.");
    assert.equal((await create(body({ audience: "owners" }))).status, 422);
  });

  test("the hotel side: a Hotel Admin sees admins-only and everyone's, a hotel user only everyone's, oldest first; Got it hides it for that person only; a guest never reaches it", async () => {
    grantDashboard();
    const admins = (await create(body())).data;
    const everyone = (await create(body({ title: "For all", audience: "everyone" }))).data;
    const ha = await unread("ha");
    assert.equal(ha.status, 200, JSON.stringify(ha.error));
    assert.deepEqual(ha.data.map((a: { id: string }) => a.id), [admins.id, everyone.id]);
    assert.deepEqual(Object.keys(ha.data[0]).sort(), ["at", "body", "id", "important", "title"]);
    assert.deepEqual((await unread("hu")).data.map((a: { id: string }) => a.id), [everyone.id]);
    assert.deepEqual((await dismiss(admins.id, "ha")).data, { dismissed: true });
    assert.deepEqual((await unread("ha")).data.map((a: { id: string }) => a.id), [everyone.id], "gone for Hari");
    assert.deepEqual((await dismiss(admins.id, "ha")).status, 200, "a repeat is fine");
    assert.equal((await dismiss(admins.id, "hu")).status, 404, "a hotel user cannot see an admins-only one");
    assert.equal((await dismiss(randomUUID(), "ha")).status, 404);
    assert.equal((await unread("guest")).status, 403);
    assert.equal((await unread("sa")).status, 403, "platform staff have no hotel dashboard");
    const list = await call(annList, "GET", "/api/v1/platform/announcements", "sa");
    assert.deepEqual(list.data.map((a: { title: string; reads: number }) => [a.title, a.reads]), [["For all", 0], ["Maintenance on Sunday night", 1]]);
  });

  test("ending one (audited) takes it off every dashboard at once; a second end is a 409; one past its last day is over by itself", async () => {
    grantDashboard();
    const a = (await create(body())).data;
    assert.equal((await unread("ha")).data.length, 1);
    const ended = await end(a.id);
    assert.deepEqual([ended.status, ended.data.state, typeof ended.data.endedAt], [200, "over", "string"]);
    assert.equal((await unread("ha")).data.length, 0);
    assert.deepEqual([(await end(a.id)).status, (await end(a.id)).error.message], [409, "This announcement is already over."]);
    assert.equal((await end(randomUUID())).status, 404);
    assert.equal((await end(a.id, "pa")).status, 403);
    assert.equal(auditOf("announcement_ended").filter((x) => x.result === "success").length, 1);
    const today = (await create(body({ title: "Today only", endsOn: "2026-10-05" }))).data;
    assert.deepEqual([today.state, today.endsAt], ["live", "2026-10-05T18:29:59.000Z"], "the last day runs to the end of the IST day");
    // the next morning (past the browser sessions' life, so straight through the service): over by itself, for the hotel and in the list
    clock = new Date("2026-10-06T01:00:00+05:30");
    const svc = w.services.announcements;
    const hotelAdmin = makeSession({ userId: U.ha, hotelId: H.sunrise, accountRole: "hotel_admin", roleKey: "admin", roleLevel: 3 });
    assert.deepEqual(await svc.unread(hotelAdmin), [], "over the next morning");
    const superAdmin = makeSession({ userId: U.sa, hotelId: "", accountRole: "super_admin", roleKey: "super_admin", roleLevel: 4 });
    assert.equal((await svc.list(superAdmin)).find((x) => x.id === today.id)?.state, "over");
  });
});

describe("every platform route: who may call it (security inventory)", () => {
  // Super Admin only; every other platform route is open to Platform Admin and Super Admin
  const SUPER_ONLY = [/^users\/\[id\]\//, /^staff/, /^audit/, /^sign-ins/, /^settings/, /^security/, /^health/, /^archived-hotels/, /^announcements/, /^hotels\/\[id\]\/(export|delete-permanently)/, /^setup/, /^whatsapp\//];
  // My vault answers 404 to anyone but its Super Admin (it does not say it exists)
  const HIDDEN = [/^my-vault/];
  const QUERIES: Record<string, string> = { "DELETE whatsapp/rules/hotels/[hotelId]/route.ts": `?key=${HOTEL_OVERRIDE_KEYS[0]}` };
  // the Set-up centre's word params take real values, so the Platform Admin's answer is the gate's and not the params check's
  const SETUP_PARAMS: Record<string, (rel: string) => string> = { service: () => "payments_hotel", business: () => "hotel", group: () => "razorpay_hotel", step: (rel) => (rel.includes("google") ? "connect" : "test") };
  const BODIES: Record<string, unknown> = {
    "staff/route.ts": { name: "Nila New", username: "nila.new", email: "nila@demo.hms", mobile: "9876543210" },
    "settings/route.ts": { defaultGstPercent: 12 },
    "security/route.ts": { tempPasswordMinutes: 60 },
    "settings/smtp-test/route.ts": { to: "me@example.com" },
    "announcements/route.ts": { title: "Maintenance tonight", body: "HMS is away from 1 to 1:30 am.", audience: "admins" },
    "hotels/[id]/delete-permanently/route.ts": { confirmSlug: "x" },
    "hotels/[id]/enter/route.ts": { reason: "Looking into a ticket" },
    "staff/[id]/hotel-access/route.ts": { level: "full", allHotels: true, reason: "Covers the night desk" },
    "setup/hotels/[id]/payments/route.ts": { business: "hotel", mode: "test" },
    "setup/hotels/[id]/id-photos/route.ts": { exactCopy: true },
    "setup/hotels/[id]/settings/[group]/route.ts": { values: {} },
    "users/[id]/mail-addresses/route.ts": { pattern: "org_name" },
    "users/[id]/mail-addresses/preview/route.ts": { pattern: "org_name" },
    "security/resets/route.ts": { layer: 2, reason: "inventory test" },
    "whatsapp/backup/route.ts": { step: "verify" },
    "whatsapp/hotels/[hotelId]/move/route.ts": { step: "undo" },
    "whatsapp/lines/route.ts": { kind: "platform", phoneNumberId: "123456789012", wabaId: "123456789012", token: "EAAG".padEnd(40, "x") },
    "whatsapp/lines/[id]/disconnect/route.ts": { confirm: "Platform number" },
    "whatsapp/lines/[id]/test/route.ts": { to: "919825012345" },
    "whatsapp/lines/[id]/token/route.ts": { token: "EAAG".padEnd(40, "y") },
    "whatsapp/lines/[id]/hotels/route.ts": { hotelId: "11111111-1111-4111-8111-111111111111" },
    "whatsapp/lines/[id]/hotels/[hotelId]/route.ts": { hotelCode: null },
    "whatsapp/rules/hotels/[hotelId]/route.ts": { overrides: {} },
    "whatsapp/rules/kill-switch/route.ts": { scope: "global", on: false },
  };
  const root = path.join(process.cwd(), "src", "app", "api", "v1", "platform");
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
      else if (e.name === "route.ts") files.push(path.relative(root, path.join(dir, e.name)).replace(/\\/g, "/"));
    }
  };
  walk(root);

  test("the inventory is complete (a route added later must be covered by these checks)", () => {
    assert.ok(files.length >= 45, `found ${files.length} platform route files`);
  });

  test("anonymous: 401 everywhere; hotel staff, group admin and guest: never a success, 403 once the body is valid; Platform Admin: 403 on every Super-Admin-only route", async () => {
    let calls = 0;
    for (const rel of files) {
      const mod = (await import(pathToFileURL(path.join(root, rel)).href)) as Record<string, Route | undefined>;
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        const handler = mod[method];
        if (!handler) continue;
        const params: Record<string, string> = {};
        for (const m of rel.matchAll(/\[(\w+)\]/g)) params[m[1]] = rel.startsWith("setup/") ? (SETUP_PARAMS[m[1]]?.(rel) ?? randomUUID()) : randomUUID();
        const urlPath = `/api/v1/platform/${rel.replace(/\/?route\.ts$/, "").replace(/\[(\w+)\]/g, (_, name: string) => params[name])}${QUERIES[`${method} ${rel}`] ?? ""}`;
        const body = method === "GET" || method === "DELETE" ? undefined : (BODIES[rel] ?? {});
        const send = async (who: string | null) => {
          const h: Record<string, string> = { host: "hms.test", origin: ORIGIN, "user-agent": "node-test/1.0" };
          if (who) h.cookie = `${SESSION_COOKIE}=${TOKENS[who]}`;
          if (body !== undefined) h["content-type"] = "application/json";
          const res = await handler(new Request(`${ORIGIN}${urlPath}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), { params: Promise.resolve(params) });
          calls += 1;
          return res.status;
        };
        const label = `${method} ${rel}`;
        assert.equal(await send(null), 401, `${label} anonymous`);
        for (const who of ["hu", "ha", "gadm", "guest"]) {
          const status = await send(who);
          const hidden = HIDDEN.some((re) => re.test(rel));
          assert.ok(status === 403 || status === 422 || (hidden && status === 404), `${label} as ${who} answered ${status}`);
          if (BODIES[rel] !== undefined) assert.equal(status, 403, `${label} as ${who}`);
        }
        if (SUPER_ONLY.some((re) => re.test(rel))) assert.equal(await send("pa"), 403, `${label} as Platform Admin`);
        else if (HIDDEN.some((re) => re.test(rel))) assert.ok([404, 422].includes(await send("pa")), `${label} as Platform Admin`);
      }
    }
    assert.ok(calls > 200, `${calls} calls made`);
    assert.equal(w.cons.data.audit.filter((a) => a.result === "success").length, 0, "nothing succeeded for a person who may not");
    assert.equal(w.cons.data.deletions.length + w.cons.data.exports.length, 0);
  });
});