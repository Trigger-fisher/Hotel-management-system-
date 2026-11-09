// Problems with online payments, demo store (ui-shared/dashboards/payProblems.mock.ts): one store for the hotel, but the guest portal sees only the guest's payments
// and problems, the company portal only the company's. Run with `node --test tests/payProblems.mock.test.ts`.
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

const { createPayProblemsMock } = await import("../../common/ui-shared/dashboards/payProblems.mock");

const ok = <T>(r: { ok: boolean; data?: T }): T => {
  assert.equal(r.ok, true);
  return r.data as T;
};

describe("payment problems demo store", () => {
  test("each portal lists only its own payer's payments", async () => {
    const m = createPayProblemsMock({ latencyMs: 0 });
    const guest = ok(await m.listPaymentsOf("guest", {})).items.map((p) => p.description);
    const company = ok(await m.listPaymentsOf("company", {})).items.map((p) => p.description);
    assert.ok(guest.includes("Room service"));
    assert.ok(!company.includes("Room service"), "a company never sees a guest's room service payment");
    assert.ok(company.length > 0 && company.every((d) => !guest.includes(d)));
    assert.ok(ok(await m.listPaymentsOf("guest", {})).items.every((p) => !("payer" in p)));
  });

  test("a problem raised by the company reaches the hotel but not the guest", async () => {
    const m = createPayProblemsMock({ latencyMs: 0 });
    const pay = ok(await m.listPaymentsOf("company", {})).items.find((p) => p.status === "captured");
    assert.ok(pay);
    ok(await m.raiseAs("company", { paymentId: pay.paymentId, business: pay.business, kind: "other", title: "Paid twice", message: "The bank shows two debits.", amountPaise: null } as never));
    assert.equal(ok(await m.listProblemsOf("company", { status: "all" })).items.length, 1);
    assert.equal(ok(await m.listProblemsOf("guest", { status: "all" })).items.length, 0);
    assert.equal(ok(await m.list({ status: "all" })).items.length, 1);
  });

  test("a portal cannot raise or withdraw on the other payer's payment", async () => {
    const m = createPayProblemsMock({ latencyMs: 0 });
    const guestPay = ok(await m.listPaymentsOf("guest", {})).items.find((p) => p.status === "captured");
    assert.ok(guestPay);
    const input = { paymentId: guestPay.paymentId, business: guestPay.business, kind: "other", title: "Wrong amount", message: "I was charged too much.", amountPaise: null } as never;
    assert.equal((await m.raiseAs("company", input)).ok, false);
    const raised = ok(await m.raiseAs("guest", input));
    assert.equal((await m.withdrawAs("company", raised.id)).ok, false);
    assert.equal(ok(await m.withdrawAs("guest", raised.id)).status, "withdrawn");
  });
});
