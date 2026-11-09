// Decision 55 (R25): the Sign in button of a hotel website opens HMS with `?hotel=<slug>`; the sign-in call carries it as `entryHotel`. It is only a hint: applied when the hotel is
// open, its website is live and the person is linked to it; otherwise ignored and the sign-in is exactly as before. The answer says which hotel with `entryHotelId`.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import { POST as verifyCode } from "../../src/app/api/v1/auth/code/verify/route";
import { POST as signIn } from "../../src/app/api/v1/auth/sign-in/route";
import { configureAuth } from "../../src/server/compose/auth";
import { HOTEL, PASSWORD, WEB, buildWorld, ctx, json, req, type Who, type World } from "./helpers/authWorld";

const HOTEL2 = "22222222-2222-4222-8222-222222222222";
let w: World;

beforeEach(async () => {
  configureAuth(null);
  w = await buildWorld();
  w.data.hotels.push({ id: HOTEL2, name: "Hotel Sunset, Surat", group: null });
  w.data.sites.push({ hotelId: HOTEL2, slug: "hotel-sunset", live: true, domains: ["www.sunset.example"] });
  w.data.sites.push({ hotelId: HOTEL, slug: "hotel-sunrise", live: false, domains: [] });
});

const link = (who: Who) => w.data.memberships.push({ userId: w.users[who].id, hotelId: HOTEL2, roleId: null, status: "active", isDefault: false, subject: null });
const signInWith = (who: Who, entryHotel?: string) => signIn(req("POST", "/api/v1/auth/sign-in", { body: { username: w.users[who].username, password: PASSWORD, device: WEB, ...(entryHotel ? { entryHotel } : {}) } }), ctx());
const lastSessionHotel = (): string | null => w.data.sessions[w.data.sessions.length - 1].hotelId;

describe("sign-in from a hotel website", () => {
  test("a linked person lands in that hotel for this session and the answer names it; their stored default is untouched", async () => {
    link("staff");
    const body = await json(await signInWith("staff", "hotel-sunset"));
    assert.equal(body.data.status, "signed_in");
    assert.equal(body.data.session.entryHotelId, HOTEL2);
    assert.equal(lastSessionHotel(), HOTEL2);
    assert.equal(w.data.memberships.find((m) => m.userId === w.users.staff.id && m.hotelId === HOTEL)?.isDefault, true);
  });

  test("without the hint, or with a hotel the person is not linked to, or one that is unknown or whose website is not live: today's default and no entryHotelId", async () => {
    link("staff");
    for (const [who, slug] of [["staff", undefined], ["firsttime", "hotel-sunset"], ["staff", "no-such-hotel"], ["staff", "hotel-sunrise"]] as const) {
      if (who === "firsttime") continue;
      const body = await json(await signInWith(who, slug));
      assert.equal(body.data.status, "signed_in", String(slug));
      assert.equal(body.data.session.entryHotelId, undefined, String(slug));
      assert.equal(lastSessionHotel(), HOTEL, String(slug));
    }
    const unlinked = await json(await signInWith("guest", "hotel-sunset"));
    assert.equal(unlinked.data.session.entryHotelId, undefined);
    assert.equal(lastSessionHotel(), HOTEL);
  });

  test("a hotel that is not open is ignored (no refusal, no hint)", async () => {
    link("staff");
    w.data.hotels.find((h) => h.id === HOTEL2)!.status = "suspended";
    const body = await json(await signInWith("staff", "hotel-sunset"));
    assert.equal(body.data.session.entryHotelId, undefined);
    assert.equal(lastSessionHotel(), HOTEL);
  });

  test("the code step: the hint travels again with the code and is applied only then", async () => {
    link("anita");
    const first = await json(await signInWith("anita", "hotel-sunset"));
    assert.equal(first.data.status, "code_required");
    const code = w.lastCode(w.users.anita.id, "login_code");
    const verify = (entryHotel?: string) => verifyCode(req("POST", "/api/v1/auth/code/verify", { body: { challengeId: first.data.challengeId, code, ...(entryHotel ? { entryHotel } : {}) } }), ctx());
    const done = await json(await verify("hotel-sunset"));
    assert.equal(done.data.session.entryHotelId, HOTEL2);
    assert.equal(lastSessionHotel(), HOTEL2);
  });

  test("a platform owner has no hotel: the hint is ignored; a malformed slug is a 422", async () => {
    const body = await json(await signInWith("mihir", "hotel-sunset"));
    assert.notEqual(body.data.status, "signed_in_with_hotel");
    assert.equal(body.data.session?.entryHotelId, undefined);
    assert.equal((await signInWith("staff", "Not A Slug!")).status, 422);
  });
});

void randomUUID;