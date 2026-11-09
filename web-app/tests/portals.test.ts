// Decisions 46 to 54 on the client: the portal "not set up" page, the hotel selector, the guest portal rules (order hours, restaurant hours),
// the mock of the restaurant hours, the Pathik Submit setting, and the code box's input rule (the auto-submit fires on exactly
// six digits). Run with `node --test tests/*.test.ts`.
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { describe, test } from "node:test";

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

const { portalNotSetUp, portalCopy } = await import("../../common/ui-shared/dashboards/portalState");
const { portalHotelStore, hotelParam, PORTAL_ALL_HOTELS } = await import("../../common/ui-shared/dashboards/portalHotel");
const gp = await import("../../common/ui-shared/dashboards/guestPortal");
const { createGuestPortalMock, createRestaurantMock } = await import("../../common/ui-shared/dashboards/guestPortal.mock");
const { createGuestAccountMock } = await import("../../common/ui-shared/dashboards/guestAccount.mock");
const { normaliseTotp } = await import("../../common/ui-shared/auth/validation");
const { personsText } = await import("../../common/ui-shared/dashboards/guest");

const err = (code: string, extra: Record<string, unknown> = {}) => ({ code, message: code, traceId: "t", ...extra }) as never;

describe("portal not set up (409 PORTAL_NOT_LINKED / PORTAL_INACTIVE)", () => {
  test("the server's own code and the CONFLICT + serverCode shape both give the friendly page", () => {
    const a = portalNotSetUp(err("PORTAL_NOT_LINKED", { details: { fields: { portal: "company" } } }));
    assert.equal(a?.portal, "company");
    assert.equal(a?.inactive, false);
    assert.equal(a?.message, portalCopy.fallback.company);
    const b = portalNotSetUp(err("CONFLICT", { details: { serverCode: "PORTAL_INACTIVE" } }));
    assert.equal(b?.inactive, true);
    assert.equal(b?.message, portalCopy.fallback.inactive);
  });
  test("the server's own sentence wins over the fallback, and other errors are not a 'not set up' page", () => {
    assert.equal(portalNotSetUp(err("PORTAL_NOT_LINKED", { message: "Ask the front desk to link you." }))?.message, "Ask the front desk to link you.");
    assert.equal(portalNotSetUp(err("SERVER_ERROR")), null);
    assert.equal(portalNotSetUp(err("CONFLICT", { details: { serverCode: "SOMETHING_ELSE" } })), null);
  });
});

describe("hotel selector store", () => {
  test("'all' sends no ?hotel=, a hotel id sends it, and listeners hear a change once", () => {
    portalHotelStore.reset();
    assert.equal(portalHotelStore.get(), PORTAL_ALL_HOTELS);
    assert.equal(hotelParam(), undefined);
    let heard = 0;
    const off = portalHotelStore.subscribe(() => heard++);
    portalHotelStore.set("h-2");
    portalHotelStore.set("h-2");
    assert.equal(hotelParam(), "h-2");
    assert.equal(heard, 1);
    portalHotelStore.reset();
    assert.equal(hotelParam(), undefined);
    assert.equal(heard, 2);
    off();
  });
});

describe("guest portal rules", () => {
  test("restaurant hours: a closed day, a reversed span and a bad time are refused field by field", () => {
    const h = gp.allDayHours();
    assert.deepEqual(gp.validateHours(h), {});
    h.days[1] = { day: 1, closed: false, opens: "10:00", closes: "09:00" };
    h.days[2] = { day: 2, closed: false, opens: "7am", closes: "20:00" };
    h.days[3] = { day: 3, closed: true, opens: "00:00", closes: "00:00" };
    const e = gp.validateHours(h);
    assert.ok(e.day1 && e.day2);
    assert.equal(e.day3, undefined);
  });
  test("day numbers start on Monday and the schedule picker follows the hours of that weekday", () => {
    assert.equal(gp.dayOfDate("2026-10-12"), 0); // a Monday
    assert.equal(gp.dayOfDate("2026-10-18"), 6);
    const days = gp.allDayHours().days.map((d) => ({ ...d, opens: "07:00", closes: "23:00" }));
    days[6] = { day: 6, closed: true, opens: "00:00", closes: "00:00" };
    assert.equal(gp.insideHours(days, "2026-10-12", "08:00"), true);
    assert.equal(gp.insideHours(days, "2026-10-12", "06:59"), false);
    assert.equal(gp.insideHours(days, "2026-10-18", "12:00"), false);
  });
  test("the open/closed line says what is true", () => {
    const days = gp.allDayHours().days.map((d) => ({ ...d, opens: "07:00", closes: "23:00" }));
    const info = (accepting: boolean, openNow: boolean) => ({ staying: true, stay: null, hours: { accepting, openNow, days } });
    assert.match(gp.hoursLine(info(true, true), "2026-10-12"), /^Open now/);
    assert.match(gp.hoursLine(info(true, false), "2026-10-12"), /^Closed now/);
    assert.match(gp.hoursLine(info(false, false), "2026-10-12"), /not taking orders/);
    assert.equal(gp.clockText("07:00"), "7:00 am");
    assert.equal(gp.clockText("23:30"), "11:30 pm");
    assert.equal(gp.clockText("12:00"), "12:00 pm");
  });
  test("persons on a bill read as people", () => {
    assert.equal(personsText({ adults: 2, children: 1, names: [] }), "2 adults, 1 child");
    assert.equal(personsText({ adults: 1, children: 0, names: [] }), "1 adult");
  });
});

describe("guest portal mock", () => {
  const api = () => createGuestPortalMock({ staying: true }, { latencyMs: 0 });
  test("a guest who is not staying: order info says so (one hotel chosen)", async () => {
    portalHotelStore.set("h-1");
    const a = createGuestPortalMock({ staying: false }, { latencyMs: 0 });
    const info = await a.getOrderInfo();
    assert.ok(info.ok && info.data.all === false && info.data.staying === false && info.data.stay === null);
    portalHotelStore.set(PORTAL_ALL_HOTELS);
  });
  test("order info, the server's shapes: one hotel -> the app bar's hotel, room and guest; all hotels -> each hotel with in house", async () => {
    portalHotelStore.set("h-1");
    const one = await api().getOrderInfo();
    assert.ok(one.ok && one.data.all === false && one.data.hotelName === "Hotel Sunrise, Rajkot" && one.data.roomNumber === "204" && one.data.guestName === "Amit Joshi");
    portalHotelStore.set(PORTAL_ALL_HOTELS);
    const all = await api().getOrderInfo();
    assert.ok(all.ok && all.data.all === true);
    if (all.ok && all.data.all === true) assert.deepEqual(all.data.hotels.map((h) => [h.hotelId, h.inHouse, h.roomNumber]), [["h-1", true, "204"], ["h-2", false, null]]);
  });
  test("the sign-in history mock: the guest's own, newest first, a failed attempt counted", async () => {
    const list = await createGuestAccountMock({ latencyMs: 0 }).signIns({ pageSize: 10 });
    assert.ok(list.ok && list.data.items.length === 4 && list.data.totals.failed === 1 && list.data.items[0].at > list.data.items[1].at);
  });
  test("the sign-in code card: turning it off needs the password", async () => {
    const a = api();
    assert.ok((await a.setSignInCode(true)).ok);
    const off = await a.setSignInCode(false);
    assert.ok(!off.ok && off.error.details?.fields?.password);
    const done = await a.setSignInCode(false, "secret");
    assert.ok(done.ok && done.data.signInCodeOn === false);
  });
});

describe("restaurant hours mock", () => {
  test("hours saved by the hotel admin are what the guest page reads", async () => {
    const shared = { hours: gp.allDayHours() };
    const admin = createRestaurantMock({ latencyMs: 0 }, shared);
    const guest = createGuestPortalMock({ staying: true, hours: shared }, { latencyMs: 0 });
    const h = await admin.getHours();
    assert.ok(h.ok);
    const next = { ...h.data, accepting: false };
    assert.ok((await admin.saveHours(next)).ok);
    portalHotelStore.set("h-1");
    const info = await guest.getOrderInfo();
    portalHotelStore.set(PORTAL_ALL_HOTELS);
    assert.ok(info.ok && info.data.all === false && info.data.hours.accepting === false && info.data.hours.openNow === false);
  });
});

describe("the code box (auto-submit at six digits)", () => {
  test("six digits, pasted or typed, with or without a space, are a code; anything shorter is not yet", () => {
    assert.equal(normaliseTotp("123456"), "123456");
    assert.equal(normaliseTotp("123 456"), "123456");
    assert.equal(normaliseTotp("12345"), null);
    assert.equal(normaliseTotp(""), null);
    assert.equal(normaliseTotp("12345a"), null);
  });
});
