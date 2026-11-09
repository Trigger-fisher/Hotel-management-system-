// Unit tests for the System Log / Force Log / System Health mock (ui-shared/dashboards/adminSystem.mock.ts): paged and filtered like the server.
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

const { createSystemAdminMock } = await import("../../common/ui-shared/dashboards/adminSystem.mock");
const { MOCK_TODAY } = await import("../../common/ui-shared/dashboards/payrollPay");

const api = createSystemAdminMock({ latencyMs: 0 });

async function data<T>(p: Promise<{ ok: true; data: T } | { ok: false; error: unknown }>): Promise<T> {
  const r = await p;
  assert.ok(r.ok, "the mock answered with an error");
  return r.data;
}

describe("System Log mock", () => {
  test("pages like the server: 25 by default, the next page carries on, sizes snap to 10/25/50/100", async () => {
    const first = await data(api.listSystemLog({}));
    assert.equal(first.page, 1);
    assert.equal(first.pageSize, 25);
    assert.equal(first.items.length, Math.min(25, first.total));
    const p1 = await data(api.listSystemLog({ page: 1, pageSize: 10 }));
    const p2 = await data(api.listSystemLog({ page: 2, pageSize: 10 }));
    assert.equal(p1.items.length, 10);
    assert.equal(p2.page, 2);
    assert.ok(p2.items.length > 0);
    assert.equal(new Set([...p1.items, ...p2.items].map((r) => r.id)).size, p1.items.length + p2.items.length, "no row on two pages");
    assert.equal((await data(api.listSystemLog({ pageSize: 7 }))).pageSize, 10);
  });

  test("rows have string ids and come newest first", async () => {
    const all = await data(api.listSystemLog({ pageSize: 100 }));
    for (const r of all.items) assert.equal(typeof r.id, "string");
    for (let i = 1; i < all.items.length; i++) assert.ok(all.items[i - 1].at >= all.items[i].at, "newest first");
  });

  test("a filter: one module only", async () => {
    const res = await data(api.listSystemLog({ module: "expense", pageSize: 100 }));
    assert.ok(res.total > 0);
    assert.ok(res.items.every((r) => r.module === "expense"));
  });

  test("search looks in the summary, the person and the details", async () => {
    const res = await data(api.listSystemLog({ search: "  HS-0412 ", pageSize: 100 }));
    assert.ok(res.total >= 1);
    assert.ok(res.items.every((r) => `${r.summary} ${r.subject ?? ""} ${JSON.stringify(r.details)}`.includes("HS-0412")));
    assert.equal((await data(api.listSystemLog({ search: "nothing like this anywhere" }))).total, 0);
  });

  test("view 'problems' shows only what failed; with status 'success' it shows nothing (as the server)", async () => {
    const res = await data(api.listSystemLog({ view: "problems", pageSize: 100 }));
    assert.ok(res.total > 0);
    assert.ok(res.items.every((r) => r.status === "failed"));
    assert.equal((await data(api.listSystemLog({ view: "problems", status: "success" }))).total, 0);
  });

  test("view 'today' keeps today's lines (the mock's day)", async () => {
    const res = await data(api.listSystemLog({ view: "today", pageSize: 100 }));
    assert.ok(res.total > 0);
    assert.ok(res.items.every((r) => r.at.slice(0, 10) === MOCK_TODAY));
  });

  test("stats, modules and people describe the whole log, not the filter", async () => {
    const all = await data(api.listSystemLog({ pageSize: 100 }));
    const filtered = await data(api.listSystemLog({ module: "bills" }));
    assert.deepEqual(filtered.stats, all.stats);
    assert.equal(all.stats.total, all.total);
    assert.equal(all.stats.failed, all.items.filter((r) => r.status === "failed").length);
    assert.equal(all.stats.today, all.items.filter((r) => r.at.slice(0, 10) === MOCK_TODAY).length);
    assert.equal(all.modules.reduce((s, m) => s + m.count, 0), all.total);
    assert.ok(all.modules.some((m) => m.key === "revenue"));
    assert.deepEqual(all.people, [...all.people].sort());
    assert.equal(all.stats.people, all.people.length);
    assert.ok(!all.people.includes(""));
  });
});

describe("Force Log mock", () => {
  test("views and stats", async () => {
    const all = await data(api.listForceLog({ pageSize: 100 }));
    assert.ok(all.total > 0);
    assert.ok(all.items.every((r) => typeof r.id === "string"));
    const locks = await data(api.listForceLog({ view: "locks", pageSize: 100 }));
    assert.equal(locks.total, all.stats.locks);
    assert.ok(locks.items.every((r) => r.action === "lock"));
    const sessions = await data(api.listForceLog({ view: "sessions", pageSize: 100 }));
    assert.ok(sessions.items.every((r) => r.action === "armed" || r.action === "disarmed"));
  });
});

describe("System Health mock", () => {
  test("health, faults, resolve and reopen", async () => {
    const h = await data(api.getHealth());
    assert.ok(h.features.length > 0);
    assert.ok(h.checks.length > 0);
    assert.ok(["healthy", "degraded", "down"].includes(h.overall));
    assert.equal(h.openErrors, h.recentErrors.length);
    const open = await data(api.listFaults({}));
    assert.equal(open.page.items.length, open.counts.open);
    const id = open.page.items[0].id;
    assert.equal(typeof id, "string");
    const fixed = await data(api.resolveFault(id));
    assert.equal(fixed.fault.resolved, true);
    assert.equal((await data(api.listFaults({}))).counts.open, open.counts.open - 1);
    await data(api.reopenFault(id));
    assert.equal((await data(api.listFaults({}))).counts.open, open.counts.open);
    const missing = await api.resolveFault("no-such-fault");
    assert.equal(missing.ok, false);
  });
});
