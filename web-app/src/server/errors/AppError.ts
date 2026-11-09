import "server-only";
import type { ApiError } from "@shared/auth/types";
import { DEFAULT_MESSAGE, type ApiErrorCode } from "./codes";

/** Optional extra fields the apps understand: retryAfterSeconds, fields (name -> problem), attemptsLeft. */
// currentVersion: CONFLICT on a stale optimistic update (the version the record has now). Not in ui-shared yet: the Lead adds it there.
// reason: why ACCOUNT_BLOCKED / ACCOUNT_DISABLED refused a sign-in (hotel_pending, group_pending, hotel_suspended, hotel_archived, hotel_rejected);
// sent only after a correct password. Not in ui-shared yet (contract request: auth-pallav PallavBlockedReason + flow.blockedReasonOf).
// serverCode: which friendly page the PUBLIC onboarding link shows for a refused token (NOT_FOUND, EXPIRED, ALREADY_SUBMITTED, CANCELLED).
export type ErrorDetails = NonNullable<ApiError["details"]> & { currentVersion?: number; reason?: string; serverCode?: string };

/**
 * An error the service layer throws on purpose. The message must be safe to show in a log and must never
 * hold a secret, an ID number or SQL text. Anything that is not an AppError is treated as a bug and answered
 * with SERVER_ERROR.
 */
export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly details?: ErrorDetails;

  constructor(code: ApiErrorCode, message?: string, details?: ErrorDetails, options?: { cause?: unknown }) {
    super(message ?? DEFAULT_MESSAGE[code], options);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
}

export function isAppError(value: unknown): value is AppError {
  if (value instanceof AppError) return true;
  // the same error built by ANOTHER copy of this class (a bundler can load a module twice, e.g. src/db and the route code in separate chunks) is still ours: without this a
  // plain "FORBIDDEN: Hotel is not available" would be answered as a 500 SERVER_ERROR
  const e = value as { name?: unknown; code?: unknown; message?: unknown } | null;
  return typeof e === "object" && e !== null && e.name === "AppError" && typeof e.code === "string" && e.code in DEFAULT_MESSAGE && typeof e.message === "string";
}
