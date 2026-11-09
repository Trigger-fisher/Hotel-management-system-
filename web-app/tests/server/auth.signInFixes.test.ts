// Sign-in fixes of 5 Nov 2026 (MJ): each test names the finding it pins.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { refusalEvent } from "../../../common/ui-shared/auth-pallav/flow";
import { POST as lock } from "../../src/app/api/v1/auth/lock/route";
import { GET as getSession } from "../../src/app/api/v1/auth/session/route";
import { POST as signIn } from "../../src/app/api/v1/auth/sign-in/route";
import { POST as signOut } from "../../src/app/api/v1/auth/sign-out/route";
import { POST as unlock } from "../../src/app/api/v1/auth/unlock/route";
import { configureAuth } from "../../src/server/compose/auth";
import { route } from "../../src/server/http/route";
import { HOTEL, PASSWORD, WEB, buildWorld, cookieOf, ctx, json, req, type World } from "./helpers/authWorld";

let w: World;
beforeEach(async () => {
  configureAuth(null);
  w = await buildWorld();
});

const doSignIn = (username: string, password = PASSWORD, ip = "10.0.0.1") => signIn(req("POST", "/api/v1/auth/sign-in", { body: { username, password, device: WEB }, ip }), ctx());
const errorOf = async (res: Response): Promise<{ code: string; message: string; details?: Record<string, unknown> }> => (await json(res)).error;

const anyPage = route({ permission: "session", handler: async () => ({ data: { page: "dashboard data" } }) });
const signedInCookie = async (username: string): Promise<string> => {
  const res = await doSignIn(username);
  assert.equal((await json(res)).data.status, "signed_in");
  return cookieOf(res) as string;
};

describe("flow-screen-lock-bypassed-by-reload / security-screen-lock-client-only", () => {
  test("a locked screen is locked on the server: every other route answers 423 SCREEN_LOCKED, the session check says locked, until the right password", async () => {
    const cookie = await signedInCookie("staff");
    assert.equal((await anyPage(req("GET", "/api/v1/anything", { cookie }), ctx())).status, 200);
    assert.equal((await lock(req("POST", "/api/v1/auth/lock", { cookie, body: {} }), ctx())).status, 200);
    // a reload or a new tab: the data routes refuse, the session answer carries locked so the app opens on the lock screen
    const refused = await anyPage(req("GET", "/api/v1/anything", { cookie }), ctx());
    assert.equal(refused.status, 423);
    assert.equal((await json(refused)).error.code, "SCREEN_LOCKED");
    const s = await getSession(req("GET", "/api/v1/auth/session", { cookie, origin: null }), ctx());
    assert.equal(s.status, 200);
    assert.equal((await json(s)).data.locked, true);
    // a wrong password keeps it locked
    assert.equal((await unlock(req("POST", "/api/v1/auth/unlock", { cookie, body: { password: "Wrong#Pass1" } }), ctx())).status, 401);
    assert.equal((await anyPage(req("GET", "/api/v1/anything", { cookie }), ctx())).status, 423);
    // the right one opens it again
    assert.equal((await unlock(req("POST", "/api/v1/auth/unlock", { cookie, body: { password: PASSWORD } }), ctx())).status, 200);
    assert.equal((await anyPage(req("GET", "/api/v1/anything", { cookie }), ctx())).status, 200);
    assert.equal((await json(await getSession(req("GET", "/api/v1/auth/session", { cookie, origin: null }), ctx()))).data.locked, undefined);
  });
  test("sign-out still works while the screen is locked", async () => {
    const cookie = await signedInCookie("staff");
    await lock(req("POST", "/api/v1/auth/lock", { cookie, body: {} }), ctx());
    assert.equal((await signOut(req("POST", "/api/v1/auth/sign-out", { cookie }), ctx())).status, 200);
  });
});

describe("security-portal-account-can-hold-hotel-grants", () => {
  const revenuePage = route({ permission: { key: "revenue", level: "view" }, handler: async () => ({ data: { page: "every guest's revenue" } }) });
  test("a guest login whose role holds a hotel module still gets 403 on that module's route; a staff login with the same role gets in", async () => {
    // both carry the Viewer role, which grants revenue (view)
    const staff = await signedInCookie("staff");
    assert.equal((await revenuePage(req("GET", "/api/v1/revenue/x", { cookie: staff }), ctx())).status, 200);
    const guest = await signedInCookie("guest");
    const refused = await revenuePage(req("GET", "/api/v1/revenue/x", { cookie: guest }), ctx());
    assert.equal(refused.status, 403);
    assert.equal((await json(refused)).error.code, "FORBIDDEN");
  });
  test("a guest's session holds no hotel module permission at all", async () => {
    const res = await doSignIn("guest");
    const session = (await json(res)).data.session;
    assert.equal(session.user.role, "guest_user");
    const verified = await w.resolver.resolveSession(req("GET", "/x", { cookie: cookieOf(res) as string }));
    assert.deepEqual(verified?.permissions, {});
  });
});

describe("flow-group-admin-session-has-no-group", () => {
  test("a Group Hotel Admin's session names the group they run, though they have no hotel", async () => {
    const u = w.data.users.find((x) => x.username === "mihir")!;
    u.accountRole = "group_hotel_admin";
    u.codeRequired = false;
    w.data.adminGroups = [{ id: "g-7", name: "Lakeside Group", adminUserId: u.id, status: "active" }];
    const body = await json(await doSignIn("mihir"));
    assert.equal(body.data.status, "signed_in");
    assert.deepEqual(body.data.session.user.group, { id: "g-7", name: "Lakeside Group" });
    assert.equal(body.data.session.user.hotel, null);
  });
});

describe("flow-console-role-can-sit-inside-a-hotel", () => {
  test("a Super Admin with a stray hotel membership signs in with no hotel, and still signs in while that hotel is suspended", async () => {
    const u = w.data.users.find((x) => x.username === "mihir")!;
    u.codeRequired = false;
    w.data.memberships.push({ userId: u.id, hotelId: HOTEL, roleId: null, status: "active", isDefault: true, subject: null });
    const first = await json(await doSignIn("mihir"));
    assert.equal(first.data.session.user.hotel, null);
    w.data.hotels.find((h) => h.id === HOTEL)!.status = "suspended";
    const again = await json(await doSignIn("mihir"));
    assert.equal(again.data.status, "signed_in", JSON.stringify(again));
  });
});

describe("flow-multi-hotel-account-blocked-by-default-hotel", () => {
  test("a guest linked to two hotels still signs in when the default one is suspended (the active one is used)", async () => {
    const OTHER = "22222222-2222-4222-8222-222222222222";
    w.data.hotels.push({ id: OTHER, name: "Hotel Lakeview", group: null });
    const g = w.data.users.find((x) => x.username === "guest")!;
    w.data.memberships.push({ userId: g.id, hotelId: OTHER, roleId: null, status: "active", isDefault: false, subject: { kind: "guest", id: "33333333-3333-4333-8333-333333333333" } });
    w.data.hotels.find((h) => h.id === HOTEL)!.status = "suspended";
    const body = await json(await doSignIn("guest"));
    assert.equal(body.data.status, "signed_in", JSON.stringify(body));
    assert.equal(body.data.session.user.hotel.id, OTHER);
  });
  test("a guest whose only hotel is suspended is still refused", async () => {
    w.data.hotels.find((h) => h.id === HOTEL)!.status = "suspended";
    assert.equal((await errorOf(await doSignIn("guest"))).code, "ACCOUNT_BLOCKED");
  });
});

describe("flow-sign-out-leaves-hotel-visit-open", () => {
  test("signing out during a hotel visit closes the visit (signed_out) and writes hotel_exited", async () => {
    const u = w.data.users.find((x) => x.username === "mihir")!;
    u.codeRequired = false;
    const cookie = await signedInCookie("mihir");
    const s = w.data.sessions.find((x) => x.userId === u.id && x.revokedAt === null)!;
    const at = w.clock.at;
    w.data.visits.push({ id: "v-1", userId: u.id, hotelId: HOTEL, sessionId: s.id, reason: "Checking a bill", startedAt: at, expiresAt: new Date(at.getTime() + 3_600_000), endedAt: null, endedReason: null, endedBy: null, ip: null, userAgent: null } as never);
    assert.equal((await signOut(req("POST", "/api/v1/auth/sign-out", { cookie }), ctx())).status, 200);
    const v = w.data.visits.find((x) => x.id === "v-1")!;
    assert.equal(v.endedReason, "signed_out");
    assert.ok(v.endedAt);
    assert.ok(w.data.audit.some((a) => a.action === "hotel_exited" && a.hotelId === HOTEL && a.actorUserId === u.id));
  });
});

describe("security-no-absolute-session-lifetime", () => {
  test("a staff session that kept sliding ends 12 hours after its sign-in", async () => {
    const cookie = await signedInCookie("staff");
    const s = w.data.sessions.find((x) => x.revokedAt === null)!;
    s.issuedAt = new Date(w.clock.at.getTime() - 12 * 3_600_000 - 1000);
    assert.equal((await anyPage(req("GET", "/api/v1/anything", { cookie }), ctx())).status, 401);
    s.issuedAt = new Date(w.clock.at.getTime() - 11 * 3_600_000);
    assert.equal((await anyPage(req("GET", "/api/v1/anything", { cookie }), ctx())).status, 200);
  });
});

describe("proof: a Hotel User cannot call a Hotel Admin route or a platform route", () => {
  test("staff (hotel_user) gets 403 on the hotel's Users list and on the platform console's hotels", async () => {
    const { GET: usersList } = await import("../../src/app/api/v1/admin/users/route");
    const { GET: platformHotels } = await import("../../src/app/api/v1/platform/hotels/route");
    const cookie = await signedInCookie("staff");
    assert.equal((await usersList(req("GET", "/api/v1/admin/users", { cookie }), ctx())).status, 403);
    assert.equal((await platformHotels(req("GET", "/api/v1/platform/hotels", { cookie }), ctx())).status, 403);
  });
});

describe("flow-disabled-account-says-details-wrong", () => {
  test("a disabled account (right password) answers ACCOUNT_DISABLED with reason 'disabled', and the screen opens the blocked step, not 'details don't match'", async () => {
    const e = await errorOf(await doSignIn("disabled"));
    assert.equal(e.code, "ACCOUNT_DISABLED");
    assert.equal(e.details?.reason, "disabled");
    const event = refusalEvent({ code: "ACCOUNT_DISABLED", message: e.message, details: e.details as never });
    assert.deepEqual(event, { type: "BLOCKED", reason: "disabled", reasonText: null });
  });
  test("the admin of a rejected hotel is told the application was not approved", async () => {
    const u = w.data.users.find((x) => x.username === "anita")!;
    u.status = "disabled";
    w.data.hotels.find((h) => h.id === HOTEL)!.status = "rejected";
    const e = await errorOf(await doSignIn("anita"));
    assert.equal(e.code, "ACCOUNT_DISABLED");
    assert.equal(e.details?.reason, "hotel_rejected");
  });
  test("the admin of a rejected group is told the group application was not approved", async () => {
    const u = w.data.users.find((x) => x.username === "mihir")!;
    u.status = "disabled";
    u.accountRole = "group_hotel_admin";
    w.data.adminGroups = [{ id: "g-9", name: "Lakeside Group", adminUserId: u.id, status: "rejected" }];
    const e = await errorOf(await doSignIn("mihir"));
    assert.equal(e.details?.reason, "group_rejected");
  });
  test("an account that needs the code but has no email gets reason 'no_email', shown as its own screen", async () => {
    const e = await errorOf(await doSignIn("noemail"));
    assert.equal(e.code, "ACCOUNT_DISABLED");
    assert.equal(e.details?.reason, "no_email");
    assert.equal(refusalEvent({ code: "ACCOUNT_DISABLED", message: e.message, details: e.details as never })?.reason, "no_email");
  });
  test("a wrong password on a disabled account still says only INVALID_CREDENTIALS", async () => {
    assert.equal((await errorOf(await doSignIn("disabled", "Wrong#Pass1"))).code, "INVALID_CREDENTIALS");
  });
});
