import "server-only";
import type { PlatformUser, PlatformUserLevel, PlatformUserPage, PlatformUserReset, PlatformUserStatus } from "@shared/dashboards/platform";
import { TEMP_PASSWORD_NOTE } from "@shared/dashboards/platform";
import type { VerifiedSession } from "../../auth/session";
import type { AccountRole } from "../../auth/session";
import { createAccountActions, type AccountAction } from "./accountActions";
import { createGate, type PlatformMeta } from "./access";
import { byName, paged, words, type ConsoleDeps } from "./context";
import { levelOf, userView } from "./views";

// Every account on the platform, read only (docs/BACKEND.md 14.5). The Super Admin sees all five levels. A Platform Admin may read it too (the hotel
// pages need the people of a hotel) but the Super Admin and Platform Admin accounts are HIDDEN from them: those levels are never listed and never
// counted for a Platform Admin. The actions on users (disable, enable, unlock, reset password) are in accountActions.ts: Super Admin only (a Platform Admin\n// gets 403, audited, and acts on Hotel Admins through the hotel-admins routes).

const LEVEL_ORDER: readonly PlatformUserLevel[] = ["super_admin", "platform_admin", "group_admin", "hotel_admin", "hotel_user"];
const STATUSES: readonly PlatformUserStatus[] = ["active", "disabled", "locked", "pending"];
const ROLES_OF: Record<PlatformUserLevel, readonly AccountRole[]> = {
  super_admin: ["super_admin"], platform_admin: ["platform_admin"], group_admin: ["group_hotel_admin"], hotel_admin: ["hotel_admin"], hotel_user: ["hotel_user"],
};

export function createUserService(deps: ConsoleDeps) {
  const { unit, now } = deps;
  const gate = createGate(unit, now);

  async function list(session: VerifiedSession, q: { search?: string; level?: "all" | PlatformUserLevel; status?: "all" | PlatformUserStatus; hotelId?: string; groupId?: string; page: number; pageSize: number }): Promise<PlatformUserPage> {
    gate.read(session);
    const isSuper = session.accountRole === "super_admin";
    const visible = LEVEL_ORDER.filter((l) => isSuper || (l !== "super_admin" && l !== "platform_admin"));
    return unit.run(async (repos) => {
      await gate.actor(repos, session);
      const at = now();
      const rows = (await repos.accounts.list({ words: words(q.search), accountRoles: visible.flatMap((l) => ROLES_OF[l]), hotelId: q.hotelId, groupId: q.groupId }, at))
        .map((a) => userView(a, at))
        .filter((u) => (visible as readonly string[]).includes(u.level));
      const level = q.level ?? "all";
      const status = q.status ?? "all";
      const byStatus = rows.filter((u) => status === "all" || u.status === status);
      const byLevel = rows.filter((u) => level === "all" || u.level === level);
      const levels = { all: byStatus.length } as Record<"all" | PlatformUserLevel, number>;
      for (const l of LEVEL_ORDER) levels[l] = byStatus.filter((u) => u.level === l).length;
      const statuses = { all: byLevel.length } as Record<"all" | PlatformUserStatus, number>;
      for (const s of STATUSES) statuses[s] = byLevel.filter((u) => u.status === s).length;
      const out = byStatus
        .filter((u) => level === "all" || u.level === level)
        .sort((x, y) => LEVEL_ORDER.indexOf(x.level) - LEVEL_ORDER.indexOf(y.level) || (x.hotelName ?? "").localeCompare(y.hotelName ?? "", "en") || byName(x, y));
      return { ...paged(out, q.page, q.pageSize), counts: { levels, statuses } };
    });
  }

  const actions = createAccountActions(deps);
  const run = async (session: VerifiedSession, id: string, action: AccountAction, meta: PlatformMeta): Promise<{ user: PlatformUser; message?: string }> => {
    const r = await actions.act(session, meta, id, action, "user");
    return { user: userView(r.row, r.at), message: r.message };
  };
  const disable = async (session: VerifiedSession, id: string, meta: PlatformMeta): Promise<PlatformUser> => (await run(session, id, "disable", meta)).user;
  const enable = async (session: VerifiedSession, id: string, meta: PlatformMeta): Promise<PlatformUser> => (await run(session, id, "enable", meta)).user;
  const unlock = async (session: VerifiedSession, id: string, meta: PlatformMeta): Promise<PlatformUser> => (await run(session, id, "unlock", meta)).user;
  async function resetPassword(session: VerifiedSession, id: string, meta: PlatformMeta): Promise<PlatformUserReset> {
    const r = await run(session, id, "reset", meta);
    return { user: r.user, message: r.message as string, tempPasswordNote: TEMP_PASSWORD_NOTE };
  }

  return { list, disable, enable, unlock, resetPassword };
}

export type UserService = ReturnType<typeof createUserService>;
export { levelOf };
