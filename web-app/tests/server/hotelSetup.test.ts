// "Set up your hotel": the checklist of a hotel that came through approval (platform.hotel_setup), through the REAL route files, the session answer and the
// in-memory platform data. The row is made by the approval (platform.onboarding.test.ts); here it is put in place by hand.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import type { Session } from "@shared/auth-pallav/types";
import { GET as getSession } from "../../src/app/api/v1/auth/session/route";
import { POST as signIn } from "../../src/app/api/v1/auth/sign-in/route";
import { POST as verifyCode } from "../../src/app/api/v1/auth/code/verify/route";
import { GET as getSetup, PUT as putSetup } from "../../src/app/api/v1/profile/hotel-setup/route";
import { configureAuth } from "../../src/server/compose/auth";
import { HOTEL, PASSWORD, WEB, buildWorld, cookieOf, ctx, json, req, type World } from "./helpers/authWorld";

let w: World;
beforeEach(async () => {
  configureAuth(null);
  w = await buildWorld();
});

const ids = ["security", "profile", "rooms", "rates", "policies", "staff", "test"] as const;
const steps = (value: string): Record<string, string> => Object.fromEntries([...ids.map((k) => [k, value]), ["live", "todo"]]);
const adminCookie = async (): Promise<{ cookie: string; session: Session }> => {
  const first = await json(await signIn(req("POST", "/api/v1/auth/sign-in", { body: { username: "anita", password: PASSWORD, device: WEB } }), ctx()));
  const res = await verifyCode(req("POST", "/api/v1/auth/code/verify", { body: { challengeId: first.data.challengeId, code: w.lastCode(w.users.anita.id, "login_code") } }), ctx());
  return { cookie: cookieOf(res) as string, session: (await json(res)).data.session };
};
const staffCookie = async (): Promise<string> => cookieOf(await signIn(req("POST", "/api/v1/auth/sign-in", { body: { username: "staff", password: PASSWORD, device: WEB } }), ctx())) as string;
const put = (cookie: string | null, body: unknown) => putSetup(req("PUT", "/api/v1/profile/hotel-setup", { cookie: cookie ?? undefined, body }), ctx());
const get = (cookie: string | null) => getSetup(req("GET", "/api/v1/profile/hotel-setup", { cookie: cookie ?? undefined, origin: null }), ctx());
const me = async (cookie: string) => (await json(await getSession(req("GET", "/api/v1/auth/session", { cookie, origin: null }), ctx()))).data.user;
const withRow = (): void => void w.data.hotelSetup.push({ hotelId: HOTEL, status: "pending", steps: {}, hidden: false, doneAt: null });

describe("the checklist flag in the session and the routes", () => {
  test("a hotel without a checklist (made before, or by the CLI) shows nothing; the answers say it does not apply", async () => {
    const { cookie, session } = await adminCookie();
    assert.equal((session.user.hotel as { setup?: unknown }).setup, undefined);
    assert.deepEqual((await json(await get(cookie))).data, { applies: false, steps: {}, hidden: false, finished: false });
    assert.equal((await put(cookie, { steps: steps("done"), hidden: false, finished: false })).status, 404);
  });

  test("a new hotel's Hotel Admin sees the flag at sign-in and in /auth/session; staff of the same hotel never do", async () => {
    withRow();
    const { cookie, session } = await adminCookie();
    assert.deepEqual((session.user.hotel as { setup?: unknown }).setup, { applies: true });
    assert.deepEqual(((await me(cookie)).hotel as { setup?: unknown }).setup, { applies: true });
    const staff = await staffCookie();
    assert.equal(((await me(staff)).hotel as { setup?: unknown }).setup, undefined);
    assert.deepEqual((await json(await get(staff))).data, { applies: false, steps: {}, hidden: false, finished: false });
    assert.equal((await put(staff, { steps: steps("todo"), hidden: false, finished: false })).status, 403);
  });

  test("progress is saved as the screen holds it (steps, Skip for now); a reload reads it back", async () => {
    withRow();
    const { cookie } = await adminCookie();
    const body = { steps: { ...steps("todo"), security: "done", profile: "visited" }, hidden: true, finished: false };
    const saved = await json(await put(cookie, body));
    assert.deepEqual(saved.data, { applies: true, steps: body.steps, hidden: true, finished: false });
    assert.equal(w.data.hotelSetup[0].status, "in_progress");
    assert.deepEqual((await json(await get(cookie))).data, saved.data);
  });

  test("Go live needs every other step done or skipped; then it is final, audited, and the flag is gone for good", async () => {
    withRow();
    const { cookie } = await adminCookie();
    const early = await put(cookie, { steps: { ...steps("done"), staff: "todo" }, hidden: false, finished: true });
    assert.deepEqual([early.status, (await json(early)).error.message], [409, "Finish or skip every step before going live."]);
    assert.equal(w.data.hotelSetup[0].status, "pending", "nothing was saved by the refusal");
    const mixed = { ...steps("done"), staff: "skipped", live: "done" };
    const done = await put(cookie, { steps: mixed, hidden: true, finished: true });
    assert.equal(done.status, 200, JSON.stringify(await json(done)));
    assert.deepEqual((await json(done)).data, { applies: false, steps: mixed, hidden: true, finished: true });
    assert.equal(w.data.hotelSetup[0].doneAt?.getTime(), w.clock.at.getTime());
    const audit = w.data.audit.filter((a) => a.action === "hotel_setup.done");
    assert.deepEqual(audit.map((a) => [a.actorUserId, a.hotelId, a.entityId]), [[w.users.anita.id, HOTEL, HOTEL]]);
    assert.equal(((await me(cookie)).hotel as { setup?: unknown }).setup, undefined);
    assert.equal((await put(cookie, { steps: steps("done"), hidden: false, finished: false })).status, 409, "a finished checklist is not reopened");
  });

  test("a checklist where everything was skipped is recorded as skipped (audited as such)", async () => {
    withRow();
    const { cookie } = await adminCookie();
    assert.equal((await put(cookie, { steps: { ...steps("skipped"), live: "done" }, hidden: true, finished: true })).status, 200);
    assert.equal(w.data.hotelSetup[0].status, "skipped");
    assert.equal(w.data.audit.filter((a) => a.action === "hotel_setup.skipped").length, 1);
  });

  test("bad input is 422 (unknown state, odd step key, too many steps, an extra field); no session is 401", async () => {
    withRow();
    const { cookie } = await adminCookie();
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`step_${i}`, "todo"]));
    for (const bad of [
      { steps: { security: "maybe" }, hidden: false, finished: false },
      { steps: { "Bad Key": "todo" }, hidden: false, finished: false },
      { steps: many, hidden: false, finished: false },
      { steps: {}, hidden: false, finished: false, status: "done" },
      { steps: {}, hidden: "no", finished: false },
    ]) assert.equal((await put(cookie, bad)).status, 422, JSON.stringify(bad).slice(0, 60));
    assert.equal((await get(null)).status, 401);
    assert.equal((await put(null, { steps: {}, hidden: false, finished: false })).status, 401);
  });
});
