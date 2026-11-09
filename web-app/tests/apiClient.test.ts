// Unit tests for src/lib/api/client.ts: the one HTTP layer (envelope, DashResult mapping, Idempotency-Key, 401, 429).
// Run with `npm test` (Node's built-in runner; Node strips the TypeScript types).
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { afterEach, describe, test } from "node:test";

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

const { http, dash, get, buildQuery, newIdempotencyKey } = await import("../src/lib/api/client");
const { clearGetCache } = await import("../src/lib/api/getCache");
const { onSessionEnded } = await import("../src/lib/api/sessionEvents");

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}
const realFetch = globalThis.fetch;
let seen: Seen[] = [];

function answer(status: number, body: unknown, headers: Record<string, string> = {}) {
  seen = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push({ url, method: init.method ?? "GET", headers: init.headers as Record<string, string>, body: init.body as string | undefined });
    return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", "x-trace-id": "trace-123", ...headers } });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  // a GET answer is remembered for 20 s (getCache.ts): no test sees another's
  clearGetCache();
});

describe("api client", () => {
  test("a success envelope gives the data", async () => {
    answer(200, { data: { id: "1" } });
    const r = await http<{ id: string }>("GET", "/billing/bills/1");
    assert.deepEqual(r.ok && r.data, { id: "1" });
    assert.equal(seen[0]?.url, "/api/v1/billing/bills/1");
  });

  test("a GET has no Idempotency-Key, every write has a valid and fresh one", async () => {
    answer(200, { data: {} });
    await http("GET", "/x");
    assert.equal(seen[0]?.headers["Idempotency-Key"], undefined);
    await http("POST", "/x", { body: { a: 1 } });
    await http("POST", "/x", { body: { a: 1 } });
    const [a, b] = [seen[1]?.headers["Idempotency-Key"], seen[2]?.headers["Idempotency-Key"]];
    assert.match(a ?? "", /^[A-Za-z0-9_-]{8,128}$/);
    assert.notEqual(a, b);
    assert.equal(seen[1]?.body, '{"a":1}');
    assert.equal(seen[1]?.headers["Content-Type"], "application/json");
  });

  test("a retry can reuse its key", async () => {
    answer(200, { data: {} });
    const key = newIdempotencyKey();
    await http("PATCH", "/x", { body: {}, idempotencyKey: key });
    assert.equal(seen[0]?.headers["Idempotency-Key"], key);
  });

  test("422 keeps the field sentences", async () => {
    answer(422, { error: { code: "VALIDATION_FAILED", message: "Check the fields", traceId: "t1", details: { fields: { amount: "The amount field is required." } } } });
    const r = await dash("POST", "/revenue/deposits", { body: {} });
    assert.ok(!r.ok);
    assert.equal(r.error.code, "VALIDATION_FAILED");
    assert.equal(r.error.details?.fields?.amount, "The amount field is required.");
    assert.equal(r.error.traceId, "t1");
  });

  test("409 keeps the current version", async () => {
    answer(409, { error: { code: "CONFLICT", message: "Someone else changed this", traceId: "t2", details: { currentVersion: 7 } } });
    const r = await dash("PATCH", "/billing/bills/1", { body: { version: 3 } });
    assert.ok(!r.ok);
    assert.equal(r.error.code, "CONFLICT");
    assert.equal(r.error.details?.currentVersion, 7);
  });

  test("401 ends the session once, for any number of calls, and is SESSION_EXPIRED for the screen", async () => {
    answer(401, { error: { code: "SESSION_EXPIRED", message: "SESSION_EXPIRED", traceId: "t3" } });
    const ended: string[] = [];
    const off = onSessionEnded((c) => ended.push(c));
    const rs = await Promise.all([dash("GET", "/a"), dash("GET", "/b"), dash("GET", "/c")]);
    off();
    assert.deepEqual(ended, ["SESSION_EXPIRED"]);
    const first = rs[0];
    assert.ok(first && !first.ok);
    assert.equal(first.error.code, "SESSION_EXPIRED");
    assert.equal(first.error.details?.serverCode, undefined);
  });

  test("a wrong password on the auth routes does not end the session", async () => {
    answer(401, { error: { code: "INVALID_CREDENTIALS", message: "INVALID_CREDENTIALS", traceId: "t4" } });
    const ended: string[] = [];
    const off = onSessionEnded((c) => ended.push(c));
    const r = await http("POST", "/auth/sign-in", { body: {}, keepSessionOn401: true });
    off();
    assert.deepEqual(ended, []);
    assert.ok(!r.ok);
    assert.equal(r.error.code, "INVALID_CREDENTIALS");
  });

  test("429 keeps Retry-After", async () => {
    answer(429, { error: { code: "RATE_LIMITED", message: "RATE_LIMITED", traceId: "t5" } }, { "retry-after": "12" });
    const r = await dash("GET", "/search", { query: { q: "ab" } });
    assert.ok(!r.ok);
    assert.equal(r.error.code, "RATE_LIMITED");
    assert.equal(r.error.details?.retryAfterSeconds, 12);
  });

  test("a failed network call and a non-JSON answer are SERVER_ERROR and never throw", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const a = await dash("GET", "/x");
    assert.ok(!a.ok && a.error.code === "SERVER_ERROR");
    globalThis.fetch = (async () => new Response("<html>bad gateway</html>", { status: 502 })) as typeof fetch;
    const b = await dash("GET", "/x");
    assert.ok(!b.ok && b.error.code === "SERVER_ERROR");
  });

  test("a dash GET is remembered, http GETs and fresh GETs are not", async () => {
    answer(200, { data: { id: "1" } });
    await get("/billing/bills/1");
    await get("/billing/bills/1");
    assert.equal(seen.length, 1);
    await get("/billing/bills/1", undefined, undefined, { fresh: true });
    await http("GET", "/billing/bills/1");
    await http("GET", "/billing/bills/1");
    assert.equal(seen.length, 4);
  });

  test("the query leaves out empty values and escapes the rest", () => {
    assert.equal(buildQuery({ q: "a b&c", page: 2, tab: "", x: undefined, y: null, ok: false }), "?q=a%20b%26c&page=2&ok=false");
    assert.equal(buildQuery(undefined), "");
  });
});
