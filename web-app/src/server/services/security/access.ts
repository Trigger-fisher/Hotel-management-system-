import "server-only";
import type { VerifiedSession } from "../../auth/session";
import { isPortalAccount } from "../../auth/permissions";
import { AppError } from "../../errors";
import type { ResetActor } from "./resets";

/** The Super Admin in the browser, or 403. Not a portal account, not inside a hotel visit and never an API key: an emergency reset is a person's decision. */
export function resetActor(session: VerifiedSession): ResetActor {
  if (isPortalAccount(session) || session.visit !== undefined || session.token || session.accountRole !== "super_admin") throw new AppError("FORBIDDEN", "Only a Super Admin can use the security tools.");
  return { userId: session.userId, name: session.username ?? "Super Admin", isSuper: true };
}
