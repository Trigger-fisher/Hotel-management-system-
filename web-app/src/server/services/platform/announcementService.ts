import "server-only";
import type { PlatformAnnouncement, PlatformAnnouncementInput } from "@shared/dashboards/platform";
import { platformCopy } from "@shared/dashboards/platform";
import type { HotelAnnouncement } from "@shared/dashboards/overview";
import { isPortalAccount } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { AnnouncementAudience, AnnouncementRow } from "../../repos/platformConsole";
import { createGate, type PlatformMeta } from "./access";
import type { ConsoleDeps } from "./context";

// Announcements to the hotels (MJ's plan, P4; platform migration 0120): the Super Admin publishes a message (maintenance tonight, a new feature) for every
// Hotel Admin or for everyone in every hotel; each person sees it on their dashboard until they dismiss it, or until it ends (its last day, or the Super
// Admin ending it). Publishing and ending are audited. The hotel side is read by any hotel account with the dashboard: a portal account never sees them.

const X = platformCopy.announcements.errors;
const IST_END_OF_DAY_MS = (18 * 60 + 29) * 60_000 + 59_000;
/** The last moment of an IST day as UTC. */
const endOfIstDay = (day: string): Date => new Date(Date.parse(`${day}T00:00:00Z`) + IST_END_OF_DAY_MS);
const istDay = (d: Date): string => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);

export function announcementView(a: AnnouncementRow, now: Date): PlatformAnnouncement {
  const over = a.endedAt !== null || (a.endsAt !== null && a.endsAt <= now);
  return {
    id: a.id, title: a.title, body: a.body, audience: a.audience, important: a.important, startsAt: a.startsAt.toISOString(), endsAt: a.endsAt ? a.endsAt.toISOString() : null, endedAt: a.endedAt ? a.endedAt.toISOString() : null,
    state: over ? "over" : a.startsAt > now ? "scheduled" : "live", createdBy: a.createdByName, createdAt: a.createdAt.toISOString(), reads: a.reads,
  };
}

export function createAnnouncementService(deps: ConsoleDeps) {
  const { unit, now } = deps;
  const gate = deps.gate ?? createGate(unit, now);

  /** The audiences a hotel account belongs to: everyone; admins too for a Hotel Admin. */
  function audiencesOf(session: VerifiedSession): AnnouncementAudience[] {
    if (isPortalAccount(session) || session.hotelId === "" || session.visit !== undefined) throw new AppError("FORBIDDEN");
    return session.accountRole === "hotel_admin" ? ["admins", "everyone"] : ["everyone"];
  }

  return {
    /** Every announcement, newest first (Super Admin). */
    async list(session: VerifiedSession): Promise<PlatformAnnouncement[]> {
      gate.superRead(session);
      return unit.run(async (repos) => {
        await gate.actor(repos, session);
        const at = now();
        return (await repos.announcements.list()).map((a) => announcementView(a, at));
      });
    },

    /** Publishes one now (Super Admin, audited). The last day is an IST day; empty = until ended. */
    async create(session: VerifiedSession, input: PlatformAnnouncementInput, meta: PlatformMeta): Promise<PlatformAnnouncement> {
      const probe = { action: "announcement_created", entity: "platform", entityId: null } as const;
      await gate.superWrite(session, meta, probe);
      const title = input.title.trim();
      const body = input.body.trim();
      const endsOn = (input.endsOn ?? "").trim();
      const f: Record<string, string> = {};
      if (title === "") f.title = X.titleRequired;
      else if (Array.from(title).length > 120) f.title = X.titleLong;
      if (body === "") f.body = X.bodyRequired;
      else if (Array.from(body).length > 2000) f.body = X.bodyLong;
      const at = now();
      if (endsOn !== "" && endsOn < istDay(at)) f.endsOn = X.endsOnPast;
      if (Object.keys(f).length > 0) throw await gate.refuse(session, meta, probe, new AppError("VALIDATION_FAILED", Object.values(f)[0], { fields: f }));
      return unit.run(async (repos) => {
        const actor = await gate.actor(repos, session);
        const id = await repos.announcements.create({ title, body, audience: input.audience, important: input.important === true, startsAt: at, endsAt: endsOn === "" ? null : endOfIstDay(endsOn) }, actor.userId, at);
        await gate.audit(repos, actor, meta, { ...probe, entityId: id, targetLabel: title, reason: title, after: { audience: input.audience, important: input.important === true, endsOn: endsOn || null } });
        const row = await repos.announcements.get(id);
        if (!row) throw new AppError("NOT_FOUND");
        return announcementView(row, at);
      });
    },

    /** Ends one now (Super Admin, audited): it leaves every dashboard at once. 409 when it is already over. */
    async end(session: VerifiedSession, id: string, meta: PlatformMeta): Promise<PlatformAnnouncement> {
      const probe = { action: "announcement_ended", entity: "platform", entityId: id } as const;
      await gate.superWrite(session, meta, probe);
      return unit.run(async (repos) => {
        const actor = await gate.actor(repos, session);
        const at = now();
        const before = await repos.announcements.get(id);
        if (!before) throw new AppError("NOT_FOUND");
        if (!(await repos.announcements.end(id, at))) throw new AppError("CONFLICT", X.over);
        await gate.audit(repos, actor, meta, { ...probe, targetLabel: before.title, reason: before.title });
        const row = await repos.announcements.get(id);
        if (!row) throw new AppError("NOT_FOUND");
        return announcementView(row, at);
      });
    },

    /** The hotel side: what this person has not dismissed yet (Hotel Admins see the admins-only ones too), oldest first. */
    async unread(session: VerifiedSession): Promise<HotelAnnouncement[]> {
      const audiences = audiencesOf(session);
      const at = now();
      return unit.run(async (repos) => (await repos.announcements.unreadFor(session.userId, audiences, at)).map((a) => ({ id: a.id, title: a.title, body: a.body, important: a.important, at: a.startsAt.toISOString() })));
    },

    /** The hotel side: dismiss one for this person (only one they can see; a repeat is fine). */
    async dismiss(session: VerifiedSession, id: string): Promise<{ dismissed: true }> {
      const audiences = audiencesOf(session);
      const at = now();
      await unit.run(async (repos) => {
        const row = await repos.announcements.get(id);
        if (!row || !audiences.includes(row.audience)) throw new AppError("NOT_FOUND");
        await repos.announcements.markRead(id, session.userId, at);
      });
      return { dismissed: true };
    },
  };
}

export type AnnouncementService = ReturnType<typeof createAnnouncementService>;
