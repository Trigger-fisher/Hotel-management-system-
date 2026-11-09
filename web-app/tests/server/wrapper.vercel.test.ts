// The wrapper's body cap on Vercel (process.env.VERCEL set): the host refuses a body above 4.5 MB before the function runs, so every route is capped at
// 4,400,000 bytes there; a route that declares more still works up to the cap, and over it the answer is a clear 413 sentence. Without VERCEL nothing changes.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { z } from "zod";
import type { VerifiedSession } from "../../src/server/auth/session";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { createRouteFactory, HOST_BODY_TOO_BIG, VERCEL_MAX_BODY_BYTES } from "../../src/server/http/wrapper";
import { createLogger } from "../../src/server/logger";
import { catalog, grant, makeSession } from "./helpers/session";

const ORIGIN = "https://hms.test";
const sessions = new Map<string, VerifiedSession>([["admin", makeSession({ client: "web", grants: [grant("revenue", "full")], userId: "00000000-0000-4000-8000-000000000004" })]]);
const { route } = createRouteFactory({
  resolveSession: async (request) => sessions.get(request.headers.get("x-test-session") ?? "") ?? null,
  catalog,
  idempotency: createMemoryIdempotencyStore(),
  logger: createLogger({ level: "silent", write: () => undefined }),
});
const body = z.strictObject({ data: z.string().max(50_000_000) });
const big = route({ permission: "session", body, maxBodyBytes: 40 * 1024 * 1024, idempotency: "off", handler: async ({ body: b }) => ({ data: { length: b.data.length } }) });
const small = route({ permission: "session", body, idempotency: "off", handler: async ({ body: b }) => ({ data: { length: b.data.length } }) });

const send = (handler: typeof big, size: number, headers: Record<string, string> = {}) =>
  handler(new Request(`${ORIGIN}/x`, { method: "POST", headers: { host: "hms.test", origin: ORIGIN, "x-test-session": "admin", "content-type": "application/json", ...headers }, body: JSON.stringify({ data: "a".repeat(size) }) }), { params: Promise.resolve({}) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
const json = async (res: Response) => (await res.json()) as any;

let before: string | undefined;
beforeEach(() => {
  before = process.env.VERCEL;
});
afterEach(() => {
  if (before === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = before;
});

describe("the request body cap on Vercel", () => {
  test("on Vercel a route that declares 40 MB works up to 4,400,000 bytes", async () => {
    process.env.VERCEL = "1";
    const res = await send(big, VERCEL_MAX_BODY_BYTES - 100);
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal((await json(res)).data.length, VERCEL_MAX_BODY_BYTES - 100);
  });

  test("on Vercel a body over the cap: 413 with one clear sentence, by its length or by its content-length header", async () => {
    process.env.VERCEL = "1";
    for (const res of [await send(big, VERCEL_MAX_BODY_BYTES + 10), await send(big, 10, { "content-length": String(VERCEL_MAX_BODY_BYTES + 1) })]) {
      assert.equal(res.status, 413);
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.ok(res.headers.get("x-trace-id"));
      const b = await json(res);
      assert.equal(b.error.code, "VALIDATION_FAILED");
      assert.equal(b.error.message, HOST_BODY_TOO_BIG);
      assert.equal(b.error.details.fields._, HOST_BODY_TOO_BIG);
    }
  });

  test("on Vercel a route's own smaller limit is unchanged (422, as everywhere)", async () => {
    process.env.VERCEL = "1";
    const res = await send(small, 300_000);
    assert.equal(res.status, 422);
    assert.equal((await json(res)).error.details.fields._, "Request is too large");
  });

  test("without VERCEL nothing changes: the route's own limit applies (a 5 MB body is fine under 40 MB)", async () => {
    delete process.env.VERCEL;
    assert.equal((await send(big, 5_000_000)).status, 200);
    assert.equal((await send(small, 300_000)).status, 422);
  });
});
