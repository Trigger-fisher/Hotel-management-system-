// The Platform console (P2): overview, hotels and their status machine, hotel admins, groups, activity: through the REAL route files on the in-memory
// double (docs/BACKEND.md section 14.1 to 14.3). Who may call (Platform Admin, Super Admin), the contract's sentences, history and audit rows in the
// same unit (a failing audit write undoes the change), the credential side on the same transaction, hostile input.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import { GET as activityRoute } from "../../src/app/api/v1/platform/activity/route";
import { DELETE as unlinkRoute } from "../../src/app/api/v1/platform/groups/[id]/hotels/[hotelId]/route";
import { POST as linkRoute } from "../../src/app/api/v1/platform/groups/[id]/hotels/route";
import { PUT as groupAdminRoute } from "../../src/app/api/v1/platform/groups/[id]/admin/route";
import { GET as groupRoute } from "../../src/app/api/v1/platform/groups/[id]/route";
import { GET as groupsRoute, POST as createGroupRoute } from "../../src/app/api/v1/platform/groups/route";
import { POST as disableRoute } from "../../src/app/api/v1/platform/hotel-admins/[id]/disable/route";
import { POST as enableRoute } from "../../src/app/api/v1/platform/hotel-admins/[id]/enable/route";
import { POST as resetRoute } from "../../src/app/api/v1/platform/hotel-admins/[id]/reset-password/route";
import { POST as unlockRoute } from "../../src/app/api/v1/platform/hotel-admins/[id]/unlock/route";
import { GET as adminsRoute } from "../../src/app/api/v1/platform/hotel-admins/route";
import { POST as addAdminRoute } from "../../src/app/api/v1/platform/hotels/[id]/admins/route";
import { POST as archiveRoute } from "../../src/app/api/v1/platform/hotels/[id]/archive/route";
import { POST as reactivateRoute } from "../../src/app/api/v1/platform/hotels/[id]/reactivate/route";
import { POST as restoreRoute } from "../../src/app/api/v1/platform/hotels/[id]/restore/route";
import { GET as hotelRoute } from "../../src/app/api/v1/platform/hotels/[id]/route";
import { POST as suspendRoute } from "../../src/app/api/v1/platform/hotels/[id]/suspend/route";
import { GET as hotelsRoute } from "../../src/app/api/v1/platform/hotels/route";
import { GET as overviewRoute } from "../../src/app/api/v1/platform/overview/route";
import { GET as usersRoute } from "../../src/app/api/v1/platform/users/route";
import { createArgon2Hasher } from "../../src/server/auth/password";
import type { VerifiedSession } from "../../src/server/auth/session";
import { buildPlatformServices, configurePlatform } from "../../src/server/compose/platform";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { createMemoryProvisioner } from "../../src/server/provisioner/memory";
import type { UserRecord } from "../../src/server/repos/auth";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { createMemoryPlatformConsole, type MemHotelMeta } from "../../src/server/repos/memory/platformConsole";
import { createCredentialService } from "../../src/server/services/auth/credentialService";
import { catalog, makeSession } from "./helpers/session";

const ORIGIN = "https://hms.test";
const hasher = createArgon2Hasher({ memoryCost: 1024, timeCost: 1, parallelism: 1 });
let clock = new Date("2026-10-05T10:00:00+05:30");
const now = (): Date => new Date(clock.getTime());

const H = { sunrise: randomUUID(), gir: randomUUID(), pending: randomUUID(), old: randomUUID(), solo: randomUUID() };
const G = { sunrise: randomUUID() };
const U: Record<string, string> = {};
const sessions = new Map<string, VerifiedSession>();

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
  const superRole = role("super_admin", 4);
  const meta = (over: Partial<MemHotelMeta> & Pick<MemHotelMeta, "slug">): MemHotelMeta => ({
    city: "Rajkot", state: "Gujarat", gstin: "24ABCDE1234F1Z5", timeZone: "Asia/Kolkata", createdAt: new Date("2026-09-01T10:00:00+05:30"), provisionedAt: new Date("2026-09-01T10:00:00+05:30"),
    submittedAt: null, approvedAt: null, rejectedAt: null, rejectReason: null, suspendedAt: null, suspendReason: null, archivedAt: null, archiveReason: null, restoreUntil: null,
    statusBeforeArchive: null, lastActivityAt: null, deletedAt: null, ...over,
  });
  const hotel = (id: string, name: string, status: string, m: Partial<MemHotelMeta> & Pick<MemHotelMeta, "slug">): void => {
    data.hotels.push({ id, name, status } as never);
    cons.data.hotels.set(id, meta(m));
  };
  hotel(H.sunrise, "Hotel Sunrise", "active", { slug: "hotel-sunrise", createdAt: new Date("2026-10-02T10:00:00+05:30") });
  hotel(H.gir, "Gir Forest Lodge", "suspended", { slug: "gir-forest-lodge", suspendedAt: new Date("2026-09-20T10:00:00+05:30"), suspendReason: "Unpaid" });
  hotel(H.pending, "Moonlight Inn", "pending_approval", { slug: "moonlight-inn", provisionedAt: null, submittedAt: new Date("2026-10-04T10:00:00+05:30") });
  hotel(H.old, "Old Palace", "archived", {
    slug: "old-palace", archivedAt: new Date("2026-09-25T10:00:00+05:30"), archiveReason: "Closed", restoreUntil: new Date("2026-12-24T10:00:00+05:30"), statusBeforeArchive: "active",
  });
  hotel(H.solo, "Solo Stay", "active", { slug: "solo-stay" });
  cons.data.groups.push({
    id: G.sunrise, name: "Sunrise Group", slug: "sunrise-group", status: "active", adminUserId: null, createdAt: new Date("2026-09-01T10:00:00+05:30"), deletedAt: null, legalName: null, gstin: null,
    address: null, city: null, state: null, pin: null, phone: null, email: null, submittedAt: null, approvedAt: null, rejectedAt: null, rejectReason: null,
  });
  cons.data.members.push({ groupId: G.sunrise, hotelId: H.sunrise, linkedBy: null, createdAt: new Date("2026-09-02T10:00:00+05:30") });
  const person = (key: string, over: Partial<UserRecord> & { roleId?: string }): UserRecord => {
    const id = randomUUID();
    U[key] = id;
    const u: UserRecord = {
      id, username: key, email: `${key}@demo.hms`, mobile: null, displayName: key.toUpperCase(), passwordHash: "x", accountRole: "hotel_user", status: "active", mustChangePassword: false,
      passwordChangedAt: null, failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null, codeRequired: false, lastLoginAt: null, deletedAt: null, roleId: viewer, ...over,
    };
    data.users.push(u);
    cons.data.accountMeta.set(id, { createdAt: new Date("2026-09-01T10:00:00+05:30"), createdBy: null });
    return u;
  };
  person("pa", { accountRole: "platform_admin", roleId: admin, displayName: "Priya Platform", codeRequired: true });
  person("sa", { accountRole: "super_admin", roleId: superRole, displayName: "Sonal Super", codeRequired: true });
  const ha = person("nisha", { accountRole: "hotel_admin", codeRequired: true, roleId: superRole, displayName: "Nisha Rao", mobile: "+919824012345" });
  data.memberships.push({ userId: ha.id, hotelId: H.sunrise, roleId: null, status: "active", isDefault: true, subject: null });
  const locked = person("lara", { accountRole: "hotel_admin", codeRequired: true, roleId: admin, displayName: "Lara Locked", lockedUntil: new Date("2026-10-06T10:00:00+05:30"), lockLevel: 2 });
  data.memberships.push({ userId: locked.id, hotelId: H.sunrise, roleId: null, status: "active", isDefault: true, subject: null });
  const gir = person("giri", { accountRole: "hotel_admin", codeRequired: true, roleId: admin, displayName: "Giri Gir" });
  data.memberships.push({ userId: gir.id, hotelId: H.gir, roleId: null, status: "active", isDefault: true, subject: null });
  person("staff", { accountRole: "hotel_user" });
  person("guest", { accountRole: "guest_user" });
  person("groupie", { accountRole: "group_hotel_admin", roleId: admin });

  const services = buildPlatformServices({
    unit: cons.unit,
    credentials: (repos) => createCredentialService({ unit: { run: (work) => work(repos.auth) }, hasher, now }),
    now,
    hasher, publicUrl: "https://hms.test", newToken: () => randomUUID().replace(/-/g, ""), hashKey: randomBytes(32),
    provisioner: createMemoryProvisioner({ auth: () => auth.data(), console: () => cons.data, now }),
  });
  configurePlatform(services);
  return { auth, cons, services };
}

const sess = (key: string, accountRole: VerifiedSession["accountRole"]): void => {
  sessions.set(key, makeSession({ hotelId: "", userId: U[key], accountRole, roleKey: "admin", roleLevel: 3 }));
};

beforeEach(() => {
  clock = new Date("2026-10-05T10:00:00+05:30");
  sessions.clear();
  w = build();
  sess("pa", "platform_admin");
  sess("sa", "super_admin");
  sess("staff", "hotel_user");
  sess("guest", "guest_user");
  sess("groupie", "group_hotel_admin");
  sess("nisha", "hotel_admin");
  configureRoutes({
    resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null,
    catalog,
    idempotency: createMemoryIdempotencyStore(),
    logger: createLogger({ level: process.env.DBG ? "debug" : "silent", write: (l: string) => { if (process.env.DBG) process.stderr.write(l + "\n"); } }),
  });
});

function req(method: string, path: string, who: string | null, body?: unknown): Request {
  const h: Record<string, string> = { host: "hms.test", origin: ORIGIN, "user-agent": "node-test/1.0" };
  if (who) h["x-test-session"] = who;
  if (body !== undefined) h["content-type"] = "application/json";
  return new Request(`${ORIGIN}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
type Route = (r: Request, c: { params: Promise<Record<string, string>> }) => Promise<Response>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: bodies are asserted field by field
async function call(route: Route, method: string, path: string, who: string | null, opts: { body?: unknown; params?: Record<string, string> } = {}): Promise<{ status: number; data: any; error: any }> {
  const res = await route(req(method, path, who, opts.body), { params: Promise.resolve(opts.params ?? {}) });
  const j = await res.json();
  return { status: res.status, data: j.data, error: j.error };
}
const auditOf = (action: string) => w.cons.data.audit.filter((a) => a.action === action);

describe("who may use the console", () => {
  test("Platform Admin and Super Admin may; staff, guest, hotel admin and Group Hotel Admin get 403; no session is 401", async () => {
    for (const who of ["pa", "sa"]) assert.equal((await call(overviewRoute, "GET", "/api/v1/platform/overview", who)).status, 200);
    for (const who of ["staff", "guest", "groupie", "nisha"]) {
      const r = await call(overviewRoute, "GET", "/api/v1/platform/overview", who);
      assert.equal(r.status, 403, who);
      assert.equal(r.error.code, "FORBIDDEN");
    }
    assert.equal((await call(overviewRoute, "GET", "/api/v1/platform/overview", null)).status, 401);
  });

  test("a refused write is audited as a failed row and changes nothing", async () => {
    const r = await call(suspendRoute, "POST", `/api/v1/platform/hotels/${H.sunrise}/suspend`, "nisha", { body: { reason: "x" }, params: { id: H.sunrise } });
    assert.equal(r.status, 403);
    assert.equal(w.cons.data.audit.filter((a) => a.result === "failed").length, 1);
    assert.equal(w.auth.data().hotels.find((h) => h.id === H.sunrise)?.status, "active");
  });

  test("an account that is no longer an active Platform Admin loses access at once", async () => {
    w.auth.data().users.find((u) => u.id === U.pa)!.status = "disabled";
    assert.equal((await call(overviewRoute, "GET", "/api/v1/platform/overview", "pa")).status, 403);
  });
});

describe("overview and hotel list", () => {
  test("tiles, newest hotels and what needs attention", async () => {
    const r = await call(overviewRoute, "GET", "/api/v1/platform/overview", "pa");
    const t = r.data.tiles;
    assert.equal(t.hotelsActive, 2);
    assert.equal(t.hotelsSuspended, 1);
    assert.equal(t.groups, 1);
    assert.equal(t.pendingHotels, 1);
    assert.equal(t.pendingApproval, 1);
    assert.equal(t.createdThisMonth, 1);
    assert.equal(t.lockedAccounts, 1);
    assert.equal(r.data.recentHotels.length, 4, "archived hotels are not in the newest list");
    const kinds = r.data.needsAttention.map((x: { kind: string }) => x.kind).sort();
    assert.deepEqual(kinds, ["locked_account", "no_admin", "pending_approval", "suspended"].sort());
  });

  test("status 'all' leaves archived out; counts follow search and kind; kindCounts follow the status", async () => {
    const all = await call(hotelsRoute, "GET", "/api/v1/platform/hotels", "pa");
    assert.equal(all.data.total, 4);
    assert.deepEqual(all.data.counts, { all: 4, active: 2, suspended: 1, pending_approval: 1, rejected: 0, archived: 1 });
    assert.deepEqual(all.data.kindCounts, { all: 4, individual: 3, group: 1 });
    const arch = await call(hotelsRoute, "GET", "/api/v1/platform/hotels?status=archived", "pa");
    assert.deepEqual(arch.data.items.map((h: { name: string }) => h.name), ["Old Palace"]);
    assert.equal(arch.data.items[0].canRestore, true);
    const grp = await call(hotelsRoute, "GET", "/api/v1/platform/hotels?kind=group", "pa");
    assert.deepEqual(grp.data.items.map((h: { name: string }) => h.name), ["Hotel Sunrise"]);
    const q = await call(hotelsRoute, "GET", "/api/v1/platform/hotels?search=gir%20lodge", "pa");
    assert.deepEqual(q.data.items.map((h: { name: string }) => h.name), ["Gir Forest Lodge"]);
    const m = await call(hotelsRoute, "GET", "/api/v1/platform/hotels?createdMonth=2026-10", "pa");
    assert.deepEqual(m.data.items.map((h: { name: string }) => h.name), ["Hotel Sunrise"]);
  });

  test("hostile and out-of-range query values are refused (422), unknown keys too", async () => {
    for (const q of ["pageSize=1000", "pageSize=7", "status=bogus", "createdMonth=2026-13", "page=0", "search=%00x", "groupId=not-a-uuid", "x=1", "page=1&page=2"]) {
      assert.equal((await call(hotelsRoute, "GET", `/api/v1/platform/hotels?${q}`, "pa")).status, 422, q);
    }
    const r = await call(hotelsRoute, "GET", `/api/v1/platform/hotels?search=${encodeURIComponent("'; DROP TABLE hotels;--")}`, "pa");
    assert.equal(r.status, 200);
    assert.equal(r.data.total, 0);
  });

  test("one hotel: facts, admins, read-only settings and activity; another id is 404", async () => {
    const r = await call(hotelRoute, "GET", `/api/v1/platform/hotels/${H.sunrise}`, "pa", { params: { id: H.sunrise } });
    assert.equal(r.status, 200);
    assert.equal(r.data.hotel.name, "Hotel Sunrise");
    assert.equal(r.data.hotel.kind, "group");
    assert.equal(r.data.hotel.groupName, "Sunrise Group");
    assert.deepEqual(r.data.admins.map((a: { name: string }) => a.name).sort(), ["Lara Locked", "Nisha Rao"]);
    assert.equal(r.data.admins.find((a: { username: string }) => a.username === "nisha").mobile, "9824012345");
    assert.equal(r.data.settings.stateCode, "24");
    assert.equal(r.data.settings.gstDefaults.roomsPercent, 5);
    assert.equal(r.data.onboarding, null);
    assert.equal((await call(hotelRoute, "GET", `/api/v1/platform/hotels/${randomUUID()}`, "pa", { params: { id: randomUUID() } })).status, 404);
    assert.equal((await call(hotelRoute, "GET", "/api/v1/platform/hotels/nope", "pa", { params: { id: "nope" } })).status, 422);
  });
});

describe("hotel status machine", () => {
  const post = (route: Route, action: string, id: string, who = "pa", body?: unknown) => call(route, "POST", `/api/v1/platform/hotels/${id}/${action}`, who, { body, params: { id } });
  const statusOf = (id: string): string | undefined => w.auth.data().hotels.find((h) => h.id === id)?.status;

  test("suspend: reason stored, history and audit written, the hotel's sessions end; again is 409", async () => {
    w.auth.data().sessions.push({ id: randomUUID(), userId: U.nisha, hotelId: H.sunrise, tokenHash: "h", client: "web", deviceLabel: null, ip: null, issuedAt: now(), lastSeenAt: now(), expiresAt: new Date(now().getTime() + 3_600_000), revokedAt: null, revokedReason: null } as never);
    const r = await post(suspendRoute, "suspend", H.sunrise, "pa", { reason: "  Unpaid invoice  " });
    assert.equal(r.status, 200);
    assert.equal(r.data.status, "suspended");
    assert.equal(r.data.suspendReason, "Unpaid invoice");
    assert.equal(statusOf(H.sunrise), "suspended");
    assert.equal(w.auth.data().sessions.filter((s) => s.revokedAt === null).length, 0);
    const h = w.cons.data.statusHistory.at(-1)!;
    assert.deepEqual([h.fromStatus, h.toStatus, h.reason, h.actorRole], ["active", "suspended", "Unpaid invoice", "platform_admin"]);
    const a = auditOf("hotel_suspended").at(-1)!;
    assert.deepEqual([a.actorName, a.actorRole, a.hotelId, a.result, a.reason, a.targetLabel], ["Priya Platform", "platform_admin", H.sunrise, "success", "Unpaid invoice", "Hotel Sunrise"]);
    assert.equal(a.ip, null, "no address on a test request");
    assert.equal(a.userAgent, "node-test/1.0");
    const again = await post(suspendRoute, "suspend", H.sunrise, "pa", {});
    assert.equal(again.status, 409);
    assert.equal(again.error.message, "This hotel is already suspended.");
  });

  test("suspend needs an active hotel; reactivate needs a suspended one", async () => {
    assert.equal((await post(suspendRoute, "suspend", H.pending, "pa", {})).error.message, "Only an active hotel can be suspended.");
    assert.equal((await post(reactivateRoute, "reactivate", H.sunrise)).error.message, "This hotel is already active.");
    assert.equal((await post(reactivateRoute, "reactivate", H.old)).error.message, "Only a suspended hotel can be reactivated.");
    const ok = await post(reactivateRoute, "reactivate", H.gir);
    assert.equal(ok.status, 200);
    assert.equal(ok.data.status, "active");
    assert.equal(ok.data.suspendReason, null);
  });

  test("a reason longer than 500 characters is refused with the field", async () => {
    const r = await post(suspendRoute, "suspend", H.sunrise, "pa", { reason: "x".repeat(501) });
    assert.equal(r.status, 422);
    assert.equal(r.error.details.fields.reason, "Keep the reason to 500 characters.");
    assert.equal(statusOf(H.sunrise), "active");
  });

  test("archive keeps the data for 90 days; restore returns to the status it had; after the grace it is 409", async () => {
    assert.equal((await post(archiveRoute, "archive", H.gir, "pa", { reason: "Contract ended" })).status, 403, "archiving is the Super Admin's only");
    const r = await post(archiveRoute, "archive", H.gir, "sa", { reason: "Contract ended" });
    assert.equal(r.status, 200);
    assert.equal(r.data.hotel.status, "archived");
    assert.equal(r.data.hotel.canRestore, true);
    assert.equal(r.data.hotel.restoresTo, "suspended");
    assert.equal(w.cons.data.hotels.get(H.gir)!.restoreUntil!.toISOString(), new Date(clock.getTime() + 90 * 86_400_000).toISOString());
    assert.equal((await post(archiveRoute, "archive", H.gir, "sa", {})).error.message, "This hotel is already archived.");
    assert.equal((await post(archiveRoute, "archive", H.pending, "sa", {})).error.message, "This hotel waits for approval. Approve or reject it first.");
    assert.equal((await post(restoreRoute, "restore", H.gir)).status, 403, "restoring is the Super Admin's only");
    const back = await post(restoreRoute, "restore", H.gir, "sa");
    assert.equal(back.data.hotel.status, "suspended", "a suspended hotel never comes back straight to active");
    assert.equal(back.data.hotel.suspendReason, "Unpaid", "the remembered reason is kept");
    clock = new Date("2027-01-10T10:00:00+05:30");
    const late = await post(restoreRoute, "restore", H.old, "sa");
    assert.equal(late.status, 409, "Old Palace's grace ended on 24 Dec");
    assert.equal(statusOf(H.old), "archived");
  });

  test("archiving the hotel of a group's admin clears the group admin", async () => {
    w.cons.data.groups[0].adminUserId = U.nisha;
    const r = await post(archiveRoute, "archive", H.sunrise, "sa", {});
    assert.equal(r.status, 200);
    assert.equal(w.cons.data.groups[0].adminUserId, null);
    assert.equal(w.cons.data.groupHistory.at(-1)!.event, "admin_cleared");
    assert.equal(auditOf("group_admin_cleared").length, 1);
  });

  test("a failing audit write undoes the whole change", async () => {
    w.cons.data.failAuditWrites = true;
    const r = await post(suspendRoute, "suspend", H.sunrise, "pa", { reason: "x" });
    assert.equal(r.status, 500);
    assert.equal(statusOf(H.sunrise), "active");
    assert.equal(w.cons.data.statusHistory.length, 0);
  });

  test("activity lists the successful actions about a hotel, newest first", async () => {
    await post(suspendRoute, "suspend", H.sunrise, "pa", { reason: "Unpaid" });
    await post(reactivateRoute, "reactivate", H.sunrise);
    const r = await call(activityRoute, "GET", `/api/v1/platform/activity?hotelId=${H.sunrise}`, "pa");
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.items.map((x: { action: string }) => x.action), ["hotel_reactivated", "hotel_suspended"]);
    assert.equal(r.data.items[1].text, "Suspended Hotel Sunrise: Unpaid");
  });
});

describe("hotel admins", () => {
  const adm = (route: Route, action: string, id: string, who = "pa") => call(route, "POST", `/api/v1/platform/hotel-admins/${id}/${action}`, who, { params: { id } });

  test("the list has counts and filters", async () => {
    const r = await call(adminsRoute, "GET", "/api/v1/platform/hotel-admins", "pa");
    assert.equal(r.data.total, 3);
    assert.deepEqual(r.data.counts, { all: 3, active: 2, disabled: 0, locked: 1, pending: 0 });
    const locked = await call(adminsRoute, "GET", "/api/v1/platform/hotel-admins?status=locked", "pa");
    assert.deepEqual(locked.data.items.map((a: { name: string }) => a.name), ["Lara Locked"]);
    const live = await call(adminsRoute, "GET", `/api/v1/platform/hotel-admins?hotelId=${H.gir}`, "pa");
    assert.deepEqual(live.data.items.map((a: { name: string }) => a.name), ["Giri Gir"]);
    const group = await call(adminsRoute, "GET", `/api/v1/platform/hotel-admins?groupId=${G.sunrise}`, "pa");
    assert.equal(group.data.total, 2);
  });

  test("add: the account is made, the temporary password is mailed in the same unit and never returned; the first one is the hotel's SuperAdmin", async () => {
    const r = await call(addAdminRoute, "POST", `/api/v1/platform/hotels/${H.solo}/admins`, "pa", { body: { name: "Meera Shah", username: "Meera.Shah", email: "Meera@Solo.in", mobile: "98240 12399" }, params: { id: H.solo } });
    assert.equal(r.status, 201);
    assert.equal(r.data.admin.username, "meera.shah");
    assert.equal(r.data.admin.mobile, "9824012399");
    assert.equal(r.data.admin.hotelName, "Solo Stay");
    assert.equal(r.data.tempPasswordNote, "Temporary password sent by email (dev log)");
    const mail = w.auth.data().outbox.filter((o) => o.kind === "temp_password");
    assert.equal(mail.length, 1);
    const temp = JSON.parse(mail[0].payload as string).tempPassword as string;
    assert.ok(temp.length >= 8);
    assert.ok(!JSON.stringify(r).includes(temp), "the password is never in the answer");
    const made = w.auth.data().users.find((u) => u.username === "meera.shah")!;
    assert.equal(made.accountRole, "hotel_admin");
    assert.equal(made.status, "invited");
    assert.equal(w.auth.data().roles.find((x) => x.id === made.roleId)?.key, "super_admin");
    assert.equal(auditOf("admin_created").at(-1)!.targetLabel, "Meera Shah");
    const second = await call(addAdminRoute, "POST", `/api/v1/platform/hotels/${H.solo}/admins`, "pa", { body: { name: "Raj Shah", username: "raj.shah", email: "raj@solo.in", mobile: "9824012398" }, params: { id: H.solo } });
    assert.equal(w.auth.data().roles.find((x) => x.id === w.auth.data().users.find((u) => u.username === "raj.shah")!.roleId)?.key, "admin", `second: ${second.status}`);
  });

  test("add: field errors use the contract's words; taken username, e-mail and mobile are field errors; a hotel that is not live is 409", async () => {
    const bad = await call(addAdminRoute, "POST", `/api/v1/platform/hotels/${H.solo}/admins`, "pa", { body: { name: "", username: "A", email: "nope", mobile: "123" }, params: { id: H.solo } });
    assert.equal(bad.status, 422);
    assert.deepEqual(Object.keys(bad.error.details.fields).sort(), ["email", "mobile", "name", "username"]);
    const dup = await call(addAdminRoute, "POST", `/api/v1/platform/hotels/${H.solo}/admins`, "pa", { body: { name: "Dup", username: "NISHA", email: "nisha@demo.hms", mobile: "9824012345" }, params: { id: H.solo } });
    assert.equal(dup.error.details.fields.username, "This username is already in use.");
    assert.equal(dup.error.details.fields.email, "Another account already uses this email.");
    assert.equal(dup.error.details.fields.mobile, "Another account already uses this mobile number.");
    const dead = await call(addAdminRoute, "POST", `/api/v1/platform/hotels/${H.old}/admins`, "pa", { body: { name: "X Y", username: "xyz", email: "x@y.in", mobile: "9824012311" }, params: { id: H.old } });
    assert.equal(dead.status, 409);
    assert.equal(w.auth.data().outbox.length, 0, "nothing was mailed for a refused add");
    const extra = await call(addAdminRoute, "POST", `/api/v1/platform/hotels/${H.solo}/admins`, "pa", { body: { name: "X Y", username: "xyz", email: "x@y.in", mobile: "9824012311", role: "super_admin" }, params: { id: H.solo } });
    assert.equal(extra.status, 422, "unknown keys (a role) are refused");
  });

  test("reset mails a new temporary password and ends the person's sessions; disabled, pending and not-live accounts are refused", async () => {
    const ok = await adm(resetRoute, "reset-password", U.nisha);
    assert.equal(ok.status, 200);
    assert.equal(ok.data.message, "A temporary password was sent to nisha@demo.hms.");
    assert.equal(w.auth.data().outbox.filter((o) => o.kind === "admin_reset").length, 1);
    assert.equal(auditOf("admin_password_reset").length, 1);
    await adm(disableRoute, "disable", U.giri);
    assert.equal((await adm(resetRoute, "reset-password", U.giri)).error.message, "Enable this account first, then reset its password.");
    w.auth.data().users.find((u) => u.id === U.nisha)!.status = "pending_approval";
    assert.equal((await adm(resetRoute, "reset-password", U.nisha)).error.message, "This account waits for its hotel to be approved.");
  });

  test("unlock only a locked account; disable and enable are SETs with the right conflicts; groups' and staff accounts are 404 here", async () => {
    assert.equal((await adm(unlockRoute, "unlock", U.nisha)).error.message, "This account is not locked.");
    const un = await adm(unlockRoute, "unlock", U.lara);
    assert.equal(un.data.status, "active");
    assert.equal(w.auth.data().users.find((u) => u.id === U.lara)!.lockedUntil, null);
    const dis = await adm(disableRoute, "disable", U.nisha);
    assert.equal(dis.data.status, "disabled");
    assert.equal((await adm(disableRoute, "disable", U.nisha)).error.message, "This account is already disabled.");
    assert.equal((await adm(enableRoute, "enable", U.nisha)).data.status, "active");
    assert.equal((await adm(enableRoute, "enable", U.nisha)).error.message, "This account is not disabled.");
    assert.equal((await adm(disableRoute, "disable", U.pa)).status, 404, "a Platform Admin is not managed through hotel admins");
    assert.equal((await adm(disableRoute, "disable", U.groupie)).status, 404);
    assert.equal((await adm(disableRoute, "disable", randomUUID())).status, 404);
    assert.equal(w.auth.data().users.find((u) => u.id === U.pa)!.status, "active");
  });
});

describe("groups", () => {
  const link = (groupId: string, hotelId: string, who = "pa") => call(linkRoute, "POST", `/api/v1/platform/groups/${groupId}/hotels`, who, { body: { hotelId }, params: { id: groupId } });

  test("list and detail", async () => {
    const list = await call(groupsRoute, "GET", "/api/v1/platform/groups", "pa");
    assert.equal(list.data.length, 1);
    assert.equal(list.data[0].hotelCount, 1);
    const d = await call(groupRoute, "GET", `/api/v1/platform/groups/${G.sunrise}`, "pa", { params: { id: G.sunrise } });
    assert.deepEqual(d.data.hotels.map((h: { name: string }) => h.name), ["Hotel Sunrise"]);
    assert.deepEqual(d.data.availableHotels.map((h: { name: string }) => h.name), ["Gir Forest Lodge", "Solo Stay"], "live hotels in no group only");
    assert.deepEqual(d.data.adminChoices.map((a: { name: string }) => a.name), ["Nisha Rao"], "active admins of member hotels only (Lara is locked)");
  });

  test("create with hotels: unique name, a hotel in one group only, only live hotels", async () => {
    const r = await call(createGroupRoute, "POST", "/api/v1/platform/groups", "pa", { body: { name: " Coastal Group ", hotelIds: [H.solo, H.gir] } });
    assert.equal(r.status, 201);
    assert.equal(r.data.name, "Coastal Group");
    assert.equal(r.data.hotelCount, 2);
    assert.equal(w.cons.data.groupHistory.filter((x) => x.event === "hotel_linked").length, 2);
    assert.equal(auditOf("group_hotel_added").length, 2);
    const dupe = await call(createGroupRoute, "POST", "/api/v1/platform/groups", "pa", { body: { name: "coastal group" } });
    assert.equal(dupe.error.details.fields.name, "A group with this name already exists.");
    const taken = await call(createGroupRoute, "POST", "/api/v1/platform/groups", "pa", { body: { name: "Other", hotelIds: [H.sunrise] } });
    assert.equal(taken.error.details.fields.hotelIds, "Hotel Sunrise is already in Sunrise Group.");
    const archived = await call(createGroupRoute, "POST", "/api/v1/platform/groups", "pa", { body: { name: "Third", hotelIds: [H.old] } });
    assert.equal(archived.error.details.fields.hotelIds, "Only an active or suspended hotel can join a group.");
    assert.equal((await call(createGroupRoute, "POST", "/api/v1/platform/groups", "pa", { body: { name: "" } })).error.details.fields.name, "Enter the group name.");
    assert.equal(w.cons.data.groups.length, 2, "a refused create leaves nothing behind");
  });

  test("add and remove a hotel; removing the admin's hotel clears the admin; a hotel never sits in two groups", async () => {
    const add = await link(G.sunrise, H.solo);
    assert.equal(add.status, 200);
    assert.deepEqual(add.data.hotels.map((h: { name: string }) => h.name), ["Hotel Sunrise", "Solo Stay"]);
    const twice = await link(G.sunrise, H.solo);
    assert.equal(twice.status, 422);
    assert.equal(twice.error.details.fields.hotelId, "Solo Stay is already in Sunrise Group.");
    assert.equal((await link(G.sunrise, H.old)).error.details.fields.hotelId, "Only an active or suspended hotel can join a group.");
    assert.equal((await link(G.sunrise, randomUUID())).status, 404);
    await call(groupAdminRoute, "PUT", `/api/v1/platform/groups/${G.sunrise}/admin`, "pa", { body: { adminId: U.nisha }, params: { id: G.sunrise } });
    const del = await call(unlinkRoute, "DELETE", `/api/v1/platform/groups/${G.sunrise}/hotels/${H.sunrise}`, "pa", { params: { id: G.sunrise, hotelId: H.sunrise } });
    assert.equal(del.status, 200);
    assert.deepEqual(del.data.hotels.map((h: { name: string }) => h.name), ["Solo Stay"]);
    assert.equal(w.cons.data.groups[0].adminUserId, null);
    assert.equal(statusOfHotel(H.sunrise), "active", "unlinking deletes nothing");
    const again = await call(unlinkRoute, "DELETE", `/api/v1/platform/groups/${G.sunrise}/hotels/${H.sunrise}`, "pa", { params: { id: G.sunrise, hotelId: H.sunrise } });
    assert.equal(again.error.details.fields.hotelId, "This hotel is not in this group.");
  });

  test("set the group admin: an active Hotel Admin of a member hotel, or null to clear", async () => {
    const set = (adminId: string | null, who = "pa") => call(groupAdminRoute, "PUT", `/api/v1/platform/groups/${G.sunrise}/admin`, who, { body: { adminId }, params: { id: G.sunrise } });
    assert.equal((await set(U.nisha)).data.group.groupAdmin.name, "Nisha Rao");
    assert.equal(w.cons.data.groupHistory.at(-1)!.event, "admin_set");
    for (const bad of [U.lara, U.giri, U.pa, randomUUID()]) {
      const r = await set(bad);
      assert.equal(r.status, 422, bad);
      assert.equal(r.error.details.fields.adminId, "Choose an active Hotel Admin of a hotel in this group.");
    }
    assert.equal((await set(null)).data.group.groupAdmin, null);
    assert.equal(auditOf("group_admin_cleared").length, 1);
    assert.equal((await set(U.nisha, "staff")).status, 403);
  });
});

describe("users (read only)", () => {
  const users = (who: string, query = "") => call(usersRoute, "GET", `/api/v1/platform/users${query}`, who);

  test("a Platform Admin reads everyone below them; Super Admin and Platform Admin accounts are hidden and not counted", async () => {
    const r = await users("pa");
    assert.equal(r.status, 200);
    assert.equal(r.data.total, 5);
    assert.deepEqual(r.data.items.map((u: { username: string }) => u.username), ["groupie", "giri", "lara", "nisha", "staff"], "by level, then hotel, then name");
    assert.deepEqual(r.data.counts.levels, { all: 5, super_admin: 0, platform_admin: 0, group_admin: 1, hotel_admin: 3, hotel_user: 1 });
    assert.deepEqual(r.data.counts.statuses, { all: 5, active: 4, disabled: 0, locked: 1, pending: 0 });
    assert.ok(!JSON.stringify(r.data).includes("Priya Platform") && !JSON.stringify(r.data).includes("Sonal Super"));
    const asked = await users("pa", "?level=super_admin");
    assert.equal(asked.data.total, 0, "asking for a hidden level returns nothing");
  });

  test("the Super Admin sees every level", async () => {
    const r = await users("sa");
    assert.equal(r.data.total, 7);
    assert.deepEqual(r.data.counts.levels, { all: 7, super_admin: 1, platform_admin: 1, group_admin: 1, hotel_admin: 3, hotel_user: 1 });
    assert.equal(r.data.items[0].level, "super_admin");
    assert.equal(r.data.items[0].email, "sa@demo.hms");
    assert.ok(!JSON.stringify(r.data).toLowerCase().includes("password"));
  });

  test("filters: level, status, hotel, group and search; counts follow; hostile input is refused", async () => {
    assert.deepEqual((await users("pa", "?level=hotel_admin&status=locked")).data.items.map((u: { name: string }) => u.name), ["Lara Locked"]);
    assert.deepEqual((await users("pa", `?hotelId=${H.gir}`)).data.items.map((u: { username: string }) => u.username), ["giri"]);
    assert.equal((await users("pa", `?groupId=${G.sunrise}`)).data.total, 2);
    assert.deepEqual((await users("pa", "?search=nis")).data.items.map((u: { username: string }) => u.username), ["nisha"]);
    const byLevel = await users("pa", "?status=locked");
    assert.deepEqual([byLevel.data.counts.levels.all, byLevel.data.counts.levels.hotel_admin, byLevel.data.counts.statuses.all], [1, 1, 5], "level counts follow the status filter, status counts follow the level filter");
    for (const q of ["?pageSize=10000", "?level=bogus", "?status=bogus", "?hotelId=x", "?x=1"]) assert.equal((await users("pa", q)).status, 422, q);
    assert.equal((await users("staff")).status, 403);
    assert.equal((await users("nisha")).status, 403);
  });
});

function statusOfHotel(id: string): string | undefined {
  return w.auth.data().hotels.find((h) => h.id === id)?.status;
}
