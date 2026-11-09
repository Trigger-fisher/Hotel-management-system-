// Decision 71, Room service: the menu read sends the hotel (the route reads ?hotel=), the page's pure rules (order or only browse, the status line, when the
// kitchen opens next, the days an order can be scheduled for) and the mock outside a stay (menu kept, no stay: read only; an order is refused).
// Run with `node --test tests/guest.order.test.ts` (Node's built-in runner; Node strips the TypeScript types).
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { afterEach, beforeEach, describe, test } from "node:test";

type NextResolve = (specifier: string, context?: unknown) => unknown;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: unknown, next: NextResolve): unknown }): void;
};
const shared = new URL("../../common/ui-shared/", import.meta.url);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@shared/")) return next(new URL(`${specifier.slice("@shared/".length)}.ts`, shared).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const rules = await import("../../common/ui-shared/dashboards/guestCopy/order");
const { createGuestApi } = await import("../../common/ui-shared/dashboards/guest.mock");
const { portalHotelStore, PORTAL_ALL_HOTELS } = await import("../../common/ui-shared/dashboards/portalHotel");
const { createHttpGuestApi } = await import("../src/lib/api/adapters/guest");
const { clearGetCache } = await import("../src/lib/api/getCache");
type RestaurantDay = import("../../common/ui-shared/dashboards/guestPortal").RestaurantDay;

describe("the menu read", () => {
  const realFetch = globalThis.fetch;
  let urls: string[] = [];
  beforeEach(() => {
    clearGetCache();
    urls = [];
    globalThis.fetch = (async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ data: { stay: null, profileName: "A", menu: [] } }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    portalHotelStore.set(PORTAL_ALL_HOTELS);
  });

  test("sends the chosen hotel as ?hotel= (the route answers forHotel(session, query.hotel)), and none under All hotels", async () => {
    const api = createHttpGuestApi();
    portalHotelStore.set("h-2");
    await api.getMenu();
    assert.match(urls[0] ?? "", /\/api\/v1\/guest\/menu\?(.*&)?hotel=h-2/);
    clearGetCache();
    portalHotelStore.set(PORTAL_ALL_HOTELS);
    await api.getMenu();
    assert.doesNotMatch(urls[1] ?? "", /hotel=/);
  });
});

describe("order or browse", () => {
  test("ordering needs a stay on both answers; otherwise the menu is read only", () => {
    assert.equal(rules.orderModeOf(true, { roomNumber: "204" }), "order");
    assert.equal(rules.orderModeOf(false, { roomNumber: "204" }), "browse");
    assert.equal(rules.orderModeOf(true, null), "browse");
  });

  test("the mock outside a stay keeps the menu but no stay, and refuses an order", async () => {
    for (const scenario of ["arriving", "checkedOut", "none"] as const) {
      const api = createGuestApi({ latencyMs: 0 }, undefined, undefined, { scenario: () => scenario });
      const menu = await api.getMenu();
      assert.ok(menu.ok);
      assert.equal(menu.data.stay, null, scenario);
      assert.ok(menu.data.menu.some((g) => g.items.length > 0), scenario);
      assert.equal(rules.orderModeOf(false, menu.data.stay), "browse");
      const id = menu.data.menu[0]?.items[0]?.id ?? "";
      const placed = await api.placeOrder({ qty: { [id]: 1 }, payWith: "room_bill", note: "" });
      assert.equal(placed.ok, false, scenario);
    }
    const staying = createGuestApi({ latencyMs: 0 }, undefined, undefined, { scenario: () => "staying" });
    const m = await staying.getMenu();
    assert.ok(m.ok && m.data.stay !== null);
  });
});

// Monday-based days: 26 Oct 2026 is a Monday
const week = (opens = "07:00", closes = "23:00"): RestaurantDay[] => Array.from({ length: 7 }, (_, day) => ({ day, closed: false, opens, closes }));

describe("the kitchen's hours", () => {
  test("opens later today, tomorrow, or on the next open day; null when it never opens", () => {
    assert.equal(rules.kitchenOpensText(week(), "2026-10-26", "04:30"), "at 7:00 am");
    assert.equal(rules.kitchenOpensText(week(), "2026-10-26", "23:30"), "tomorrow at 7:00 am");
    const shut = week().map((d) => (d.day <= 1 ? { ...d, closed: true } : d)); // Monday and Tuesday closed
    assert.equal(rules.kitchenOpensText(shut, "2026-10-26", "10:00"), "on Wed at 7:00 am");
    assert.equal(rules.kitchenOpensText(week().map((d) => ({ ...d, closed: true })), "2026-10-26", "10:00"), null);
  });

  test("the status line says only what is known", () => {
    const hours = { accepting: true, openNow: true, days: week() };
    assert.equal(rules.hoursShort(hours, "2026-10-26", "12:00"), "Open now · until 11:00 pm");
    assert.equal(rules.hoursShort({ ...hours, openNow: false }, "2026-10-26", "05:00"), "Closed now · opens 7:00 am");
    assert.equal(rules.hoursShort({ ...hours, accepting: false }, "2026-10-26", "12:00"), "Not taking orders");
    assert.equal(rules.orderStatusLine({ roomNumber: "204", hotelName: "Hotel Sunrise, Rajkot", hours: "Open now · until 11:00 pm" }), "Room 204 · Hotel Sunrise, Rajkot · Open now · until 11:00 pm");
    assert.equal(rules.orderStatusLine({ roomNumber: null, hotelName: " ", hours: "Closed today" }), "Closed today");
  });
});

describe("scheduling", () => {
  test("from today (or check-in, if later) to check-out, dated 25 Oct 2026", () => {
    const days = rules.scheduleDays("2026-10-24", "2026-10-27", "2026-10-25");
    assert.deepEqual(days.map((d) => d.value), ["2026-10-25", "2026-10-26", "2026-10-27"]);
    assert.equal(days[0]?.label, "Today, 25 Oct 2026");
    assert.equal(days[1]?.label, "26 Oct 2026");
    assert.deepEqual(rules.scheduleDays("2026-10-28", "2026-10-29", "2026-10-25").map((d) => d.label), ["28 Oct 2026", "29 Oct 2026"]);
    assert.deepEqual(rules.scheduleDays("2026-10-20", "2026-10-22", "2026-10-25"), []);
  });

  test("the cancel countdown", () => {
    assert.equal(rules.mmss(154_000), "2:34");
    assert.equal(rules.mmss(-5), "0:00");
  });
});
