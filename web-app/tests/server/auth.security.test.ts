// Sign-in and security (MJ, 5 Nov 2026): the Super Admin's session time per user kind, enforced on every request; temporary passwords that expire; the 15-minute
// lock and the admin's unlock in the sign-in history; the vault re-check (password or emailed code) that a Show needs.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import type { SessionKind } from "@shared/dashboards/security";
import { POST as recheck } from "../../src/app/api/v1/auth/recheck/route";
import { POST as recheckCodeSend } from "../../src/app/api/v1/auth/recheck/code/route";
import { POST as recheckCodeVerify } from "../../src/app/api/v1/auth/recheck/code/verify/route";
import { POST as signIn } from "../../src/app/api/v1/auth/sign-in/route";
import { assertRechecked, freshlyRechecked } from "../../src/server/auth/recheck";
import { renderMail } from "../../src/server/services/auth/mail";
import { SESSION_COOKIE, hashSessionToken, newSessionToken } from "../../src/server/auth/tokens";
import { configureAuth } from "../../src/server/compose/auth";
import type { UserRecord } from "../../src/server/repos/auth";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { createMemoryPlatformConsole } from "../../src/server/repos/memory/platformConsole";
import { createCredentialService } from "../../src/server/services/auth/credentialService";
import { createSessionResolver } from "../../src/server/services/auth/sessionResolver";
import { createUserService } from "../../src/server/services/platform/userService";
import { createSecurityService } from "../../src/server/services/platform/securityService";
import { PASSWORD, TEMP_PASSWORD, WEB, buildWorld, cookieOf, ctx, json, req, type World } from "./helpers/authWorld";
import { catalog, makeSession } from "./helpers/session";

const META = { traceId: "trace-security-1", ip: "10.0.0.5", userAgent: "node-test" };
const HOTEL = "33333333-3333-4333-8333-333333333333";
const T0 = new Date("2026-11-05T09:00:00+05:30");
const KINDS: readonly SessionKind[] = ["super_admin", "platform_admin", "group_hotel_admin", "hotel_admin", "hotel_user", "corporate_user", "guest_user"];
const code = async (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string }) => e.code ?? "error");

describe("session time per user kind (Platform settings > Security)", () => {
  let auth: ReturnType<typeof createMemoryAuth>;
  let cons: ReturnType<typeof createMemoryPlatformConsole>;
  const clock = { at: T0 };
  const now = () => new Date(clock.at.getTime());
  const later = (minutes: number) => void (clock.at = new Date(T0.getTime() + minutes * 60_000));
  const ids = Object.fromEntries(KINDS.map((k) => [k, randomUUID()])) as Record<SessionKind, string>;
  const tokens = {} as Record<SessionKind, string>;
  let resolver: ReturnType<typeof createSessionResolver>;
  const security = () => createSecurityService({ unit: cons.unit, now });
  const as = (kind: SessionKind) => makeSession({ userId: ids[kind], hotelId: "", accountRole: kind, roleKey: kind === "super_admin" ? "super_admin" : "viewer", roleLevel: 4 });
  const cookie = (token: string) => new Request("https://hms.test/api/v1/x", { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
  const alive = async (kind: SessionKind) => (await resolver.resolveSession(cookie(tokens[kind]))) !== null;
  const openSession = (kind: SessionKind, issuedAt: Date): string => {
    const token = newSessionToken();
    const inHotel = ["hotel_admin", "hotel_user", "corporate_user", "guest_user"].includes(kind);
    // the idle window is set far away here, so only the absolute lifetime decides
    auth.data().sessions.push({ id: randomUUID(), userId: ids[kind], hotelId: inHotel ? HOTEL : null, client: "web", tokenHash: hashSessionToken(token), deviceLabel: null, userAgent: null, ip: null, issuedAt, lastSeenAt: issuedAt, expiresAt: new Date(issuedAt.getTime() + 40 * 86_400_000), revokedAt: null, revokedReason: null });
    return token;
  };

  beforeEach(() => {
    clock.at = T0;
    auth = createMemoryAuth();
    cons = createMemoryPlatformConsole(auth);
    const roleId = randomUUID();
    auth.data().roles.push({ id: roleId, hotelId: null, key: "viewer", level: 1, inherits: true });
    auth.data().hotels.push({ id: HOTEL, name: "Hotel Sunrise", group: null, status: "active" });
    cons.data.hotels.set(HOTEL, { slug: "hotel-sunrise", city: "Rajkot", state: "Gujarat", gstin: null, timeZone: "Asia/Kolkata", createdAt: T0, provisionedAt: T0, submittedAt: null, approvedAt: null, rejectedAt: null, rejectReason: null, suspendedAt: null, suspendReason: null, archivedAt: null, archiveReason: null, restoreUntil: null, statusBeforeArchive: null, lastActivityAt: null, deletedAt: null } as never);
    for (const kind of KINDS) {
      const u: UserRecord = { id: ids[kind], username: kind.replace(/_/g, ""), email: `${kind}@demo.hms`, mobile: null, displayName: kind.toUpperCase(), passwordHash: "x", roleId, accountRole: kind, status: "active", mustChangePassword: false, passwordChangedAt: null, failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null, codeRequired: false, lastLoginAt: null, deletedAt: null };
      auth.data().users.push(u);
      if (["hotel_admin", "hotel_user", "corporate_user", "guest_user"].includes(kind)) {
        const subject = kind === "guest_user" ? { kind: "guest" as const, id: randomUUID() } : kind === "corporate_user" ? { kind: "company" as const, id: randomUUID() } : null;
        auth.data().memberships.push({ userId: ids[kind], hotelId: HOTEL, roleId: null, status: "active", isDefault: true, subject });
      }
    }
    for (const kind of KINDS) tokens[kind] = openSession(kind, T0);
    resolver = createSessionResolver({ unit: auth.unit, catalog, now, cacheMs: 0 });
  });

  test("by default the staff kinds stay signed in 12 hours and company and guest 7 days", async () => {
    later(12 * 60 - 1);
    for (const kind of KINDS) assert.equal(await alive(kind), true, `${kind} at 11 h 59 min`);
    later(12 * 60);
    for (const kind of KINDS) assert.equal(await alive(kind), kind === "corporate_user" || kind === "guest_user", `${kind} at 12 h`);
    later(7 * 24 * 60 - 1);
    assert.deepEqual([await alive("corporate_user"), await alive("guest_user")], [true, true]);
    later(7 * 24 * 60);
    assert.deepEqual([await alive("corporate_user"), await alive("guest_user")], [false, false]);
  });

  test("each kind gets its own limit, and the session reports when it ends", async () => {
    const minutes: Record<SessionKind, number> = { super_admin: 60, platform_admin: 90, group_hotel_admin: 120, hotel_admin: 150, hotel_user: 180, corporate_user: 240, guest_user: 300 };
    const saved = await security().update(as("super_admin"), { sessionMinutes: minutes }, META);
    assert.deepEqual(saved.sessionMinutes, minutes);
    for (const kind of KINDS) {
      later(minutes[kind] - 1);
      const s = await resolver.resolveSession(cookie(tokens[kind]));
      assert.ok(s, `${kind} one minute before its limit`);
      assert.equal(s.lifeEndsAt?.getTime(), T0.getTime() + minutes[kind] * 60_000, `${kind} ends at its own time`);
      assert.ok((s.expiresAt as Date).getTime() <= T0.getTime() + minutes[kind] * 60_000, "the reported expiry never passes the limit");
      later(minutes[kind]);
      assert.equal(await alive(kind), false, `${kind} at its limit`);
    }
  });

  test("a change applies to sessions already open on their next request, and to new ones; the ended page says the session ended", async () => {
    later(30);
    assert.equal(await alive("hotel_user"), true);
    await security().update(as("super_admin"), { sessionMinutes: { hotel_user: 15 } }, META);
    assert.equal(await alive("hotel_user"), false, "signed in 30 minutes ago, the new limit is 15");
    assert.equal(await resolver.endedReason(cookie(tokens.hotel_user)), "SESSION_EXPIRED", "a plain 'your session has ended', not 'your account changed'");
    assert.equal(await alive("hotel_admin"), true, "another kind keeps its own time");
    tokens.hotel_user = openSession("hotel_user", now());
    later(44);
    assert.equal(await alive("hotel_user"), true);
    later(45);
    assert.equal(await alive("hotel_user"), false);
    await security().update(as("super_admin"), { sessionMinutes: { hotel_user: 60 } }, META);
    assert.equal(await alive("hotel_user"), true, "a longer limit brings a session inside its time back at once");
  });

  test("only the Super Admin reads or changes it: a Platform Admin and a hotel's own top role are refused (audited); every change is audited with what changed", async () => {
    assert.equal(await code(security().update(as("platform_admin"), { sessionMinutes: { hotel_user: 15 } }, META)), "FORBIDDEN");
    assert.equal(await code(security().get(as("platform_admin"))), "FORBIDDEN");
    const hotelTop = makeSession({ userId: ids.hotel_admin, hotelId: HOTEL, accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4 });
    assert.equal(await code(security().update(hotelTop, { tempPasswordMinutes: 60 }, META)), "FORBIDDEN");
    assert.ok(cons.data.audit.some((a) => a.action === "settings_updated" && a.result === "failed" && a.actorRole === "platform_admin"));
    later(30);
    assert.equal(await alive("hotel_user"), true, "nothing changed");
    await security().update(as("super_admin"), { sessionMinutes: { hotel_user: 15 }, tempPasswordMinutes: 60 }, META);
    const row = cons.data.audit.filter((a) => a.action === "settings_updated" && a.result === "success").at(-1);
    assert.equal(row?.reason, "Hotel User signed in for 15 minutes, Temporary password works for 1 hour");
    assert.deepEqual((await security().get(as("super_admin"))).tempPasswordMinutes, 60);
  });

  test("the bounds: 15 minutes to 30 days a session, 5 minutes to 24 hours a temporary password; nothing is saved from a refused change", async () => {
    const fields = async (input: Parameters<ReturnType<typeof security>["update"]>[1]) =>
      security().update(as("super_admin"), input, META).then(() => ({}), (e: { details?: { fields?: Record<string, string> } }) => e.details?.fields ?? {});
    assert.deepEqual(Object.keys(await fields({ sessionMinutes: { guest_user: 14 } })), ["sessionMinutes.guest_user"]);
    assert.deepEqual(Object.keys(await fields({ sessionMinutes: { guest_user: 43_201 } })), ["sessionMinutes.guest_user"]);
    assert.deepEqual(Object.keys(await fields({ sessionMinutes: { hotel_user: 90.5 } })), ["sessionMinutes.hotel_user"]);
    assert.deepEqual(Object.keys(await fields({ tempPasswordMinutes: 4 })), ["tempPasswordMinutes"]);
    assert.deepEqual(Object.keys(await fields({ tempPasswordMinutes: 1441 })), ["tempPasswordMinutes"]);
    const s = await security().get(as("super_admin"));
    assert.deepEqual([s.sessionMinutes.guest_user, s.sessionMinutes.hotel_user, s.tempPasswordMinutes], [10_080, 720, 30]);
    await security().update(as("super_admin"), { sessionMinutes: { guest_user: 43_200, hotel_user: 15 }, tempPasswordMinutes: 5 }, META);
  });

  test("an admin's unlock is in the sign-in history and the audit; a Platform Admin cannot unlock a console account", async () => {
    const users = createUserService({ unit: cons.unit, now, credentials: () => ({}) as never });
    const target = auth.data().users.find((u) => u.id === ids.hotel_user)!;
    target.lockedUntil = new Date(T0.getTime() + 15 * 60_000);
    target.failedAttempts = 0;
    await users.unlock(as("super_admin"), ids.hotel_user, META);
    const event = auth.data().events.find((e) => e.event === "account_unlocked" && e.userId === ids.hotel_user);
    assert.deepEqual(event?.detail, { by: ids.super_admin });
    assert.equal(auth.data().users.find((u) => u.id === ids.hotel_user)?.lockedUntil, null);
    assert.ok(cons.data.audit.some((a) => a.action === "user_unlocked" && a.result === "success"));
    auth.data().users.find((u) => u.id === ids.platform_admin)!.lockedUntil = new Date(T0.getTime() + 15 * 60_000);
    assert.equal(await code(users.unlock(as("platform_admin"), ids.platform_admin, META)), "FORBIDDEN");
  });
});

describe("a temporary password expires (default 30 minutes, the Super Admin's time)", () => {
  let w: World;
  beforeEach(async () => {
    configureAuth(null);
    w = await buildWorld();
  });
  const minutesAgo = (n: number) => new Date(w.clock.at.getTime() - n * 60_000);
  const setGiven = (at: Date | null) => void (w.data.users.find((u) => u.id === w.users.firsttime.id)!.tempPasswordAt = at);
  const first = async (password = TEMP_PASSWORD, username = "firsttime") => json(await signIn(req("POST", "/api/v1/auth/sign-in", { body: { username, password, device: WEB } }), ctx()));

  test("29 minutes after it was given it still opens the 'choose your own password' step; at 30 minutes it is refused with a plain sentence", async () => {
    setGiven(minutesAgo(29));
    assert.equal((await first()).data.status, "password_change_required");
    setGiven(minutesAgo(30));
    const refused = await first();
    assert.equal(refused.error.code, "ACCOUNT_DISABLED");
    assert.equal(refused.error.details.reason, "temp_password_expired");
    assert.equal(refused.error.message, "This temporary password has expired. Ask your administrator to send a new one.");
    assert.equal(w.data.sessions.length, 0, "no session");
    assert.ok(w.data.events.some((e) => e.event === "login_failed" && (e.detail as { reason?: string } | null)?.reason === "temp_password_expired"));
    const wrong = await first("Wrong#Pass1");
    assert.equal(wrong.error.code, "INVALID_CREDENTIALS", "a wrong password learns nothing about the expiry");
  });

  test("the Super Admin's time is used (60 minutes here)", async () => {
    w.data.security = { tempPasswordMinutes: 60 };
    setGiven(minutesAgo(45));
    assert.equal((await first()).data.status, "password_change_required");
    setGiven(minutesAgo(60));
    assert.equal((await first()).error.details.reason, "temp_password_expired");
  });

  test("an administrator's reset gives a new temporary password with its time; the person must choose their own at the first sign-in, which clears it", async () => {
    const now = () => new Date(w.clock.at.getTime());
    const credentials = createCredentialService({ unit: w.mem.unit, hasher: w.hasher, now, newTempPassword: () => "Reset#Temp2468" });
    await credentials.adminResetPassword(w.users.staff.id);
    const u = w.data.users.find((x) => x.id === w.users.staff.id)!;
    assert.deepEqual([u.mustChangePassword, u.tempPasswordAt?.getTime()], [true, w.clock.at.getTime()]);
    const mail = w.mailed(w.users.staff.id, "admin_reset").at(-1)!;
    assert.equal(mail.payload?.minutes, 30, "the email carries the time the password works");
    assert.match(renderMail("admin_reset", mail.payload!).text, /The temporary password works for 30 minutes\. After that, ask your administrator to send a new one\./);
    const step = await first("Reset#Temp2468", "staff");
    assert.equal(step.data.status, "password_change_required", "no session until the person chooses their own password");
    w.clock.at = new Date(w.clock.at.getTime() + 30 * 60_000);
    assert.equal((await first("Reset#Temp2468", "staff")).error.details.reason, "temp_password_expired");
    await credentials.adminResetPassword(w.users.staff.id);
    const fresh = await first("Reset#Temp2468", "staff");
    const { POST: change } = await import("../../src/app/api/v1/auth/password/change/route");
    const done = await json(await change(req("POST", "/x", { body: { changeToken: fresh.data.changeToken, newPassword: "Mine#Own2026", device: WEB } }), ctx()));
    assert.equal(done.data.status, "signed_in");
    const after = w.data.users.find((x) => x.id === w.users.staff.id)!;
    assert.deepEqual([after.mustChangePassword, after.tempPasswordAt], [false, null]);
  });

  test("an account given a temporary password outside the app (no time recorded) is not timed", async () => {
    setGiven(null);
    w.clock.at = new Date(w.clock.at.getTime() + 3 * 86_400_000);
    assert.equal((await first()).data.status, "password_change_required");
  });
});

describe("the vault re-check (password or emailed code, good for 5 minutes)", () => {
  let w: World;
  let cookie: string;
  beforeEach(async () => {
    configureAuth(null);
    w = await buildWorld();
    const res = await signIn(req("POST", "/api/v1/auth/sign-in", { body: { username: "staff", password: PASSWORD, device: WEB } }), ctx());
    cookie = cookieOf(res) as string;
  });
  const session = async () => w.resolver.resolveSession(req("GET", "/x", { cookie }));
  const minutes = (n: number) => void (w.clock.at = new Date(w.clock.at.getTime() + n * 60_000));

  test("the right password marks the session for 5 minutes and is audited; nothing secret is kept", async () => {
    assert.equal(freshlyRechecked((await session())!, w.clock.at), false);
    const ok = await json(await recheck(req("POST", "/api/v1/auth/recheck", { cookie, body: { password: PASSWORD } }), ctx()));
    assert.equal(ok.data.validUntil, new Date(w.clock.at.getTime() + 5 * 60_000).toISOString());
    assert.equal(freshlyRechecked((await session())!, w.clock.at), true);
    minutes(4);
    assert.equal(freshlyRechecked((await session())!, w.clock.at), true);
    minutes(1);
    assert.equal(freshlyRechecked((await session())!, w.clock.at), false, "5 minutes later it must be done again");
    assert.ok(w.data.audit.some((a) => a.action === "vault.rechecked_by_password" && a.actorUserId === w.users.staff.id));
    assert.ok(!JSON.stringify(w.data.audit).includes(PASSWORD));
  });

  test("a wrong password counts toward the lock: the fifth locks the account for 15 minutes", async () => {
    const tries: Response[] = [];
    for (let i = 0; i < 5; i++) tries.push(await recheck(req("POST", "/api/v1/auth/recheck", { cookie, body: { password: "Wrong#Pass1" } }), ctx()));
    assert.equal((await json(tries[0])).error.code, "INVALID_CREDENTIALS");
    assert.equal(tries[4].status, 423);
    assert.deepEqual((await json(tries[4])).error.details, { retryAfterSeconds: 900 });
    assert.equal(freshlyRechecked((await session())!, w.clock.at), false);
  });

  test("the emailed code: a wrong one says how many tries are left, the right one marks the session; another person cannot use it", async () => {
    const sent = await json(await recheckCodeSend(req("POST", "/api/v1/auth/recheck/code", { cookie }), ctx()));
    assert.match(sent.data.maskedEmail, /^st\*+@demo\.hms$/);
    assert.ok(!JSON.stringify(sent).includes(w.lastCode(w.users.staff.id, "login_code")), "the answer never carries the code");
    const wrong = await json(await recheckCodeVerify(req("POST", "/x", { cookie, body: { challengeId: sent.data.challengeId, code: "000000" } }), ctx()));
    assert.deepEqual([wrong.error.code, wrong.error.details.attemptsLeft], ["INVALID_CODE", 4]);
    const other = await signIn(req("POST", "/api/v1/auth/sign-in", { body: { username: "guest", password: PASSWORD, device: WEB } }), ctx());
    const stolen = await json(await recheckCodeVerify(req("POST", "/x", { cookie: cookieOf(other) as string, body: { challengeId: sent.data.challengeId, code: w.lastCode(w.users.staff.id, "login_code") } }), ctx()));
    assert.equal(stolen.error.code, "CHALLENGE_EXPIRED");
    const good = await json(await recheckCodeVerify(req("POST", "/x", { cookie, body: { challengeId: sent.data.challengeId, code: w.lastCode(w.users.staff.id, "login_code") } }), ctx()));
    assert.ok(good.data.rechecked);
    assert.equal(freshlyRechecked((await session())!, w.clock.at), true);
    const again = await json(await recheckCodeVerify(req("POST", "/x", { cookie, body: { challengeId: sent.data.challengeId, code: w.lastCode(w.users.staff.id, "login_code") } }), ctx()));
    assert.equal(again.error.code, "CHALLENGE_EXPIRED", "a code works once");
  });

  test("an API key can never show a vault secret, even with a fresh re-check time on it", async () => {
    const s = (await session())!;
    const fresh = { ...s, recheckedAt: new Date(w.clock.at.getTime() - 60_000) };
    assert.doesNotThrow(() => assertRechecked(fresh, w.clock.at));
    assert.throws(() => assertRechecked({ ...fresh, client: "token" }, w.clock.at), (e: { code?: string; details?: { reason?: string } }) => e.code === "FORBIDDEN" && e.details?.reason === "recheck_required");
  });

  test("five wrong codes cancel the code", async () => {
    const sent = await json(await recheckCodeSend(req("POST", "/api/v1/auth/recheck/code", { cookie }), ctx()));
    let last: { error: { code: string } } | null = null;
    for (let i = 0; i < 5; i++) last = await json(await recheckCodeVerify(req("POST", "/x", { cookie, body: { challengeId: sent.data.challengeId, code: "000000" } }), ctx()));
    assert.equal(last?.error.code, "CODE_ATTEMPTS_EXCEEDED");
    const right = await json(await recheckCodeVerify(req("POST", "/x", { cookie, body: { challengeId: sent.data.challengeId, code: w.lastCode(w.users.staff.id, "login_code") } }), ctx()));
    assert.equal(right.error.code, "CHALLENGE_EXPIRED");
  });
});
