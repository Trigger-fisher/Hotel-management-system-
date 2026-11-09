import "server-only";
import { createHash } from "node:crypto";
import { toErrorResult } from "../errors";
import type { Logger } from "../logger/logger";
import { TRACE_HEADER } from "./trace";

const BASE_HEADERS = { "cache-control": "no-store" } as const;

/**
 * A success response in the one envelope `{ "data": T }` (A7), with the trace id header. The envelope leaves room for paging and
 * other meta next to `data` without breaking a client. Errors keep their own body, `{ error: { code, message, traceId } }`.
 */
export function jsonOk(data: unknown, traceId: string, status = 200, extra: readonly (readonly [string, string])[] = []): Response {
  const headers = new Headers({ ...BASE_HEADERS, [TRACE_HEADER]: traceId });
  // append, not set: several Set-Cookie lines must stay separate
  for (const [name, value] of extra) headers.append(name, value);
  return Response.json({ data }, { status, headers });
}

/**
 * A success answer that the browser may keep and ask about again (T2, list reads): the same envelope with a weak ETag over the body. When the caller's
 * If-None-Match names that ETag (or *), the answer is 304 with no body and the browser shows what it already has. The server still built the data:
 * what is saved is the bytes on the wire, and a list that did not change paints without a flash. The route's `cache` (`private, no-cache`) is put on
 * by the wrapper, so the browser revalidates every time and nothing stale is ever shown.
 */
export function jsonOkRevalidated(data: unknown, traceId: string, ifNoneMatch: string | null, extra: readonly (readonly [string, string])[] = []): Response {
  const body = JSON.stringify({ data });
  const etag = `W/"${createHash("sha256").update(body, "utf8").digest("base64url").slice(0, 27)}"`;
  const headers = new Headers({ ...BASE_HEADERS, [TRACE_HEADER]: traceId, etag, "content-type": "application/json" });
  for (const [name, value] of extra) headers.append(name, value);
  const asked = (ifNoneMatch ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  if (asked.some((t) => t === "*" || t === etag || `W/${t}` === etag)) return new Response(null, { status: 304, headers });
  return new Response(body, { status: 200, headers });
}

/**
 * An error response in the standard format. `logger` receives the real cause (redacted by the logger) with the
 * trace id; the caller gets only the code, a safe message and the trace id.
 */
export function jsonError(thrown: unknown, traceId: string, logger?: Logger): Response {
  const { status, body, unexpected } = toErrorResult(thrown, traceId);
  const headers: Record<string, string> = { ...BASE_HEADERS, [TRACE_HEADER]: traceId };
  const retryAfter = body.error.details?.retryAfterSeconds;
  if (retryAfter !== undefined) headers["retry-after"] = String(Math.max(0, Math.ceil(retryAfter)));
  if (logger) {
    // an unexpected failure keeps its cause (with the stack) for the log; an expected refusal (4xx: a wrong password, no session, a rule) logs only its code
    if (unexpected) logger.error("request failed", { traceId, code: body.error.code, status, cause: thrown });
    else logger.warn("request rejected", { traceId, code: body.error.code, status });
  }
  return Response.json(body, { status, headers });
}
