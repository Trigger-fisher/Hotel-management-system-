import "server-only";
// Every error code the API can return, and the HTTP status each one maps to.
// The code lists live in ui-shared (the apps show a friendly text per code, never the server's message).
// The status table below is typed on those unions, so adding a code in ui-shared fails the type check until
// it is given a status here.
import type { AuthErrorCode } from "@shared/auth/types";
import type { DashErrorCode } from "@shared/dashboards/common";

export type ApiErrorCode = AuthErrorCode | DashErrorCode;

export const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  INVALID_CREDENTIALS: 401,
  ACCOUNT_LOCKED: 423,
  ACCOUNT_DISABLED: 403,
  INVALID_CODE: 401,
  CODE_ATTEMPTS_EXCEEDED: 429,
  CHALLENGE_EXPIRED: 410,
  RESET_LINK_INVALID: 400,
  RESET_LINK_EXPIRED: 410,
  PASSWORD_TOO_WEAK: 422,
  PASSWORD_REUSED: 422,
  SCREEN_LOCKED: 423,
  SESSION_EXPIRED: 401,
  SESSION_REPLACED: 401,
  SESSION_REVOKED: 401,
  ACCOUNT_BLOCKED: 403,
  PASSWORD_CHANGE_REQUIRED: 403,
  IDEMPOTENCY_KEY_REUSED: 422,
  REQUEST_IN_PROGRESS: 409,
  VALIDATION_FAILED: 422,
  RATE_LIMITED: 429,
  NETWORK_OFFLINE: 503,
  SERVER_ERROR: 500,
  UNKNOWN: 500,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  CONFLICT: 409,
  // decision 47: a portal account (guest, company) with no record behind it, or one whose record is switched off
  PORTAL_NOT_LINKED: 409,
  PORTAL_INACTIVE: 409,
};

/** Short, safe, English text for logs and tools. The apps never show it; they show their own text for the code. */
export const DEFAULT_MESSAGE: Record<ApiErrorCode, string> = {
  INVALID_CREDENTIALS: "Sign-in details are not correct",
  ACCOUNT_LOCKED: "Account is locked",
  ACCOUNT_DISABLED: "Account is disabled",
  INVALID_CODE: "Code is not correct",
  CODE_ATTEMPTS_EXCEEDED: "Too many wrong codes",
  CHALLENGE_EXPIRED: "Sign-in step expired",
  RESET_LINK_INVALID: "Reset link is not valid",
  RESET_LINK_EXPIRED: "Reset link expired",
  PASSWORD_TOO_WEAK: "Password is too weak",
  PASSWORD_REUSED: "Password was used before",
  SCREEN_LOCKED: "Screen is locked",
  SESSION_EXPIRED: "Session expired",
  SESSION_REPLACED: "Session was replaced by a newer sign-in",
  SESSION_REVOKED: "Session was ended",
  ACCOUNT_BLOCKED: "Account is blocked",
  PASSWORD_CHANGE_REQUIRED: "Password must be changed first",
  IDEMPOTENCY_KEY_REUSED: "Idempotency key was used with different data",
  REQUEST_IN_PROGRESS: "The same request is still running",
  VALIDATION_FAILED: "Some details need fixing",
  RATE_LIMITED: "Too many requests",
  NETWORK_OFFLINE: "Service unavailable",
  SERVER_ERROR: "Something went wrong",
  UNKNOWN: "Something went wrong",
  NOT_FOUND: "Not found",
  FORBIDDEN: "Not allowed",
  CONFLICT: "Conflicts with a newer change",
  PORTAL_NOT_LINKED: "This account is not linked to a record yet",
  PORTAL_INACTIVE: "The record behind this account is switched off",
};

export function statusFor(code: ApiErrorCode): number {
  return STATUS_BY_CODE[code];
}
