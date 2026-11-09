import "server-only";
import type { PlatformAdminHotelAccess, PlatformAdminHotelAccessInput, PlatformAdminInput, PlatformStaff, PlatformStaffCreated, PlatformStaffPage, PlatformStaffQuery, PlatformStaffReset } from "@shared/dashboards/platform";
import { TEMP_PASSWORD_NOTE, platformCopy } from "@shared/dashboards/platform";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { AdminHotelAccess, PlatformConsoleRepos } from "../../repos/platformConsole";
import { createAccountActions, type AccountAction } from "./accountActions";
import { createGate, type PlatformMeta } from "./access";
import { byName, paged, words, type ConsoleDeps } from "./context";
import { checkAdmin, failIfAny, lower, storedMobile, MOBILE_TAKEN, type Fields } from "./validate";
import { staffView } from "./views";

// Platform Admin accounts (platform staff), Super Admin only (docs/BACKEND.md 14.6). The role is ALWAYS platform_admin: nobody raises rights here, and
// Super Admins are never listed or changed on these screens. A new account gets a temporary password by e-mail and must choose its own on first sign-in.

const E = platformCopy.errors;

export function createStaffService(deps: ConsoleDeps) {
  const { unit, now } = deps;
  const gate = createGate(unit, now);
  const actions = createAccountActions(deps);

  async function list(session: VerifiedSession, q: { search?: string; status?: PlatformStaffQuery["status"]; page: number; pageSize: number }): Promise<PlatformStaffPage> {
    gate.superRead(session);
    return unit.run(async (repos) => {
      const actor = await gate.actor(repos, session);
      const at = now();
      const matched = (await repos.accounts.list({ words: words(q.search), accountRoles: ["platform_admin"] }, at)).map((a) => staffView(a, at, actor.userId));
      const n = (s: PlatformStaff["status"]): number => matched.filter((u) => u.status === s).length;
      const counts = { all: matched.length, active: n("active"), locked: n("locked"), disabled: n("disabled") };
      const status = q.status ?? "all";
      const rows = matched.filter((u) => status === "all" || u.status === status).sort(byName);
      return { ...paged(rows, q.page, q.pageSize), counts, superAdminCount: await repos.accounts.activeSuperAdmins() };
    });
  }

  async function create(session: VerifiedSession, input: PlatformAdminInput, meta: PlatformMeta): Promise<PlatformStaffCreated> {
    const probe = { action: "staff_created", entity: "user", entityId: null } as const;
    await gate.superWrite(session, meta, probe);
    const f: Fields = {};
    checkAdmin(input, "", f);
    return unit.run(async (repos) => {
      const actor = await gate.actor(repos, session);
      const at = now();
      if (!f.username && (await repos.accounts.usernameTaken(lower(input.username)))) f.username = E.usernameTaken;
      if (!f.email && (await repos.accounts.emailTaken(lower(input.email)))) f.email = E.emailTaken;
      const mobile = storedMobile(input.mobile);
      if (!f.mobile && mobile && (await repos.accounts.mobileTaken(mobile))) f.mobile = MOBILE_TAKEN;
      failIfAny(f);
      // the placeholder role has no hotel permission and platform staff have no hotel: what they may do comes from the account role alone
      const id = await repos.accounts.create(
        { username: lower(input.username), email: lower(input.email), mobile: mobile as string, displayName: input.name.trim(), accountRole: "platform_admin", roleKey: "viewer", hotelId: null },
        actor.userId, at,
      );
      await deps.credentials(repos).issueInvite(id);
      const row = await repos.accounts.get(id);
      if (!row) throw new AppError("SERVER_ERROR");
      await gate.audit(repos, actor, meta, { ...probe, entityId: id, targetLabel: row.displayName });
      return { staff: staffView(row, at, actor.userId), tempPasswordNote: TEMP_PASSWORD_NOTE };
    });
  }

  const run = async (session: VerifiedSession, id: string, action: AccountAction, meta: PlatformMeta, actorId?: string) => {
    const r = await actions.act(session, meta, id, action, "staff");
    return { staff: staffView(r.row, r.at, actorId ?? session.userId), message: r.message };
  };
  const disable = async (session: VerifiedSession, id: string, meta: PlatformMeta): Promise<PlatformStaff> => (await run(session, id, "disable", meta)).staff;
  const enable = async (session: VerifiedSession, id: string, meta: PlatformMeta): Promise<PlatformStaff> => (await run(session, id, "enable", meta)).staff;
  const unlock = async (session: VerifiedSession, id: string, meta: PlatformMeta): Promise<PlatformStaff> => (await run(session, id, "unlock", meta)).staff;
  async function resetPassword(session: VerifiedSession, id: string, meta: PlatformMeta): Promise<PlatformStaffReset> {
    const r = await run(session, id, "reset", meta);
    return { staff: r.staff, message: r.message as string, tempPasswordNote: TEMP_PASSWORD_NOTE };
  }

  /** The platform admin's account, or 404 (a Super Admin or any other account is not on these screens). */
  async function staffRow(repos: PlatformConsoleRepos, id: string) {
    const row = await repos.accounts.get(id);
    if (!row || row.accountRole !== "platform_admin") throw new AppError("NOT_FOUND");
    return row;
  }

  const accessView = async (repos: PlatformConsoleRepos, userId: string, a: AdminHotelAccess): Promise<PlatformAdminHotelAccess> => ({
    userId, level: a.level, allHotels: a.allHotels, hotelIds: a.allHotels ? [] : a.hotelIds, reason: a.reason,
    updatedBy: a.updatedBy ? ((await repos.accounts.get(a.updatedBy))?.displayName ?? null) : null,
    updatedAt: a.updatedAt ? a.updatedAt.toISOString() : null,
  });

  /** What this platform admin may do when entering hotels (platform 0135); the default (view, all hotels) when never set. Super Admin only. */
  async function getHotelAccess(session: VerifiedSession, id: string): Promise<PlatformAdminHotelAccess> {
    gate.superRead(session);
    return unit.run(async (repos) => {
      await staffRow(repos, id);
      return accessView(repos, id, await repos.adminAccess.get(id));
    });
  }

  /** Sets it; audited (platform_admin_access_changed, before and after). A visit already under way keeps its access: the next one uses the new. */
  async function setHotelAccess(session: VerifiedSession, id: string, input: PlatformAdminHotelAccessInput, meta: PlatformMeta): Promise<PlatformAdminHotelAccess> {
    const probe = { action: "platform_admin_access_changed", entity: "user", entityId: id } as const;
    await gate.superWrite(session, meta, probe);
    const reason = (input.reason ?? "").trim();
    const hotelIds = input.allHotels ? [] : [...new Set(input.hotelIds ?? [])];
    const f: Fields = {};
    // a Platform Admin visits view only (MJ, 5 Nov 2026): full power inside a hotel is the Super Admin's
    if (input.level === "full") f.level = "A Platform Admin can view hotels only. Choose View only or No access.";
    if (Array.from(reason).length < 5) f.reason = "Give the reason in at least 5 characters.";
    else if (Array.from(reason).length > 500) f.reason = E.reasonLong;
    if (!input.allHotels && input.level !== "none" && hotelIds.length === 0) f.hotelIds = "Choose at least one hotel, or allow all hotels.";
    failIfAny(f);
    return unit.run(async (repos) => {
      const actor = await gate.actor(repos, session);
      const at = now();
      const row = await staffRow(repos, id);
      for (const h of hotelIds) if (!(await repos.hotels.get(h, at))) throw new AppError("VALIDATION_FAILED", "A chosen hotel does not exist.", { fields: { hotelIds: "A chosen hotel does not exist." } });
      const before = await repos.adminAccess.get(id);
      if (!(await repos.adminAccess.set(id, { level: input.level, allHotels: input.allHotels, hotelIds, reason }, actor.userId, at))) {
        throw new AppError("CONFLICT", "Hotel access levels are not available yet: the database update (platform 0135) has not been applied.");
      }
      const after = await repos.adminAccess.get(id);
      const shape = (a: AdminHotelAccess) => ({ level: a.level, allHotels: a.allHotels, hotelIds: a.allHotels ? [] : a.hotelIds });
      await gate.audit(repos, actor, meta, { ...probe, targetLabel: row.displayName, reason, before: shape(before), after: shape(after) });
      return accessView(repos, id, after);
    });
  }

  return { list, create, disable, enable, unlock, resetPassword, getHotelAccess, setHotelAccess };
}

export type StaffService = ReturnType<typeof createStaffService>;
