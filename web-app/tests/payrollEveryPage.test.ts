// Unit tests for getEveryPage (src/lib/api/adapters/payrollShared.ts): the pages after the first are asked in waves of PARALLEL_PAGES, and the joined
// answer is remembered like one GET (src/lib/api/getCache.ts).
// Run with `npm test` (Node's built-in runner; Node strips the TypeScript types).
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { afterEach, beforeEach, describe, test } from "node:test";

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

const { PARALLEL_PAGES, getEveryPage } = await import("../src/lib/api/adapters/payrollShared");
const { clearGetCache } = await import("../src/lib/api/getCache");

const realFetch = globalThis.fetch;
const TOTAL = 850;
/** The requests so far, in order of start; each one waits until `release()` is called. */
let started: string[] = [];
let waiting: (() => void)[] = [];
const release = async () => {
  const w = waiting;
  waiting = [];
  for (const r of w) r();
  await new Promise((r) => setTimeout(r, 0));
};

function server(failPage?: number) {
  started = [];
  waiting = [];
  globalThis.fetch = (async (url: string) => {
    started.push(url);
    await new Promise<void>((r) => waiting.push(r));
    const page = Number(new URL(url, "http://x").searchParams.get("page"));
    if (page === failPage) return new Response(JSON.stringify({ error: { code: "SERVER_ERROR", message: "SERVER_ERROR", traceId: "t" } }), { status: 500 });
    const from = (page - 1) * 100;
    const items = Array.from({ length: Math.max(0, Math.min(100, TOTAL - from)) }, (_, i) => ({ id: from + i + 1 }));
    return new Response(JSON.stringify({ data: { items, total: TOTAL, page, pageSize: 100 } }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

beforeEach(() => clearGetCache());
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("getEveryPage", () => {
  test("850 rows: the first page alone, then the other 8 pages in ONE wave (two waves with the old 6)", async () => {
    assert.equal(PARALLEL_PAGES, 10);
    server();
    const done = getEveryPage<{ items: { id: number }[]; total: number }>("/payroll/companies/c1/employees", { tab: "all" }, 5000);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(started.length, 1);
    await release();
    assert.equal(started.length, 9, "pages 2 to 9 are asked together");
    await release();
    const r = await done;
    assert.ok(r.ok);
    assert.equal(r.data.items.length, TOTAL);
    assert.deepEqual(r.data.items.map((i) => i.id).slice(0, 3), [1, 2, 3]);
    assert.equal(r.data.items[TOTAL - 1]?.id, TOTAL);
  });

  test("the joined answer is remembered: the same list asked again fetches nothing; another query or a plain page does", async () => {
    server();
    const first = getEveryPage("/payroll/companies/c1/employees", { tab: "all" }, 5000);
    for (let i = 0; i < 3; i += 1) await release();
    const a = await first;
    assert.equal(started.length, 9);
    const b = await getEveryPage("/payroll/companies/c1/employees", { tab: "all" }, 5000);
    assert.equal(started.length, 9);
    assert.equal(a, b);
    const other = getEveryPage("/payroll/companies/c1/employees", { tab: "active" }, 5000);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(started.length, 10);
    await release();
    await release();
    await other;
  });

  test("a failed page fails the whole list and nothing of it is remembered", async () => {
    server(4);
    const done = getEveryPage("/payroll/companies/c1/employees", {}, 5000);
    for (let i = 0; i < 3; i += 1) await release();
    const r = await done;
    assert.ok(!r.ok && r.error.code === "SERVER_ERROR");
    server();
    const again = getEveryPage("/payroll/companies/c1/employees", {}, 5000);
    for (let i = 0; i < 3; i += 1) await release();
    assert.ok((await again).ok);
    // page 1 and the pages that answered well the first time came from the memory; the failed page 4 was asked again
    assert.deepEqual(started.map((u) => new URL(u, "http://x").searchParams.get("page")), ["4"]);
  });
});
