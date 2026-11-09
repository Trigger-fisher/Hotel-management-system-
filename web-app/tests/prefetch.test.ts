// Unit tests for src/dashboards/prefetch.ts: the frame reads the shell starts with a view's chunk load, and that they are the very addresses the payroll adapters read.
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

const { PAYROLL_FRAME_PATHS, prefetchFor } = await import("../src/dashboards/prefetch");
const { clearGetCache } = await import("../src/lib/api/getCache");
const { createPayrollCoreRealApi } = await import("../src/lib/api/adapters/payrollCore");
const { createPayrollPayRealApi } = await import("../src/lib/api/adapters/payrollPay");

const realFetch = globalThis.fetch;
let urls: string[] = [];
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  clearGetCache();
  urls = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("prefetchFor", () => {
  test("a payroll view starts the two company lists once each; a view outside payroll starts nothing", async () => {
    prefetchFor("hotel.payroll.staff");
    prefetchFor("hotel.payroll.staff");
    await settle();
    assert.deepEqual(urls, PAYROLL_FRAME_PATHS.map((p) => `/api/v1${p}`));
    urls = [];
    prefetchFor("hotel.dashboard");
    prefetchFor("hotel.fo.rooms");
    await settle();
    assert.deepEqual(urls, []);
  });

  test("the frames' own listCompanies calls then cost no request: the adapters read the same addresses", async () => {
    prefetchFor("hotel.payroll.pay.slips");
    await settle();
    assert.equal(urls.length, 2);
    await createPayrollCoreRealApi().listCompanies();
    await createPayrollPayRealApi().listCompanies();
    assert.equal(urls.length, 2);
    clearGetCache();
    await createPayrollCoreRealApi().listCompanies();
    await createPayrollPayRealApi().listCompanies();
    assert.deepEqual(urls.slice(2), PAYROLL_FRAME_PATHS.map((p) => `/api/v1${p}`));
  });
});
