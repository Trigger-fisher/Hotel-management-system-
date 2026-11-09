import "server-only";
import type { PlatformGroup, PlatformGroupDetail, PlatformGroupStatus } from "@shared/dashboards/platform";
import { platformCopy, slugFromName } from "@shared/dashboards/platform";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { GroupEvent, GroupStatus, PlatformConsoleRepos, PlatformGroupRow, PlatformHotelRow } from "../../repos/platformConsole";
import { createGate, type Actor, type AuditInput, type PlatformMeta } from "./access";
import { byName, type ConsoleDeps } from "./context";
import { groupLimitOf, placesTaken } from "./groupLimit";
import { failIfAny, type Fields } from "./validate";
import { accountStatus, activityView, adminView, groupView, hotelView } from "./views";
import { matchWords } from "../../validation/listQuery";

// Groups and their membership (docs/BACKEND.md section 14.3): create, link and unlink hotels, set the Group Hotel Admin. A hotel is in at most one
// group (a unique index backs the rule). Every change writes group_history and the audit row in the same unit. Approving or rejecting a group that
// came from an invitation is the invitations task (P3).

const E = platformCopy.errors;
const LIVE = ["active", "suspended"];

export function createGroupService(deps: ConsoleDeps) {
  const { unit, now } = deps;
  const gate = createGate(unit, now);

  async function read<T>(session: VerifiedSession, work: (repos: PlatformConsoleRepos) => Promise<T>): Promise<T> {
    gate.read(session);
    return unit.run(async (repos) => {
      await gate.actor(repos, session);
      return work(repos);
    });
  }

  async function write<T>(session: VerifiedSession, meta: PlatformMeta, probe: AuditInput, work: (repos: PlatformConsoleRepos, actor: Actor) => Promise<T>): Promise<T> {
    await gate.write(session, meta, probe);
    return unit.run(async (repos) => work(repos, await gate.actor(repos, session)));
  }

  async function loadGroup(repos: PlatformConsoleRepos, id: string, forUpdate = false): Promise<PlatformGroupRow> {
    const g = await repos.groups.get(id, { forUpdate });
    if (!g) throw new AppError("NOT_FOUND");
    return g;
  }

  async function history(repos: PlatformConsoleRepos, actor: Actor, meta: PlatformMeta, g: { id: string }, event: GroupEvent, extra: { hotelId?: string | null; adminUserId?: string | null; from?: GroupStatus | null; to?: GroupStatus | null } = {}): Promise<void> {
    await repos.groups.addHistory({
      groupId: g.id, event, fromStatus: extra.from ?? null, toStatus: extra.to ?? null, hotelId: extra.hotelId ?? null, adminUserId: extra.adminUserId ?? null,
      changedBy: actor.userId, actorRole: actor.role, reason: null, traceId: meta.traceId, at: now(),
    });
  }

  async function detail(repos: PlatformConsoleRepos, g: PlatformGroupRow): Promise<PlatformGroupDetail> {
    const at = now();
    const [all, admins, activity] = await Promise.all([
      repos.hotels.list({ words: [] }, at),
      repos.accounts.list({ words: [], accountRoles: ["hotel_admin"], groupId: g.id }, at),
      repos.audit.activity({ groupId: g.id }, { offset: 0, limit: 50 }),
    ]);
    const members = new Set(g.hotelIds);
    const max = (await repos.groups.maxHotels([g.id])).get(g.id) ?? null;
    return {
      group: groupView(g, max),
      hotels: all.filter((h) => members.has(h.id)).map((h) => hotelView(h, at)).sort(byName),
      availableHotels: all.filter((h) => LIVE.includes(h.status) && h.groupId === null).map((h) => hotelView(h, at)).sort(byName),
      adminChoices: admins.filter((a) => a.hotelId !== null && members.has(a.hotelId) && accountStatus(a, at) === "active").map((a) => adminView(a, at)).sort(byName),
      activity: activity.rows.map(activityView),
    };
  }

  async function list(session: VerifiedSession, status: "all" | PlatformGroupStatus | undefined, search?: string): Promise<PlatformGroup[]> {
    return read(session, async (repos) => {
      const rows = await repos.groups.list();
      const limits = await repos.groups.maxHotels(rows.map((g) => g.id));
      const wanted = status ?? "all";
      return matchWords(
        rows
          .filter((g) => g.status === "pending_approval" || g.status === "active" || g.status === "rejected")
          .map((g) => groupView(g, limits.get(g.id) ?? null))
          .filter((g) => wanted === "all" || g.status === wanted)
          .sort(byName),
        search,
        (g) => [g.name, g.groupAdmin?.name, g.groupAdmin?.username],
      );
    });
  }

  async function get(session: VerifiedSession, id: string): Promise<PlatformGroupDetail> {
    return read(session, async (repos) => detail(repos, await loadGroup(repos, id)));
  }

  /** A free group slug from the name ("sunrise-group", "sunrise-group-2" ...). */
  async function freeSlug(repos: PlatformConsoleRepos, name: string): Promise<string> {
    const root = slugFromName(name).slice(0, 36) || "group";
    if (!(await repos.groups.slugTaken(root))) return root;
    for (let i = 2; i < 200; i++) if (!(await repos.groups.slugTaken(`${root}-${i}`))) return `${root}-${i}`;
    throw new AppError("SERVER_ERROR");
  }

  async function create(session: VerifiedSession, input: { name: string; hotelIds?: string[] }, meta: PlatformMeta): Promise<PlatformGroup> {
    const name = input.name.trim();
    const ids = [...new Set(input.hotelIds ?? [])];
    return write(session, meta, { action: "group_created", entity: "group", entityId: null }, async (repos, actor) => {
      const at = now();
      const f: Fields = {};
      if (!name) f.name = E.required.groupName;
      else if (Array.from(name).length > 100) f.name = E.nameLong;
      else if (await repos.groups.nameTaken(name)) f.name = E.groupNameTaken;
      const hotels: PlatformHotelRow[] = [];
      for (const hid of ids) {
        const h = await repos.hotels.get(hid, at, { forUpdate: true });
        if (!h) {
          f.hotelIds = E.hotelUnknown;
          break;
        }
        const inGroup = await repos.groups.groupOfHotel(h.id);
        if (inGroup) f.hotelIds = E.hotelInGroup(h.name, inGroup.name);
        else if (!LIVE.includes(h.status)) f.hotelIds = E.hotelNotJoinable;
        if (f.hotelIds) break;
        hotels.push(h);
      }
      failIfAny(f);
      const id = await repos.groups.create({ name, slug: await freeSlug(repos, name) }, at);
      await history(repos, actor, meta, { id }, "created", { to: "active" });
      await gate.audit(repos, actor, meta, { action: "group_created", entity: "group", entityId: id, groupId: id, targetLabel: name });
      for (const h of hotels) {
        await repos.groups.link(id, h.id, actor.userId, at);
        await history(repos, actor, meta, { id }, "hotel_linked", { hotelId: h.id });
        await gate.audit(repos, actor, meta, { action: "group_hotel_added", entity: "group", entityId: id, hotelId: h.id, groupId: id, targetLabel: h.name });
      }
      return groupView(await loadGroup(repos, id));
    });
  }

  /** A hotel is in at most one group; the group must be active and the hotel live (VALIDATION_FAILED field hotelId). */
  async function addHotel(session: VerifiedSession, groupId: string, hotelId: string, meta: PlatformMeta): Promise<PlatformGroupDetail> {
    return write(session, meta, { action: "group_hotel_added", entity: "group", entityId: groupId, groupId, hotelId }, async (repos, actor) => {
      const at = now();
      const g = await loadGroup(repos, groupId, true);
      const h = await repos.hotels.get(hotelId, at, { forUpdate: true });
      if (!h) throw new AppError("NOT_FOUND");
      if (g.status !== "active") throw new AppError("CONFLICT", E.groupNotActive);
      const inGroup = await repos.groups.groupOfHotel(h.id);
      if (inGroup) throw new AppError("VALIDATION_FAILED", E.hotelInGroup(h.name, inGroup.name), { fields: { hotelId: E.hotelInGroup(h.name, inGroup.name) } });
      if (!LIVE.includes(h.status)) throw new AppError("VALIDATION_FAILED", E.hotelNotJoinable, { fields: { hotelId: E.hotelNotJoinable } });
      // the group's limit holds for the platform too (raise it first); counted with the group row locked
      // the same count as a group's invitation: its hotels AND its open invitations
      const max = await groupLimitOf(repos, g.id);
      if (max !== null && (await placesTaken(repos, g.id, at, null)) >= max) {
        const message = `This group can have at most ${max} hotels. Raise its limit first.`;
        throw new AppError("VALIDATION_FAILED", message, { fields: { hotelId: message } });
      }
      await repos.groups.link(g.id, h.id, actor.userId, at);
      await history(repos, actor, meta, g, "hotel_linked", { hotelId: h.id });
      await gate.audit(repos, actor, meta, { action: "group_hotel_added", entity: "group", entityId: g.id, hotelId: h.id, groupId: g.id, targetLabel: h.name });
      return detail(repos, await loadGroup(repos, g.id));
    });
  }

  /** Unlinks the hotel (nothing is deleted; it becomes individual) and clears the group admin when they belong to that hotel. */
  async function removeHotel(session: VerifiedSession, groupId: string, hotelId: string, meta: PlatformMeta): Promise<PlatformGroupDetail> {
    return write(session, meta, { action: "group_hotel_removed", entity: "group", entityId: groupId, groupId, hotelId }, async (repos, actor) => {
      const g = await loadGroup(repos, groupId, true);
      if (!g.hotelIds.includes(hotelId)) throw new AppError("VALIDATION_FAILED", E.hotelNotInGroup, { fields: { hotelId: E.hotelNotInGroup } });
      const h = await repos.hotels.get(hotelId, now());
      await repos.groups.unlink(g.id, hotelId);
      await history(repos, actor, meta, g, "hotel_unlinked", { hotelId });
      await gate.audit(repos, actor, meta, { action: "group_hotel_removed", entity: "group", entityId: g.id, hotelId, groupId: g.id, targetLabel: h?.name ?? null });
      if (g.admin && g.admin.hotelId === hotelId && g.admin.accountRole === "hotel_admin") {
        await repos.groups.setAdmin(g.id, null);
        await history(repos, actor, meta, g, "admin_cleared", { hotelId, adminUserId: g.admin.id });
        await gate.audit(repos, actor, meta, { action: "group_admin_cleared", entity: "group", entityId: g.id, hotelId, groupId: g.id, targetLabel: g.name });
      }
      return detail(repos, await loadGroup(repos, g.id));
    });
  }

  /** adminId = an ACTIVE Hotel Admin of a member hotel (replaces a group-level admin), or null to remove the group admin. */
  async function setAdmin(session: VerifiedSession, groupId: string, adminId: string | null, meta: PlatformMeta): Promise<PlatformGroupDetail> {
    return write(session, meta, { action: adminId ? "group_admin_set" : "group_admin_cleared", entity: "group", entityId: groupId, groupId }, async (repos, actor) => {
      const at = now();
      const g = await loadGroup(repos, groupId, true);
      if (adminId === null) {
        if (g.admin) {
          await repos.groups.setAdmin(g.id, null);
          await history(repos, actor, meta, g, "admin_cleared", { adminUserId: g.admin.id });
          await gate.audit(repos, actor, meta, { action: "group_admin_cleared", entity: "group", entityId: g.id, groupId: g.id, targetLabel: g.name });
        }
        return detail(repos, await loadGroup(repos, g.id));
      }
      const a = await repos.accounts.get(adminId);
      if (!a || a.accountRole !== "hotel_admin" || a.hotelId === null || !g.hotelIds.includes(a.hotelId) || accountStatus(a, at) !== "active") {
        throw new AppError("VALIDATION_FAILED", E.adminNotInGroup, { fields: { adminId: E.adminNotInGroup } });
      }
      await repos.groups.setAdmin(g.id, a.id);
      await history(repos, actor, meta, g, "admin_set", { hotelId: a.hotelId, adminUserId: a.id });
      await gate.audit(repos, actor, meta, { action: "group_admin_set", entity: "user", entityId: a.id, hotelId: a.hotelId, groupId: g.id, targetLabel: a.displayName });
      return detail(repos, await loadGroup(repos, g.id));
    });
  }

  /**
   * The most hotels the group may have (MJ, 18 Oct 2026): Super Admin and Platform Admin only (the platform gate), null removes it, never below what the group has now
   * (waiting, active and suspended hotels). Audited, and kept in group_history (max_hotels_set, "from X to Y").
   */
  async function setMaxHotels(session: VerifiedSession, groupId: string, maxHotels: number | null, meta: PlatformMeta): Promise<PlatformGroupDetail> {
    if (maxHotels !== null && !(Number.isInteger(maxHotels) && maxHotels >= 0 && maxHotels <= 10000)) {
      throw new AppError("VALIDATION_FAILED", "Enter a whole number from 0 to 10,000, or leave it empty for no limit.", { fields: { maxHotels: "Enter a whole number from 0 to 10,000, or leave it empty for no limit." } });
    }
    return write(session, meta, { action: "settings_updated", entity: "group", entityId: groupId, groupId }, async (repos, actor) => {
      const g = await loadGroup(repos, groupId, true);
      const now0 = await repos.groups.countTowardLimit(g.id);
      if (maxHotels !== null && maxHotels < now0) {
        const message = `This group already has ${now0} ${now0 === 1 ? "hotel" : "hotels"}: the limit cannot be lower than that.`;
        throw new AppError("VALIDATION_FAILED", message, { fields: { maxHotels: message } });
      }
      const before = (await repos.groups.maxHotels([g.id])).get(g.id) ?? null;
      if (before !== maxHotels) {
        if (!(await repos.groups.setMaxHotels(g.id, maxHotels))) throw new AppError("CONFLICT", "Group limits need platform migration 0133. Run it first.");
        const words = (v: number | null): string => (v === null ? "no limit" : String(v));
        await repos.groups.addHistory({ groupId: g.id, event: "max_hotels_set", fromStatus: null, toStatus: null, hotelId: null, adminUserId: null, changedBy: actor.userId, actorRole: actor.role, reason: `from ${words(before)} to ${words(maxHotels)}`, traceId: meta.traceId, at: now() });
        await gate.audit(repos, actor, meta, { action: "settings_updated", entity: "group", entityId: g.id, groupId: g.id, targetLabel: g.name, reason: `Most hotels: ${words(maxHotels)}`, before: { maxHotels: before }, after: { maxHotels } });
      }
      return detail(repos, await loadGroup(repos, g.id));
    });
  }

  return { list, get, create, addHotel, removeHotel, setAdmin, setMaxHotels };
}

export type GroupService = ReturnType<typeof createGroupService>;
