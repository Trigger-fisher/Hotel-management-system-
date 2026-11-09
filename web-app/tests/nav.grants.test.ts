// The hotel menu lists only what the signed-in role may open (user.grants); no grants = no filtering. The shell's filter (navModel.visibleSections)
// is `hotelHasFeature && userMayOpen && (admin || !adminOnly)`: this tests userMayOpen over the real menu (ui-shared/dashboards/nav.ts).
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { test } from "node:test";

// ui-shared writes extensionless relative imports for the bundler; plain Node retries them with ".ts" (same as flow.test.ts).
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

const { moduleOfView, setUserGrants, userMayOpen } = await import("../../common/ui-shared/dashboards/features");
const { nav } = await import("../../common/ui-shared/dashboards/nav");

const shown = () => nav.hotel.flatMap((s) => s.items).filter((i) => !i.hidden && userMayOpen(i.id)).map((i) => i.id);

test("without grants every entry shows", () => {
  setUserGrants(undefined);
  assert.equal(userMayOpen("hotel.fo.board"), true);
  assert.ok(shown().includes("hotel.fo.board"));
});

test("a role without Front Office does not see its entries, but keeps the ones it holds", () => {
  setUserGrants({ bills: "edit", revenue: "view" });
  const now = shown();
  for (const gone of ["hotel.fo.board", "hotel.fo.reservations", "hotel.fo.inHouse", "hotel.fo.rooms", "hotel.co.profiles", "hotel.cash.expenses"]) {
    assert.ok(!now.includes(gone), `${gone} must be hidden`);
  }
  for (const kept of ["hotel.billing.bills", "hotel.cash.revenue"]) assert.ok(now.includes(kept), `${kept} must show`);
  setUserGrants(undefined);
});

test("entries that belong to no module always show, and a level of none hides", () => {
  setUserGrants({ pms: "none" });
  assert.equal(moduleOfView("hotel.overview.dashboard"), undefined);
  assert.equal(userMayOpen("hotel.overview.dashboard"), true);
  assert.equal(userMayOpen("hotel.fo.board"), false);
  setUserGrants(undefined);
});
