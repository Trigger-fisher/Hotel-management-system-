import "server-only";
import type {
  PlatformActivity, PlatformAdminCreated, PlatformAdminInput, PlatformAdminPage, PlatformAdminQuery, PlatformAttentionItem, PlatformHotel, PlatformHotelAdmin,
  PlatformHotelChange, PlatformHotelDetail, PlatformHotelPage, PlatformHotelQuery, PlatformHotelStatus, PlatformOverview, PlatformPasswordReset,
} from "@shared/dashboards/platform";
import { TEMP_PASSWORD_NOTE, platformCopy } from "@shared/dashboards/platform";
import type { Page } from "@shared/dashboards/common";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import { searchWords } from "../../validation/listQuery";
import type { HotelLifecycleStatus, PlatformAccountRow, PlatformConsoleRepos, PlatformHotelRow } from "../../repos/platformConsole";
import { createGate, type Actor, type AuditInput, type PlatformMeta } from "./access";
import { byName, paged, words, type ConsoleDeps } from "./context";
import { transition, reasonFor, type HotelAction } from "./lifecycle";
import { checkAdmin, failIfAny, istMonth, lower, storedMobile, MOBILE_TAKEN, type Fields } from "./validate";
import { accountStatus, activityView, adminView, hotelView, onboardingView, settingsView } from "./views";

// Hotels, hotel admins, the overview and the activity trail of the Platform console (docs/BACKEND.md section 14.1, 14.2). Every write runs in ONE
// unit: the change, its history row and its audit row commit together, so a failing audit write undoes the change. Nothing here opens a hotel schema.

const E = platformCopy.errors;
const C = platformCopy;
const LIVE: readonly HotelLifecycleStatus[] = ["active", "suspended"];
const isLive = (h: Pick<PlatformHotelRow, "status">): boolean => LIVE.includes(h.status);

const AUDIT_OF: Record<"suspend" | "reactivate" | "archive" | "restore", "hotel_suspended" | "hotel_reactivated" | "hotel_archived" | "hotel_restored"> = {
  suspend: "hotel_suspended", reactivate: "hotel_reactivated", archive: "hotel_archived", restore: "hotel_restored",
};

export function createHotelService(deps: ConsoleDeps) {
  const { unit, now } = deps;
  const gate = deps.gate ?? createGate(unit, now);

  const hotelAudit = (action: AuditInput["action"], h: PlatformHotelRow, reason: string | null = null): AuditInput => ({
    action, entity: "hotel", entityId: h.id, hotelId: h.id, groupId: h.groupId, targetLabel: h.name, reason,
  });

  async function loadHotel(repos: PlatformConsoleRepos, id: string, forUpdate = false): Promise<PlatformHotelRow> {
    const h = await repos.hotels.get(id, now(), { forUpdate });
    if (!h) throw new AppError("NOT_FOUND");
    return h;
  }

  /** Runs a read in one unit after the account-role check (the actor is re-read inside the unit). */
  async function read<T>(session: VerifiedSession, work: (repos: PlatformConsoleRepos, actor: Actor) => Promise<T>): Promise<T> {
    gate.read(session);
    return unit.run(async (repos) => work(repos, await gate.actor(repos, session)));
  }

  /** Runs a write: the account-role check first (a refusal is audited), then one unit with the actor re-read. */
  async function write<T>(session: VerifiedSession, meta: PlatformMeta, probe: AuditInput, work: (repos: PlatformConsoleRepos, actor: Actor) => Promise<T>): Promise<T> {
    await gate.write(session, meta, probe);
    return unit.run(async (repos) => work(repos, await gate.actor(repos, session)));
  }

  /* ------------------------------------------------------------------ overview */

  function attention(hotels: readonly PlatformHotelRow[], admins: readonly PlatformAccountRow[], groups: Awaited<ReturnType<PlatformConsoleRepos["groups"]["list"]>>, at: Date): PlatformAttentionItem[] {
    const out: PlatformAttentionItem[] = [];
    const byId = new Map(hotels.map((h) => [h.id, h]));
    for (const a of admins) {
      const h = a.hotelId ? byId.get(a.hotelId) : undefined;
      if (!h || !isLive(h) || accountStatus(a, at) !== "locked") continue;
      out.push({
        id: `locked-${a.id}`, kind: "locked_account", hotelId: h.id, hotelName: h.name, groupId: h.groupId, groupName: h.groupName, adminId: a.id, adminName: a.displayName,
        text: C.attention.locked(a.displayName, h.name), since: (a.lockedAt ?? a.lockedUntil ?? a.createdAt).toISOString(),
      });
    }
    for (const h of hotels) {
      const base = { hotelId: h.id, hotelName: h.name, groupId: h.groupId, groupName: h.groupName, adminId: null, adminName: null };
      if (isLive(h) && !admins.some((a) => a.hotelId === h.id)) out.push({ ...base, id: `noadmin-${h.id}`, kind: "no_admin", text: C.attention.noAdmin(h.name), since: h.createdAt.toISOString() });
      if (h.status === "suspended") out.push({ ...base, id: `suspended-${h.id}`, kind: "suspended", text: C.attention.suspended(h.name), since: (h.suspendedAt ?? h.createdAt).toISOString() });
      if (h.status === "pending_approval") {
        const first = admins.find((a) => a.hotelId === h.id);
        out.push({
          ...base, id: `pending-${h.id}`, kind: "pending_approval", adminId: first?.id ?? null, adminName: first?.displayName ?? null,
          text: C.attention.pendingApproval(h.name), since: (h.submittedAt ?? h.createdAt).toISOString(),
        });
      }
    }
    for (const g of groups) {
      if (g.status !== "pending_approval") continue;
      out.push({
        id: `pendinggroup-${g.id}`, kind: "pending_group", hotelId: "", hotelName: g.name, groupId: g.id, groupName: g.name, adminId: g.admin?.id ?? null, adminName: g.admin?.displayName ?? null,
        text: C.attention.pendingGroup(g.name, g.admin?.displayName ?? ""), since: (g.submittedAt ?? g.createdAt).toISOString(),
      });
    }
    return out.sort((x, y) => (x.since < y.since ? 1 : x.since > y.since ? -1 : 0));
  }

  async function overview(session: VerifiedSession): Promise<PlatformOverview> {
    return read(session, async (repos) => {
      const at = now();
      const [hotels, groups, admins, inv, recent] = await Promise.all([
        repos.hotels.list({ words: [] }, at),
        repos.groups.list(),
        repos.accounts.list({ words: [], accountRoles: ["hotel_admin"] }, at),
        repos.hotels.invitationCounts(at),
        repos.audit.activity({}, { offset: 0, limit: 100 }),
      ]);
      const month = istMonth(at);
      const live = new Set(hotels.filter(isLive).map((h) => h.id));
      const adminsOfLive = admins.filter((a) => a.hotelId !== null && live.has(a.hotelId));
      const listedGroups = groups.filter((g) => g.status === "pending_approval" || g.status === "active" || g.status === "rejected");
      const pendingHotels = hotels.filter((h) => h.status === "pending_approval").length;
      const pendingGroups = groups.filter((g) => g.status === "pending_approval").length;
      return {
        tiles: {
          hotelsActive: hotels.filter((h) => h.status === "active").length,
          hotelsSuspended: hotels.filter((h) => h.status === "suspended").length,
          groups: groups.filter((g) => g.status === "active").length,
          groupsListed: listedGroups.length + inv.groupsWaiting,
          groupsWaiting: inv.groupsWaiting,
          groupsRejected: groups.filter((g) => g.status === "rejected").length,
          hotelAdmins: adminsOfLive.filter((a) => accountStatus(a, at) !== "pending").length,
          lockedAccounts: adminsOfLive.filter((a) => accountStatus(a, at) === "locked").length,
          createdThisMonth: hotels.filter((h) => h.status !== "archived" && istMonth(h.createdAt) === month).length,
          pendingApproval: pendingHotels + pendingGroups,
          pendingHotels,
          pendingGroups,
          invitationsOpen: inv.open,
        },
        recentHotels: hotels.filter((h) => h.status !== "archived").sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime()).slice(0, 5).map((h) => hotelView(h, at)),
        needsAttention: attention(hotels, admins, groups, at),
        // hotels a group's admin created itself (live at once, no approval): "Created hotel X. Created by group G (group admin P)." so the Super Admin sees them here
        groupCreatedHotels: recent.rows.filter((r) => r.action === "hotel_created" && (r.reason ?? "").startsWith("Created by group")).slice(0, 5).map(activityView),
      };
    });
  }

  /* ------------------------------------------------------------------ hotels */

  async function listHotels(session: VerifiedSession, q: { search?: string; status?: PlatformHotelQuery["status"]; kind?: PlatformHotelQuery["kind"]; groupId?: string; createdMonth?: string; page: number; pageSize: number }): Promise<PlatformHotelPage> {
    return read(session, async (repos) => {
      const at = now();
      const rows = await repos.hotels.list({ words: words(q.search), groupId: q.groupId, createdMonth: q.createdMonth }, at);
      const kindOk = (h: PlatformHotelRow): boolean => !q.kind || q.kind === "all" || (h.groupId ? "group" : "individual") === q.kind;
      const forCounts = rows.filter(kindOk);
      const n = (st: PlatformHotelStatus): number => forCounts.filter((h) => h.status === st).length;
      const counts = { all: forCounts.filter((h) => h.status !== "archived").length, active: n("active"), suspended: n("suspended"), pending_approval: n("pending_approval"), rejected: n("rejected"), archived: n("archived") };
      const status = q.status ?? "all";
      const byStatus = rows.filter((h) => (status === "all" ? h.status !== "archived" : h.status === status));
      const kindCounts = { all: byStatus.length, individual: byStatus.filter((h) => !h.groupId).length, group: byStatus.filter((h) => !!h.groupId).length };
      const list = byStatus.filter(kindOk).map((h) => hotelView(h, at)).sort(byName);
      return { ...paged(list, q.page, q.pageSize), counts, kindCounts };
    });
  }

  async function getHotel(session: VerifiedSession, id: string): Promise<PlatformHotelDetail> {
    return read(session, async (repos) => {
      const at = now();
      const h = await loadHotel(repos, id);
      const [admins, activity, onboarding, gst] = await Promise.all([
        repos.accounts.list({ words: [], accountRoles: ["hotel_admin"], hotelId: h.id }, at),
        repos.audit.activity({ hotelId: h.id }, { offset: 0, limit: 50 }),
        repos.hotels.onboarding(h.id),
        repos.hotels.defaultGstPercent(),
      ]);
      return {
        hotel: hotelView(h, at), admins: admins.map((a) => adminView(a, at)).sort(byName), settings: settingsView(h, gst),
        activity: activity.rows.map(activityView), onboarding: onboardingView(onboarding),
      };
    });
  }

  /** Suspend, reactivate, archive, restore: the status machine, the history row, the audit row (one unit). */
  async function change(session: VerifiedSession, meta: PlatformMeta, id: string, action: "suspend" | "reactivate" | "archive" | "restore", rawReason: string | undefined): Promise<{ hotel: PlatformHotelRow; before: PlatformHotelRow; at: Date }> {
    const reason = reasonFor(action as HotelAction, rawReason);
    // archiving and restoring a hotel is full power: the Super Admin's only (MJ, 5 Nov 2026); suspend and reactivate stay with every platform admin
    if (action === "archive" || action === "restore") await gate.superWrite(session, meta, { action: AUDIT_OF[action], entity: "hotel", entityId: id, hotelId: id });
    return write(session, meta, { action: AUDIT_OF[action], entity: "hotel", entityId: id, hotelId: id }, async (repos, actor) => {
      const at = now();
      const before = await loadHotel(repos, id, true);
      const patch = transition(before, action, reason, at);
      await repos.hotels.setLifecycle(id, patch);
      await repos.hotels.addStatusHistory({ hotelId: id, fromStatus: before.status, toStatus: patch.status, changedBy: actor.userId, actorRole: actor.role, reason, traceId: meta.traceId, at });
      // a suspended or archived hotel's people are signed out at once
      if (action === "suspend" || action === "archive") await repos.hotels.endSessions(id, at);
      await gate.audit(repos, actor, meta, hotelAudit(AUDIT_OF[action], before, reason));
      if (action === "archive" && before.groupId) await clearGroupAdminOfHotel(repos, actor, meta, before, at);
      return { hotel: await loadHotel(repos, id), before, at };
    });
  }

  /** An archived hotel can no longer be the home of its group's admin. */
  async function clearGroupAdminOfHotel(repos: PlatformConsoleRepos, actor: Actor, meta: PlatformMeta, h: PlatformHotelRow, at: Date): Promise<void> {
    if (!h.groupId) return;
    const g = await repos.groups.get(h.groupId, { forUpdate: true });
    if (!g?.admin || g.admin.hotelId !== h.id) return;
    await repos.groups.setAdmin(g.id, null);
    await repos.groups.addHistory({ groupId: g.id, event: "admin_cleared", fromStatus: null, toStatus: null, hotelId: h.id, adminUserId: g.admin.id, changedBy: actor.userId, actorRole: actor.role, reason: null, traceId: meta.traceId, at });
    await gate.audit(repos, actor, meta, { action: "group_admin_cleared", entity: "group", entityId: g.id, hotelId: h.id, groupId: g.id, targetLabel: g.name });
  }

  async function suspend(session: VerifiedSession, id: string, reason: string | undefined, meta: PlatformMeta): Promise<PlatformHotel> {
    const r = await change(session, meta, id, "suspend", reason);
    return hotelView(r.hotel, r.at);
  }
  async function reactivate(session: VerifiedSession, id: string, meta: PlatformMeta): Promise<PlatformHotel> {
    const r = await change(session, meta, id, "reactivate", undefined);
    return hotelView(r.hotel, r.at);
  }
  async function archive(session: VerifiedSession, id: string, reason: string | undefined, meta: PlatformMeta): Promise<PlatformHotelChange> {
    const r = await change(session, meta, id, "archive", reason);
    return { hotel: hotelView(r.hotel, r.at), message: C.archive.archived(r.hotel.name), note: C.archive.signInBlocked };
  }
  async function restore(session: VerifiedSession, id: string, meta: PlatformMeta): Promise<PlatformHotelChange> {
    const r = await change(session, meta, id, "restore", undefined);
    const back = r.hotel.status;
    const message = back === "active" ? C.archive.restored(r.hotel.name) : C.archive.restoredTo(r.hotel.name, C.hotelConsole.lifecycle[back as "suspended" | "rejected"]);
    return { hotel: hotelView(r.hotel, r.at), message, note: null };
  }

  async function activity(session: VerifiedSession, q: { hotelId?: string; groupId?: string; search?: string; page: number; pageSize: number }): Promise<Page<PlatformActivity>> {
    return read(session, async (repos) => {
      const r = await repos.audit.activity({ hotelId: q.hotelId, groupId: q.groupId, words: searchWords(q.search) }, { offset: (q.page - 1) * q.pageSize, limit: q.pageSize });
      return { items: r.rows.map(activityView), total: r.total, page: q.page, pageSize: q.pageSize };
    });
  }

  /* ------------------------------------------------------------------ hotel admins */

  async function listAdmins(session: VerifiedSession, q: { search?: string; status?: PlatformAdminQuery["status"]; hotelId?: string; groupId?: string; liveOnly?: boolean; includeArchived?: boolean; page: number; pageSize: number }): Promise<PlatformAdminPage> {
    return read(session, async (repos) => {
      const at = now();
      const [accounts, hotels] = await Promise.all([
        repos.accounts.list({ words: words(q.search), accountRoles: ["hotel_admin"], hotelId: q.hotelId, groupId: q.groupId }, at),
        q.liveOnly && q.includeArchived !== true ? repos.hotels.list({ words: [] }, at) : Promise.resolve([] as PlatformHotelRow[]),
      ]);
      const live = new Set(hotels.filter(isLive).map((h) => h.id));
      const matched = accounts.filter((a) => !(q.liveOnly && q.includeArchived !== true) || (a.hotelId !== null && live.has(a.hotelId)));
      const st = (a: PlatformAccountRow): string => accountStatus(a, at);
      const counts = {
        all: matched.length, active: matched.filter((a) => st(a) === "active").length, disabled: matched.filter((a) => st(a) === "disabled").length,
        locked: matched.filter((a) => st(a) === "locked").length, pending: matched.filter((a) => st(a) === "pending").length,
      };
      const status = q.status ?? "all";
      const rows = matched.filter((a) => status === "all" || st(a) === status).map((a) => adminView(a, at)).sort((x, y) => x.hotelName.localeCompare(y.hotelName, "en") || byName(x, y));
      return { ...paged(rows, q.page, q.pageSize), counts };
    });
  }

  /** The "already used" sentences for a new person (username, e-mail, mobile are unique among live accounts). */
  async function takenFields(repos: PlatformConsoleRepos, a: PlatformAdminInput, f: Fields): Promise<void> {
    if (!f.username && (await repos.accounts.usernameTaken(lower(a.username)))) f.username = E.usernameTaken;
    if (!f.email && (await repos.accounts.emailTaken(lower(a.email)))) f.email = E.emailTaken;
    const mobile = storedMobile(a.mobile);
    if (!f.mobile && mobile && (await repos.accounts.mobileTaken(mobile))) f.mobile = MOBILE_TAKEN;
  }

  async function addAdmin(session: VerifiedSession, hotelId: string, input: PlatformAdminInput, meta: PlatformMeta): Promise<PlatformAdminCreated> {
    const f: Fields = {};
    checkAdmin(input, "", f);
    return write(session, meta, { action: "admin_created", entity: "user", entityId: null, hotelId }, async (repos, actor) => {
      const at = now();
      const h = await loadHotel(repos, hotelId, true);
      if (!isLive(h)) throw new AppError("CONFLICT", E.hotelNotLive);
      await takenFields(repos, input, f);
      failIfAny(f);
      const first = !(await repos.accounts.hotelHasSuperAdmin(h.id));
      const id = await repos.accounts.create(
        { username: lower(input.username), email: lower(input.email), mobile: storedMobile(input.mobile) as string, displayName: input.name.trim(), accountRole: "hotel_admin", roleKey: first ? "super_admin" : "admin", hotelId: h.id },
        actor.userId, at,
      );
      await deps.credentials(repos).issueInvite(id);
      const row = await repos.accounts.get(id);
      if (!row) throw new AppError("SERVER_ERROR");
      await gate.audit(repos, actor, meta, { action: "admin_created", entity: "user", entityId: id, hotelId: h.id, groupId: h.groupId, targetLabel: row.displayName });
      return { admin: adminView(row, at), tempPasswordNote: TEMP_PASSWORD_NOTE };
    });
  }

  type AdminAction = "reset" | "unlock" | "disable" | "enable";
  const ADMIN_AUDIT = { reset: "admin_password_reset", unlock: "admin_unlocked", disable: "admin_disabled", enable: "admin_enabled" } as const;

  /** Finds a Hotel Admin (locked row) and its hotel; NOT_FOUND for anything else. Applies the mock's rules for each action. */
  async function adminAction(session: VerifiedSession, id: string, action: AdminAction, meta: PlatformMeta): Promise<{ row: PlatformAccountRow; at: Date; message?: string }> {
    return write(session, meta, { action: ADMIN_AUDIT[action], entity: "user", entityId: id }, async (repos, actor) => {
      const at = now();
      const a = await repos.accounts.get(id, { forUpdate: true });
      if (!a || a.accountRole !== "hotel_admin") throw new AppError("NOT_FOUND");
      const h = a.hotelId ? await repos.hotels.get(a.hotelId, at) : null;
      const notLive = !h || !isLive(h);
      const status = accountStatus(a, at);
      let message: string | undefined;
      switch (action) {
        case "reset":
          if (status === "disabled") throw new AppError("CONFLICT", E.disabledNoReset);
          if (status === "pending") throw new AppError("CONFLICT", E.accountPending);
          if (notLive) throw new AppError("CONFLICT", E.hotelNotLive);
          await deps.credentials(repos).adminResetPassword(a.id);
          message = `A temporary password was sent to ${a.email ?? "the account's email"}.`;
          break;
        case "unlock":
          if (status !== "locked") throw new AppError("CONFLICT", E.notLocked);
          if (notLive) throw new AppError("CONFLICT", E.hotelNotLive);
          await repos.accounts.unlock(a.id);
          await repos.auth.events.event({ userId: a.id, hotelId: a.hotelId ?? null, event: "account_unlocked", ip: meta.ip, userAgent: null, detail: { by: actor.userId }, at });
          break;
        case "disable":
          if (status === "disabled") throw new AppError("CONFLICT", E.alreadyDisabled);
          if (status === "pending") throw new AppError("CONFLICT", E.accountPending);
          await repos.accounts.setStatus(a.id, "disabled", a.hotelId);
          await repos.accounts.endSessions(a.id, at);
          break;
        case "enable":
          if (status !== "disabled") throw new AppError("CONFLICT", E.notDisabled);
          if (notLive) throw new AppError("CONFLICT", E.hotelNotLive);
          await repos.accounts.setStatus(a.id, "active", a.hotelId);
          break;
      }
      await gate.audit(repos, actor, meta, { action: ADMIN_AUDIT[action], entity: "user", entityId: a.id, hotelId: a.hotelId, groupId: a.groupId, targetLabel: a.displayName });
      const row = await repos.accounts.get(a.id);
      if (!row) throw new AppError("SERVER_ERROR");
      return { row, at, message };
    });
  }

  async function resetAdminPassword(session: VerifiedSession, id: string, meta: PlatformMeta): Promise<PlatformPasswordReset> {
    const r = await adminAction(session, id, "reset", meta);
    return { admin: adminView(r.row, r.at), message: r.message as string, tempPasswordNote: TEMP_PASSWORD_NOTE };
  }
  const unlockAdmin = async (session: VerifiedSession, id: string, meta: PlatformMeta): Promise<PlatformHotelAdmin> => {
    const r = await adminAction(session, id, "unlock", meta);
    return adminView(r.row, r.at);
  };
  const disableAdmin = async (session: VerifiedSession, id: string, meta: PlatformMeta): Promise<PlatformHotelAdmin> => {
    const r = await adminAction(session, id, "disable", meta);
    return adminView(r.row, r.at);
  };
  const enableAdmin = async (session: VerifiedSession, id: string, meta: PlatformMeta): Promise<PlatformHotelAdmin> => {
    const r = await adminAction(session, id, "enable", meta);
    return adminView(r.row, r.at);
  };

  return { overview, listHotels, getHotel, suspend, reactivate, archive, restore, activity, listAdmins, addAdmin, resetAdminPassword, unlockAdmin, disableAdmin, enableAdmin, gate };
}

export type HotelService = ReturnType<typeof createHotelService>;
