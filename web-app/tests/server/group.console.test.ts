// The Group Hotel Admin console server (docs/BACKEND.md 14c; contract ui-shared/dashboards/groupConsole.ts), through the REAL route files on the in-memory
// double: the group is always the signed-in account's own; anything outside it (a hotel of another group, an individual hotel, an invitation or a Hotel Admin of
// another group) is a 404 and changes nothing; every write is audited with the actor's role; a visit into a member hotel is read-only.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeEach, describe, test } from "node:test";
import { POST as accountUnlock } from "../../src/app/api/v1/group/hotel-admins/[id]/unlock/route";
import { POST as accountDisable } from "../../src/app/api/v1/group/hotel-admins/[id]/disable/route";
import { POST as accountEnable } from "../../src/app/api/v1/group/hotel-admins/[id]/enable/route";
import { POST as accountReset } from "../../src/app/api/v1/group/hotel-admins/[id]/reset-password/route";
import { GET as adminsGet } from "../../src/app/api/v1/group/hotel-admins/route";
import { GET as activityGet } from "../../src/app/api/v1/group/activity/route";
import { POST as hotelArchive } from "../../src/app/api/v1/group/hotels/[id]/archive/route";
import { POST as hotelEnter } from "../../src/app/api/v1/group/hotels/[id]/enter/route";
import { POST as hotelExit } from "../../src/app/api/v1/group/hotels/[id]/exit/route";
import { GET as hotelGet } from "../../src/app/api/v1/group/hotels/[id]/route";
import { POST as hotelUnlink } from "../../src/app/api/v1/group/hotels/[id]/unlink/route";
import { GET as hotelsGet } from "../../src/app/api/v1/group/hotels/route";
import { POST as onboardingSubmit } from "../../src/app/api/v1/onboarding/[token]/route";
import { PUT as maxHotelsPut } from "../../src/app/api/v1/platform/groups/[id]/max-hotels/route";
import { POST as platformGroupHotelsPost } from "../../src/app/api/v1/platform/groups/[id]/hotels/route";
import { POST as inviteCancel } from "../../src/app/api/v1/group/invitations/[id]/cancel/route";
import { POST as inviteResend } from "../../src/app/api/v1/group/invitations/[id]/resend/route";
import { GET as invitesGet, POST as invitesPost } from "../../src/app/api/v1/group/invitations/route";
import { GET as overviewGet } from "../../src/app/api/v1/group/overview/route";
import { GET as billsGet } from "../../src/app/api/v1/billing/bills/route";
import { POST as platformInvite } from "../../src/app/api/v1/platform/invitations/route";
import { POST as platformRestore } from "../../src/app/api/v1/platform/hotels/[id]/restore/route";
import { GET as platformOverviewGet } from "../../src/app/api/v1/platform/overview/route";
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
import { catalog } from "./helpers/session";

const ORIGIN = "https://hms.test";
const hasher = createArgon2Hasher({ memoryCost: 1024, timeCost: 1, parallelism: 1 });
let clock = new Date("2026-10-05T10:00:00+05:30");
const now = (): Date => new Date(clock.getTime());
const H = { a1: randomUUID(), a2: randomUUID(), a3: randomUUID(), b1: randomUUID(), solo: randomUUID() };
const G = { one: randomUUID(), two: randomUUID() };
const U: Record<string, string> = {};
const TOKENS: Record<string, string> = {};
let w: World;
type World = ReturnType<typeof build>;

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
  role("super_admin", 4);
  const meta = (slug: string, over: Partial<MemHotelMeta> = {}): MemHotelMeta => ({
    slug, city: "Rajkot", state: "Gujarat", gstin: "24ABCDE1234F1Z5", timeZone: "Asia/Kolkata", createdAt: new Date("2026-06-01T10:00:00+05:30"), provisionedAt: new Date("2026-06-01T10:00:00+05:30"),
    submittedAt: null, approvedAt: null, rejectedAt: null, rejectReason: null, suspendedAt: null, suspendReason: null, archivedAt: null, archiveReason: null, restoreUntil: null,
    statusBeforeArchive: null, lastActivityAt: null, deletedAt: null, ...over,
  });
  const hotel = (id: string, name: string, status: string, slug: string, over: Partial<MemHotelMeta> = {}): void => {
    data.hotels.push({ id, name, status } as never);
    cons.data.hotels.set(id, meta(slug, over));
  };
  hotel(H.a1, "LT-Sunrise Rajkot", "active", "lt-sunrise-rajkot", { createdAt: new Date("2026-07-01T10:00:00+05:30") });
  hotel(H.a2, "LT-Sunrise Surat", "suspended", "lt-sunrise-surat", { suspendedAt: new Date("2026-09-20T10:00:00+05:30"), suspendReason: "Unpaid", createdAt: new Date("2026-08-01T10:00:00+05:30") });
  hotel(H.a3, "LT-Sunrise Waiting", "pending_approval", "lt-sunrise-waiting", { provisionedAt: null });
  hotel(H.b1, "LT-Other Group Hotel", "active", "lt-other-group-hotel");
  hotel(H.solo, "LT-Solo Hotel", "active", "lt-solo-hotel");
  const group = (id: string, name: string, slug: string, adminKey: string): void => {
    cons.data.groups.push({
      id, name, slug, status: "active", adminUserId: null, createdAt: new Date("2026-05-01T10:00:00+05:30"), deletedAt: null, legalName: `${name} Pvt Ltd`, gstin: "24ABCDE1234F1Z5", address: "1 Ring Road",
      city: "Rajkot", state: "Gujarat", pin: "360001", phone: "0281 2456789", email: `${slug}@demo.hms`, submittedAt: null, approvedAt: null, rejectedAt: null, rejectReason: null,
    });
    void adminKey;
  };
  group(G.one, "LT-Sunrise Group", "lt-sunrise-group", "gadm");
  group(G.two, "LT-Other Group", "lt-other-group", "gadm2");
  for (const [g, h] of [[G.one, H.a1], [G.one, H.a2], [G.one, H.a3], [G.two, H.b1]] as const) cons.data.members.push({ groupId: g, hotelId: h, linkedBy: null, createdAt: new Date("2026-07-02T10:00:00+05:30") });
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
  person("gadm", { accountRole: "group_hotel_admin", displayName: "Gita GroupAdmin", codeRequired: true });
  person("gadm2", { accountRole: "group_hotel_admin", displayName: "Gopal OtherGroup", codeRequired: true });
  person("pa", { accountRole: "platform_admin", displayName: "Priya Platform", codeRequired: true });
  person("ha1", { accountRole: "hotel_admin", displayName: "Hari Rajkot", codeRequired: true }, H.a1, admin);
  person("ha2", { accountRole: "hotel_admin", displayName: "Hema Surat", codeRequired: true, lockedUntil: new Date("2026-10-05T12:00:00+05:30"), failedAttempts: 5, lockLevel: 1 }, H.a2, admin);
  person("hu1", { accountRole: "hotel_user", displayName: "Hugo User" }, H.a1);
  person("wait", { accountRole: "hotel_admin", displayName: "Wilma Waiting", status: "pending_approval" }, H.a3, admin);
  person("hb", { accountRole: "hotel_admin", displayName: "Bhavna Other", codeRequired: true }, H.b1, admin);
  person("hs", { accountRole: "hotel_admin", displayName: "Sanjay Solo", codeRequired: true }, H.solo, admin);
  person("guest", { accountRole: "guest_user", displayName: "Gus Guest" });
  person("sa", { accountRole: "super_admin", displayName: "Sunil Super", codeRequired: true });
  // a Group Hotel Admin account that is NOT the primary admin of any group
  person("gstaff", { accountRole: "group_hotel_admin", displayName: "Gauri Staff", codeRequired: true });
  cons.data.groups.find((g) => g.id === G.one)!.adminUserId = U.gadm;
  cons.data.groups.find((g) => g.id === G.two)!.adminUserId = U.gadm2;
  const provisioner = createMemoryProvisioner({ auth: () => auth.data(), console: () => cons.data, now });
  violations.length = 0;
  const services = buildPlatformServices({
    onTenantViolation: (v) => void violations.push(v),
    unit: cons.unit, credentials: (repos) => createCredentialService({ unit: { run: (work) => work(repos.auth) }, hasher, now }), now, hasher, publicUrl: ORIGIN,
    newToken: () => randomBytes(8).toString("hex"), hashKey: randomBytes(32), provisioner,
  });
  configurePlatform(services);
  const resolver = createSessionResolver({ unit: auth.unit, catalog, now });
  configureRoutes({
    resolveSession: resolver.resolveSession,
    onVisitWriteRefused: (session, request, traceId) => services.visits.recordRefusedWrite(session, request, traceId),
    catalog,
    idempotency: createMemoryIdempotencyStore(),
    logger: createLogger({ level: "silent", write: () => undefined }),
  });
  return { auth, cons, services, provisioner };
}

const violations: { userId: string; groupId: string; what: string }[] = [];
beforeEach(() => {
  clock = new Date("2026-10-05T10:00:00+05:30");
  w = build();
});

type Route = (r: Request, c: { params: Promise<Record<string, string>> }) => Promise<Response>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: bodies are asserted field by field
async function call(route: Route, method: string, urlPath: string, who: string | null, opts: { body?: unknown; params?: Record<string, string> } = {}): Promise<{ status: number; data: any; error: any }> {
  const h: Record<string, string> = { host: "hms.test", origin: ORIGIN, "user-agent": "node-test/1.0" };
  if (who) h.cookie = `${SESSION_COOKIE}=${TOKENS[who]}`;
  if (opts.body !== undefined) h["content-type"] = "application/json";
  const res = await route(new Request(`${ORIGIN}${urlPath}`, { method, headers: h, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), { params: Promise.resolve(opts.params ?? {}) });
  const j = await res.json();
  return { status: res.status, data: j.data, error: j.error };
}
const get = (route: Route, p: string, who = "gadm", params: Record<string, string> = {}) => call(route, "GET", `/api/v1/group/${p}`, who, { params });
const post = (route: Route, p: string, who = "gadm", id?: string, body?: unknown) => call(route, "POST", `/api/v1/group/${p}`, who, { params: id ? { id } : {}, body });
const auditOf = (action: string) => w.cons.data.audit.filter((a) => a.action === action);
const status = (id: string) => w.auth.data().hotels.find((h) => h.id === id)!.status;
const invite = (over: Record<string, unknown> = {}, who = "gadm") => post(invitesPost, "invitations", who, undefined, { hotelName: "LT-Sunrise Jaipur", contactName: "Jaya Rao", email: "jaya@lt-jaipur.example", ...over });

describe("overview, lists and details: only my group", () => {
  test("the overview counts my live hotels, open invitations, hotel admins (waiting ones left out) and locked accounts", async () => {
    await invite();
    const r = await get(overviewGet, "overview");
    assert.equal(r.status, 200, JSON.stringify(r.error));
    assert.deepEqual(r.data.tiles, { hotels: 2, hotelsActive: 1, hotelsSuspended: 1, invitationsOpen: 1, hotelAdmins: 2, lockedAccounts: 1, hotelsCounted: 4 });
    assert.equal(r.data.group.name, "LT-Sunrise Group");
    assert.equal(r.data.group.isPrimaryAdmin, true, "the group console admits the primary admin only; a Group Hotel Admin who is not (gstaff) is 403 on the overview too");
    assert.equal((await get(overviewGet, "overview", "gstaff")).status, 403);
    assert.deepEqual(r.data.recentHotels.map((h: { name: string }) => h.name), ["LT-Sunrise Surat", "LT-Sunrise Rajkot"]);
    assert.ok(r.data.recentActivity.length >= 1);
    const other = await get(overviewGet, "overview", "gadm2");
    assert.deepEqual([other.data.group.name, other.data.tiles.hotels, other.data.tiles.invitationsOpen], ["LT-Other Group", 1, 0], "another group admin sees only their own group");
  });

  test("the hotel list holds my member hotels only (counts too); search and status filter; another group's and individual hotels never appear", async () => {
    const r = await get(hotelsGet, "hotels");
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.items.map((h: { name: string }) => h.name), ["LT-Sunrise Rajkot", "LT-Sunrise Surat", "LT-Sunrise Waiting"]);
    assert.deepEqual([r.data.counts.all, r.data.counts.active, r.data.counts.suspended, r.data.counts.pending_approval], [3, 1, 1, 1]);
    assert.deepEqual((await call(hotelsGet, "GET", "/api/v1/group/hotels?status=suspended", "gadm")).data.items.map((h: { name: string }) => h.name), ["LT-Sunrise Surat"]);
    assert.equal((await call(hotelsGet, "GET", "/api/v1/group/hotels?search=other", "gadm")).data.total, 0);
    assert.equal((await call(hotelsGet, "GET", "/api/v1/group/hotels?groupId=" + G.two, "gadm")).status, 422, "the group cannot be named");
  });

  test("a member hotel opens with its admins and activity; a hotel of another group, an individual hotel and an unknown id are all 404", async () => {
    const ok = await get(hotelGet, `hotels/${H.a1}`, "gadm", { id: H.a1 });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.data.admins.map((a: { name: string }) => a.name), ["HA1"].map((n) => n === "HA1" ? "Hari Rajkot" : n));
    for (const id of [H.b1, H.solo, randomUUID()]) assert.equal((await get(hotelGet, `hotels/${id}`, "gadm", { id })).status, 404, id);
  });

  test("the activity holds my group's entries only", async () => {
    await invite();
    await post(hotelUnlink, `hotels/${H.a2}/unlink`, "gadm", H.a2);
    const mine = await get(activityGet, "activity");
    assert.equal(mine.status, 200);
    assert.ok(mine.data.total >= 2 && mine.data.items.every((x: { hotelId?: string | null }) => x.hotelId === undefined || x.hotelId === null || ([H.a1, H.a2, H.a3] as string[]).includes(x.hotelId)));
    assert.equal((await get(activityGet, "activity", "gadm2")).data.total, 0, "another group sees none of it");
  });
});

describe("invitations: a member_hotel of my group, nothing else", () => {
  test("a new invitation goes into MY group as type member_hotel, is mailed, audited with the actor's role, and is listed", async () => {
    const r = await invite();
    assert.equal(r.status, 201, JSON.stringify(r.error));
    assert.deepEqual([r.data.invitation.type, r.data.invitation.groupId, r.data.invitation.invitedByRole, r.data.invitation.status], ["member_hotel", G.one, "group_admin", "sent"]);
    assert.equal(w.auth.data().outbox.filter((o) => o.kind === "invitation" && o.toEmail === "jaya@lt-jaipur.example").length, 1);
    const a = auditOf("invitation_sent").at(-1)!;
    assert.deepEqual([a.actorRole, a.actorName, a.groupId, a.result], ["group_hotel_admin", "GITA GROUPADMIN".replace("GITA GROUPADMIN", "Gita GroupAdmin"), G.one, "success"]);
    const list = await call(invitesGet, "GET", "/api/v1/group/invitations", "gadm");
    assert.deepEqual(list.data.items.map((i: { hotelName: string }) => i.hotelName), ["LT-Sunrise Jaipur"]);
    assert.equal((await call(invitesGet, "GET", "/api/v1/group/invitations", "gadm2")).data.total, 0, "another group does not see it");
  });

  test("field errors name hotelName, contactName, email; a duplicate e-mail is refused; type and group cannot be sent", async () => {
    const bad = await invite({ hotelName: " ", contactName: "", email: "nope" });
    assert.equal(bad.status, 422);
    assert.deepEqual(Object.keys(bad.error.details.fields).sort(), ["contactName", "email", "hotelName"]);
    assert.equal((await invite()).status, 201);
    assert.equal((await invite({ hotelName: "LT-Another" })).status, 422, "the same e-mail twice");
    assert.equal((await invite({ type: "individual" })).status, 422);
    assert.equal((await invite({ groupId: G.two })).status, 422);
    assert.equal(w.cons.data.invites.length, 1, "only the first one was stored");
  });

  test("resend and cancel work on my group's invitations; another group's is 404 and untouched; a cancelled one cannot be resent (409)", async () => {
    const mine = (await invite()).data.invitation.id as string;
    const theirs = (await invite({ hotelName: "LT-Their Hotel", email: "their@lt.example" }, "gadm2")).data.invitation.id as string;
    assert.equal((await post(inviteResend, `invitations/${mine}/resend`, "gadm", mine)).status, 200);
    assert.equal((await post(inviteResend, `invitations/${theirs}/resend`, "gadm", theirs)).status, 404);
    assert.equal((await post(inviteCancel, `invitations/${theirs}/cancel`, "gadm", theirs)).status, 404);
    const cancelled = await post(inviteCancel, `invitations/${mine}/cancel`, "gadm", mine);
    assert.deepEqual([cancelled.status, cancelled.data.status], [200, "cancelled"]);
    assert.equal((await post(inviteResend, `invitations/${mine}/resend`, "gadm", mine)).status, 409);
    const other = (await call(invitesGet, "GET", "/api/v1/group/invitations", "gadm2")).data.items[0];
    assert.equal(other.status, "sent", "the other group's invitation is untouched");
  });
});

describe("unlink and archive", () => {
  test("unlink: the hotel keeps its data, becomes an individual hotel, history and audit rows are written; nothing is deleted", async () => {
    const r = await post(hotelUnlink, `hotels/${H.a2}/unlink`, "gadm", H.a2);
    assert.equal(r.status, 200, JSON.stringify(r.error));
    assert.deepEqual([r.data.hotel.groupId, r.data.hotel.kind, r.data.message], [null, "individual", "LT-Sunrise Surat is no longer in the group. It keeps all its data."]);
    assert.equal(w.cons.data.members.some((m) => m.hotelId === H.a2), false);
    assert.equal(status(H.a2), "suspended", "its status is unchanged");
    assert.ok(w.cons.data.groupHistory.some((x) => x.groupId === G.one && x.event === "hotel_unlinked" && x.hotelId === H.a2));
    const a = auditOf("group_hotel_removed").at(-1)!;
    assert.deepEqual([a.actorRole, a.result, a.hotelId], ["group_hotel_admin", "success", H.a2]);
    assert.equal((await get(hotelGet, `hotels/${H.a2}`, "gadm", { id: H.a2 })).status, 404, "it is no longer mine");
    assert.equal((await post(hotelUnlink, `hotels/${H.a2}/unlink`, "gadm", H.a2)).status, 404, "a second unlink is 404");
  });

  test("unlink is refused for a hotel of another group or an individual hotel (404, nothing changes); and 409 when my own account belongs to the hotel", async () => {
    for (const id of [H.b1, H.solo, randomUUID()]) assert.equal((await post(hotelUnlink, `hotels/${id}/unlink`, "gadm", id)).status, 404, id);
    assert.ok(w.cons.data.members.some((m) => m.hotelId === H.b1 && m.groupId === G.two), "the other group still has its hotel");
    w.auth.data().memberships.push({ userId: U.gadm, hotelId: H.a1, roleId: null, status: "active", isDefault: true, subject: null });
    const own = await post(hotelUnlink, `hotels/${H.a1}/unlink`, "gadm", H.a1);
    assert.deepEqual([own.status, own.error.message], [409, "Your own account belongs to this hotel, so it cannot be unlinked from your group."]);
    assert.ok(w.cons.data.members.some((m) => m.hotelId === H.a1));
  });

  test("archive is the Super Admin's only (MJ, 5 Nov 2026): the group's route answers 403 with a plain sentence, nothing changes, the attempt is a failed audit row; a Platform Admin cannot restore either", async () => {
    const r = await post(hotelArchive, `hotels/${H.a1}/archive`, "gadm", H.a1, { reason: "Closing for the season" });
    assert.deepEqual([r.status, r.error.message], [403, "Archiving a hotel is done by the platform team. Use Remove from group to take it out of your group."]);
    assert.equal(status(H.a1), "active");
    assert.ok(auditOf("hotel_archived").some((a) => a.result === "failed" && a.actorRole === "group_hotel_admin"));
    assert.equal((await call(platformRestore, "POST", `/api/v1/platform/hotels/${H.a1}/restore`, "gadm", { params: { id: H.a1 } })).status, 403, "a group admin cannot restore");
    assert.equal((await call(platformRestore, "POST", `/api/v1/platform/hotels/${H.a1}/restore`, "pa", { params: { id: H.a1 } })).status, 403, "nor a Platform Admin");
  });

  test("archive on another group's or an individual hotel is 404, nothing changes, and the attempt is kept as a failed audit row", async () => {
    for (const id of [H.b1, H.solo]) {
      assert.equal((await post(hotelArchive, `hotels/${id}/archive`, "gadm", id, {})).status, 404);
      assert.equal(status(id), "active");
    }
    assert.ok(auditOf("hotel_archived").some((a) => a.result === "failed" && a.actorRole === "group_hotel_admin"));
    assert.equal(auditOf("hotel_archived").filter((a) => a.result === "success").length, 0);
  });
});

describe("the Hotel Admins of my hotels", () => {
  test("the list holds the admins of my live member hotels, with counts; nobody else", async () => {
    const r = await get(adminsGet, "hotel-admins");
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.items.map((a: { name: string }) => a.name).sort(), ["Hari Rajkot", "Hema Surat"]);
    assert.equal(r.data.counts.locked, 1);
    assert.equal((await get(adminsGet, "hotel-admins", "gadm2")).data.items.map((a: { name: string }) => a.name).join(), "Bhavna Other");
    assert.equal((await call(adminsGet, "GET", `/api/v1/group/hotel-admins?hotelId=${H.b1}`, "gadm")).status, 404, "a hotel of another group cannot be asked for");
  });

  test("unlock, disable, enable and reset work on my admins and are audited; the account of another group, an individual hotel, a plain user and a platform person are all 404", async () => {
    assert.equal((await post(accountUnlock, `hotel-admins/${U.ha2}/unlock`, "gadm", U.ha2)).status, 200);
    assert.equal(w.auth.data().users.find((u) => u.id === U.ha2)!.lockedUntil, null);
    const off = await post(accountDisable, `hotel-admins/${U.ha1}/disable`, "gadm", U.ha1);
    assert.deepEqual([off.status, off.data.status], [200, "disabled"]);
    assert.equal((await post(accountEnable, `hotel-admins/${U.ha1}/enable`, "gadm", U.ha1)).data.status, "active");
    const reset = await post(accountReset, `hotel-admins/${U.ha1}/reset-password`, "gadm", U.ha1);
    assert.equal(reset.status, 200, JSON.stringify(reset.error));
    assert.ok(!JSON.stringify(reset).includes("passwordHash"));
    assert.deepEqual(auditOf("admin_unlocked").map((a) => a.actorRole), ["group_hotel_admin"]);
    const writes = w.cons.data.audit.length;
    for (const id of [U.hb, U.hs, U.hu1, U.pa, U.gadm, U.gadm2, U.guest, randomUUID()]) {
      for (const [route, verb] of [[accountUnlock, "unlock"], [accountDisable, "disable"], [accountEnable, "enable"], [accountReset, "reset-password"]] as const) {
        assert.equal((await post(route, `hotel-admins/${id}/${verb}`, "gadm", id)).status, 404, `${verb} ${id}`);
      }
    }
    assert.equal(w.cons.data.audit.length, writes, "no refusal wrote an audit row or a change");
    assert.equal(w.auth.data().users.find((u) => u.id === U.hb)!.status, "active");
  });
});

describe("enter a member hotel: read only", () => {
  test("enter needs a reason of 5 to 500 characters; the visit is audited; inside it every hotel write is refused; exit ends it", async () => {
    assert.equal((await post(hotelEnter, `hotels/${H.a1}/enter`, "gadm", H.a1, { reason: "no" })).status, 422);
    const r = await post(hotelEnter, `hotels/${H.a1}/enter`, "gadm", H.a1, { reason: "Checking this month's bills" });
    assert.equal(r.status, 200, JSON.stringify(r.error));
    assert.deepEqual([r.data.ok, r.data.readOnly, r.data.hotel.id], [true, true, H.a1]);
    assert.equal(auditOf("hotel_entered").at(-1)!.actorRole, "group_hotel_admin");
    const inside = await call(billsGet, "GET", "/api/v1/billing/bills", "gadm");
    assert.notEqual(inside.status, 401, "the visit gives the session the hotel");
    const write = await call(billsGet as Route, "POST", "/api/v1/billing/bills", "gadm", { body: {} });
    assert.equal(write.status, 403, "a write to a hotel route is refused read-only");
    assert.ok(auditOf("hotel_write_refused").length >= 1);
    const out = await post(hotelExit, `hotels/${H.a1}/exit`, "gadm", H.a1);
    assert.equal(out.status, 200);
    assert.equal(auditOf("hotel_exited").length, 1);
  });

  test("a hotel of another group or an individual hotel cannot be entered (404, no visit, a failed audit row); unlinking a hotel ends my visit into it", async () => {
    for (const id of [H.b1, H.solo]) assert.equal((await post(hotelEnter, `hotels/${id}/enter`, "gadm", id, { reason: "Looking around" })).status, 404, id);
    assert.equal(w.auth.data().visits.length, 0);
    assert.ok(auditOf("hotel_entered").every((a) => a.result === "failed"));
    assert.equal((await post(hotelEnter, `hotels/${H.a1}/enter`, "gadm", H.a1, { reason: "Looking around" })).status, 200);
    assert.equal(w.auth.data().visits.filter((v) => v.endedAt === null).length, 1);
    assert.equal((await post(hotelUnlink, `hotels/${H.a1}/unlink`, "gadm", H.a1)).status, 200);
    assert.equal(w.auth.data().visits.filter((v) => v.endedAt === null).length, 0, "the visit ended with the unlink");
    assert.equal((await post(hotelExit, `hotels/${H.b1}/exit`, "gadm", H.b1)).status, 404);
  });
});

describe("every group route: who may call it (security inventory)", () => {
  const root = path.join(process.cwd(), "src", "app", "api", "v1", "group");
  const files: string[] = [];
  // the group's own inbox (platform 0166) has its own routes under conversations/: they are checked below, not as console routes
  const inbox: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
      else if (e.name === "route.ts") {
        const rel = path.relative(root, path.join(dir, e.name)).replace(/\\/g, "/");
        (rel.startsWith("conversations/") ? inbox : files).push(rel);
      }
    }
  };
  walk(root);

  test("the inventory is complete: all eighteen routes of the contract (with Extend 60 minutes and the payments page)", () => {
    assert.equal(files.length, 18, files.join(", "));
  });

  test("anonymous 401; a Platform Admin, a hotel's admin, a hotel user and a guest never get in (403); a group admin of a group with no active admin link gets 403", async () => {
    for (const rel of files) {
      const mod = (await import(pathToFileURL(path.join(root, rel)).href)) as Record<string, Route | undefined>;
      for (const method of ["GET", "POST"]) {
        const handler = mod[method];
        if (!handler) continue;
        const params: Record<string, string> = {};
        for (const m of rel.matchAll(/\[(\w+)\]/g)) params[m[1]] = randomUUID();
        const urlPath = `/api/v1/group/${rel.replace(/\/?route\.ts$/, "").replace(/\[(\w+)\]/g, (_s, k: string) => params[k])}`;
        const body = method === "GET" ? undefined : rel.startsWith("invitations/route") ? { hotelName: "X", contactName: "Y", email: "x@y.example" } : rel.endsWith("enter/route.ts") ? { reason: "Looking around" } : rel === "hotels/route.ts" ? { hotel: { name: "X", address: "A", city: "C", state: "Gujarat", pin: "360001", gstin: "24ABCDE1234F1Z5", phone: "0281 2456789", email: "x@y.example" }, admin: { name: "N", username: "nnn", email: "n@y.example", mobile: "9876543210" } } : {};
        for (const who of [null, "pa", "ha1", "hu1", "guest"]) {
          const r = await call(handler, method, urlPath, who, { params, ...(body !== undefined ? { body } : {}) });
          assert.equal(r.status, who === null ? 401 : 403, `${method} ${rel} as ${who}`);
        }
      }
    }
    assert.equal(w.cons.data.invites.length, 0, "no refusal created anything");
  });

  test("the group inbox: anonymous 401, and a Platform Admin, a hotel's admin, a hotel user and a guest never get a 2xx answer on any of its routes", async () => {
    assert.ok(inbox.length >= 20, `the group inbox routes: ${inbox.length}`);
    for (const rel of inbox) {
      const mod = (await import(pathToFileURL(path.join(root, rel)).href)) as Record<string, Route | undefined>;
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        const handler = mod[method];
        if (!handler) continue;
        const params: Record<string, string> = {};
        for (const m of rel.matchAll(/\[(\w+)\]/g)) params[m[1]] = randomUUID();
        const urlPath = `/api/v1/group/${rel.replace(/\/?route\.ts$/, "").replace(/\[(\w+)\]/g, (_s, k: string) => params[k])}`;
        const body = method === "GET" || method === "DELETE" ? undefined : {};
        const anon = await call(handler, method, urlPath, null, { params, ...(body !== undefined ? { body } : {}) });
        assert.equal(anon.status, 401, `${method} ${rel} anonymous`);
        for (const who of ["pa", "ha1", "hu1", "guest"]) {
          const r = await call(handler, method, urlPath, who, { params, ...(body !== undefined ? { body } : {}) });
          assert.ok(r.status >= 400, `${method} ${rel} as ${who} answered ${r.status}`);
        }
      }
    }
  });
  test("a platform route does not open for a group admin (the other way round too): invitations of any type are the platform's", async () => {
    assert.equal((await call(platformInvite, "POST", "/api/v1/platform/invitations", "gadm", { body: { type: "member_hotel", hotelName: "X", contactName: "Y", email: "x@y.example" } })).status, 403);
    assert.equal((await post(invitesPost, "invitations", "pa", undefined, { hotelName: "X", contactName: "Y", email: "x@y.example" })).status, 403);
  });
});

describe("a hotel invited by its group: the same invitation and form, approved at once, within the group's limit", () => {
  const PASSWORD = "Moonlight#2026x";
  const tokenOf = (): string => new URL(JSON.parse(w.auth.data().outbox.filter((o) => o.kind === "invitation").at(-1)!.payload as string).link).searchParams.get("invite") as string;
  const form = (name: string, user: string) => ({
    kind: "hotel" as const,
    hotel: { name, address: "5 MI Road", city: "Jaipur", state: "Rajasthan", pin: "302001", gstin: "08ABCDE1234F1Z9", phone: "0141 2345678", email: `desk@${user}.example`, logoName: "" },
    admin: { name: "Jaya Rao", username: user, email: `${user}@hotel.example`, mobile: `98765${String(Math.floor(Math.random() * 1e5)).padStart(5, "0")}`, password: PASSWORD, passwordConfirm: PASSWORD },
  });
  const submit = (token: string, body: object) => call(onboardingSubmit, "POST", `/api/v1/onboarding/${token}`, null, { body, params: { token } });
  const setMax = (who: string, max: number | null, groupId = G.one) => call(maxHotelsPut, "PUT", `/api/v1/platform/groups/${groupId}/max-hotels`, who, { params: { id: groupId }, body: { maxHotels: max } });

  test("the group's primary admin invites; the hotel fills the public form; it is LIVE at once in the group, its admin active, the Super Admin sees who created it, and the group admin can visit", async () => {
    assert.equal((await invite()).status, 201);
    const r = await submit(tokenOf(), form("LT-Sunrise Jaipur", "jaya.rao"));
    assert.equal(r.status, 201, JSON.stringify(r.error));
    assert.equal(r.data.hotel.status, "active");
    assert.match(r.data.message, /ready/);
    const id = r.data.hotel.id as string;
    assert.equal(status(id), "active");
    assert.ok(w.cons.data.members.some((m) => m.groupId === G.one && m.hotelId === id));
    assert.equal(w.auth.data().users.find((u) => u.username === "jaya.rao")?.status, "active");
    const created = auditOf("hotel_created").find((a) => a.hotelId === id);
    assert.deepEqual([created?.reason, created?.actorRole, created?.actorUserId], ["Created by group LT-Sunrise Group (group admin Gita GroupAdmin)", "group_hotel_admin", U.gadm]);
    assert.ok(w.auth.data().outbox.some((o) => o.kind === "onboarding_approved"), "the approval mail");
    assert.ok(!w.auth.data().outbox.some((o) => o.kind === "onboarding_waiting" && o.toEmail === "jaya.rao@hotel.example"), "no 'waiting' mail");
    const overview = await call(platformOverviewGet, "GET", "/api/v1/platform/overview", "sa");
    assert.match(overview.data.groupCreatedHotels[0].text, /Created hotel LT-Sunrise Jaipur\. Created by group LT-Sunrise Group \(group admin Gita GroupAdmin\)\./);
    const enter = await post(hotelEnter, `hotels/${id}/enter`, "gadm", id, { reason: "Checking the new hotel" });
    assert.equal(enter.status, 200, JSON.stringify(enter.error));
  });

  test("only the group's primary admin may invite for the group: a Group Hotel Admin who is not a primary admin is refused (403)", async () => {
    assert.equal((await invite({}, "gstaff")).status, 403);
  });

  test("when the build fails the hotel waits for the Super Admin's Approve (nothing lost)", async () => {
    await invite();
    w.provisioner.failNext = true;
    const r = await submit(tokenOf(), form("LT-Will Fail", "will.fail"));
    assert.equal(r.status, 201, JSON.stringify(r.error));
    assert.deepEqual([r.data.hotel.status, status(r.data.hotel.id)], ["pending_approval", "pending_approval"]);
  });

  test("the limit: only Super / Platform Admin set it, never below the count; invitations count; at the limit a new invitation and a late form are refused; no limit again", async () => {
    assert.equal((await setMax("gadm", 10)).status, 403, "a group admin cannot change its own limit");
    assert.equal((await setMax("ha1", 10)).status, 403);
    assert.equal((await setMax("sa", 2)).status, 422, "3 hotels already count (active, suspended, waiting)");
    const ok = await setMax("pa", 4);
    assert.equal(ok.status, 200, JSON.stringify(ok.error));
    assert.equal(ok.data.group.maxHotels, 4);
    assert.ok(w.cons.data.groupHistory.some((h) => h.groupId === G.one && h.event === "max_hotels_set" && h.reason === "from no limit to 4"));
    assert.equal((await invite()).status, 201, "the fourth place");
    const full = await invite({ hotelName: "LT-Fifth", email: "fifth@lt.example" });
    assert.equal(full.status, 422);
    assert.equal(full.error.details.fields.limit, "Your group can have at most 4 hotels. Ask the platform to raise the limit.");
    const ov = await get(overviewGet, "overview");
    assert.deepEqual([ov.data.group.maxHotels, ov.data.tiles.hotelsCounted], [4, 4]);
    // the open invitation holds its place: its form still goes through
    const token = tokenOf();
    assert.equal((await submit(token, form("LT-Fourth", "fourth.one"))).data.hotel.status, "active");
    assert.equal((await setMax("sa", null)).status, 200);
    assert.equal((await invite({ hotelName: "LT-Fifth", email: "fifth@lt.example" })).status, 201, "no limit again");
  });

  test("the limit lowered after an invitation was sent: its form is refused (422 limit) and no hotel is made", async () => {
    await invite();
    const token = tokenOf();
    // three hotels count plus this invitation; the Super Admin sets 4, then the group fills its last place another way: an extra waiting hotel
    await setMax("sa", 4);
    w.auth.data().hotels.push({ id: randomUUID(), name: "LT-Extra", status: "pending_approval" } as never);
    const extra = w.auth.data().hotels.at(-1)!.id;
    w.cons.data.hotels.set(extra, { ...w.cons.data.hotels.get(H.a3)!, slug: "lt-extra" });
    w.cons.data.members.push({ groupId: G.one, hotelId: extra, linkedBy: null, createdAt: now() });
    const r = await submit(token, form("LT-Too Many", "too.many"));
    assert.equal(r.status, 422);
    assert.ok(r.error.details.fields.limit);
    assert.equal(w.auth.data().hotels.some((h) => h.name === "LT-Too Many"), false);
  });

  test("two quick invitations at the last free place: only one passes", async () => {
    await setMax("sa", 4);
    const [a, b] = await Promise.all([invite({ hotelName: "LT-Race One", email: "r1@race.example" }), invite({ hotelName: "LT-Race Two", email: "r2@race.example" })]);
    assert.deepEqual([a.status, b.status].sort(), [201, 422]);
  });

  test("a resend cannot bring an EXPIRED invitation back past the limit (security review L4): it is counted again with the group locked", async () => {
    await setMax("sa", 4);
    const first = await invite();
    assert.equal(first.status, 201, "the fourth place");
    const id = first.data.invitation.id as string;
    // its link ran out: an expired invitation holds no place
    for (const l of w.cons.data.links.filter((x) => x.invitationId === id)) Object.assign(l, { issuedAt: new Date(clock.getTime() - 2 * 3_600_000), expiresAt: new Date(clock.getTime() - 3_600_000) });
    assert.equal((await invite({ hotelName: "LT-Second", email: "second@lt.example" })).status, 201, "its place was free again");
    const again = await post(inviteResend, `invitations/${id}/resend`, "gadm", id);
    assert.equal(again.status, 422, JSON.stringify(again.error));
    assert.ok(again.error.details.fields.limit);
    // a resend of an OPEN invitation at the limit still works (it keeps its own place)
    const second = w.cons.data.invites.find((i) => i.hotelName === "LT-Second")!;
    assert.equal((await post(inviteResend, `invitations/${second.id}/resend`, "gadm", second.id)).status, 200);
  });

  test("the platform's Add hotel counts open invitations too (security review L5)", async () => {
    await setMax("sa", 4);
    assert.equal((await invite()).status, 201, "3 hotels + 1 open invitation = 4");
    const r = await call(platformGroupHotelsPost, "POST", `/api/v1/platform/groups/${G.one}/hotels`, "sa", { params: { id: G.one }, body: { hotelId: H.solo } });
    assert.equal(r.status, 422, JSON.stringify(r.error));
    assert.equal(w.cons.data.members.some((m) => m.hotelId === H.solo), false);
  });

  test("an admin removed between the console's check and the send cannot still send (security review L6): checked again under the group lock", async () => {
    const unit = w.cons.unit as { run: (work: never) => Promise<unknown> };
    const run = unit.run;
    let calls = 0;
    // the first unit of the request is the console's own "is this the group's admin" check; right after it the Super Admin removes the admin
    unit.run = (async (work: never) => {
      const out = await run(work);
      if (++calls === 1) w.cons.data.groups.find((g) => g.id === G.one)!.adminUserId = null;
      return out;
    }) as typeof unit.run;
    try {
      const r = await invite();
      assert.equal(r.status, 403, JSON.stringify(r.error));
    } finally {
      unit.run = run;
    }
    assert.equal(w.cons.data.invites.length, 0, "nothing was sent");
  });
});

describe("cross-group attempts reach the security layer", () => {
  const kinds = () => violations.map((v) => v.what);

  test("my own records and an id that does not exist raise nothing", async () => {
    assert.equal((await get(hotelGet, `hotels/${H.a1}`, "gadm", { id: H.a1 })).status, 200);
    const unknown = randomUUID();
    assert.equal((await get(hotelGet, `hotels/${unknown}`, "gadm", { id: unknown })).status, 404);
    assert.equal((await post(hotelUnlink, `hotels/${unknown}/unlink`, "gadm", unknown)).status, 404);
    assert.equal((await post(accountUnlock, `hotel-admins/${U.ha2}/unlock`, "gadm", U.ha2)).status, 200);
    assert.deepEqual(violations, []);
  });

  test("another group's hotel, unlink, invitation and Hotel Admin, and an individual hotel, are each reported once, with the same 404 as an unknown id and ids only", async () => {
    assert.equal((await post(hotelEnter, `hotels/${H.b1}/enter`, "gadm", H.b1, { reason: "checking something" })).status, 404);
    assert.equal((await post(hotelUnlink, `hotels/${H.b1}/unlink`, "gadm", H.b1)).status, 404);
    assert.equal((await post(hotelUnlink, `hotels/${H.solo}/unlink`, "gadm", H.solo)).status, 404);
    const theirs = (await post(invitesPost, "invitations", "gadm2", undefined, { hotelName: "LT-Their Hotel", contactName: "Their Contact", email: "their@lt.example" })).data.invitation.id as string;
    assert.equal((await post(inviteCancel, `invitations/${theirs}/cancel`, "gadm", theirs)).status, 404);
    assert.equal((await post(accountDisable, `hotel-admins/${U.hb}/disable`, "gadm", U.hb)).status, 404);
    assert.deepEqual(kinds(), ["hotel", "hotel", "hotel", "invitation", "hotel_admin"]);
    assert.ok(violations.every((v) => v.userId === U.gadm && v.groupId === G.one));
    assert.deepEqual(Object.keys(violations[0]!).sort(), ["groupId", "userId", "what"]);
  });

  test("a hook that throws never changes the answer", async () => {
    const services = buildPlatformServices({
      onTenantViolation: () => {
        throw new Error("alert down");
      },
      unit: w.cons.unit, credentials: (repos) => createCredentialService({ unit: { run: (work) => work(repos.auth) }, hasher: createArgon2Hasher({ memoryCost: 1024, timeCost: 1, parallelism: 1 }), now }), now,
      hasher: createArgon2Hasher({ memoryCost: 1024, timeCost: 1, parallelism: 1 }), publicUrl: ORIGIN, newToken: () => "t", hashKey: randomBytes(32), provisioner: w.provisioner,
    });
    configurePlatform(services);
    assert.equal((await get(hotelGet, `hotels/${H.b1}`, "gadm", { id: H.b1 })).status, 404);
  });
});
