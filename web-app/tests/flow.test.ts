// End-to-end-ish tests of the shared sign-in flow (Pallav login, S05) as the web screens drive it:
// the mock PallavAuthApi (ui-shared/auth-pallav/mock.ts) answers, the screen dispatches into pallavAuthReducer
// (ui-shared/auth-pallav/flow.ts) the way useSubmit / the step components do.
// Run with `npm test` (Node's built-in runner; Node strips the TypeScript types).
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { afterEach, describe, test } from "node:test";
import type { ApiResult, DeviceInfo, PallavAuthApi, SignInResult } from "../../common/ui-shared/auth-pallav/types";
import type { PallavAuthEvent, PallavAuthState } from "../../common/ui-shared/auth-pallav/flow";

// ui-shared writes extensionless relative imports (`./validation`) for the bundler. Plain Node
// needs the extension, so retry unresolved relative imports with ".ts". The real files are
// tested; nothing is copied. Type-only imports are erased.
type NextResolve = (specifier: string, context?: unknown) => unknown;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: unknown, next: NextResolve): unknown }): void;
};
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const { pallavAuthReducer, initialPallavAuthState } = await import("../../common/ui-shared/auth-pallav/flow");
const { pallavCopy } = await import("../../common/ui-shared/auth-pallav/copy");
const { createPallavMockAuthApi, PALLAV_DEMO_ACCOUNTS, PALLAV_DEMO_CODE, PALLAV_DEMO_PASSWORD } = await import(
  "../../common/ui-shared/auth-pallav/mock"
);
const { mockSetCodeRequired } = await import("../../common/ui-shared/dashboards/signInCode.mock");
const { newPasswordChecks, normaliseTotp, normaliseUsername, PASSWORD_REGEX, validateNewPassword, validateUsername } = await import(
  "../../common/ui-shared/auth/validation"
);

const device: DeviceInfo = { platform: "web", name: "Chrome on Windows" };
const NOW = Date.UTC(2026, 9, 5, 10, 0, 0);
const newApi = () => createPallavMockAuthApi({ latencyMs: 0, now: () => NOW });

/** A tiny "screen": holds the flow state and applies events like AuthApp's send(). */
function flow(start: PallavAuthState = initialPallavAuthState) {
  let state = start;
  return {
    get state() {
      return state;
    },
    send(e: PallavAuthEvent) {
      state = pallavAuthReducer(state, e);
      return state;
    },
  };
}

function ok<T>(r: ApiResult<T>): T {
  if (!r.ok) assert.fail(`expected ok, got ${r.error.code}`);
  return r.data;
}

function fails<T>(r: ApiResult<T>, code: string) {
  assert.equal(r.ok, false, `expected ${code}, got ok`);
  if (!r.ok) assert.equal(r.error.code, code);
  return r.ok ? undefined : r.error;
}

/** SignInStep + useSubmit: keep the username, call the API, then RESULT / LOCKED / BLOCKED. */
async function submitSignIn(f: ReturnType<typeof flow>, api: PallavAuthApi, username: string, password = PALLAV_DEMO_PASSWORD) {
  const clean = normaliseUsername(username);
  f.send({ type: "USERNAME_CHANGED", username: clean });
  const r = await api.signIn({ username: clean, password, device });
  if (r.ok) f.send({ type: "RESULT", result: r.data, now: NOW });
  else if (r.error.code === "ACCOUNT_LOCKED")
    f.send({ type: "LOCKED", retryAfterSeconds: r.error.details?.retryAfterSeconds ?? 15 * 60, now: NOW });
  else if (r.error.code === "ACCOUNT_BLOCKED") f.send({ type: "BLOCKED" });
  return r;
}

function expectSignedIn(s: PallavAuthState, role: string) {
  assert.equal(s.step, "signedIn");
  assert.ok(s.session, "session set");
  assert.equal(s.session.user.role, role);
  // Everything from the sign-in steps is cleared.
  assert.equal(s.challengeId, null);
  assert.equal(s.changeToken, null);
  assert.equal(s.sentTo, null);
  assert.equal(s.resendAt, null);
  assert.equal(s.problem, null);
}

describe("flow-mock-sign-in-rejects-email (the demo behaves like the real server)", () => {
  test("the demo account's email signs in like its username", async () => {
    const r = ok(await newApi().signIn({ username: "anita@demo.hms", password: PALLAV_DEMO_PASSWORD, device }));
    assert.equal(r.status, "signed_in");
  });
  test("wrong tries count per username, and a running lock holds even against the right password", async () => {
    const api = newApi();
    for (const name of ["staff", "anita", "guest", "corporate"]) fails(await api.signIn({ username: name, password: "Wrong#Pass1", device }), "INVALID_CREDENTIALS");
    fails(await api.signIn({ username: "platform", password: "Wrong#Pass1", device }), "INVALID_CREDENTIALS");
    for (let i = 0; i < 4; i++) fails(await api.signIn({ username: "staff", password: "Wrong#Pass1", device }), i < 3 ? "INVALID_CREDENTIALS" : "ACCOUNT_LOCKED");
    fails(await api.signIn({ username: "staff", password: PALLAV_DEMO_PASSWORD, device }), "ACCOUNT_LOCKED");
    ok(await api.signIn({ username: "anita", password: PALLAV_DEMO_PASSWORD, device }));
  });
});

describe("username rules", () => {
  test("usernames are trimmed and lower-cased; bad ones are named", () => {
    assert.equal(normaliseUsername("  Staff "), "staff");
    assert.equal(validateUsername("  Staff "), null);
    assert.equal(validateUsername("first.time-1_x"), null);
    assert.equal(validateUsername(""), "required");
    assert.equal(validateUsername("   "), "required");
    assert.equal(validateUsername("ab"), "invalid_username");
    assert.equal(validateUsername("a@b.co"), "invalid_username", "an email is not a username");
    assert.equal(validateUsername("98765 43210"), "invalid_username", "a mobile number is not a username");
    assert.equal(validateUsername("has space"), "invalid_username");
  });

  test("the email code accepts spaces and exactly 6 digits", () => {
    assert.equal(normaliseTotp("123456"), "123456");
    assert.equal(normaliseTotp("123 456"), "123456");
    assert.equal(normaliseTotp("12345"), null);
    assert.equal(normaliseTotp("1234567"), null);
    assert.equal(normaliseTotp("12345a"), null);
    // ease-code-paste-tolerance: the code as it is pasted from the email
    assert.equal(normaliseTotp("123456."), "123456");
    assert.equal(normaliseTotp("123-456"), "123456");
    assert.equal(normaliseTotp("Your sign-in code is 123456. It works for 10 minutes."), "123456");
    assert.equal(normaliseTotp("123456 or 654321"), null, "two codes: not guessed");
  });

  test("every demo account is a valid username", () => {
    for (const a of PALLAV_DEMO_ACCOUNTS) assert.equal(validateUsername(a.username), null, a.username);
  });
});

describe("sign in", () => {
  test("staff signs straight in; username kept; web session has no token and a 120-minute window", async () => {
    const f = flow();
    await submitSignIn(f, newApi(), "Staff");
    expectSignedIn(f.state, "hotel_user");
    assert.equal(f.state.username, "staff");
    assert.equal(f.state.session?.client, "web");
    assert.equal(f.state.session?.token, null);
    assert.equal(f.state.session?.expiresAt, new Date(NOW + 120 * 60_000).toISOString());
  });

  test("wrong password and unknown username get the same answer (never reveal which)", async () => {
    const api = newApi();
    const a = fails(await submitSignIn(flow(), api, "staff", "nope"), "INVALID_CREDENTIALS");
    const b = fails(await submitSignIn(flow(), api, "nobody.here", PALLAV_DEMO_PASSWORD), "INVALID_CREDENTIALS");
    assert.equal(a?.code, b?.code);
    assert.deepEqual(a?.details, b?.details);
  });

  test("failed sign-in keeps the step and the username", async () => {
    const f = flow();
    fails(await submitSignIn(f, newApi(), "staff", "nope"), "INVALID_CREDENTIALS");
    assert.equal(f.state.step, "signIn");
    assert.equal(f.state.username, "staff");
  });

  test("5 wrong passwords -> ACCOUNT_LOCKED on the 5th -> locked step with the end time", async () => {
    const f = flow();
    const api = newApi();
    for (let i = 0; i < 4; i++) {
      fails(await submitSignIn(f, api, "staff", "wrong"), "INVALID_CREDENTIALS");
      assert.equal(f.state.step, "signIn");
    }
    const e = fails(await submitSignIn(f, api, "staff", "wrong"), "ACCOUNT_LOCKED");
    assert.equal(e?.details?.retryAfterSeconds, 15 * 60);
    assert.equal(f.state.step, "locked");
    assert.equal(f.state.lockedUntil, new Date(NOW + 15 * 60 * 1000).toISOString());
    assert.equal(f.state.session, null);
  });

  test("a success resets the failure count", async () => {
    const api = newApi();
    const f = flow();
    for (let i = 0; i < 4; i++) await submitSignIn(f, api, "staff", "wrong");
    await submitSignIn(f, api, "staff");
    expectSignedIn(f.state, "hotel_user");
    fails(await submitSignIn(flow(), api, "staff", "wrong"), "INVALID_CREDENTIALS");
    assert.equal(flow().state.step, "signIn");
  });

  test("locked demo user -> locked step; reset password link leads on to forgotPassword", async () => {
    const f = flow();
    const e = fails(await submitSignIn(f, newApi(), "locked"), "ACCOUNT_LOCKED");
    assert.equal(e?.details?.retryAfterSeconds, 900);
    assert.equal(f.state.step, "locked");
    assert.equal(f.state.lockedUntil, "2026-10-05T10:15:00.000Z");
    assert.equal(f.state.username, "locked");
    f.send({ type: "GO", step: "forgotPassword" });
    assert.equal(f.state.step, "forgotPassword");
    assert.equal(f.state.lockedUntil, null);
    assert.equal(f.state.username, "locked");
  });

  test("blocked by an admin -> blocked step (no timer); Back to sign in clears it", async () => {
    const f = flow();
    fails(await submitSignIn(f, newApi(), "blocked"), "ACCOUNT_BLOCKED");
    assert.equal(f.state.step, "blocked");
    assert.equal(f.state.lockedUntil, null);
    assert.equal(f.state.username, "blocked");
    f.send({ type: "GO", step: "signIn" });
    assert.equal(f.state.step, "signIn");
  });

  test("busy and error accounts give RATE_LIMITED / SERVER_ERROR without moving", async () => {
    const f = flow();
    const api = newApi();
    const busy = fails(await submitSignIn(f, api, "busy"), "RATE_LIMITED");
    assert.equal(busy?.details?.retryAfterSeconds, 60);
    fails(await submitSignIn(f, api, "error"), "SERVER_ERROR");
    assert.equal(f.state.step, "signIn");
  });

  test("offline: every call fails with NETWORK_OFFLINE", async () => {
    const api = createPallavMockAuthApi({ latencyMs: 0, offline: () => true });
    fails(await api.signIn({ username: "staff", password: PALLAV_DEMO_PASSWORD, device }), "NETWORK_OFFLINE");
    fails(await api.forgotPassword({ username: "staff" }), "NETWORK_OFFLINE");
  });
});

describe("emailed code (decision 46: the person's own choice, off until they switch it on)", () => {
  // Every test that needs the code switches it on for "anita" first and every test ends with everyone off again.
  const turnedOn: string[] = [];
  const codeOn = (name: string) => {
    mockSetCodeRequired(name, true);
    turnedOn.push(name);
  };
  afterEach(() => {
    for (const n of turnedOn.splice(0)) mockSetCodeRequired(n, false);
  });

  async function toEmailCode(username = "anita") {
    codeOn(username);
    const f = flow();
    const api = newApi();
    await submitSignIn(f, api, username);
    return { f, api };
  }

  test("nobody is asked for a code by default: hotel admin, super admin and group admin sign straight in", async () => {
    for (const [name, role] of [["anita", "hotel_admin"], ["mihir", "super_admin"], ["group", "group_hotel_admin"]] as const) {
      const f = flow();
      await submitSignIn(f, newApi(), name);
      expectSignedIn(f.state, role);
      assert.equal(f.state.username, name);
    }
  });

  test("an admin who switched the code on is asked for it, and the right code signs in: hotel admin, super admin and group admin", async () => {
    for (const [name, role] of [["anita", "hotel_admin"], ["mihir", "super_admin"], ["group", "group_hotel_admin"]] as const) {
      const { f, api } = await toEmailCode(name);
      assert.equal(f.state.step, "emailCode", name);
      assert.equal(f.state.challengeId, "ch2-1");
      assert.equal(f.state.sentTo, "a****@demo.hms");
      assert.equal(f.state.resendAt, NOW + 30_000);
      f.send({ type: "RESULT", result: ok(await api.verifyCode({ challengeId: f.state.challengeId!, code: PALLAV_DEMO_CODE })), now: NOW });
      expectSignedIn(f.state, role);
      assert.equal(f.state.username, name);
    }
  });

  test("a hotel user who has not switched the code on is not asked for it", async () => {
    const f = flow();
    await submitSignIn(f, newApi(), "staff");
    expectSignedIn(f.state, "hotel_user");
  });

  test("code with spaces (123 456) is accepted by the screen's normaliser", async () => {
    const { f, api } = await toEmailCode();
    const clean = normaliseTotp("123 456");
    assert.ok(clean);
    ok(await api.verifyCode({ challengeId: f.state.challengeId!, code: clean }));
  });

  test("wrong code -> INVALID_CODE, still on emailCode", async () => {
    const { f, api } = await toEmailCode();
    fails(await api.verifyCode({ challengeId: f.state.challengeId!, code: "000000" }), "INVALID_CODE");
    assert.equal(f.state.step, "emailCode");
    assert.equal(f.state.sentTo, "a****@demo.hms");
  });

  test("5 wrong codes -> CODE_ATTEMPTS_EXCEEDED -> back to sign in with the reason, username kept", async () => {
    const { f, api } = await toEmailCode();
    for (let i = 0; i < 4; i++) fails(await api.verifyCode({ challengeId: "ch2-1", code: "000000" }), "INVALID_CODE");
    fails(await api.verifyCode({ challengeId: "ch2-1", code: "000000" }), "CODE_ATTEMPTS_EXCEEDED");
    f.send({ type: "CHALLENGE_ENDED", code: "CODE_ATTEMPTS_EXCEEDED" });
    assert.equal(f.state.step, "signIn");
    assert.equal(f.state.problem, "CODE_ATTEMPTS_EXCEEDED");
    assert.equal(f.state.challengeId, null);
    assert.equal(f.state.username, "anita");
    assert.ok(pallavCopy.challengeEnded.CODE_ATTEMPTS_EXCEEDED);
  });

  test("unknown challenge -> CHALLENGE_EXPIRED -> back to sign in with the reason", async () => {
    const { f, api } = await toEmailCode();
    fails(await api.verifyCode({ challengeId: "ch-old", code: PALLAV_DEMO_CODE }), "CHALLENGE_EXPIRED");
    f.send({ type: "CHALLENGE_ENDED", code: "CHALLENGE_EXPIRED" });
    assert.equal(f.state.step, "signIn");
    assert.equal(f.state.problem, "CHALLENGE_EXPIRED");
    assert.equal(f.state.username, "anita");
    assert.ok(pallavCopy.challengeEnded.CHALLENGE_EXPIRED);
  });

  test("Send a new code: the countdown restarts and the step stays", async () => {
    const { f, api } = await toEmailCode();
    const later = NOW + 40_000;
    const r = ok(await api.resendCode(f.state.challengeId!));
    f.send({ type: "CODE_RESENT", sentTo: r.maskedEmail, resendAfterSeconds: r.resendAfterSeconds, now: later });
    assert.equal(f.state.step, "emailCode");
    assert.equal(f.state.resendAt, later + 30_000);
    assert.equal(f.state.challengeId, "ch2-1");
    fails(await api.resendCode("ch-old"), "CHALLENGE_EXPIRED");
  });

  test("Sign in with a different account: GO signIn keeps the username, drops the challenge", async () => {
    const { f } = await toEmailCode();
    f.send({ type: "GO", step: "signIn" });
    assert.deepEqual(f.state, { ...initialPallavAuthState, username: "anita" });
  });
});

describe("forced password change (temporary password)", () => {
  test("firsttime -> changePassword: reused rejected, weak rejected, a new valid one accepted -> signedIn", async () => {
    const f = flow();
    const api = newApi();
    await submitSignIn(f, api, "firsttime");
    assert.equal(f.state.step, "changePassword");
    assert.equal(f.state.changeToken, "chg2-1");

    // The temporary password passes the client rules; only the server knows it is reused.
    assert.equal(validateNewPassword(PALLAV_DEMO_PASSWORD, PALLAV_DEMO_PASSWORD, [f.state.username]).password, null);
    fails(await api.changePassword({ changeToken: f.state.changeToken!, newPassword: PALLAV_DEMO_PASSWORD, device }), "PASSWORD_REUSED");
    fails(await api.changePassword({ changeToken: f.state.changeToken!, newPassword: "MyPassword#1", device }), "PASSWORD_TOO_WEAK");
    assert.equal(f.state.step, "changePassword");

    const fresh = "Fresh#Start2026";
    assert.deepEqual(validateNewPassword(fresh, fresh, [f.state.username]), { password: null, confirm: null });
    const r = await api.changePassword({ changeToken: f.state.changeToken!, newPassword: fresh, device });
    f.send({ type: "RESULT", result: ok(r), now: NOW });
    expectSignedIn(f.state, "hotel_user");
  });

  test("the username cannot be the password", () => {
    assert.notEqual(validateNewPassword("Firsttime#2026", "Firsttime#2026", ["firsttime"]).password, null);
  });

  test("a stale change token -> CHALLENGE_EXPIRED", async () => {
    fails(await newApi().changePassword({ changeToken: "chg-old", newPassword: "Fresh#Start2026", device }), "CHALLENGE_EXPIRED");
  });
});

describe("forgot and reset password", () => {
  test("same answer whether or not the username exists (MJ #13)", async () => {
    const api = newApi();
    const known = ok(await api.forgotPassword({ username: "anita" }));
    const unknown = ok(await api.forgotPassword({ username: "nobody.at.all" }));
    assert.deepEqual(known, unknown);
    assert.equal(known.resendAfterSeconds, 30);
  });

  test("username -> code and new password -> resetDone -> back to sign in", async () => {
    const api = newApi();
    const f = flow({ ...initialPallavAuthState, username: "anita" });
    f.send({ type: "GO", step: "forgotPassword" });
    assert.equal(f.state.step, "forgotPassword");
    assert.equal(f.state.username, "anita");

    const r = ok(await api.forgotPassword({ username: "anita" }));
    f.send({ type: "FORGOT_SENT", challengeId: r.challengeId, sentTo: r.sentTo, resendAfterSeconds: r.resendAfterSeconds, now: NOW });
    assert.equal(f.state.step, "resetPassword");
    assert.equal(f.state.challengeId, "rst2-1");
    assert.equal(f.state.resendAt, NOW + 30_000);

    fails(await api.resetPassword({ challengeId: "rst2-1", code: "000000", newPassword: "Fresh#Start2026" }), "INVALID_CODE");
    fails(await api.resetPassword({ challengeId: "rst2-1", code: PALLAV_DEMO_CODE, newPassword: "MyPassword#1" }), "PASSWORD_TOO_WEAK");
    assert.equal(f.state.step, "resetPassword");
    ok(await api.resetPassword({ challengeId: f.state.challengeId!, code: PALLAV_DEMO_CODE, newPassword: "Fresh#Start2026" }));
    f.send({ type: "RESET_DONE" });
    assert.equal(f.state.step, "resetDone");
    assert.equal(f.state.challengeId, null, "challenge dropped after use");

    f.send({ type: "GO", step: "signIn" });
    assert.deepEqual(f.state, { ...initialPallavAuthState, username: "anita" });
  });

  test("an old reset challenge -> CHALLENGE_EXPIRED", async () => {
    fails(await newApi().resetPassword({ challengeId: "rst-old", code: PALLAV_DEMO_CODE, newPassword: "Fresh#Start2026" }), "CHALLENGE_EXPIRED");
  });

  test("Send a new code on the reset step restarts the countdown", async () => {
    const api = newApi();
    const f = flow();
    f.send({ type: "FORGOT_SENT", challengeId: "rst2-1", sentTo: "the email on that account", resendAfterSeconds: 30, now: NOW });
    const later = NOW + 31_000;
    const r = ok(await api.resendResetCode("rst2-1"));
    f.send({ type: "CODE_RESENT", sentTo: r.maskedEmail, resendAfterSeconds: r.resendAfterSeconds, now: later });
    assert.equal(f.state.step, "resetPassword");
    assert.equal(f.state.resendAt, later + 30_000);
  });
});

describe("session, screen lock, sign out", () => {
  async function signedIn() {
    const f = flow();
    const api = newApi();
    await submitSignIn(f, api, "staff");
    return { f, api };
  }

  test("SCREEN_LOCK without a session does nothing (same state object)", () => {
    for (const step of ["signIn", "forgotPassword", "locked", "blocked"] as const) {
      const s: PallavAuthState = { ...initialPallavAuthState, step };
      assert.equal(pallavAuthReducer(s, { type: "SCREEN_LOCK" }), s);
      assert.equal(pallavAuthReducer(s, { type: "SCREEN_UNLOCKED" }), s);
    }
  });

  test("SCREEN_LOCK with a session -> screenLocked; unlock with the password -> signedIn", async () => {
    const { f, api } = await signedIn();
    const session = f.state.session;
    f.send({ type: "SCREEN_LOCK" });
    assert.equal(f.state.step, "screenLocked");
    assert.equal(f.state.session, session, "session kept while locked");
    fails(await api.unlockScreen({ password: "wrong" }), "INVALID_CREDENTIALS");
    ok(await api.unlockScreen({ password: PALLAV_DEMO_PASSWORD }));
    f.send({ type: "SCREEN_UNLOCKED" });
    assert.equal(f.state.step, "signedIn");
  });

  test("SIGNED_OUT keeps the username and clears everything else", async () => {
    const { f, api } = await signedIn();
    ok(await api.signOut());
    f.send({ type: "SIGNED_OUT" });
    assert.deepEqual(f.state, { ...initialPallavAuthState, username: "staff" });
    fails(await api.getSession(), "SESSION_EXPIRED");
    fails(await api.unlockScreen({ password: PALLAV_DEMO_PASSWORD }), "SESSION_EXPIRED");
  });

  test("SESSION_ENDED keeps the username and the reason (replaced, revoked, expired)", async () => {
    for (const code of ["SESSION_REPLACED", "SESSION_REVOKED", "SESSION_EXPIRED"] as const) {
      const { f } = await signedIn();
      f.send({ type: "SESSION_ENDED", code });
      assert.deepEqual(f.state, { ...initialPallavAuthState, username: "staff", step: "sessionEnded", problem: code });
    }
    assert.ok(pallavCopy.sessionRevoked.title);
  });

  test("getSession returns the live session after sign-in", async () => {
    const { f, api } = await signedIn();
    assert.deepEqual(ok(await api.getSession()), f.state.session);
  });
});

describe("reducer details", () => {
  test("GO clears a previous problem", () => {
    const s: PallavAuthState = { ...initialPallavAuthState, step: "sessionEnded", problem: "SESSION_REVOKED" };
    assert.equal(pallavAuthReducer(s, { type: "GO", step: "signIn" }).problem, null);
  });

  test("USERNAME_CHANGED never changes the step", () => {
    const s: PallavAuthState = { ...initialPallavAuthState, step: "forgotPassword" };
    const next = pallavAuthReducer(s, { type: "USERNAME_CHANGED", username: "anita" });
    assert.equal(next.step, "forgotPassword");
    assert.equal(next.username, "anita");
  });

  test("every SignInResult maps to its step and clears a problem", () => {
    const results: [SignInResult, PallavAuthState["step"]][] = [
      [{ status: "code_required", challengeId: "c", maskedEmail: "m", resendAfterSeconds: 30 }, "emailCode"],
      [{ status: "password_change_required", changeToken: "p" }, "changePassword"],
    ];
    for (const [result, step] of results) {
      const next = pallavAuthReducer({ ...initialPallavAuthState, problem: "UNKNOWN" }, { type: "RESULT", result, now: NOW });
      assert.equal(next.step, step);
      assert.equal(next.problem, null);
    }
  });

  test("LOCKED and BLOCKED start clean: no session, challenge or code left behind", async () => {
    const f = flow();
    await submitSignIn(f, newApi(), "staff");
    f.send({ type: "LOCKED", retryAfterSeconds: 60, now: NOW });
    assert.equal(f.state.session, null);
    assert.equal(f.state.step, "locked");
    const g = flow({ ...initialPallavAuthState, step: "emailCode", username: "anita", challengeId: "c", sentTo: "x", resendAt: 1 });
    g.send({ type: "BLOCKED" });
    assert.deepEqual(g.state, { ...initialPallavAuthState, username: "anita", step: "blocked" });
  });

  test("the API has only the Pallav calls (no authenticator, recovery code, invite or email-link calls)", () => {
    // The mock also has three demo-only calls (local demo build: Quick login, guest register); the real API (lib/auth/httpApi.ts) must not.
    const mockOnly = ["quickSignIn", "registerGuest", "setRegisteredPassword"];
    assert.deepEqual(Object.keys(newApi()).filter((k) => !mockOnly.includes(k)).sort(), [
      "changePassword", "forgotPassword", "getSession", "resendCode", "resendResetCode", "resetPassword", "signIn", "signOut", "unlockScreen", "verifyCode",
    ]);
    assert.deepEqual(Object.keys(newApi()).filter((k) => mockOnly.includes(k)).sort(), mockOnly);
  });
});

describe("password rules", () => {
  test("newPasswordChecks returns the 7 checks in order", () => {
    const checks = newPasswordChecks("");
    assert.deepEqual(
      checks.map((c) => c.id),
      ["length", "uppercase", "lowercase", "number", "special", "not_identifier", "no_invisible"],
    );
    assert.ok(checks.every((c) => !c.ok), "nothing is met for an empty password");
    assert.ok(newPasswordChecks("Fresh#Start2026", ["mihir@demo.hms"]).every((c) => c.ok));
  });

  test("each check flips on its own rule", () => {
    const failing = (pw: string, avoid: string[] = []) =>
      newPasswordChecks(pw, avoid).filter((c) => !c.ok).map((c) => c.id);
    assert.deepEqual(failing("Ab1!"), ["length"]);
    assert.deepEqual(failing("fresh#start2026"), ["uppercase"]);
    assert.deepEqual(failing("FRESH#START2026"), ["lowercase"]);
    assert.deepEqual(failing("Fresh#Start"), ["number"]);
    assert.deepEqual(failing("FreshStart2026"), ["special"]);
    assert.deepEqual(failing("Fresh Start2026"), ["special", "no_invisible"], "a space is not a special character and is not allowed");
    assert.deepEqual(failing("Fresh₹Start2026"), ["special"], "only the server's ASCII specials count");
    assert.deepEqual(failing("Mihir#2026x", ["mihir@demo.hms"]), ["not_identifier"]);
    assert.deepEqual(failing("Ab#1defg", ["ab"]), [], "identifiers shorter than 3 are not checked");
    assert.deepEqual(failing("Fresh#St​art2026"), ["no_invisible"]);
    assert.deepEqual(failing("A".repeat(127) + "a1!"), ["length"], "130 characters is too long");
  });

  test("validateNewPassword: field errors", () => {
    const v = (pw: string, confirm = pw, avoid: string[] = []) => validateNewPassword(pw, confirm, avoid);
    assert.deepEqual(v("", ""), { password: "required", confirm: "required" });
    assert.equal(v("Ab1!").password, "too_short");
    assert.equal(v("Aa1!".repeat(33)).password, "too_long");
    assert.equal(v("fresh#start2026").password, "password_rules");
    assert.equal(v("FRESH#START2026").password, "password_rules");
    assert.equal(v("Fresh#Start").password, "password_rules");
    assert.equal(v("FreshStart2026").password, "password_rules");
    assert.equal(v("Mihir#2026x", "Mihir#2026x", ["mihir"]).password, "password_rules");
    assert.equal(v("Fresh#St​art2026").password, "password_rules");
    assert.deepEqual(v("Fresh#Start2026", "Fresh#Start2025"), { password: null, confirm: "mismatch" });
    assert.deepEqual(v("Fresh#Start2026", ""), { password: null, confirm: "required" });
    assert.deepEqual(v("Fresh#Start2026"), { password: null, confirm: null });
    assert.deepEqual(v("Aa1!Aa1!"), { password: null, confirm: null }, "exactly 8 is enough");
    assert.deepEqual(v("Aa1!".repeat(32)), { password: null, confirm: null }, "exactly 128 is allowed");
  });

  test("validateNewPassword never accepts what PASSWORD_REGEX rejects", () => {
    const samples = [
      "", "a", "Ab1!", "Aa1!Aa1!", "aaaaaaaa", "AAAAAAAA", "12345678", "!!!!!!!!", "Aaaaaaa1", "Aaaaaaa!",
      "aaaaaa1!", "AAAAAA1!", "Fresh Start 2026", "Fresh#Start2026", "Ünïcödé#1A", "Aa1!".repeat(32),
      "Aa1!".repeat(32) + "x", "Tab\tTab1!", "Line\nBreak1!", PALLAV_DEMO_PASSWORD,
    ];
    for (const pw of samples) {
      if (validateNewPassword(pw, pw).password === null) {
        assert.ok(PASSWORD_REGEX.test(pw), `accepted but regex rejects: ${JSON.stringify(pw)}`);
      }
      if (!PASSWORD_REGEX.test(pw)) {
        assert.notEqual(validateNewPassword(pw, pw).password, null, `regex rejects but accepted: ${JSON.stringify(pw)}`);
      }
    }
  });
});
