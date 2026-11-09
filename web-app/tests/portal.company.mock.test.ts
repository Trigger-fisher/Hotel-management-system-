// The Company portal's mock (decisions 48 and 52): latest first on every list, persons on a bill, the sidebar's hotel choice narrows every page,
// the company profile changes contact details but never the prices and percentages. Run with `node --test tests/portal.company.mock.test.ts`.
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

const { createCorporateApi } = await import("../../common/ui-shared/dashboards/corporate.mock");
const { portalHotelStore, PORTAL_ALL_HOTELS } = await import("../../common/ui-shared/dashboards/portalHotel");

const api = createCorporateApi({ latencyMs: 0 } as never);
const ok = <T>(r: { ok: boolean; data?: T }): T => {
  assert.equal(r.ok, true);
  return r.data as T;
};
const q = { page: 1, pageSize: 50 };

describe("company portal mock", () => {
  test("Due bills: latest bill first, with the persons staying on each bill", async () => {
    portalHotelStore.set(PORTAL_ALL_HOTELS);
    const page = ok(await api.listDueBills(q));
    const dates = page.items.map((b) => b.billDate);
    assert.deepEqual(dates, [...dates].sort().reverse());
    for (const b of page.items) {
      assert.ok(b.detail.persons && b.detail.persons.adults + b.detail.persons.children > 0, `${b.billNumber} has persons`);
    }
  });

  test("Payment history and Ledger: latest first across all hotels", async () => {
    portalHotelStore.set(PORTAL_ALL_HOTELS);
    const pays = ok(await api.listPaymentHistory(q)).items.map((p) => p.date);
    assert.deepEqual(pays, [...pays].sort().reverse());
    const lines = ok(await api.getLedgerAccount(q)).items.map((l) => l.date);
    assert.deepEqual(lines, [...lines].sort().reverse());
  });

  test("The dashboard's needs-attention list is the oldest open bills", async () => {
    portalHotelStore.set(PORTAL_ALL_HOTELS);
    const d = ok(await api.getDashboard());
    const ages = d.attention.map((b) => b.ageDays);
    assert.deepEqual(ages, [...ages].sort((a, b) => b - a));
    assert.ok(d.cards.billsThisMonth >= 1);
  });

  test("Choosing one hotel narrows the lists to that hotel", async () => {
    portalHotelStore.set("h-3");
    const due = ok(await api.listDueBills(q));
    assert.ok(due.items.length > 0 && due.items.every((b) => b.hotelId === "h-3"));
    const pays = ok(await api.listPaymentHistory(q));
    assert.ok(pays.items.every((p) => p.hotelId === "h-3"));
    portalHotelStore.set(PORTAL_ALL_HOTELS);
  });

  test("Statement, Overview and Due bills show the same amount to pay, for all hotels and for each hotel", async () => {
    for (const scope of [PORTAL_ALL_HOTELS, "h-1", "h-2", "h-3"]) {
      portalHotelStore.set(scope);
      const ledger = ok(await api.getLedgerAccount(q));
      const due = ok(await api.listDueBills(q)).summary.totalDuePaise;
      assert.equal(ledger.totals.balancePaise, due, `statement balance for ${scope}`);
      assert.equal(ok(await api.getDashboard()).cards.totalDuePaise, due, `overview for ${scope}`);
      for (const h of ledger.byHotel) {
        const hotelDue = ok(await api.listDueBills(q)).summary.byHotel.find((x) => x.hotelId === h.hotelId)?.totalDuePaise;
        assert.equal(h.closingPaise, hotelDue, `closing balance of ${h.hotelId}`);
      }
    }
    portalHotelStore.set(PORTAL_ALL_HOTELS);
  });

  test("Company profile: contact details save, prices and percentages stay the hotel's", async () => {
    const before = ok(await api.getPortalProfile("h-1"));
    const saved = ok(await api.savePortalProfile("h-1", { mobile: "9825000099", pricing: { discountPct: 99 } } as never));
    assert.equal(saved.mobile, "9825000099");
    assert.deepEqual(saved.pricing, before.pricing);
  });
});
