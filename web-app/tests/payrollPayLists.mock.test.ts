// Unit tests for the pay lists' mock (ui-shared/dashboards/payrollPay.mock.ts): Slips, Advances, Bonus and Resignations page, filter, search,
// sort and summarise like the server (docs/BACKEND.md 7.6 "Pay lists").
// Run with `node --test tests/*.test.ts` (Node's built-in runner; Node strips the TypeScript types).
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { describe, test } from "node:test";

// The shared code writes extensionless relative imports (bundler style). Plain Node needs the extension, so retry unresolved relative imports with ".ts".
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

const { createPayrollPayApi } = await import("../../common/ui-shared/dashboards/payrollPay.mock");

const api = createPayrollPayApi({ latencyMs: 0 });
const CO = "pc1";

async function data<T>(p: Promise<{ ok: true; data: T } | { ok: false; error: unknown }>): Promise<T> {
  const r = await p;
  assert.ok(r.ok, "the mock answered with an error");
  return r.data;
}

async function refused(p: Promise<{ ok: boolean; error?: { code: string } }>): Promise<string> {
  const r = await p;
  assert.equal(r.ok, false, "the mock should refuse this query");
  return r.error?.code ?? "";
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
const sortedCopy = <T>(rows: T[], key: (r: T) => string | number, dir: 1 | -1) => [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * dir);

describe("Salary Slips mock", () => {
  test("pages: 25 by default, the next page carries on, a page past the end is empty with the same total", async () => {
    const first = await data(api.listSlips(CO));
    assert.equal(first.page, 1);
    assert.equal(first.pageSize, 25);
    assert.equal(first.items.length, Math.min(25, first.total));
    const all = await data(api.listSlips(CO, { page: 1, pageSize: 100 }));
    const p1 = await data(api.listSlips(CO, { page: 1, pageSize: 10 }));
    const p2 = await data(api.listSlips(CO, { page: 2, pageSize: 10 }));
    assert.deepEqual([...ids(p1.items), ...ids(p2.items)], ids(all.items).slice(0, 20));
    const past = await data(api.listSlips(CO, { page: 99, pageSize: 10 }));
    assert.deepEqual([past.items.length, past.total], [0, all.total]);
  });

  test("the default order is the newest period first", async () => {
    const all = await data(api.listSlips(CO, { page: 1, pageSize: 100 }));
    const periods = all.items.map((r) => r.period);
    assert.deepEqual(periods, [...periods].sort().reverse());
  });

  test("status, search and period narrow the total; the summary does not follow search, status or page", async () => {
    const all = await data(api.listSlips(CO, { page: 1, pageSize: 100 }));
    const paid = await data(api.listSlips(CO, { status: "Paid", page: 1, pageSize: 100 }));
    assert.ok(paid.items.length > 0 && paid.items.every((r) => r.paymentStatus === "Paid"));
    assert.equal(paid.total, all.items.filter((r) => r.paymentStatus === "Paid").length);
    assert.deepEqual(paid.summary, all.summary);

    const someone = all.items[0]!;
    const found = await data(api.listSlips(CO, { search: `  ${someone.employeeCode.toLowerCase()} `, page: 1, pageSize: 100 }));
    assert.ok(found.items.every((r) => r.employeeCode === someone.employeeCode));
    assert.deepEqual(found.summary, all.summary);
    // every word must match
    const none = await data(api.listSlips(CO, { search: `${someone.employeeName} zzzz-nobody`, page: 1, pageSize: 100 }));
    assert.equal(none.total, 0);

    const month = all.summary.latestPeriod!;
    const inMonth = await data(api.listSlips(CO, { period: month, page: 1, pageSize: 100 }));
    assert.ok(inMonth.items.every((r) => r.period === month));
    assert.equal(inMonth.summary.period, month);
    assert.equal(inMonth.summary.slips, inMonth.total);
    assert.equal(inMonth.summary.latestPeriod, month);
  });

  test("the summary counts every slip: people, money and statuses", async () => {
    const all = await data(api.listSlips(CO, { page: 1, pageSize: 100 }));
    const s = all.summary;
    assert.equal(s.period, null);
    assert.equal(s.slips, all.total);
    assert.equal(s.people, new Set(all.items.map((r) => r.employeeId)).size);
    assert.equal(s.netPaise, all.items.reduce((t, r) => t + r.netPaise, 0));
    assert.equal(s.paidPaise, all.items.reduce((t, r) => t + r.paidPaise, 0));
    assert.equal(s.outstandingPaise, all.items.reduce((t, r) => t + Math.max(0, r.netPaise - r.paidPaise), 0));
    assert.equal(Object.values(s.byStatus).reduce((t, n) => t + n, 0), s.slips);
    assert.equal(s.latestPeriod, all.items[0]!.period);
  });

  test("sorts by net and employee both ways, before paging", async () => {
    const all = await data(api.listSlips(CO, { page: 1, pageSize: 100 }));
    const netDesc = await data(api.listSlips(CO, { sort: "net", dir: "desc", page: 1, pageSize: 100 }));
    assert.deepEqual(netDesc.items.map((r) => r.netPaise), sortedCopy(all.items, (r) => r.netPaise, -1).map((r) => r.netPaise));
    const firstTen = await data(api.listSlips(CO, { sort: "net", dir: "desc", page: 1, pageSize: 10 }));
    assert.deepEqual(ids(firstTen.items), ids(netDesc.items).slice(0, 10));
    const byName = await data(api.listSlips(CO, { sort: "employee", page: 1, pageSize: 100 }));
    const names = byName.items.map((r) => r.employeeName.toLowerCase());
    assert.deepEqual(names, [...names].sort());
  });

  test("an unknown status or sort is refused (422)", async () => {
    assert.equal(await refused(api.listSlips(CO, { status: "Lost" as never })), "VALIDATION_FAILED");
    assert.equal(await refused(api.listSlips(CO, { sort: "designation" as never })), "VALIDATION_FAILED");
  });
});

describe("Advances mock", () => {
  test("status (open | settled) and search narrow the page; summary and counts stay", async () => {
    const all = await data(api.listAdvances(CO, { page: 1, pageSize: 100 }));
    assert.equal(all.page.total, all.counts.all);
    const open = await data(api.listAdvances(CO, { status: "open", page: 1, pageSize: 100 }));
    assert.ok(open.page.items.every((a) => !a.isSettled));
    assert.equal(open.page.total, all.counts.open);
    const settled = await data(api.listAdvances(CO, { status: "settled", page: 1, pageSize: 100 }));
    assert.equal(settled.page.total, all.counts.settled);
    assert.deepEqual([open.summary, open.counts], [all.summary, all.counts]);

    const a = all.page.items[0]!;
    const found = await data(api.listAdvances(CO, { search: a.employeeName.split(" ")[0], page: 1, pageSize: 100 }));
    assert.ok(found.page.total >= 1 && found.page.total <= all.page.total);
    assert.deepEqual([found.summary, found.counts], [all.summary, all.counts]);
    const byEntry = await data(api.listAdvances(CO, { search: a.entryNo, page: 1, pageSize: 100 }));
    assert.ok(byEntry.page.items.some((x) => x.id === a.id));
  });

  test("pages and sorts by amount; the default order is the newest date first", async () => {
    const all = await data(api.listAdvances(CO, { page: 1, pageSize: 100 }));
    const dates = all.page.items.map((a) => Date.parse(a.date));
    assert.deepEqual(dates, [...dates].sort((x, y) => y - x));
    const p1 = await data(api.listAdvances(CO, { page: 1, pageSize: 10 }));
    assert.deepEqual([p1.page.pageSize, p1.page.items.length], [10, Math.min(10, all.page.total)]);
    const up = await data(api.listAdvances(CO, { sort: "amount", dir: "asc", page: 1, pageSize: 100 }));
    assert.deepEqual(up.page.items.map((a) => a.amountPaise), sortedCopy(all.page.items, (a) => a.amountPaise, 1).map((a) => a.amountPaise));
  });

  test("the summary is always the live advances, also in the recycle-bin view", async () => {
    const live = await data(api.listAdvances(CO, { page: 1, pageSize: 100 }));
    const bin = await data(api.listAdvances(CO, { deleted: true, page: 1, pageSize: 100 }));
    assert.deepEqual(bin.summary, live.summary);
    assert.equal(bin.counts.all, bin.page.total);
  });

  test("a period keeps that month's advances and their summary", async () => {
    const all = await data(api.listAdvances(CO, { page: 1, pageSize: 100 }));
    const month = all.page.items[0]!.date.slice(0, 7);
    const inMonth = await data(api.listAdvances(CO, { period: month, page: 1, pageSize: 100 }));
    assert.ok(inMonth.page.total >= 1 && inMonth.page.total <= all.page.total);
    assert.equal(inMonth.counts.all, inMonth.page.total);
    assert.equal(inMonth.summary.outstandingPaise, inMonth.page.items.reduce((t, a) => t + a.outstandingPaise, 0));
  });

  test("an unknown status or sort is refused (422)", async () => {
    assert.equal(await refused(api.listAdvances(CO, { status: "closed" as never })), "VALIDATION_FAILED");
    assert.equal(await refused(api.listAdvances(CO, { sort: "recovered" as never })), "VALIDATION_FAILED");
  });
});

describe("Bonus mock", () => {
  test("status is the entry type; search over type and remarks; summary and counts stay", async () => {
    const all = await data(api.listBonus(CO, { page: 1, pageSize: 100 }));
    assert.equal(all.page.total, all.counts.all);
    for (const type of ["Bonus", "Incentive"] as const) {
      const one = await data(api.listBonus(CO, { status: type, page: 1, pageSize: 100 }));
      assert.ok(one.page.items.every((b) => b.type === type));
      assert.equal(one.page.total, all.counts[type]);
      assert.deepEqual([one.summary, one.counts], [all.summary, all.counts]);
    }
    const typed = await data(api.listBonus(CO, { search: "incentive", page: 1, pageSize: 100 }));
    assert.ok(typed.page.total >= all.counts.Incentive);
    assert.deepEqual(typed.summary, all.summary);
  });

  test("the summary adds up every live entry", async () => {
    const all = await data(api.listBonus(CO, { page: 1, pageSize: 100 }));
    const sum = (type: string) => all.page.items.filter((b) => b.type === type).reduce((t, b) => t + b.amountPaise, 0);
    assert.deepEqual(all.summary, { bonusPaise: sum("Bonus"), incentivePaise: sum("Incentive"), people: new Set(all.page.items.map((b) => b.employeeId)).size });
  });

  test("sorts by type and amount; pages", async () => {
    const all = await data(api.listBonus(CO, { page: 1, pageSize: 100 }));
    const byType = await data(api.listBonus(CO, { sort: "type", dir: "desc", page: 1, pageSize: 100 }));
    const types = byType.page.items.map((b) => b.type);
    assert.deepEqual(types, [...types].sort().reverse());
    const amount = await data(api.listBonus(CO, { sort: "amount", dir: "desc", page: 1, pageSize: 100 }));
    assert.deepEqual(amount.page.items.map((b) => b.amountPaise), sortedCopy(all.page.items, (b) => b.amountPaise, -1).map((b) => b.amountPaise));
    const p2 = await data(api.listBonus(CO, { sort: "amount", dir: "desc", page: 2, pageSize: 5 }));
    assert.deepEqual(ids(p2.page.items), ids(amount.page.items).slice(5, 10));
  });

  test("an unknown status or sort is refused (422)", async () => {
    assert.equal(await refused(api.listBonus(CO, { status: "Gift" as never })), "VALIDATION_FAILED");
  });
});

describe("Resignations mock", () => {
  test("status is the record's status; the summary carries byStatus and does not follow the filter", async () => {
    const all = await data(api.listSeparations(CO, { page: 1, pageSize: 100 }));
    const s = all.summary;
    assert.equal(s.all, all.page.total);
    assert.equal(s.byStatus.Pending + s.byStatus.Accepted + s.byStatus.Relieved, s.all);
    for (const st of ["Pending", "Accepted", "Relieved"] as const) {
      const one = await data(api.listSeparations(CO, { status: st, page: 1, pageSize: 100 }));
      assert.equal(one.page.total, s.byStatus[st]);
      assert.ok(one.page.items.every((x) => x.status === st));
      assert.deepEqual(one.summary, s);
    }
  });

  test("the old tab still works, together with a status", async () => {
    const relieved = await data(api.listSeparations(CO, { tab: "relieved", page: 1, pageSize: 100 }));
    assert.equal(relieved.page.total, relieved.summary.relieved);
    const both = await data(api.listSeparations(CO, { tab: "relieved", status: "Pending", page: 1, pageSize: 100 }));
    assert.equal(both.page.total, 0);
  });

  test("search over name, reason, type and entry no; sort by last working day both ways", async () => {
    const all = await data(api.listSeparations(CO, { page: 1, pageSize: 100 }));
    const x = all.page.items[0]!;
    const byEntry = await data(api.listSeparations(CO, { search: x.entryNo, page: 1, pageSize: 100 }));
    assert.deepEqual(ids(byEntry.page.items), [x.id]);
    const byType = await data(api.listSeparations(CO, { search: x.type, page: 1, pageSize: 100 }));
    assert.ok(byType.page.items.some((y) => y.id === x.id));
    const lwd = all.page.items.map((y) => y.lastWorkingDate);
    assert.deepEqual(lwd, [...lwd].sort().reverse());
    const up = await data(api.listSeparations(CO, { sort: "lastWorkingDate", dir: "asc", page: 1, pageSize: 100 }));
    assert.deepEqual(up.page.items.map((y) => y.lastWorkingDate), [...lwd].sort());
  });

  test("an unknown status or sort is refused (422)", async () => {
    assert.equal(await refused(api.listSeparations(CO, { status: "Rejoined" as never })), "VALIDATION_FAILED");
    assert.equal(await refused(api.listSeparations(CO, { sort: "type" as never })), "VALIDATION_FAILED");
  });
});
