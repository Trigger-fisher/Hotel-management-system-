// MJ's hotel rules (5 Nov 2026) on the screen models and the demo data: a Hotel User sees no payroll on Overview.
// Run with `node --test tests/hotelRules.test.ts`.
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

const overview = await import("../../common/ui-shared/dashboards/overview");
const billing = await import("../../common/ui-shared/dashboards/billing");
const roomService = await import("../../common/ui-shared/dashboards/roomService");
const { createBillingApi } = await import("../../common/ui-shared/dashboards/billing.mock");
const { createOverviewApi } = await import("../../common/ui-shared/dashboards/overview.mock");

const ok = <T>(r: { ok: boolean; data?: T }): T => {
  assert.equal(r.ok, true);
  return r.data as T;
};

describe("Overview: no payroll for a Hotel User", () => {
  test("the demo Overview drops the payroll row and the salary item for staff; the Hotel Admin keeps both", async () => {
    const api = createOverviewApi({ latencyMs: 0 } as never);
    const full = ok(await api.getDashboard());
    assert.ok(full.payroll, "the demo hotel has payroll figures");
    assert.ok(full.attention.some((a) => a.id === "salary"), "the demo hotel has open salaries");
    const staff = overview.dashboardForRole(full, "hotel_user");
    assert.equal(staff.payroll, null);
    assert.ok(!staff.attention.some((a) => a.id === "salary"));
    assert.ok(!JSON.stringify(staff).includes("salary"), "no salary word anywhere in what the screen gets");
    assert.deepEqual(staff.books, full.books, "the cash rows stay");
    for (const role of ["hotel_admin", "group_hotel_admin", "super_admin"]) assert.equal(overview.dashboardForRole(full, role), full, `${role} keeps payroll`);
  });

  test("the bell and the live attention feed drop the salary item for staff only", async () => {
    const api = createOverviewApi({ latencyMs: 0 } as never);
    const feed = ok(await api.getAttention());
    assert.ok(feed.items.some((a) => a.id === "salary"));
    assert.ok(!overview.attentionForRole(feed.items, "hotel_user").some((a) => a.id === "salary"));
    assert.equal(overview.attentionForRole(feed.items, "hotel_admin").length, feed.items.length);
  });

  test("a dashboard without payroll still assembles: no salary item", () => {
    const d = overview.assembleDashboard("2026-11-05", [], { today: 1, todayCashPaise: 0, month: 1, latest: null }, null);
    assert.equal(d.payroll, null);
    assert.deepEqual(d.attention.map((a) => a.id), ["entries"]);
  });
});

describe("Dining orders: the guests' cancel window is the Hotel Admin's", () => {
  test("only the Hotel Admin and the roles above may change it; a Hotel User, a guest and a company never", () => {
    assert.deepEqual(["hotel_admin", "group_hotel_admin", "super_admin", "platform_admin"].map(roomService.mayChangeGuestCancelWindow), [true, true, true, true]);
    assert.deepEqual(["hotel_user", "guest_user", "corporate_user", ""].map(roomService.mayChangeGuestCancelWindow), [false, false, false, false]);
  });
});

describe("Pay by link: a Hotel User is never sent to Admin > Online payments", () => {
  const fill = (t: string, v: readonly (string | number)[]) => t.replace(/\{(\d+)\}/g, (_m, i: string) => String(v[Number(i)]));
  test("the Hotel User's notes have no Admin path and no button; the Hotel Admin keeps both", () => {
    const staff = billing.payLinkNotes("hotel_user", fill);
    const admin = billing.payLinkNotes("hotel_admin", fill);
    for (const text of [staff.auto, staff.linkReady("Ravi Mehta", "₹4,725.00", 3)]) assert.ok(!/Admin|Online payments/.test(text), text);
    const q = billing.billingCopy.bills.quickPay;
    for (const text of [q.notReady, q.askAdmin]) assert.ok(!/Razorpay|SuperAdmin|Admin >/.test(text), `a failed link reads plainly to staff: ${text}`);
    assert.equal(staff.adminButton, false);
    assert.equal(staff.linkReady("Ravi Mehta", "₹4,725.00", 3), "Ravi Mehta can pay ₹4,725.00 with this link. It works for 3 days; when the guest has paid, record the payment here.");
    assert.equal(staff.linkReady("", "₹10.00", 3).startsWith("The guest can pay"), true);
    assert.equal(admin.adminButton, true);
    assert.match(admin.auto, /Admin > Online payments/);
    assert.match(admin.linkReady("Ravi Mehta", "₹4,725.00", 3), /Admin > Online payments/);
  });
});

describe("SAC codes on GST bills", () => {
  test("rooms 996311, food 996331; a bill's own stored codes win; an older bill prints the defaults", async () => {
    assert.deepEqual(billing.GST_SAC, { hotel: "996311", food: "996331" });
    assert.deepEqual(billing.billSac({ hotelSac: "996312", foodSac: "996332" }), { hotel: "996312", food: "996332" });
    assert.deepEqual(billing.billSac({}), { hotel: "996311", food: "996331" });
    assert.deepEqual(billing.billSac({ hotelSac: null, foodSac: "" }), { hotel: "996311", food: "996331" });
    const api = createBillingApi({ latencyMs: 0 } as never);
    const list = ok(await api.listBills({ tab: "all", page: 1, pageSize: 5 } as never));
    for (const b of list.page.items) assert.deepEqual(billing.billSac(b), { hotel: "996311", food: "996331" });
  });
});
