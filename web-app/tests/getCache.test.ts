// Unit tests for src/lib/api/getCache.ts through the client (src/lib/api/client.ts): the 20 s memory of GET answers, what shares it and what forgets it.
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

const { dash, get, http } = await import("../src/lib/api/client");
const { GET_CACHE_MS, clearGetCache, getCacheSize, rememberGet } = await import("../src/lib/api/getCache");
const { softRefreshAll } = await import("../src/components/ui/softRefresh");
const { signOutInBackground } = await import("../src/lib/auth/signOut");

const realFetch = globalThis.fetch;
const realNow = Date.now;
let urls: string[] = [];
let now = 1_000_000;

/** Every request is answered with `status` and `body`; the answer can be held back with `hold` and released by the returned function. */
function answer(status: number, body: (url: string) => unknown, hold = false): () => void {
  urls = [];
  let release: (() => void)[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    urls.push(`${init.method ?? "GET"} ${url}`);
    if (hold) await new Promise<void>((resolve) => release.push(resolve));
    return new Response(JSON.stringify(body(url)), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return () => {
    const waiting = release;
    release = [];
    for (const r of waiting) r();
  };
}

beforeEach(() => {
  clearGetCache();
  now = 1_000_000;
  Date.now = () => now;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  Date.now = realNow;
});

describe("the GET memory", () => {
  test("a second identical GET inside 20 s does not fetch and gives the same answer; after 20 s it fetches again", async () => {
    answer(200, () => ({ data: { rows: [1] } }));
    const a = await get<{ rows: number[] }>("/payroll/companies");
    const b = await get<{ rows: number[] }>("/payroll/companies");
    assert.equal(urls.length, 1);
    assert.ok(a.ok && b.ok);
    assert.equal(a.data, b.data);
    now += GET_CACHE_MS - 1;
    await get("/payroll/companies");
    assert.equal(urls.length, 1);
    now += 1;
    await get("/payroll/companies");
    assert.equal(urls.length, 2);
  });

  test("the key is the whole address: another query is another request, the same query in another key order is the same", async () => {
    answer(200, () => ({ data: [] }));
    await get("/x", { a: 1, b: 2 });
    await get("/x", { a: 1, b: 3 });
    await get("/x", { a: 1, b: 2 });
    assert.deepEqual(urls, ["GET /api/v1/x?a=1&b=2", "GET /api/v1/x?a=1&b=3"]);
  });

  test("two identical GETs in flight share one request", async () => {
    const release = answer(200, () => ({ data: { n: 1 } }), true);
    const both = Promise.all([get("/x"), get("/x"), get("/y")]);
    await Promise.resolve();
    release();
    const [a, b, c] = await both;
    assert.deepEqual(urls, ["GET /api/v1/x", "GET /api/v1/y"]);
    assert.ok(a.ok && b.ok && c.ok);
    assert.equal(a.data, b.data);
  });

  test("an error is not kept: the next GET asks again", async () => {
    answer(500, () => ({ error: { code: "SERVER_ERROR", message: "SERVER_ERROR", traceId: "t" } }));
    const a = await get("/x");
    assert.ok(!a.ok);
    assert.equal(getCacheSize(), 0);
    answer(200, () => ({ data: 1 }));
    const b = await get("/x");
    assert.ok(b.ok && b.data === 1);
    assert.equal(urls.length, 1);
  });

  test("a write (any non-GET through http) forgets everything, whatever its answer", async () => {
    answer(200, () => ({ data: 1 }));
    await get("/x");
    await dash("POST", "/x/1", { body: {} });
    await get("/x");
    assert.deepEqual(urls.map((u) => u.split(" ")[0]), ["GET", "POST", "GET"]);
    await get("/x");
    answer(409, () => ({ error: { code: "CONFLICT", message: "CONFLICT", traceId: "t" } }));
    await http("PATCH", "/x/1", { body: {} });
    await get("/x");
    assert.equal(urls.length, 2);
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await http("DELETE", "/x/1");
    answer(200, () => ({ data: 1 }));
    await get("/x");
    assert.equal(urls.length, 1);
  });

  test("a GET that was in flight when a write finished is not kept (it may be from before the write)", async () => {
    const release = answer(200, () => ({ data: "old" }), true);
    const reading = get("/x");
    await Promise.resolve();
    clearGetCache();
    release();
    assert.deepEqual(await reading, { ok: true, data: "old" });
    assert.equal(getCacheSize(), 0);
  });

  test("a 401 forgets everything", async () => {
    answer(200, () => ({ data: 1 }));
    await get("/x");
    assert.equal(getCacheSize(), 1);
    answer(401, () => ({ error: { code: "SESSION_EXPIRED", message: "SESSION_EXPIRED", traceId: "t" } }));
    await get("/y");
    assert.equal(getCacheSize(), 0);
  });

  test("fresh: true and a GET with its own signal always ask the server; a fresh answer is still kept for the others", async () => {
    answer(200, () => ({ data: 1 }));
    await get("/x");
    await get("/x", undefined, undefined, { fresh: true });
    await get("/x", undefined, new AbortController().signal);
    assert.equal(urls.length, 3);
    await get("/x");
    assert.equal(urls.length, 3);
  });

  test("a soft refresh (F5) and a sign-out forget everything", async () => {
    answer(200, () => ({ data: 1 }));
    await get("/x");
    assert.equal(getCacheSize(), 1);
    assert.equal(await softRefreshAll(), "nothing");
    assert.equal(getCacheSize(), 0);
    await get("/x");
    assert.equal(getCacheSize(), 1);
    signOutInBackground();
    assert.equal(getCacheSize(), 0);
  });

  test("rememberGet keeps a joined answer under any key and does not keep a rejection", async () => {
    let runs = 0;
    const run = async () => {
      runs += 1;
      return { ok: true as const, data: runs };
    };
    assert.deepEqual(await rememberGet("/x#every", run), { ok: true, data: 1 });
    assert.deepEqual(await rememberGet("/x#every", run), { ok: true, data: 1 });
    assert.equal(runs, 1);
    await assert.rejects(rememberGet("/boom", () => Promise.reject(new Error("boom"))));
    await assert.rejects(rememberGet("/boom", () => Promise.reject(new Error("again"))), /again/);
  });
});
