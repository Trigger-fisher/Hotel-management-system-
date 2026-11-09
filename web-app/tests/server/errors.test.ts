import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { z } from "zod";
import { AppError, DEFAULT_MESSAGE, STATUS_BY_CODE, errorBody, toErrorResult } from "../../src/server/errors";
import { jsonError, jsonOk } from "../../src/server/http/respond";
import { TRACE_HEADER, newTraceId, traceIdFrom, traceIdFromRequest } from "../../src/server/http/trace";
import { createLogger } from "../../src/server/logger";
import { parseInput } from "../../src/server/validation/zodErrors";

const TRACE = "trace-1234567890";

describe("code -> status", () => {
  test("every code has a valid HTTP status and a default message", () => {
    for (const [code, status] of Object.entries(STATUS_BY_CODE)) {
      assert.ok(Number.isInteger(status) && status >= 400 && status <= 599, `${code} has status ${status}`);
      assert.ok(DEFAULT_MESSAGE[code as keyof typeof DEFAULT_MESSAGE], `${code} has a message`);
    }
  });
  test("the common codes map as the apps expect", () => {
    assert.equal(STATUS_BY_CODE.NOT_FOUND, 404);
    assert.equal(STATUS_BY_CODE.FORBIDDEN, 403);
    assert.equal(STATUS_BY_CODE.VALIDATION_FAILED, 422);
    assert.equal(STATUS_BY_CODE.CONFLICT, 409);
    assert.equal(STATUS_BY_CODE.RATE_LIMITED, 429);
    assert.equal(STATUS_BY_CODE.SESSION_EXPIRED, 401);
    assert.equal(STATUS_BY_CODE.SERVER_ERROR, 500);
  });
});

describe("toErrorResult", () => {
  test("AppError keeps its code, message and details", () => {
    const r = toErrorResult(new AppError("RATE_LIMITED", "Slow down", { retryAfterSeconds: 30 }), TRACE);
    assert.equal(r.status, 429);
    assert.deepEqual(r.body, { error: { code: "RATE_LIMITED", message: "Slow down", traceId: TRACE, details: { retryAfterSeconds: 30 } } });
    assert.equal(r.unexpected, false);
  });
  test("a 5xx AppError is unexpected", () => {
    assert.equal(toErrorResult(new AppError("SERVER_ERROR"), TRACE).unexpected, true);
  });
  test("an unknown error becomes SERVER_ERROR with no stack, no message, no SQL", () => {
    const boom = new Error('relation "hotel_x.bills" does not exist; password=hunter2');
    const r = toErrorResult(boom, TRACE);
    const text = JSON.stringify(r.body);
    assert.equal(r.status, 500);
    assert.equal(r.body.error.code, "SERVER_ERROR");
    assert.equal(r.body.error.traceId, TRACE);
    assert.ok(!text.includes("relation") && !text.includes("hunter2") && !text.includes("at "));
    assert.equal(r.unexpected, true);
  });
  test("non-Error throws are handled too", () => {
    for (const thrown of ["text", 42, null, undefined, { a: 1 }]) {
      assert.equal(toErrorResult(thrown, TRACE).body.error.code, "SERVER_ERROR");
    }
  });
  test("a ZodError that escaped becomes VALIDATION_FAILED with field names only", () => {
    const parsed = z.strictObject({ name: z.string() }).safeParse({ name: 5, extra: "secret-value" });
    assert.equal(parsed.success, false);
    if (parsed.success) return;
    const r = toErrorResult(parsed.error, TRACE);
    assert.equal(r.status, 422);
    assert.deepEqual(r.body.error.details?.fields, { name: "Wrong type or missing", extra: "Unexpected field" });
    assert.ok(!JSON.stringify(r.body).includes("secret-value"));
  });
  test("errorBody omits details when there are none", () => {
    assert.ok(!("details" in errorBody("NOT_FOUND", "Not found", TRACE).error));
  });
});

describe("parseInput", () => {
  const schema = z.strictObject({ name: z.string().min(1).max(10), nights: z.number().int().min(1) });
  test("returns parsed data", () => {
    assert.deepEqual(parseInput(schema, { name: "Asha", nights: 2 }), { name: "Asha", nights: 2 });
  });
  test("rejects unknown keys, bad types and bounds with VALIDATION_FAILED", () => {
    for (const input of [{ name: "Asha", nights: 2, admin: true }, { name: "", nights: 2 }, { name: "Asha", nights: 0 }, null, "x"]) {
      assert.throws(
        () => parseInput(schema, input),
        (e: unknown) => e instanceof AppError && e.code === "VALIDATION_FAILED",
      );
    }
  });
});

describe("trace id", () => {
  test("generated ids are valid and unique", () => {
    const a = newTraceId();
    assert.notEqual(a, newTraceId());
    assert.equal(traceIdFrom(a), a);
  });
  test("a well-formed incoming id is reused", () => {
    assert.equal(traceIdFrom("abc12345-DEF_678"), "abc12345-DEF_678");
  });
  test("malformed incoming ids are replaced", () => {
    for (const bad of [null, undefined, "", "short", "a".repeat(65), "has space 12345", "line\nbreak12345", "<script>12345", "semi;colon12345"]) {
      const id = traceIdFrom(bad);
      assert.notEqual(id, bad);
      assert.match(id, /^[A-Za-z0-9_-]{8,64}$/);
    }
  });
  test("read from a request header", () => {
    const request = new Request("http://localhost/api/v1/health", { headers: { [TRACE_HEADER]: "from-caller-123" } });
    assert.equal(traceIdFromRequest(request), "from-caller-123");
  });
});

describe("responses", () => {
  test("jsonOk wraps the data in { data }, with the trace header and no-store", async () => {
    const res = jsonOk({ a: 1 }, TRACE);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get(TRACE_HEADER), TRACE);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(await res.json(), { data: { a: 1 } });
  });
  test("the envelope holds any JSON value: a list, a number, null, and a custom status", async () => {
    for (const value of [[1, 2], 5, null, "text", { items: [], total: 0 }]) {
      assert.deepEqual(await jsonOk(value, TRACE).json(), { data: value });
    }
    assert.equal(jsonOk({ id: 1 }, TRACE, 201).status, 201);
  });
  test("a success body never has an `error` key and an error body never has `data`", async () => {
    const ok = (await jsonOk({ x: 1 }, TRACE).json()) as Record<string, unknown>;
    const err = (await jsonError(new AppError("NOT_FOUND"), TRACE).json()) as Record<string, unknown>;
    assert.ok(!("error" in ok) && "data" in ok);
    assert.ok("error" in err && !("data" in err));
  });
  test("jsonError sends the standard body, status, trace header and Retry-After", async () => {
    const res = jsonError(new AppError("RATE_LIMITED", undefined, { retryAfterSeconds: 12.2 }), TRACE);
    assert.equal(res.status, 429);
    assert.equal(res.headers.get(TRACE_HEADER), TRACE);
    assert.equal(res.headers.get("retry-after"), "13");
    const body = (await res.json()) as { error: { code: string; traceId: string } };
    assert.equal(body.error.code, "RATE_LIMITED");
    assert.equal(body.error.traceId, TRACE);
  });
  test("jsonError logs the cause (redacted) with the trace id, and the caller never sees it", async () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "debug", write: (line) => lines.push(line) });
    const res = jsonError(new Error("db down, password=abc user token secret"), TRACE, logger);
    const text = await res.text();
    assert.ok(!text.includes("db down"));
    assert.equal(lines.length, 1);
    const logged = JSON.parse(lines[0]) as Record<string, unknown>;
    assert.equal(logged.level, "error");
    assert.equal(logged.traceId, TRACE);
    assert.equal(logged.code, "SERVER_ERROR");
  });
  test("a 4xx is logged as a warning", () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "debug", write: (line) => lines.push(line) });
    jsonError(new AppError("NOT_FOUND"), TRACE, logger);
    assert.equal((JSON.parse(lines[0]) as { level: string }).level, "warn");
  });
});
