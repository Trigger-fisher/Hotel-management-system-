// Unit tests for ui-shared/dashboards/routes.ts: the address of every dashboard page, following the REST API (decision 49: the URL decides).
// Run with `npm test` (Node's built-in runner; Node strips the TypeScript types).
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { describe, test } from "node:test";

// The app writes extensionless relative imports (bundler style); plain Node needs the extension.
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

const { INSIDE_PREFIX, allViewIds, badPortalHotel, isAppPath, isPortalKind, pathForRoute, portalHotelFromSearch, routeForPath, routeViewIds, withPortalHotel } = await import("../../common/ui-shared/dashboards/routes");

const KINDS = ["guest", "corporate", "hotel", "platform", "group"] as const;
/** Params that fill every ":name" of a page's address forms, one form at a time. */
const FORMS: Record<string, Record<string, string>[]> = {
  "hotel.fo.reservationForm": [{ id: "r1" }, {}],
  "hotel.web.roomForm": [{ id: "w1" }, {}],
  "platform.group": [{ id: "g1" }, { invite: "i9" }],
};
const NEEDS_ID = new Set(["group.emailThread", "hotel.co.statement", "hotel.co.notification","hotel.fo.reservation", "hotel.fo.stay", "hotel.web.enquiry", "guest.bill", "corporate.bill", "platform.hotel", "group.hotel", "hotel.conversation", "platform.conversation", "hotel.emailThread", "hotel.whatsappThread", "platform.emailThread", "platform.whatsappThread", "platform.myMailboxThread", "hotel.myMailboxThread", "group.myMailboxThread"]);
const formsOf = (viewId: string): Record<string, string>[] => FORMS[viewId] ?? (NEEDS_ID.has(viewId) ? [{ id: "abc-123" }] : [{}]);

describe("dashboard addresses follow the REST API", () => {
  test("every page of every role has an address", () => {
    for (const kind of KINDS) {
      const missing = allViewIds(kind).filter((id) => !routeViewIds(kind).includes(id));
      assert.deepEqual(missing, [], `${kind} pages without an address`);
    }
  });

  test("every form of every page round-trips (page -> address -> same page)", () => {
    for (const kind of KINDS) {
      for (const viewId of routeViewIds(kind)) {
        for (const params of formsOf(viewId)) {
          const path = pathForRoute(kind, { viewId, params });
          assert.ok(path, `${kind} ${viewId} ${JSON.stringify(params)} has an address`);
          const [pathname, search = ""] = path.split("?");
          assert.deepEqual(routeForPath(kind, pathname, search), { viewId, params }, `${kind} ${path}`);
        }
      }
    }
  });

  test("no two pages of one role share an address", () => {
    for (const kind of KINDS) {
      const seen = new Map<string, string>();
      for (const viewId of routeViewIds(kind)) {
        for (const params of formsOf(viewId)) {
          const path = pathForRoute(kind, { viewId, params });
          assert.ok(path);
          assert.equal(seen.get(path), undefined, `${kind} ${path}: ${seen.get(path)} and ${viewId}`);
          seen.set(path, viewId);
        }
      }
    }
  });

  test("the addresses are the API's resource paths", () => {
    const cases: [typeof KINDS[number], string, Record<string, string>, string][] = [
      ["hotel", "hotel.billing.advances", {}, "/billing/advances"],
      ["hotel", "hotel.cash.revenue", {}, "/revenue/deposits"],
      ["hotel", "hotel.cash.expenses", {}, "/expense/entries"],
      ["hotel", "hotel.cash.handover", {}, "/handover"],
      ["hotel", "hotel.co.profiles", {}, "/companies"],
      ["hotel", "hotel.co.statement", { id: "c1" }, "/companies/c1/statement"],
      ["hotel", "hotel.fo.inHouse", {}, "/front-office/stays"],
      ["hotel", "hotel.fo.stay", { id: "s1" }, "/front-office/stays/s1"],
      ["hotel", "hotel.fo.reservationForm", {}, "/front-office/reservations/new"],
      ["hotel", "hotel.fo.reservationForm", { id: "r1" }, "/front-office/reservations/r1/edit"],
      ["hotel", "hotel.web.gallery", {}, "/website/photos"],
      ["hotel", "hotel.admin.system", {}, "/system/health"],
      ["hotel", "hotel.payroll.staff", {}, "/payroll/employees"],
      ["hotel", "hotel.admin.profile", {}, "/profile"],
      ["guest", "guest.bill", { id: "01a12838-65f8.hotel", preview: "1" }, "/guest/bills/01a12838-65f8.hotel?preview=1"],
      ["corporate", "corporate.bills", {}, "/corporate/due-bills"],
      ["corporate", "corporate.myProfile", {}, "/profile"],
      ["platform", "platform.hotel", { id: "h1" }, "/platform/hotels/h1"],
      ["platform", "platform.group", { invite: "i9" }, "/platform/invitations/i9"],
      ["platform", "platform.admins", {}, "/platform/hotel-admins"],
      ["group", "group.hotels.invite", {}, "/group/invitations/new"],
      ["hotel", "hotel.conversations", {}, "/conversations"],
      ["hotel", "hotel.conversation", { id: "0192f3a4-1b2c-7d3e-8f40-5a6b7c8d9e0f" }, "/conversations/0192f3a4-1b2c-7d3e-8f40-5a6b7c8d9e0f"],
      ["platform", "platform.conversations", {}, "/platform/conversations"],
      ["platform", "platform.conversations", { tab: "settings" }, "/platform/conversations?tab=settings"],
      ["platform", "platform.conversation", { id: "c9" }, "/platform/conversations/c9"],
    ];
    for (const [kind, viewId, params, path] of cases) assert.equal(pathForRoute(kind, { viewId, params }), path, viewId);
  });

  test("Conversations: the hotel's at /conversations (and inside a visit), the console's at /platform/conversations with its Settings tab", () => {
    assert.deepEqual(routeForPath("hotel", "/conversations/c1"), { viewId: "hotel.conversation", params: { id: "c1" } });
    assert.deepEqual(routeForPath("hotel", "/inside/conversations", "", { inside: true }), { viewId: "hotel.conversations", params: {} });
    assert.deepEqual(routeForPath("platform", "/platform/conversations", "?tab=settings&x=1"), { viewId: "platform.conversations", params: { tab: "settings" } });
    assert.equal(routeForPath("platform", "/conversations"), null, "a hotel address is not a console page");
    assert.equal(isAppPath("/conversations/<b>"), false);
  });

  test("a record id named 'new' is the new-record form, never a record", () => {
    assert.deepEqual(routeForPath("hotel", "/front-office/reservations/new"), { viewId: "hotel.fo.reservationForm", params: {} });
    assert.deepEqual(routeForPath("group", "/group/invitations/new"), { viewId: "group.hotels.invite", params: {} });
  });

  test("the home page is '/', and '/' opens the home page", () => {
    assert.equal(pathForRoute("hotel", { viewId: "hotel.dashboard", params: {} }, { home: "hotel.dashboard" }), "/");
    assert.deepEqual(routeForPath("hotel", "/", "", { home: "hotel.dashboard" }), { viewId: "hotel.dashboard", params: {} });
    assert.deepEqual(routeForPath("hotel", "/dashboard"), { viewId: "hotel.dashboard", params: {} });
  });

  test("a hotel visit by platform or group staff lives under /inside and never matches a platform or group page", () => {
    for (const viewId of routeViewIds("hotel")) {
      for (const params of formsOf(viewId)) {
        const path = pathForRoute("hotel", { viewId, params }, { inside: true });
        assert.ok(path && (path === INSIDE_PREFIX || path.startsWith(`${INSIDE_PREFIX}/`)), path ?? viewId);
        const [pathname, search = ""] = path.split("?");
        assert.deepEqual(routeForPath("hotel", pathname, search, { inside: true }), { viewId, params });
        assert.equal(routeForPath("platform", pathname, search), null, `platform ${path}`);
        assert.equal(routeForPath("group", pathname, search), null, `group ${path}`);
      }
    }
    for (const kind of ["platform", "group"] as const) {
      for (const viewId of routeViewIds(kind)) {
        for (const params of formsOf(viewId)) {
          const path = pathForRoute(kind, { viewId, params });
          assert.ok(path && !path.startsWith(INSIDE_PREFIX), `${kind} ${path}`);
          assert.equal(routeForPath("hotel", path.split("?")[0], "", { inside: true }), null, `${kind} ${path} is no visit`);
        }
      }
    }
    assert.equal(routeForPath("hotel", "/billing/advances", "", { inside: true }), null);
  });

  test("addresses that name nothing are refused", () => {
    for (const bad of ["/billz", "/wp-admin/x.php", "/billing/advances/1", "/guest/bills/../../etc", "/guest/bills/..", "/guest/bills/.hidden", "/guest/bills/a b", "/front-office/stays/<script>", "/.env", "/inside/billz", "/bill/b7", "/fo/in-house"]) {
      assert.equal(isAppPath(bad), false, bad);
    }
    assert.equal(routeForPath("guest", "/billing/advances"), null, "a hotel page is not a guest page");
    assert.deepEqual(routeForPath("guest", "/guest/bills/b7", "?preview=1&evil=http://x"), { viewId: "guest.bill", params: { id: "b7", preview: "1" } });
    for (const good of ["/", "/inside", "/billing/advances", "/guest/bills/b7", "/inside/front-office/stays/s1", "/platform/hotels/new", "/profile", "/platform/invitations/i9"]) {
      assert.equal(isAppPath(good), true, good);
    }
  });

  test("the portals' hotel choice in the address (?hotel=): read back, added, and a mangled value refused", () => {
    const id = "0f8e2c1a-5b6d-4e7f-8a9b-0c1d2e3f4a5b";
    assert.equal(portalHotelFromSearch(`?hotel=${id}`), id);
    assert.equal(portalHotelFromSearch("?hotel=h-2&x=1"), "h-2", "the demo hotels' short ids too");
    for (const none of ["", "?hotel=all", "?hotel=", "?hotel=../x", "?hotel=<b>", "?other=1"]) assert.equal(portalHotelFromSearch(none), null, none);
    assert.equal(withPortalHotel("/guest/bills", id), `/guest/bills?hotel=${id}`);
    assert.equal(withPortalHotel("/guest/bills/b7?preview=1", "h-2"), "/guest/bills/b7?preview=1&hotel=h-2");
    for (const all of ["all", "", null, undefined, "a b"]) assert.equal(withPortalHotel("/corporate/bills", all), "/corporate/bills", String(all));
    assert.equal(badPortalHotel("?hotel=all"), false);
    assert.equal(badPortalHotel(`?hotel=${id}`), false);
    assert.equal(badPortalHotel("?x=1"), false);
    assert.equal(badPortalHotel("?hotel=<script>"), true);
    assert.equal(badPortalHotel("?hotel="), true);
    // the hotel is not a page parameter: the page an address names is the same with or without it
    assert.deepEqual(routeForPath("guest", "/guest/bills/b7", `?preview=1&hotel=${id}`), { viewId: "guest.bill", params: { id: "b7", preview: "1" } });
    assert.deepEqual([isPortalKind("guest"), isPortalKind("corporate"), isPortalKind("hotel"), isPortalKind("platform"), isPortalKind("group")], [true, true, false, false, false]);
  });
});
