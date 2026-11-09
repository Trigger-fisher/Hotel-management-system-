// The login backend end to end, through the REAL route files, the wrapper, the auth service, the session resolver and the in-memory platform
// data, with the real argon2id hasher. What stays Pallav-exact cites AuthController.php / OneTimeCode.php / PasswordPolicy.php; every
// deliberate change (MJ #13) is in a test whose name says "HMS (#13)".
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import type { HmsUser, Session, SignInResult } from "@shared/auth-pallav/types";
import { POST as changePassword } from "../../src/app/api/v1/auth/password/change/route";
import { POST as forgot } from "../../src/app/api/v1/auth/password/forgot/route";
import { GET as checkLink } from "../../src/app/api/v1/auth/password/reset-link/check/route";
import { POST as resetLink } from "../../src/app/api/v1/auth/password/reset-link/route";
import { POST as resendCode } from "../../src/app/api/v1/auth/code/resend/route";
import { POST as verifyCode } from "../../src/app/api/v1/auth/code/verify/route";
import { GET as getSession } from "../../src/app/api/v1/auth/session/route";
import { POST as signIn } from "../../src/app/api/v1/auth/sign-in/route";
import { POST as signOut } from "../../src/app/api/v1/auth/sign-out/route";
import { POST as unlock } from "../../src/app/api/v1/auth/unlock/route";
import { configureAuth } from "../../src/server/compose/auth";
import { runOutboxOnce, type MailSender } from "../../src/server/services/auth/mail";
import { SESSION_COOKIE, SIGNED_OUT_COOKIE } from "../../src/server/auth/tokens";
import { PASSWORD, TEMP_PASSWORD, WEB, buildWorld, cookieOf, ctx, json, req, type World, type Who } from "./helpers/authWorld";

let w: World;
beforeEach(async () => {
  configureAuth(null);
  w = await buildWorld();
});

const minutes = (n: number): void => void (w.clock.at = new Date(w.clock.at.getTime() + n * 60_000));
const seconds = (n: number): void => void (w.clock.at = new Date(w.clock.at.getTime() + n * 1000));

const doSignIn = (username: string, password = PASSWORD, device: object = WEB, ip = "10.0.0.1") => signIn(req("POST", "/api/v1/auth/sign-in", { body: { username, password, device }, ip }), ctx());
const signedIn = async (who: Who, device: object = WEB): Promise<{ res: Response; session: Session; cookie: string | null }> => {
  const res = await doSignIn(w.users[who].username, PASSWORD, device);
  const body = await json(res);
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.data.status, "signed_in", JSON.stringify(body));
  return { res, session: body.data.session, cookie: cookieOf(res) };
};
const asAdmin = async (who: Who = "anita", device: object = WEB): Promise<{ res: Response; session: Session; cookie: string | null }> => {
  const first = await json(await doSignIn(w.users[who].username, PASSWORD, device));
  assert.equal(first.data.status, "code_required");
  const res = await verifyCode(req("POST", "/api/v1/auth/code/verify", { body: { challengeId: first.data.challengeId, code: w.lastCode(w.users[who].id, "login_code") } }), ctx());
  const body = await json(res);
  assert.equal(body.data.status, "signed_in", JSON.stringify(body));
  return { res, session: body.data.session, cookie: cookieOf(res) };
};
const me = (opts: { cookie?: string | null; bearer?: string | null }) => getSession(req("GET", "/api/v1/auth/session", { cookie: opts.cookie ?? undefined, bearer: opts.bearer ?? undefined, origin: null }), ctx());
const errorOf = async (res: Response): Promise<{ code: string; message: string; details?: Record<string, unknown> }> => (await json(res)).error;
const wrongPasswords = async (username: string, n: number, ip = "10.0.0.1"): Promise<Response[]> => {
  const out: Response[] = [];
  for (let i = 0; i < n; i++) out.push(await doSignIn(username, "Wrong#Pass1", WEB, ip + (i % 3)));
  return out;
};

describe("step one: username and password", () => {
  test("a wrong username and a wrong password give the SAME answer, and an unknown username still costs a hash (AuthController.php:80-89)", async () => {
    const before = w.hasher.calls.dummy;
    const unknown = await doSignIn("nobody-here");
    const wrong = await doSignIn("staff", "Wrong#Pass1");
    assert.equal(unknown.status, 401);
    assert.equal(wrong.status, 401);
    const a = await errorOf(unknown);
    const b = await errorOf(wrong);
    assert.deepEqual([a.code, a.message, a.details], [b.code, b.message, b.details]);
    assert.equal(a.code, "INVALID_CREDENTIALS");
    assert.equal(w.hasher.calls.dummy, before + 1, "the unknown username spent a dummy verify");
  });
  test("a person who does not need the code signs straight in: a web session sets the httpOnly cookie, the body has no token", async () => {
    const { res, session, cookie } = await signedIn("staff");
    assert.equal(session.client, "web");
    assert.equal(session.token, null);
    assert.equal(session.user.username, "staff");
    assert.equal(session.expiresAt, "2026-10-05T06:30:00.000Z", "120 idle minutes from 10:00 IST");
    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith(SESSION_COOKIE)) as string;
    assert.match(setCookie, /^__Host-hms_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax$/, "__Host- prefix, Path=/, no Domain, httpOnly, Secure, SameSite=Lax");
    assert.ok(!/Domain=/i.test(setCookie) && !/Max-Age/i.test(setCookie));
    assert.ok(cookie);
  });
  test("the token is never stored, only its SHA-256, and the cookie is not in the body", async () => {
    const { cookie, res } = await signedIn("staff");
    const row = w.data.sessions[0];
    assert.equal(row.tokenHash, createHash("sha256").update(cookie as string).digest("hex"));
    assert.ok(!JSON.stringify(w.data).includes(cookie as string));
    assert.ok(!JSON.stringify(await json(res)).includes(cookie as string));
  });
  test("only a browser signs in: any other platform is refused; the token is only ever in the httpOnly cookie, never in the answer", async () => {
    assert.equal((await doSignIn("staff", PASSWORD, { platform: "android", name: "Pixel 8", deviceId: "phone-device-0001" })).status, 422);
    const { res, session } = await signedIn("staff");
    assert.equal(session.client, "web");
    assert.equal(session.token, null);
    assert.ok(cookieOf(res));
  });
  test("a browser sends no device id; unknown keys and bad platforms are refused", async () => {
    assert.equal((await doSignIn("staff", PASSWORD, { platform: "web", name: "x", deviceId: "phone-device-0001" })).status, 422);
    assert.equal((await doSignIn("staff", PASSWORD, { platform: "tablet", name: "x" })).status, 422);
    assert.equal((await signIn(req("POST", "/x", { body: { username: "staff", password: PASSWORD, device: WEB, role: "super_admin" } }), ctx())).status, 422);
  });
  test("the user the apps get: id, name, email, role, hotel, group and abilities from THIS hotel's role, never from input", async () => {
    const staff = (await signedIn("staff")).session.user;
    assert.deepEqual(staff, { id: w.users.staff.id, displayName: "STAFF", email: "staff@demo.hms", username: "staff", role: "hotel_user", hotel: { id: "11111111-1111-4111-8111-111111111111", name: "Hotel Sunrise, Rajkot", foodName: "Hotel Sunrise, Rajkot Food" }, group: { id: "g-1", name: "Sunrise Hotels Group" }, abilities: [], grants: { dashboard: "view", revenue: "view" } });
  });
  test("a disabled account is refused only after the right password (so a wrong one leaks nothing), AuthController.php:91-93", async () => {
    assert.equal((await errorOf(await doSignIn("disabled", "Wrong#Pass1"))).code, "INVALID_CREDENTIALS");
    assert.equal((await errorOf(await doSignIn("disabled"))).code, "ACCOUNT_DISABLED");
  });
  test("usernames are case-insensitive and trimmed (AuthController.php:65)", async () => {
    assert.equal((await json(await doSignIn("  StAfF "))).data.status, "signed_in");
  });
});

describe("abilities in the answer", () => {
  test("a hotel SuperAdmin role gets system.backdate and system.force; a viewer none; the platform owner (no hotel) only what its role holds", async () => {
    const sonal = (await asAdmin("sonal")).session.user;
    assert.deepEqual(sonal.abilities, ["system.backdate", "system.force", "system.recycle", "users.password", "users.set-password"]);
    assert.deepEqual((await signedIn("staff")).session.user.abilities, []);
    const anita = (await asAdmin("anita")).session.user;
    assert.deepEqual(anita.abilities, ["system.backdate", "users.password"]);
  });
  test("system.recycle is DERIVED from the hotel role (SuperAdmin only): a hotel admin with the super_admin role has it, the platform owner (no hotel), an ordinary admin and a viewer do not", async () => {
    assert.ok(((await asAdmin("sonal")).session.user.abilities ?? []).includes("system.recycle"));
    assert.ok(!((await asAdmin("anita")).session.user.abilities ?? []).includes("system.recycle"));
    assert.ok(!((await signedIn("staff")).session.user.abilities ?? []).includes("system.recycle"));
    const owner = (await asAdmin("mihir")).session.user;
    assert.equal(owner.role, "super_admin");
    assert.ok(!(owner.abilities ?? []).includes("system.recycle"), "the platform owner's account role is not the hotel's SuperAdmin");
  });
  test("a per-hotel grant of system.recycle changes nothing (it is not a catalog row), and a revoke cannot take it from the SuperAdmin role", async () => {
    w.data.userPermissions.push({ userId: w.users.anita.id, hotelId: "11111111-1111-4111-8111-111111111111", key: "system.recycle", level: "full", granted: true });
    w.data.userPermissions.push({ userId: w.users.sonal.id, hotelId: "11111111-1111-4111-8111-111111111111", key: "system.recycle", level: "full", granted: false });
    assert.ok(!((await asAdmin("anita")).session.user.abilities ?? []).includes("system.recycle"));
    assert.ok(((await asAdmin("sonal")).session.user.abilities ?? []).includes("system.recycle"));
  });
  test("the session's hotel carries foodName: the food business of the hotel, by default the hotel name followed by Foods", async () => {
    const { cookie } = await asAdmin("sonal");
    const hotel = (await json(await me({ cookie }))).data.user.hotel;
    assert.deepEqual([hotel.name, hotel.foodName], ["Hotel Sunrise, Rajkot", "Hotel Sunrise, Rajkot Food"]);
  });
  test("GET /auth/session returns system.recycle for the SuperAdmin role", async () => {
    const { cookie } = await asAdmin("sonal");
    assert.ok(((await json(await me({ cookie }))).data.user.abilities ?? []).includes("system.recycle"));
  });
  test("a per-hotel revoke removes an ability and a per-hotel grant adds one; a grant in another hotel changes nothing", async () => {
    w.data.userPermissions.push({ userId: w.users.anita.id, hotelId: "11111111-1111-4111-8111-111111111111", key: "system.backdate", level: "full", granted: false });
    w.data.userPermissions.push({ userId: w.users.anita.id, hotelId: "22222222-2222-4222-8222-222222222222", key: "system.force", level: "full", granted: true });
    w.data.userPermissions.push({ userId: w.users.staff.id, hotelId: "11111111-1111-4111-8111-111111111111", key: "users.password", level: "full", granted: true });
    assert.deepEqual((await asAdmin("anita")).session.user.abilities, ["users.password"]);
    assert.deepEqual((await signedIn("staff")).session.user.abilities, ["users.password"]);
  });
  test("GET /auth/session reports the same abilities, read fresh: a role change shows on the next call", async () => {
    const { cookie } = await asAdmin("anita");
    assert.deepEqual((await json(await me({ cookie }))).data.user.abilities, ["system.backdate", "users.password"]);
    w.data.rolePermissions = w.data.rolePermissions.filter((p) => p.key !== "system.backdate");
    assert.deepEqual((await json(await me({ cookie }))).data.user.abilities, ["users.password"]);
  });
});

describe("the emailed code (the person's own choice: code_required)", () => {
  test("decision 46: the code is the person's own choice, administrators included: switched off, the password alone signs in; switched on, the answer has the masked email and the resend wait", async () => {
    await w.mem.unit.run((r) => r.users.update(w.users.anita.id, { codeRequired: false }));
    assert.equal((await json(await doSignIn("anita"))).data.status, "signed_in", "no code asked of an administrator who switched it off");
    await w.mem.unit.run((r) => r.users.update(w.users.anita.id, { codeRequired: true }));
    const body = await json(await doSignIn("anita"));
    assert.equal(body.data.status, "code_required");
    assert.equal(body.data.maskedEmail, "an***@demo.hms", "Pallav's maskEmail");
    assert.equal(body.data.resendAfterSeconds, 30);
    assert.match(body.data.challengeId, /^[0-9a-f-]{36}\.[A-Za-z0-9_-]+\.[0-9a-f]{64}$/);
  });
  test("the code is 6 digits, bound by a keyed hash, and ONLY ever inside the outbox payload", async () => {
    await doSignIn("anita");
    const code = w.lastCode(w.users.anita.id, "login_code");
    assert.match(code, /^\d{6}$/);
    const dump = JSON.stringify([w.data.codes, w.data.sessions, w.data.events, w.data.audit]);
    assert.ok(!dump.includes(code), "the plain code is nowhere in the stored data");
    assert.ok(!dump.includes("anita@demo.hms"), "nor is the address anywhere but the mail queue");
    assert.match(w.data.codes[0].codeHash, /^[0-9a-f]{64}$/);
    assert.match(w.data.outbox[0].toEmail, /@/);
    assert.match(w.data.outbox[0].payload as string, /"code"/);
    assert.equal(w.mailed(w.users.anita.id)[0].to, "anita@demo.hms");
  });
  test("a right code signs in; it cannot be used twice (OneTimeCode::clear)", async () => {
    const first = await json(await doSignIn("anita"));
    const code = w.lastCode(w.users.anita.id, "login_code");
    const ok = await verifyCode(req("POST", "/x", { body: { challengeId: first.data.challengeId, code: ` ${code.slice(0, 3)} ${code.slice(3)} ` } }), ctx());
    assert.equal((await json(ok)).data.status, "signed_in", "spaces in the code are ignored");
    assert.ok(cookieOf(ok));
    const again = await verifyCode(req("POST", "/x", { body: { challengeId: first.data.challengeId, code } }), ctx());
    assert.equal((await errorOf(again)).code, "CHALLENGE_EXPIRED");
  });
  test("a wrong code is INVALID_CODE with the tries left (OneTimeCode.php:191-193)", async () => {
    const first = await json(await doSignIn("anita"));
    const res = await verifyCode(req("POST", "/x", { body: { challengeId: first.data.challengeId, code: "000000" } }), ctx());
    assert.equal(res.status, 401);
    const e = await errorOf(res);
    assert.equal(e.code, "INVALID_CODE");
    assert.deepEqual(e.details, { attemptsLeft: 4 });
  });
  test("HMS (#13): five wrong codes CANCEL that code; the account is NOT blocked or locked (Pallav blocked it, OneTimeCode.php:185-189)", async () => {
    const first = await json(await doSignIn("anita"));
    const good = w.lastCode(w.users.anita.id, "login_code");
    const wrong = good === "111111" ? "222222" : "111111";
    for (let i = 0; i < 4; i++) assert.equal((await errorOf(await verifyCode(req("POST", "/x", { body: { challengeId: first.data.challengeId, code: wrong } }), ctx()))).code, "INVALID_CODE");
    assert.equal((await errorOf(await verifyCode(req("POST", "/x", { body: { challengeId: first.data.challengeId, code: wrong } }), ctx()))).code, "CODE_ATTEMPTS_EXCEEDED");
    assert.equal((await errorOf(await verifyCode(req("POST", "/x", { body: { challengeId: first.data.challengeId, code: good } }), ctx()))).code, "CHALLENGE_EXPIRED", "even the right code is dead now");
    const u = w.data.users.find((x) => x.id === w.users.anita.id)!;
    assert.deepEqual([u.blockedAt, u.lockedUntil], [null, null]);
    assert.equal((await json(await doSignIn("anita"))).data.status, "code_required", "signing in again gives a new code");
  });
  test("a code is good for ten minutes (OneTimeCode::VALID_MINUTES)", async () => {
    const first = await json(await doSignIn("anita"));
    const code = w.lastCode(w.users.anita.id, "login_code");
    minutes(10);
    assert.equal((await errorOf(await verifyCode(req("POST", "/x", { body: { challengeId: first.data.challengeId, code } }), ctx()))).code, "CHALLENGE_EXPIRED");
  });
  test("a forged, altered or foreign challenge is refused: the signature binds the id and the device", async () => {
    const first = await json(await doSignIn("anita"));
    const code = w.lastCode(w.users.anita.id, "login_code");
    const parts = first.data.challengeId.split(".");
    const swapped = Buffer.from(JSON.stringify({ platform: "web", name: "evil" })).toString("base64url");
    for (const challengeId of [`${parts[0]}.${swapped}.${parts[2]}`, `${parts[0]}.${parts[1]}.${"0".repeat(64)}`, "junk", `${parts[0]}.${parts[2]}`, ""]) {
      assert.equal((await errorOf(await verifyCode(req("POST", "/x", { body: { challengeId, code } }), ctx()))).code, "CHALLENGE_EXPIRED", challengeId.slice(0, 20));
    }
  });
  test("a code that is not six digits is 422 and does not count as a try", async () => {
    const first = await json(await doSignIn("anita"));
    for (const code of ["12345", "1234567", "abcdef", ""]) assert.equal((await verifyCode(req("POST", "/x", { body: { challengeId: first.data.challengeId, code } }), ctx())).status, 422);
    assert.equal(w.data.codes[0].attempts, 0);
  });
  test("resend: a wait of 30 seconds, the same challenge stays valid, the old code stops working, five sends an hour (HMS #13: 30 s, Pallav 60 s)", async () => {
    const first = await json(await doSignIn("anita"));
    const challengeId = first.data.challengeId;
    const oldCode = w.lastCode(w.users.anita.id, "login_code");
    const resend = () => resendCode(req("POST", "/x", { body: { challengeId } }), ctx());
    const tooSoon = await resend();
    assert.equal(tooSoon.status, 429);
    assert.deepEqual((await errorOf(tooSoon)).details, { retryAfterSeconds: 30 });
    seconds(31);
    const ok = await resend();
    assert.deepEqual((await json(ok)).data, { maskedEmail: "an***@demo.hms", resendAfterSeconds: 30 });
    const newCode = w.lastCode(w.users.anita.id, "login_code");
    if (newCode !== oldCode) assert.equal((await errorOf(await verifyCode(req("POST", "/x", { body: { challengeId, code: oldCode } }), ctx()))).code, "INVALID_CODE");
    const vv = await json(await verifyCode(req("POST", "/x", { body: { challengeId, code: newCode } }), ctx()));
    assert.equal(vv.data?.status, "signed_in", JSON.stringify(vv));
  });
  test("resend is capped: after the fifth email in an hour the next is refused until the hour is over (OneTimeCode::MAX_SENDS)", async () => {
    const first = await json(await doSignIn("anita"));
    const challengeId = first.data.challengeId;
    for (let i = 0; i < 4; i++) {
      seconds(31);
      assert.equal((await resendCode(req("POST", "/x", { body: { challengeId } }), ctx())).status, 200);
    }
    seconds(31);
    const refused = await resendCode(req("POST", "/x", { body: { challengeId } }), ctx());
    assert.equal(refused.status, 429);
    assert.ok(Number((await errorOf(refused)).details?.retryAfterSeconds) > 1000);
    assert.equal(w.mailed(w.users.anita.id, "login_code").length, 5);
  });
  test("an admin without an email address cannot get a code, and is told why", async () => {
    const res = await doSignIn("noemail");
    assert.equal(res.status, 403);
    assert.match((await errorOf(res)).message, /no email address/);
  });
});

describe("the lock: five wrong passwords (HMS #13: timed, growing; Pallav blocked with no timer, AuthController.php:352-365)", () => {
  test("the fifth wrong password locks for 15 minutes and says how long; the first four say nothing but INVALID_CREDENTIALS", async () => {
    const res = await wrongPasswords("staff", 5);
    for (const r of res.slice(0, 4)) assert.deepEqual((await errorOf(r)), { code: "INVALID_CREDENTIALS", message: "Sign-in details are not correct", traceId: (await errorOf(r) as unknown as { traceId: string }).traceId });
    const fifth = await errorOf(res[4]);
    assert.equal(fifth.code, "ACCOUNT_LOCKED");
    assert.deepEqual(fifth.details, { retryAfterSeconds: 900 });
    assert.equal(res[4].status, 423);
  });
  test("while locked even the RIGHT password is refused (AuthController.php:76-78); after the wait it works and the count starts again", async () => {
    await wrongPasswords("staff", 5);
    assert.equal((await errorOf(await doSignIn("staff"))).code, "ACCOUNT_LOCKED");
    minutes(14);
    assert.equal((await doSignIn("staff")).status, 423);
    minutes(1);
    assert.equal((await json(await doSignIn("staff"))).data.status, "signed_in");
    const u = w.data.users.find((x) => x.id === w.users.staff.id)!;
    assert.deepEqual([u.failedAttempts, u.lockLevel, u.lockedUntil], [0, 0, null], "a good sign-in resets every counter (:201-214)");
  });
  test("HMS (MJ, 5 Nov 2026): every lock lasts 15 minutes, however many came before (Pallav's growing LOCK_STEPS are kept only as the golden reference)", async () => {
    for (let i = 0; i < 7; i++) {
      const res = await wrongPasswords("staff", 5);
      const e = await errorOf(res[4]);
      assert.equal(e.code, "ACCOUNT_LOCKED", `lock ${i + 1}`);
      assert.deepEqual(e.details, { retryAfterSeconds: 900 }, `lock ${i + 1}`);
      seconds(900);
    }
    assert.equal(w.data.events.filter((e) => e.event === "account_locked" && e.userId === w.users.staff.id).length, 7, "every lock is in the sign-in history");
  });
  test("a lock sends the person an email (through the outbox) and writes the trail", async () => {
    await wrongPasswords("staff", 5);
    const mail = w.mailed(w.users.staff.id, "account_locked");
    assert.equal(mail.length, 1);
    assert.equal(mail[0].to, "staff@demo.hms");
    assert.ok(w.data.events.some((e) => e.event === "account_locked" && e.userId === w.users.staff.id));
    assert.equal(w.data.events.filter((e) => e.event === "login_failed").length, 5);
  });
  test("the fifth wrong password tells the security layer once, with no name, email or password; four do not", async () => {
    const seen: { userId: string; accountRole: string; via: string; ip: string | null }[] = [];
    w = await buildWorld({ onAccountLocked: async (e) => void seen.push(e) });
    await wrongPasswords("staff", 4);
    assert.equal(seen.length, 0);
    await wrongPasswords("staff", 1);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.userId, w.users.staff.id);
    assert.deepEqual(Object.keys(seen[0]!).sort(), ["accountRole", "ip", "minutes", "traceId", "userId", "via"]);
    w = await buildWorld({ onAccountLocked: async () => { throw new Error("alert down"); } });
    const res = await wrongPasswords("staff", 5);
    assert.equal((await errorOf(res[4])).code, "ACCOUNT_LOCKED", "a failing alert never changes the answer");
  });
  test("HMS (#13): a stranger's wrong attempts lock the account but NEVER end the owner's session", async () => {
    const { cookie } = await signedIn("staff");
    await wrongPasswords("staff", 5, "203.0.113.");
    assert.equal((await errorOf(await doSignIn("staff"))).code, "ACCOUNT_LOCKED");
    assert.equal((await me({ cookie })).status, 200, "the owner is still signed in");
    assert.equal(w.data.sessions.filter((s) => s.revokedAt === null).length, 1);
  });
  test("an administrator's BLOCK has no timer: ACCOUNT_BLOCKED even with the right password, and it ends the sessions (HMS #13)", async () => {
    const { cookie } = await signedIn("staff");
    await w.service.blockUser({ userId: w.users.anita.id, hotelId: null }, w.users.staff.id, { traceId: "trace-12345678", ip: null });
    assert.equal((await me({ cookie })).status, 401, "the owner's session is revoked");
    assert.equal(w.data.sessions[0].revokedReason, "blocked");
    const res = await doSignIn("staff");
    assert.equal(res.status, 403);
    assert.equal((await errorOf(res)).code, "ACCOUNT_BLOCKED");
    minutes(60 * 24 * 30);
    assert.equal((await errorOf(await doSignIn("staff"))).code, "ACCOUNT_BLOCKED", "a month later it is still blocked");
    await w.service.unblockUser({ userId: w.users.anita.id, hotelId: null }, w.users.staff.id, { traceId: "trace-12345678", ip: null });
    assert.equal((await json(await doSignIn("staff"))).data.status, "signed_in");
    assert.ok(w.data.audit.some((a) => a.action === "user.block") && w.data.events.some((e) => e.event === "account_unblocked"));
  });
  test("the per-address brake: 20 tries in 15 minutes (AuthController.php:67-72) and 30 a minute (routes/web.php:76), cleared by a good password", async () => {
    for (let i = 0; i < 20; i++) assert.equal((await doSignIn("nobody", "x", WEB, "198.51.100.7")).status, 401);
    const refused = await doSignIn("nobody", "x", WEB, "198.51.100.7");
    assert.equal(refused.status, 429);
    assert.equal((await errorOf(refused)).code, "RATE_LIMITED");
    assert.ok(refused.headers.get("retry-after"));
    assert.equal((await doSignIn("nobody", "x", WEB, "198.51.100.8")).status, 401, "another address is unaffected");
    for (let i = 0; i < 15; i++) await doSignIn("nobody", "x", WEB, "198.51.100.9");
    await doSignIn("staff", PASSWORD, WEB, "198.51.100.9");
    minutes(1); // past the 30-a-minute window, still inside the 15-minute one: only the clearing can save the next 18
    for (let i = 0; i < 18; i++) assert.equal((await doSignIn("nobody", "x", WEB, "198.51.100.9")).status, 401, "the count was cleared by the good sign-in");
  });
});

describe("a temporary password (a new account or an admin reset)", () => {
  const first = async () => json(await doSignIn("firsttime", TEMP_PASSWORD));
  test("signing in with it opens no session: only a change token, AuthController.php:101-103", async () => {
    const body = await first();
    assert.equal(body.data.status, "password_change_required");
    assert.match(body.data.changeToken, /^[0-9a-f-]{36}\.\d+\.first\.[0-9a-f]{64}$/);
    assert.equal(w.data.sessions.length, 0);
  });
  test("the new password must follow the rule and differ from the temporary one (AuthController.php:283-289)", async () => {
    const { data } = await first();
    const change = (newPassword: string, changeToken = data.changeToken) => changePassword(req("POST", "/x", { body: { changeToken, newPassword, device: WEB } }), ctx());
    const weak = await change("short");
    assert.equal((await errorOf(weak)).code, "PASSWORD_TOO_WEAK");
    assert.equal((await errorOf(weak)).message, "Password must be at least 8 characters with an uppercase letter, a lowercase letter, a number and a special character.");
    const same = await errorOf(await change(TEMP_PASSWORD));
    assert.equal(same.code, "PASSWORD_REUSED");
    assert.equal(same.message, "Choose a password different from the temporary one.");
    const ok = await change("Brand#New2026");
    assert.equal((await json(ok)).data.status, "signed_in", "a person who does not need the code is signed in");
    assert.ok(cookieOf(ok));
    const u = w.data.users.find((x) => x.id === w.users.firsttime.id)!;
    assert.deepEqual([u.mustChangePassword, u.status], [false, "active"]);
    assert.ok(u.passwordChangedAt);
    assert.equal((await errorOf(await doSignIn("firsttime", TEMP_PASSWORD))).code, "INVALID_CREDENTIALS", "the temporary one is dead");
    assert.equal(w.mailed(u.id, "password_changed").length, 1);
  });
  test("the token lasts 15 minutes and works once: it is bound to the old password hash", async () => {
    const { data } = await first();
    const change = (changeToken: string) => changePassword(req("POST", "/x", { body: { changeToken, newPassword: "Brand#New2026", device: WEB } }), ctx());
    minutes(16);
    assert.equal((await errorOf(await change(data.changeToken))).code, "CHALLENGE_EXPIRED");
    const fresh = (await first()).data.changeToken;
    assert.equal((await change(fresh)).status, 200);
    assert.equal((await errorOf(await change(fresh))).code, "CHALLENGE_EXPIRED", "used up: the password hash moved on");
  });
  test("a forged token, or one for an account that is not on a temporary password, is refused", async () => {
    const { data } = await first();
    const parts = data.changeToken.split(".");
    for (const changeToken of [`${parts[0]}.${parts[1]}.reset.${parts[3]}`, `${parts[0]}.${parts[1]}.first.${"0".repeat(64)}`, "junk", `${w.users.staff.id}.${parts[1]}.first.${parts[3]}`]) {
      assert.equal((await errorOf(await changePassword(req("POST", "/x", { body: { changeToken, newPassword: "Brand#New2026", device: WEB } }), ctx()))).code, "CHALLENGE_EXPIRED");
    }
  });
  test("an administrator who sets a password is then asked for the emailed code: the code is never skipped for admins", async () => {
    const admin = w.data.users.find((u) => u.id === w.users.anita.id)!;
    admin.mustChangePassword = true;
    admin.passwordHash = w.data.users.find((u) => u.id === w.users.firsttime.id)!.passwordHash;
    const body = await json(await doSignIn("anita", TEMP_PASSWORD));
    const res = await changePassword(req("POST", "/x", { body: { changeToken: body.data.changeToken, newPassword: "Brand#New2026", device: WEB } }), ctx());
    assert.equal((await json(res)).data.status, "code_required");
  });
});

describe("forgot password by an emailed link: the same answer for everyone (HMS #13)", () => {
  const ask = (username: string, ip = "10.0.0.1") => forgot(req("POST", "/api/v1/auth/password/forgot", { body: { username }, ip }), ctx());
  const tokenOf = (userId: string): string => {
    const mail = w.data.outbox.filter((o) => o.userId === userId && o.kind === "reset_link").at(-1)!;
    return new URL(JSON.parse(mail.payload as string).link).searchParams.get("reset")!;
  };
  test("a real account, an unknown name, a disabled account and one with no email all get the SAME answer; only the real one is mailed, with a link", async () => {
    const answers = await Promise.all(["staff", "nobody-at-all", "disabled", "noemail"].map(async (u) => (await json(await ask(u))).data));
    for (const a of answers) {
      assert.deepEqual(Object.keys(a).sort(), ["challengeId", "message", "resendAfterSeconds", "sent", "sentTo"]);
      assert.deepEqual([a.sent, a.message, a.sentTo], [true, "If an account matches, we have sent a link to its email.", "the email on that account"]);
    }
    assert.equal(w.mailed(w.users.staff.id, "reset_link").length, 1);
    assert.equal(w.data.outbox.length, 1, "nobody else was mailed");
    const token = tokenOf(w.users.staff.id);
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(JSON.parse(w.data.outbox[0].payload as string).link.endsWith(`/?reset=${token}`));
    // only the keyed hash is kept, never the token
    assert.equal(w.data.codes.length, 1);
    assert.ok(w.data.codes[0].purpose === "reset_link" && /^[0-9a-f]{64}$/.test(w.data.codes[0].codeHash) && !JSON.stringify(w.data.codes).includes(token));
    assert.ok(!JSON.stringify(answers).includes("demo.hms"), "no address, masked or not");
  });
  test("it takes an email too; a locked account can still ask (resetting is how an owner gets back in)", async () => {
    await wrongPasswords("staff", 5);
    await ask(w.data.users.find((u) => u.id === w.users.staff.id)!.email!);
    assert.equal(w.mailed(w.users.staff.id, "reset_link").length, 1);
  });
  test("throttled: 10 a minute per address; at most 5 links per account in 15 minutes, still the same answer after that", async () => {
    for (let i = 0; i < 10; i++) assert.equal((await ask(`user${i}`, "192.0.2.50")).status, 200);
    assert.equal((await ask("one-more", "192.0.2.50")).status, 429);
    for (let i = 0; i < 7; i++) assert.equal((await ask("staff", `198.51.100.${i}`)).status, 200);
    assert.equal(w.mailed(w.users.staff.id, "reset_link").length, 5, "the sixth and seventh asked, nothing was sent");
  });
});

describe("forgot password, step two: the link and the new password", () => {
  const tokenOf = (userId: string): string => {
    const mail = w.data.outbox.filter((o) => o.userId === userId && o.kind === "reset_link").at(-1)!;
    return new URL(JSON.parse(mail.payload as string).link).searchParams.get("reset")!;
  };
  const start = async (username = "staff") => {
    await forgot(req("POST", "/x", { body: { username } }), ctx());
    return tokenOf(w.users[username as "staff"].id);
  };
  const check = (token: string) => checkLink(req("GET", `/api/v1/auth/password/reset-link/check?token=${encodeURIComponent(token)}`), ctx());
  const reset = (token: string, newPassword = "Brand#New2026", ip = "10.0.0.1") => resetLink(req("POST", "/api/v1/auth/password/reset-link", { body: { token, newPassword }, ip }), ctx());
  test("a good link: check says valid; the new password is set, every session ends, the person is mailed, an audit row; the link is then used up", async () => {
    const { cookie } = await signedIn("staff");
    const token = await start();
    assert.deepEqual((await json(await check(token))).data, { valid: true });
    assert.deepEqual((await json(await reset(token))).data, { done: true });
    assert.equal((await me({ cookie })).status, 401, "the session ended");
    assert.equal((await errorOf(await doSignIn("staff", PASSWORD))).code, "INVALID_CREDENTIALS");
    assert.equal((await json(await doSignIn("staff", "Brand#New2026"))).data.status, "signed_in");
    assert.equal(w.mailed(w.users.staff.id, "password_changed").length, 1);
    assert.ok(w.data.audit.some((a) => a.action === "password.reset_by_link" && a.entityId === w.users.staff.id));
    // single use
    assert.equal((await check(token)).status, 404);
    assert.equal((await reset(token, "Other#New2026")).status, 404);
  });
  test("expired after 15 minutes, a newer link ends the older one, unknown and malformed tokens: all the same 404", async () => {
    const old = await start();
    const newer = await start();
    assert.equal((await check(old)).status, 404, "the newer link ended it");
    minutes(15);
    seconds(1);
    assert.equal((await check(newer)).status, 404, "15 minutes passed");
    assert.equal((await reset(newer)).status, 404);
    for (const bad of ["x".repeat(43), "short", "../../etc"]) assert.equal((await check(bad)).status, 404, bad);
    const bodies = await Promise.all([check(old), check("x".repeat(43))].map(async (p) => (await json(await p)).error.code));
    assert.deepEqual(bodies, ["NOT_FOUND", "NOT_FOUND"]);
  });
  test("the password rules come first (422 newPassword), the same password as now is refused, and a reset keeps an administrator's block", async () => {
    const token = await start();
    const weak = await reset(token, "weak");
    assert.deepEqual([weak.status, Object.keys((await json(weak)).error.details.fields)], [422, ["newPassword"]]);
    assert.equal((await errorOf(await reset(token, PASSWORD))).code, "PASSWORD_REUSED");
    await w.service.blockUser({ userId: w.users.anita.id, hotelId: null }, w.users.staff.id, { traceId: "trace-12345678", ip: null });
    const again = await start();
    assert.equal((await reset(again)).status, 200);
    assert.equal((await errorOf(await doSignIn("staff", "Brand#New2026"))).code, "ACCOUNT_BLOCKED", "the block stays");
  });
  test("a refused password (same as now) leaves the link usable; the 5th refusal uses it up; success is still single use", async () => {
    const token = await start();
    for (let i = 0; i < 4; i++) assert.equal((await errorOf(await reset(token, PASSWORD))).code, "PASSWORD_REUSED", `refusal ${i + 1}`);
    assert.equal((await reset(token)).status, 200, "the link still works after four refusals");
    assert.equal((await reset(token)).status, 404, "and is used up by the success");
  });
  test("five refusals of the same password use the link up", async () => {
    await reset(await start(), "Brand#New2026"); // whatever the account's password was, it is "Brand#New2026" now
    const other = await start();
    for (let i = 0; i < 5; i++) assert.equal((await errorOf(await reset(other, "Brand#New2026"))).code, "PASSWORD_REUSED");
    assert.equal((await reset(other, "Another#New2026")).status, 404, "after five refusals the link is dead");
  });
  test("no token and no password in any log, event or audit row", async () => {
    const token = await start();
    await reset(token);
    const all = JSON.stringify([w.data.events, w.data.audit, w.data.sessions]);
    assert.ok(!all.includes(token) && !all.includes("Brand#New2026"));
  });
});
describe("sessions (MASTER 4.2): one browser session per person, no refresh tokens", () => {
  test("a new web sign-in ends the old one: reason 'replaced', the old cookie is dead, and the trail says so", async () => {
    const one = await signedIn("staff");
    const two = await signedIn("staff");
    assert.notEqual(one.cookie, two.cookie);
    assert.equal((await me({ cookie: one.cookie })).status, 401);
    assert.equal((await me({ cookie: two.cookie })).status, 200);
    assert.equal(w.data.sessions.find((s) => s.revokedAt)?.revokedReason, "replaced");
    assert.ok(w.data.events.some((e) => e.event === "session_replaced"));
  });
  test("a web session ends after 120 idle minutes; real requests extend it; GET /auth/session does NOT", async () => {
    const { cookie, session } = await signedIn("staff");
    assert.equal(session.expiresAt, "2026-10-05T06:30:00.000Z");
    minutes(100);
    const peek = await json(await me({ cookie }));
    assert.equal(peek.data.expiresAt, "2026-10-05T06:30:00.000Z", "reading the session leaves the expiry where it was");
    minutes(21);
    assert.equal((await me({ cookie })).status, 401, "121 minutes after sign-in: ended, because only reads happened");
  });
  test("a real request moves the idle window forward", async () => {
    const { cookie } = await signedIn("staff");
    minutes(100);
    const act = await unlock(req("POST", "/api/v1/auth/unlock", { body: { password: PASSWORD }, cookie: cookie as string }), ctx());
    assert.equal(act.status, 200);
    minutes(100);
    assert.equal((await me({ cookie })).status, 200, "200 minutes after sign-in but only 100 since the last real request");
    assert.equal((await json(await me({ cookie }))).data.expiresAt, "2026-10-05T08:10:00.000Z");
    minutes(121);
    assert.equal((await me({ cookie })).status, 401);
  });
  test("only the session cookie opens a session: a bearer header, a cookie value in the wrong place and malformed values are all 401", async () => {
    const web = await signedIn("staff");
    assert.equal((await me({ bearer: web.cookie })).status, 401, "a cookie value sent as a bearer token");
    for (const bad of ["", "x", "a".repeat(43), "../../etc", "a".repeat(500)]) {
      assert.equal((await me({ cookie: bad })).status, 401);
      assert.equal((await me({ bearer: bad })).status, 401);
    }
  });
  test("a disabled or deleted account loses its session at the very next request", async () => {
    const { cookie } = await signedIn("staff");
    w.data.users.find((u) => u.id === w.users.staff.id)!.status = "disabled";
    assert.equal((await me({ cookie })).status, 401);
    w.data.users.find((u) => u.id === w.users.staff.id)!.status = "active";
    assert.equal((await me({ cookie })).status, 200);
    w.data.users.find((u) => u.id === w.users.staff.id)!.deletedAt = new Date();
    assert.equal((await me({ cookie })).status, 401);
  });
  test("the resolver builds the VerifiedSession from the database: role key and level, effective permissions, scope", async () => {
    const { cookie } = await signedIn("guest");
    const session = await w.resolver.resolveSession(req("GET", "/x", { cookie: cookie as string, origin: null }));
    assert.equal(session?.roleKey, "viewer");
    assert.equal(session?.roleLevel, 1);
    assert.equal(session?.accountRole, "guest_user");
    assert.equal(session?.scope?.kind, "guest");
    assert.equal(session?.hotelId, "11111111-1111-4111-8111-111111111111");
    assert.deepEqual(session?.permissions, {}, "a guest portal account holds no hotel module, whatever its role grants (security-portal-account-can-hold-hotel-grants)");
    const sonal = await asAdmin("sonal");
    const s2 = await w.resolver.resolveSession(req("GET", "/x", { cookie: sonal.cookie as string, origin: null }));
    assert.deepEqual([s2?.roleKey, s2?.roleLevel], ["super_admin", 4]);
  });
  test("sign out ends the session and clears the cookie (Max-Age=0)", async () => {
    const web = await signedIn("staff");
    const out = await signOut(req("POST", "/api/v1/auth/sign-out", { cookie: web.cookie as string }), ctx());
    assert.deepEqual((await json(out)).data, { signedOut: true });
    assert.match(out.headers.getSetCookie().find((c) => c.startsWith(SESSION_COOKIE)) as string, /^__Host-hms_session=; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=0$/);
    assert.equal((await me({ cookie: web.cookie })).status, 401);
    assert.equal(w.data.sessions[0].revokedReason, "logout");
    assert.ok(out.headers.getSetCookie().some((c) => /^__Host-hms_out=; .*Max-Age=0$/.test(c)), "the sign-out mark is cleared too");
  });
  test("the browser's sign-out mark (lib/auth/signOut.ts): the next request that carries it ends the session (logout, one event) and is answered as signed out, not 'session ended'", async () => {
    const web = await signedIn("staff");
    const withMark = (path: string) => req("GET", path, { headers: { cookie: `${SESSION_COOKIE}=${web.cookie}; ${SIGNED_OUT_COOKIE}=1` } });
    // the session was cached by the sign-in's own reads: the mark wins over the cache
    assert.equal((await me({ cookie: web.cookie })).status, 200);
    assert.equal((await getSession(withMark("/api/v1/auth/session"), ctx())).status, 401);
    const row = w.data.sessions.find((s) => s.revokedAt !== null);
    assert.equal(row?.revokedReason, "logout");
    assert.equal(w.data.events.filter((e) => e.event === "logout").length, 1);
    assert.equal((await me({ cookie: web.cookie })).status, 401, "the cookie alone no longer works either");
    assert.equal(await w.resolver.endedReason(withMark("/")), null, "a sign-out on purpose: the plain sign-in page");
    // the background sign-out request itself carries the mark: refused as signed out, the session stays ended, no second event
    assert.equal((await signOut(req("POST", "/api/v1/auth/sign-out", { headers: { cookie: `${SESSION_COOKIE}=${web.cookie}; ${SIGNED_OUT_COOKIE}=1` } }), ctx())).status, 401);
    assert.equal(w.data.events.filter((e) => e.event === "logout").length, 1);
  });
  test("a new sign-in clears an earlier sign-out mark, so the mark never ends the new session", async () => {
    const out = await signIn(req("POST", "/api/v1/auth/sign-in", { body: { username: "staff", password: PASSWORD, device: WEB } }), ctx());
    const set = out.headers.getSetCookie();
    assert.ok(set.some((c) => c.startsWith(`${SESSION_COOKIE}=`) && !c.includes("Max-Age=0")));
    assert.ok(set.some((c) => /^__Host-hms_out=; Path=\/; Secure; SameSite=Lax; Max-Age=0$/.test(c)));
  });
  test("cookie sessions are same-origin only on writes: a cross-site sign-out is refused; a cross-site sign-IN is refused too (login CSRF)", async () => {
    const web = await signedIn("staff");
    assert.equal((await signOut(req("POST", "/x", { cookie: web.cookie as string, origin: "https://evil.example" }), ctx())).status, 403);
    assert.equal((await me({ cookie: web.cookie })).status, 200, "still signed in");
    assert.equal((await signIn(req("POST", "/x", { body: { username: "staff", password: PASSWORD, device: WEB }, origin: "https://evil.example" }), ctx())).status, 403);
  });
  test("no session is 401 SESSION_EXPIRED", async () => {
    assert.equal((await errorOf(await me({}))).code, "SESSION_EXPIRED");
  });
});

describe("the screen-lock password check", () => {
  test("the right password unlocks; a wrong one is INVALID_CREDENTIALS and counts toward the lock, but the session stays", async () => {
    const { cookie } = await signedIn("staff");
    const go = (password: string) => unlock(req("POST", "/x", { body: { password }, cookie: cookie as string }), ctx());
    assert.deepEqual((await json(await go(PASSWORD))).data, { unlocked: true });
    for (let i = 0; i < 4; i++) assert.equal((await errorOf(await go("Wrong#Pass1"))).code, "INVALID_CREDENTIALS");
    assert.equal((await errorOf(await go("Wrong#Pass1"))).code, "ACCOUNT_LOCKED");
    assert.equal((await me({ cookie })).status, 200, "the session itself is not ended");
    assert.equal((await errorOf(await doSignIn("staff"))).code, "ACCOUNT_LOCKED");
  });
  test("it is rate limited per session: 10 a minute", async () => {
    const { cookie } = await signedIn("staff");
    for (let i = 0; i < 10; i++) assert.equal((await unlock(req("POST", "/x", { body: { password: PASSWORD }, cookie: cookie as string }), ctx())).status, 200);
    assert.equal((await unlock(req("POST", "/x", { body: { password: PASSWORD }, cookie: cookie as string }), ctx())).status, 429);
  });
  test("it needs a session", async () => {
    assert.equal((await unlock(req("POST", "/x", { body: { password: PASSWORD } }), ctx())).status, 401);
  });
});

describe("the mail queue: nothing readable, sent by a worker", () => {
  test("the worker decrypts, sends, and removes the payload; the address and code are only ever in the message", async () => {
    await doSignIn("anita");
    const code = w.lastCode(w.users.anita.id, "login_code");
    const sent: { to: string; subject: string; text: string }[] = [];
    const sender: MailSender = { send: async (m) => void sent.push(m) };
    assert.equal(await runOutboxOnce({ unit: w.mem.unit, sender, now: () => w.clock.at }), 1);
    assert.deepEqual([sent[0].to, sent[0].subject], ["anita@demo.hms", "Your Easy Hotel Solutions sign-in code"]);
    assert.ok(sent[0].text.includes(code));
    assert.deepEqual([w.data.outbox[0].status, w.data.outbox[0].payload], ["sent", null], "the code is gone from the database once sent");
    assert.equal(await runOutboxOnce({ unit: w.mem.unit, sender, now: () => w.clock.at }), 0, "nothing is sent twice");
  });
  test("a failing sender is retried later and given up after five tries; the payload goes then too, and no error text is kept", async () => {
    await doSignIn("anita");
    const sender: MailSender = { send: async () => { throw new Error("smtp refused anita@demo.hms"); } };
    for (let i = 0; i < 5; i++) {
      await runOutboxOnce({ unit: w.mem.unit, sender, now: () => w.clock.at });
      minutes(10);
    }
    assert.deepEqual([w.data.outbox[0].status, w.data.outbox[0].attempts, w.data.outbox[0].payload], ["failed", 5, null]);
    assert.ok(!JSON.stringify(w.data).includes("smtp refused"));
  });
  test("the trail holds no secret: no password, code or token appears in the events or the audit rows", async () => {
    await asAdmin("anita");
    await doSignIn("staff", "Wrong#Pass1");
    const dump = JSON.stringify([w.data.events, w.data.audit]);
    assert.ok(!dump.includes(PASSWORD) && !dump.includes("Wrong#Pass1") && !/\b\d{6}\b/.test(dump.replace(/"at":"[^"]+"/g, "")));
  });
});

describe("validation", () => {
  test("empty fields and over-long values are 422 with the field named; unknown keys are refused", async () => {
    for (const body of [{ username: "", password: PASSWORD, device: WEB }, { username: "staff", password: "", device: WEB }, { username: "x".repeat(51), password: PASSWORD, device: WEB }, { username: "staff", password: "x".repeat(129), device: WEB }]) {
      const res = await signIn(req("POST", "/x", { body }), ctx());
      assert.equal(res.status, 422, JSON.stringify(body).slice(0, 60));
    }
  });
  test("the contract's shapes: the sign-in result is one of the three statuses, nothing else leaks", async () => {
    const result = (await json(await doSignIn("staff"))).data as SignInResult;
    assert.deepEqual(Object.keys(result).sort(), ["session", "status"]);
    const user = (result as { session: Session }).session.user as HmsUser;
    assert.deepEqual(Object.keys(user).sort(), ["abilities", "displayName", "email", "grants", "group", "hotel", "id", "role", "username"]);
  });
});

describe("the ONE sign-in page: a username OR an email (MJ, 2026-10-06)", () => {
  test("a staff, an administrator and a guest account sign in by username and by email (any case); an unknown name answers like a wrong password", async () => {
    for (const who of ["staff", "guest"] as const) {
      const byName = await json(await doSignIn(w.users[who].username));
      const byMail = await json(await doSignIn(` ${(w.users[who].email as string).toUpperCase()} `));
      assert.equal(byName.data.status, "signed_in", who);
      assert.equal(byMail.data.status, "signed_in", who);
      assert.equal(byMail.data.session.user.id ?? byMail.data.session.user.username, byName.data.session.user.id ?? byName.data.session.user.username);
    }
    const admin = await json(await doSignIn(w.users.anita.email as string));
    assert.equal(admin.data.status, "code_required", "an administrator still gets the emailed code");
    const unknownMail = await doSignIn("nobody@demo.hms");
    const unknownName = await doSignIn("nobody");
    const wrong = await doSignIn("staff", "Wrong#Pass1");
    assert.deepEqual([unknownMail.status, unknownName.status, wrong.status], [wrong.status, wrong.status, wrong.status]);
    assert.equal((await json(unknownMail)).error.code, (await json(wrong)).error.code);
  });

  test("forgot password also takes an email and answers the same whether or not it exists", async () => {
    const known = await forgot(req("POST", "/api/v1/auth/password/forgot", { body: { username: w.users.staff.email } }));
    const unknown = await forgot(req("POST", "/api/v1/auth/password/forgot", { body: { username: "nobody@demo.hms" } }));
    assert.equal(known.status, 200);
    assert.equal(unknown.status, 200);
    assert.equal(w.mailed(w.users.staff.id, "reset_link").length, 1, "the link was mailed for the email lookup");
  });
});
