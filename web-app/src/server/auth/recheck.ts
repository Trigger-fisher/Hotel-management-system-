import "server-only";
import { RECHECK_MINUTES } from "@shared/dashboards/security";
import { AppError } from "../errors";
import type { VerifiedSession } from "./session";

export const RECHECK_REQUIRED_MESSAGE = "Confirm it is you to see this.";
/** The FORBIDDEN answer's details.reason when a re-check is needed: the screen then asks for the password or a code and tries again. */
export const RECHECK_REASON = "recheck_required";

/** Is the session's last re-check (password or emailed code) still within RECHECK_MINUTES? */
export function freshlyRechecked(session: VerifiedSession, at: Date): boolean {
  const t = session.recheckedAt?.getTime();
  return t !== undefined && t <= at.getTime() && at.getTime() - t < RECHECK_MINUTES * 60_000;
}

/** A vault shows a secret only to a browser session that proved it is the person again in the last 5 minutes (MJ, 5 Nov 2026). An API key never can. */
export function assertRechecked(session: VerifiedSession, at: Date): void {
  if (session.client !== "web" || !freshlyRechecked(session, at)) throw new AppError("FORBIDDEN", RECHECK_REQUIRED_MESSAGE, { reason: RECHECK_REASON });
}
