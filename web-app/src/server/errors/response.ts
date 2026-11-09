import "server-only";
import { z } from "zod";
import { fieldsFromZod } from "../validation/zodErrors";
import { AppError, isAppError, type ErrorDetails } from "./AppError";
import { DEFAULT_MESSAGE, statusFor, type ApiErrorCode } from "./codes";

/** The one error body every endpoint returns (MASTER section 7). The apps show their own text for `code`. */
export interface ErrorBody {
  error: { code: ApiErrorCode; message: string; traceId: string; details?: ErrorDetails };
}

export interface ErrorResult {
  status: number;
  body: ErrorBody;
  /** True for bugs (anything that was not an AppError, or a 5xx code): log at error level with the cause. */
  unexpected: boolean;
}

export function errorBody(code: ApiErrorCode, message: string, traceId: string, details?: ErrorDetails): ErrorBody {
  return { error: { code, message, traceId, ...(details ? { details } : {}) } };
}

/**
 * Turns anything thrown into the response to send. AppError -> its code. A zod error that escaped -> VALIDATION_FAILED.
 * Everything else -> SERVER_ERROR with a generic message: no stack, no SQL text, no driver message ever leaves the server.
 */
export function toErrorResult(thrown: unknown, traceId: string): ErrorResult {
  if (isAppError(thrown)) {
    const status = statusFor(thrown.code);
    return { status, body: errorBody(thrown.code, thrown.message, traceId, thrown.details), unexpected: status >= 500 };
  }
  if (thrown instanceof z.ZodError) {
    const failed = new AppError("VALIDATION_FAILED", undefined, { fields: fieldsFromZod(thrown) });
    return { status: statusFor(failed.code), body: errorBody(failed.code, failed.message, traceId, failed.details), unexpected: false };
  }
  return {
    status: statusFor("SERVER_ERROR"),
    body: errorBody("SERVER_ERROR", DEFAULT_MESSAGE.SERVER_ERROR, traceId),
    unexpected: true,
  };
}
