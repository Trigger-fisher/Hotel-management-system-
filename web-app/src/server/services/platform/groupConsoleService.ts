import "server-only";
import type {
  PlatformActivity, PlatformAdminPage, PlatformEnterResult, PlatformHotel, PlatformHotelChange, PlatformHotelDetail, PlatformHotelPage, PlatformInvitation,
  PlatformInvitationPage, PlatformInvitationSent, PlatformHotelAdmin, PlatformPasswordReset, PlatformHotelQuery, PlatformAdminQuery,
} from "@shared/dashboards/platform";
import { platformCopy } from "@shared/dashboards/platform";
import type { GroupOverview, GroupUnlinked } from "@shared/dashboards/groupConsole";
import type { Page } from "@shared/dashboards/common";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { PlatformConsoleRepos, PlatformGroupRow } from "../../repos/platformConsole";
import { createGate, type PlatformMeta } from "./access";
import type { ConsoleDeps, InviteDeps } from "./context";
import { placesTaken } from "./groupLimit";
import { createHotelService } from "./hotelService";
import { createInvitationService } from "./invitationService";
import { createVisitService } from "./visitService";
import { accountStatus, activityView, hotelView } from "./views";

// The Group Hotel Admin console: the routes under /group (docs/BACKEND.md section 14c). A Group Hotel Admin sees and touches ONLY their own group: the
// group is taken from the signed-in account (it is the group that account administers), never from a URL or a body. Everything outside the group
// (a hotel that is not a member, an invitation of another group, a Hotel Admin of another hotel) answers 404, never 403: the group admin must not learn
// that it exists. What a group admin cannot do (create, approve, suspend, restore, export, delete a hotel; add a hotel admin; invite an individual hotel
// or a group; touch platform staff) has no route here at all. The work itself is done by the platform console's own services, built with the GROUP-mode
// gate (only an active Group Hotel Admin passes it, actions that are Super-Admin-only never) and called only after the record is proven to be the group's.
// Every write is audited with the actor's role "group_hotel_admin".

const E = platformCopy.errors;

export function createGroupConsoleService(deps: InviteDeps) {
  const { unit, now } = deps;
  const gate = createGate(unit, now, "group");
  const own: ConsoleDeps = { ...deps, gate };
  const hotels = createHotelService(own);
  const invitations = createInvitationService({ ...deps, gate });
  const visits = createVisitService(own);

  /** The group this account administers; 403 for anyone else (also a Group Admin whose group is not active or who administers none). */
  async function groupOf(repos: PlatformConsoleRepos, session: VerifiedSession): Promise<PlatformGroupRow> {
    gate.read(session);
    await gate.actor(repos, session);
    const g = (await repos.groups.list()).find((x) => x.admin?.id === session.userId && x.status === "active");
    if (!g) throw new AppError("FORBIDDEN");
    return g;
  }
  /** Tells the security layer; its failure never changes the answer (the caller still gets the same 404 as for an id that does not exist). */
  function crossTenant(session: VerifiedSession, groupId: string, what: "hotel" | "invitation" | "hotel_admin"): void {
    try {
      deps.onTenantViolation?.({ userId: session.userId, groupId, what });
    } catch {
      // an alert that cannot be raised never changes the answer
    }
  }
  const groupIdOf = (session: VerifiedSession): Promise<string> => unit.run(async (repos) => (await groupOf(repos, session)).id);

  /** Proves a record is the group's before anything touches it (404 when it is not, or does not exist). */
  async function ownHotel(session: VerifiedSession, hotelId: string): Promise<string> {
    return unit.run(async (repos) => {
      const g = await groupOf(repos, session);
      const h = await repos.hotels.get(hotelId, now());
      if (h && h.groupId !== g.id) crossTenant(session, g.id, "hotel");
      if (!h || h.groupId !== g.id) throw new AppError("NOT_FOUND");
      return g.id;
    });
  }
  async function ownInvitation(session: VerifiedSession, id: string): Promise<string> {
    return unit.run(async (repos) => {
      const g = await groupOf(repos, session);
      const inv = await repos.invitations.get(id);
      if (inv && inv.groupId !== g.id) crossTenant(session, g.id, "invitation");
      if (!inv || inv.type !== "member_hotel" || inv.groupId !== g.id) throw new AppError("NOT_FOUND");
      return g.id;
    });
  }
  async function ownAdmin(session: VerifiedSession, id: string): Promise<string> {
    return unit.run(async (repos) => {
      const g = await groupOf(repos, session);
      const a = await repos.accounts.get(id);
      if (a && a.groupId !== g.id) crossTenant(session, g.id, "hotel_admin");
      if (!a || a.accountRole !== "hotel_admin" || a.groupId !== g.id) throw new AppError("NOT_FOUND");
      return g.id;
    });
  }

  async function overview(session: VerifiedSession): Promise<GroupOverview> {
    return unit.run(async (repos) => {
      const g = await groupOf(repos, session);
      const at = now();
      const [all, invs, admins, activity] = await Promise.all([
        repos.hotels.list({ words: [], groupId: g.id }, at),
        repos.invitations.list(),
        repos.accounts.list({ words: [], accountRoles: ["hotel_admin"], groupId: g.id }, at),
        repos.audit.activity({ groupId: g.id }, { offset: 0, limit: 5 }),
      ]);
      const live = all.filter((h) => h.status === "active" || h.status === "suspended");
      const maxHotels = (await repos.groups.maxHotels([g.id])).get(g.id) ?? null;
      const liveIds = new Set(live.map((h) => h.id));
      const staff = admins.filter((a) => a.hotelId !== null && liveIds.has(a.hotelId) && accountStatus(a, at) !== "pending");
      const open = invs.filter((i) => i.type === "member_hotel" && i.groupId === g.id && i.status !== "accepted" && i.status !== "revoked" && i.status !== "expired" && i.expiresAt.getTime() > at.getTime());
      return {
        group: { id: g.id, name: g.name, status: g.status, createdAt: g.createdAt.toISOString(), legalName: g.legalName, gstin: g.gstin, city: g.city, state: g.state, phone: g.phone, email: g.email, maxHotels, isPrimaryAdmin: g.admin?.id === session.userId },
        tiles: {
          hotels: live.length,
          hotelsActive: live.filter((h) => h.status === "active").length,
          hotelsSuspended: live.filter((h) => h.status === "suspended").length,
          invitationsOpen: open.length,
          hotelAdmins: staff.length,
          lockedAccounts: staff.filter((a) => accountStatus(a, at) === "locked").length,
          // the same count as the limit check: hotels (waiting, active, suspended) + open invitations, each one holds a place
          hotelsCounted: await placesTaken(repos, g.id, at, null),
        },
        recentHotels: [...live].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 5).map((h) => hotelView(h, at)),
        recentActivity: activity.rows.map(activityView),
      } as GroupOverview;
    });
  }

  async function myHotels(session: VerifiedSession, q: { search?: string; status?: PlatformHotelQuery["status"]; createdMonth?: string; page: number; pageSize: number }): Promise<PlatformHotelPage> {
    return hotels.listHotels(session, { ...q, groupId: await groupIdOf(session) });
  }

  async function getMyHotel(session: VerifiedSession, id: string): Promise<PlatformHotelDetail> {
    await ownHotel(session, id);
    return hotels.getHotel(session, id);
  }

  /** Remove the hotel from the group: it keeps everything and becomes an individual hotel. Not when the group admin's own account belongs to it. Ends any visit into it. */
  async function unlink(session: VerifiedSession, hotelId: string, meta: PlatformMeta): Promise<GroupUnlinked> {
    await gate.write(session, meta, { action: "group_hotel_removed", entity: "group", entityId: null, hotelId });
    return unit.run(async (repos) => {
      const actor = await gate.actor(repos, session);
      const at = now();
      const g0 = await groupOf(repos, session);
      const g = await repos.groups.get(g0.id, { forUpdate: true });
      const before = await repos.hotels.get(hotelId, at);
      if (g && before && before.groupId !== g.id) crossTenant(session, g.id, "hotel");
      if (!g || !before || before.groupId !== g.id) throw new AppError("NOT_FOUND");
      const me = await repos.accounts.get(session.userId);
      if (me?.hotelId === hotelId) throw new AppError("CONFLICT", "Your own account belongs to this hotel, so it cannot be unlinked from your group.");
      await repos.groups.unlink(g.id, hotelId);
      await repos.groups.addHistory({ groupId: g.id, event: "hotel_unlinked", fromStatus: null, toStatus: null, hotelId, adminUserId: null, changedBy: actor.userId, actorRole: actor.role, reason: null, traceId: meta.traceId, at });
      await gate.audit(repos, actor, meta, { action: "group_hotel_removed", entity: "group", entityId: g.id, hotelId, groupId: g.id, targetLabel: before.name });
      // a visit into a hotel that is no longer the group's ends at once
      for (const v of await repos.visits.open(session.userId)) if (v.hotelId === hotelId) await repos.visits.end(v.id, "hotel_unavailable", null, at);
      const after = await repos.hotels.get(hotelId, at);
      return { hotel: hotelView(after ?? before, at) as PlatformHotel, message: `${before.name} is no longer in the group. It keeps all its data.` };
    });
  }

  /** Archiving a hotel is the Super Admin's only (MJ, 5 Nov 2026): the route still answers, with a plain sentence, and the attempt is audited as failed. */
  async function archive(session: VerifiedSession, hotelId: string, _reason: string | undefined, meta: PlatformMeta): Promise<PlatformHotelChange> {
    await ownHotelOrRefuse(session, hotelId, meta, "hotel_archived");
    throw await gate.refuse(session, meta, { action: "hotel_archived", entity: "hotel", entityId: hotelId, hotelId }, new AppError("FORBIDDEN", "Archiving a hotel is done by the platform team. Use Remove from group to take it out of your group."));
  }

  /** A write on a record outside the group: 404 as for a read, and the attempt is kept in the audit trail (failed). */
  async function ownHotelOrRefuse(session: VerifiedSession, hotelId: string, meta: PlatformMeta, action: "hotel_archived" | "hotel_entered" | "hotel_visit_extended"): Promise<void> {
    try {
      await ownHotel(session, hotelId);
    } catch (error) {
      if (error instanceof AppError && error.code === "NOT_FOUND") throw await gate.refuse(session, meta, { action, entity: "hotel", entityId: null }, error);
      throw error;
    }
  }

  async function invite(session: VerifiedSession, input: { hotelName: string; contactName: string; email: string }, meta: PlatformMeta): Promise<PlatformInvitationSent> {
    return invitations.sendToGroup(session, await groupIdOf(session), input, meta);
  }

  async function myInvitations(session: VerifiedSession, q: { search?: string; status?: "all" | "pending" | PlatformInvitation["status"]; page: number; pageSize: number }): Promise<PlatformInvitationPage> {
    return invitations.list(session, { ...q, type: "member_hotel", groupId: await groupIdOf(session) });
  }
  async function resend(session: VerifiedSession, id: string, meta: PlatformMeta): Promise<PlatformInvitationSent> {
    await ownInvitation(session, id);
    return invitations.resend(session, id, meta);
  }
  async function cancel(session: VerifiedSession, id: string, meta: PlatformMeta): Promise<PlatformInvitation> {
    await ownInvitation(session, id);
    return invitations.cancel(session, id, meta);
  }

  async function myHotelAdmins(session: VerifiedSession, q: { search?: string; status?: PlatformAdminQuery["status"]; hotelId?: string; page: number; pageSize: number }): Promise<PlatformAdminPage> {
    const groupId = await groupIdOf(session);
    if (q.hotelId) await ownHotel(session, q.hotelId);
    return hotels.listAdmins(session, { ...q, groupId, liveOnly: true });
  }
  async function resetPassword(session: VerifiedSession, id: string, meta: PlatformMeta): Promise<PlatformPasswordReset> {
    await ownAdmin(session, id);
    return hotels.resetAdminPassword(session, id, meta);
  }
  async function unlock(session: VerifiedSession, id: string, meta: PlatformMeta): Promise<PlatformHotelAdmin> {
    await ownAdmin(session, id);
    return hotels.unlockAdmin(session, id, meta);
  }
  async function disable(session: VerifiedSession, id: string, meta: PlatformMeta): Promise<PlatformHotelAdmin> {
    await ownAdmin(session, id);
    return hotels.disableAdmin(session, id, meta);
  }
  async function enable(session: VerifiedSession, id: string, meta: PlatformMeta): Promise<PlatformHotelAdmin> {
    await ownAdmin(session, id);
    return hotels.enableAdmin(session, id, meta);
  }

  async function enter(session: VerifiedSession, hotelId: string, reason: string, meta: PlatformMeta): Promise<PlatformEnterResult> {
    await ownHotelOrRefuse(session, hotelId, meta, "hotel_entered");
    return visits.enter(session, hotelId, reason, meta);
  }
  /** "Extend 60 minutes" on a member hotel's banner (platform 0135): the same check as entering, then a new linked visit. */
  async function extend(session: VerifiedSession, hotelId: string, meta: PlatformMeta): Promise<PlatformEnterResult> {
    await ownHotelOrRefuse(session, hotelId, meta, "hotel_visit_extended");
    return visits.extend(session, hotelId, meta);
  }
  async function exit(session: VerifiedSession, hotelId: string, meta: PlatformMeta): Promise<PlatformEnterResult> {
    await ownHotel(session, hotelId);
    return visits.exit(session, hotelId, meta);
  }

  async function activity(session: VerifiedSession, q: { search?: string; page: number; pageSize: number }): Promise<Page<PlatformActivity>> {
    return hotels.activity(session, { ...q, groupId: await groupIdOf(session) });
  }

  void E;
  return { overview, myHotels, getMyHotel, unlink, archive, invite, myInvitations, resend, cancel, myHotelAdmins, resetPassword, unlock, disable, enable, enter, extend, exit, activity, recordRefusedWrite: visits.recordRefusedWrite };
}

export type GroupConsoleService = ReturnType<typeof createGroupConsoleService>;
