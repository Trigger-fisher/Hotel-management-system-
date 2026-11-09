import "server-only";
import { platformCopy } from "@shared/dashboards/platform";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { PlatformAccountRow } from "../../repos/platformConsole";
import { createGate, type AuditInput, type PlatformMeta } from "./access";
import type { ConsoleDeps } from "./context";
import { accountStatus } from "./views";

// Disable, enable, unlock and reset the password of ONE account of any level (docs/BACKEND.md 14.5 users, 14.6 platform staff). The rules are the
// mock's: a waiting account cannot be disabled or reset, a disabled one cannot be reset, the last active Super Admin cannot be disabled; a Platform
// Admin may act on hotel-level accounts but not on Super Admin / Platform Admin ones (403, audited); the staff screens are Super Admin only.
// Disable also ends the person's sessions. Every outcome, refused ones included, is in the audit trail.

const E = platformCopy.errors;
const X = platformCopy.a8Errors;

export type AccountAction = "disable" | "enable" | "unlock" | "reset";
const AUDIT = { disable: "user_disabled", enable: "user_enabled", unlock: "user_unlocked", reset: "user_password_reset" } as const;
const LIVE_HOTEL = ["active", "suspended"];

export interface ActionResult {
  row: PlatformAccountRow;
  at: Date;
  message?: string;
}

export function createAccountActions(deps: ConsoleDeps) {
  const { unit, now } = deps;
  const gate = createGate(unit, now);

  /** `scope` "staff": Platform Admin accounts only. "user": any account. Super Admin only either way. */
  async function act(session: VerifiedSession, meta: PlatformMeta, id: string, action: AccountAction, scope: "user" | "staff"): Promise<ActionResult> {
    const probe: AuditInput = { action: AUDIT[action], entity: "user", entityId: id };
    await gate.superWrite(session, meta, probe); // both the users and the staff screens are Super Admin only; a Platform Admin acts on Hotel Admins through the hotel-admins routes
    const outcome = await unit.run(async (repos): Promise<{ ok: ActionResult } | { refused: AppError; input: AuditInput }> => {
      const actor = await gate.actor(repos, session);
      const at = now();
      const a = await repos.accounts.get(id, { forUpdate: true });
      if (!a) throw new AppError("NOT_FOUND");
      if (scope === "staff" && a.accountRole !== "platform_admin") throw new AppError("NOT_FOUND", X.notStaff);
      const input: AuditInput = { ...probe, hotelId: a.hotelId, groupId: a.groupId, targetLabel: a.displayName };
      const status = accountStatus(a, at);
      const hotelGone = a.hotelStatus !== null && !LIVE_HOTEL.includes(a.hotelStatus);
      let message: string | undefined;
      switch (action) {
        case "disable":
          if (status === "pending") throw new AppError("CONFLICT", E.accountPending);
          if (status === "disabled") throw new AppError("CONFLICT", E.alreadyDisabled);
          if (a.accountRole === "super_admin" && (await repos.accounts.activeSuperAdmins()) <= 1) return { refused: new AppError("CONFLICT", E.lastSuperAdmin), input };
          await repos.accounts.setStatus(a.id, "disabled", a.hotelId);
          await repos.accounts.endSessions(a.id, at);
          break;
        case "enable":
          if (status !== "disabled") throw new AppError("CONFLICT", E.notDisabled);
          if (hotelGone) throw new AppError("CONFLICT", E.hotelNotLive);
          await repos.accounts.setStatus(a.id, "active", a.hotelId);
          break;
        case "unlock":
          if (status !== "locked") throw new AppError("CONFLICT", E.notLocked);
          if (hotelGone) throw new AppError("CONFLICT", E.hotelNotLive);
          await repos.accounts.unlock(a.id);
          await repos.auth.events.event({ userId: a.id, hotelId: a.hotelId ?? null, event: "account_unlocked", ip: meta.ip, userAgent: null, detail: { by: actor.userId }, at });
          break;
        case "reset":
          if (status === "pending") throw new AppError("CONFLICT", E.accountPending);
          if (status === "disabled") throw new AppError("CONFLICT", E.disabledNoReset);
          if (hotelGone) throw new AppError("CONFLICT", E.hotelNotLive);
          await deps.credentials(repos).adminResetPassword(a.id);
          message = platformCopy.users.resetSent(a.email ?? "");
          break;
      }
      await gate.audit(repos, actor, meta, input);
      const row = await repos.accounts.get(a.id);
      if (!row) throw new AppError("SERVER_ERROR");
      return { ok: { row, at, message } };
    });
    if ("refused" in outcome) throw await gate.refuse(session, meta, outcome.input, outcome.refused);
    return outcome.ok;
  }

  return { act };
}

export type AccountActions = ReturnType<typeof createAccountActions>;
