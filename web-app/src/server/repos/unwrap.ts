import "server-only";
import { AppError } from "../errors";
import type { VersionedResult } from "./types";

/** Turns an optimistic update's result into the record, or the error the apps understand: NOT_FOUND, or CONFLICT with the version it has now. */
export function unwrapVersioned<T>(result: VersionedResult<T>): T {
  if (result.ok) return result.record;
  if (result.reason === "not_found") throw new AppError("NOT_FOUND");
  throw new AppError("CONFLICT", undefined, { currentVersion: result.currentVersion });
}
