import "server-only";
import { randomUUID } from "node:crypto";

export const TRACE_HEADER = "x-trace-id";

// An incoming id is only reused when it is short and plain, so a caller can never put markup, spaces or a
// log-forging newline into our logs.
const VALID_TRACE_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function newTraceId(): string {
  return randomUUID();
}

/** The caller's x-trace-id when it is well formed, otherwise a fresh one. */
export function traceIdFrom(headerValue: string | null | undefined): string {
  if (headerValue && VALID_TRACE_ID.test(headerValue)) return headerValue;
  return newTraceId();
}

export function traceIdFromRequest(request: Request): string {
  return traceIdFrom(request.headers.get(TRACE_HEADER));
}
