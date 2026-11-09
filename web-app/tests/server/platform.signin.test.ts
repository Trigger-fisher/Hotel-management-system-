// Sign-in refusals for platform-managed accounts (docs/BACKEND.md 14.9): an account waiting for approval, and a hotel that is pending, suspended,
// archived, rejected or deleted. The refusal comes only AFTER the right password (a stranger learns nothing), as ACCOUNT_BLOCKED with details.reason.
// A session that is already open ends when its hotel stops being active. Through the REAL auth routes on the in-memory double.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { POST as signIn } from "../../src/app/api/v1/auth/sign-in/route";
import { GET as getSession } from "../../src/app/api/v1/auth/session/route";
import { HOTEL, PASSWORD, WEB, buildWorld, cookieOf, ctx, json, req, type World } from "./helpers/authWorld";

let w: World;
beforeEach(async () => {
  w = await buildWorld();
});

const doSignIn = (username: string, password = PASSWORD) => signIn(req("POST", "/api/v1/auth/sign-in", { body: { username, password, device: WEB } }), ctx());
const setHotel = (status: string): void => {
  const h = w.data.hotels.find((x) => x.id === HOTEL);
  assert.ok(h);
  h.status = status as never;
};

describe("hotel status blocks sign-in after a correct password", () => {
  const cases: [string, string, string][] = [
    ["pending_approval", "hotel_pending", "Your hotel is waiting for approval."],
    ["onboarding", "hotel_pending", "Your hotel is waiting for approval."],
    ["suspended", "hotel_suspended", "The hotel is suspended."],
    ["archived", "hotel_archived", "The hotel is archived."],
    ["rejected", "hotel_rejected", "The hotel was rejected."],
  ];
  for (const [status, reason, message] of cases) {
    test(`${status} -> ACCOUNT_BLOCKED ${reason}`, async () => {
      setHotel(status);
      const res = await doSignIn("staff");
      assert.equal(res.status, 403);
      const body = await json(res);
      assert.equal(body.error.code, "ACCOUNT_BLOCKED");
      assert.equal(body.error.details.reason, reason);
      assert.equal(body.error.message, message);
      assert.equal(cookieOf(res), null);
      assert.equal(w.data.sessions.length, 0, "no session was opened");
    });
  }

  test("a deleted hotel is a disabled account", async () => {
    setHotel("deleted");
    const body = await json(await doSignIn("staff"));
    assert.equal(body.error.code, "ACCOUNT_DISABLED");
  });

  test("an active hotel signs in", async () => {
    setHotel("active");
    const body = await json(await doSignIn("staff"));
    assert.equal(body.data.status, "signed_in");
  });

  test("a wrong password says the same as for an unknown name, whatever the hotel's status (nothing leaks to a stranger)", async () => {
    setHotel("suspended");
    const wrong = await json(await doSignIn("staff", "Wrong#Pass1"));
    const unknown = await json(await doSignIn("nobody-here", "Wrong#Pass1"));
    assert.equal(wrong.error.code, "INVALID_CREDENTIALS");
    assert.equal(wrong.error.code, unknown.error.code);
    assert.equal(wrong.error.message, unknown.error.message);
    assert.equal(wrong.error.details?.reason, undefined);
  });

  test("the emailed-code step is refused the same way, before a session opens", async () => {
    setHotel("suspended");
    const res = await doSignIn("anita");
    assert.equal(res.status, 403, "an administrator is refused at the password step already");
    assert.equal((await json(res)).error.details.reason, "hotel_suspended");
  });
});

describe("accounts waiting for approval", () => {
  test("a Hotel Admin that waits for its hotel's approval cannot sign in (hotel_pending)", async () => {
    const u = w.data.users.find((x) => x.username === "anita");
    assert.ok(u);
    u.status = "pending_approval";
    const body = await json(await doSignIn("anita"));
    assert.equal(body.error.code, "ACCOUNT_BLOCKED");
    assert.equal(body.error.details.reason, "hotel_pending");
  });

  test("a Group Hotel Admin that waits for its group's approval gets group_pending", async () => {
    const u = w.data.users.find((x) => x.username === "anita");
    assert.ok(u);
    u.status = "pending_approval";
    u.accountRole = "group_hotel_admin";
    assert.equal((await json(await doSignIn("anita"))).error.details.reason, "group_pending");
  });

  test("a disabled account is ACCOUNT_DISABLED with the reason 'disabled'", async () => {
    const body = await json(await doSignIn("disabled"));
    assert.equal(body.error.code, "ACCOUNT_DISABLED");
    assert.equal(body.error.details?.reason, "disabled");
  });
});

describe("platform staff are unaffected by any hotel's status", () => {
  test("the platform owner (no hotel) still reaches the code step while every hotel is suspended", async () => {
    setHotel("suspended");
    const body = await json(await doSignIn("mihir"));
    assert.equal(body.data.status, "code_required");
  });
});

describe("a session already open", () => {
  test("ends when its hotel is suspended, and comes back usable only through a new sign-in after reactivation", async () => {
    const res = await doSignIn("staff");
    const cookie = cookieOf(res);
    assert.ok(cookie);
    const me = () => getSession(req("GET", "/api/v1/auth/session", { cookie: cookie ?? undefined, origin: null }), ctx());
    assert.equal((await me()).status, 200);
    setHotel("suspended");
    assert.equal((await me()).status, 401, "the session ends");
    setHotel("active");
    const fresh = await json(await doSignIn("staff"));
    assert.equal(fresh.data.status, "signed_in");
  });

  test("ends when its account starts waiting for approval", async () => {
    const cookie = cookieOf(await doSignIn("staff"));
    assert.ok(cookie);
    const staff = w.data.users.find((x) => x.username === "staff");
    assert.ok(staff);
    staff.status = "pending_approval";
    assert.equal((await getSession(req("GET", "/api/v1/auth/session", { cookie: cookie ?? undefined, origin: null }), ctx())).status, 401);
  });
});
