import "server-only";
import type { PlatformEnterResult } from "@shared/dashboards/platform";
import { platformCopy } from "@shared/dashboards/platform";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { PlatformConsoleRepos, VisitAccess } from "../../repos/platformConsole";
import { RepoError } from "../../repos/types";
import { auditRow, createGate, platformMeta, type PlatformMeta } from "./access";
import type { ConsoleDeps } from "./context";
import { hotelStatusOf } from "./views";

// Enter hotel and Exit (docs/BACKEND.md 14.1, 14.7). A visit is a written reason, 60 minutes, bound to the platform session; while it is active the
// session resolver gives that session the hotel (its SuperAdmin permission role) and the route wrapper refuses every write to a hotel route, so the
// guard holds for any client. Start, end and every refused write are audited with the visit id (the row is then "inside the hotel").

const ENTER_HOTEL_MINUTES = 60;
const E = platformCopy.errors;
const MIN_REASON = 5;
const SHORT = "Give the reason in at least 5 characters.";

export interface EnterResult extends PlatformEnterResult {
  visitId?: string;
  expiresAt?: string;
  /** false for a FULL visit (platform 0135): the hotel's screens may write. */
  readOnly: boolean;
  access?: VisitAccess;
}

export function createVisitService(deps: ConsoleDeps) {
  const { unit, now } = deps;
  const gate = deps.gate ?? createGate(unit, now);

  /** The written reason: 5 to 500 characters, trimmed. */
  function reasonOf(raw: string): string {
    const why = (raw ?? "").trim();
    const length = Array.from(why).length;
    if (length === 0) throw new AppError("VALIDATION_FAILED", E.required.reason, { fields: { reason: E.required.reason } });
    if (length < MIN_REASON) throw new AppError("VALIDATION_FAILED", SHORT, { fields: { reason: SHORT } });
    if (length > 500) throw new AppError("VALIDATION_FAILED", E.reasonLong, { fields: { reason: E.reasonLong } });
    return why;
  }

  /**
   * What this person may do inside this hotel (platform 0135): the Super Admin always full; a platform admin view only, in the hotels the Super Admin gave them (none, or a hotel
   * outside them, is refused); a group admin view only (their own group's hotels: the group console checks it first, the database trigger again).
   */
  async function accessFor(repos: PlatformConsoleRepos, actor: { userId: string; role: string }, hotelId: string): Promise<VisitAccess> {
    if (actor.role === "super_admin") return "full";
    if (actor.role !== "platform_admin") return "view";
    const a = await repos.adminAccess.get(actor.userId);
    if (a.level === "none") throw new AppError("FORBIDDEN", "The Super Admin has not given you access to hotels.");
    if (!a.allHotels && !a.hotelIds.includes(hotelId)) throw new AppError("FORBIDDEN", "This hotel is not among the hotels the Super Admin gave you.");
    // a full (write) visit is the Super Admin's only (MJ, 5 Nov 2026): an old stored "full" counts as view
    return "view";
  }

  /** The access the database actually recorded: before platform 0135 every visit is view, whatever was asked (the hotel then stays read only, as before). */
  const recordedAccess = async (repos: PlatformConsoleRepos, userId: string, visitId: string, asked: VisitAccess): Promise<VisitAccess> =>
    asked === "view" ? "view" : ((await repos.visits.open(userId)).find((v) => v.id === visitId)?.access ?? "view");

  async function enter(session: VerifiedSession, hotelId: string, rawReason: string, meta: PlatformMeta): Promise<EnterResult> {
    await gate.write(session, meta, { action: "hotel_entered", entity: "hotel", entityId: hotelId, hotelId });
    const reason = reasonOf(rawReason);
    const result = await unit.run(async (repos) => {
      const actor = await gate.actor(repos, session);
      const at = now();
      const hotel = await repos.hotels.get(hotelId, at);
      if (!hotel) throw new AppError("NOT_FOUND");
      if (hotel.status !== "active" && hotel.status !== "suspended") throw new AppError("CONFLICT", E.enterNotLive);
      const asked = await accessFor(repos, actor, hotelId);
      // one visit at a time: an earlier one (this hotel or another, ended or past its time) is closed first; a still-valid one gets its "left" row
      for (const old of await repos.visits.open(actor.userId)) {
        const live = old.expiresAt > at;
        await repos.visits.end(old.id, live ? "replaced" : "expired", live ? actor.userId : null, at);
        if (live) await gate.audit(repos, actor, meta, { action: "hotel_exited", entity: "hotel", entityId: old.hotelId, hotelId: old.hotelId, targetLabel: old.hotelName, visitId: old.id });
      }
      let visitId: string;
      const expiresAt = new Date(at.getTime() + ENTER_HOTEL_MINUTES * 60_000);
      try {
        visitId = await repos.visits.start({ userId: actor.userId, hotelId, sessionId: session.sessionId, reason, expiresAt, ip: meta.ip, userAgent: meta.userAgent, access: asked }, at);
      } catch (error) {
        if (error instanceof RepoError) throw new AppError("CONFLICT", E.enterNotLive);
        throw error;
      }
      const access = await recordedAccess(repos, actor.userId, visitId, asked);
      const auditId = await gate.audit(repos, actor, meta, { action: "hotel_entered", entity: "hotel", entityId: hotelId, hotelId, groupId: hotel.groupId, targetLabel: hotel.name, reason, visitId, after: { access } });
      return {
        ok: true as const, hotel: { id: hotel.id, name: hotel.name, slug: hotel.slug, status: hotelStatusOf(hotel) }, auditId, visitId, expiresAt: expiresAt.toISOString(), readOnly: access !== "full", access,
      };
    });
    // the session is now the hotel's: the resolver's cached copy of it (this process) must not say otherwise
    deps.forgetSession?.(session.sessionId);
    return result;
  }

  /**
   * "Extend 60 minutes": a visit is never stretched (the database forbids it, so each row stays the record of what was decided). The live visit ends with the reason
   * 'extended' and a new one starts with the same hotel, reason and access, linked to it; one audit row. The access is decided again (a platform admin whose access was
   * lowered meanwhile gets the new level).
   */
  async function extend(session: VerifiedSession, hotelId: string, meta: PlatformMeta): Promise<EnterResult> {
    await gate.write(session, meta, { action: "hotel_visit_extended", entity: "hotel", entityId: hotelId, hotelId });
    const result = await unit.run(async (repos) => {
      const actor = await gate.actor(repos, session);
      const at = now();
      const hotel = await repos.hotels.get(hotelId, at);
      if (!hotel) throw new AppError("NOT_FOUND");
      const live = (await repos.visits.open(actor.userId)).find((v) => v.hotelId === hotelId && v.expiresAt > at);
      if (!live) throw new AppError("CONFLICT", "This visit has ended. Enter the hotel again.");
      if (hotel.status !== "active" && hotel.status !== "suspended") throw new AppError("CONFLICT", E.enterNotLive);
      const asked = await accessFor(repos, actor, hotelId);
      await repos.visits.end(live.id, "extended", actor.userId, at);
      const expiresAt = new Date(at.getTime() + ENTER_HOTEL_MINUTES * 60_000);
      let visitId: string;
      try {
        visitId = await repos.visits.start({ userId: actor.userId, hotelId, sessionId: session.sessionId, reason: live.reason, expiresAt, ip: meta.ip, userAgent: meta.userAgent, access: asked, extendedFrom: live.id }, at);
      } catch (error) {
        if (error instanceof RepoError) throw new AppError("CONFLICT", E.enterNotLive);
        throw error;
      }
      const access = await recordedAccess(repos, actor.userId, visitId, asked);
      const auditId = await gate.audit(repos, actor, meta, { action: "hotel_visit_extended", entity: "hotel", entityId: hotelId, hotelId, groupId: hotel.groupId, targetLabel: hotel.name, reason: live.reason, visitId, after: { access, expiresAt: expiresAt.toISOString() } });
      return { ok: true as const, hotel: { id: hotel.id, name: hotel.name, slug: hotel.slug, status: hotelStatusOf(hotel) }, auditId, visitId, expiresAt: expiresAt.toISOString(), readOnly: access !== "full", access };
    });
    deps.forgetSession?.(session.sessionId);
    return result;
  }

  /** Leaving ends this person's visit to the hotel. Doing it twice, or without a visit, is fine: the answer is the same and nothing more is written. */
  async function exit(session: VerifiedSession, hotelId: string, meta: PlatformMeta): Promise<EnterResult> {
    await gate.write(session, meta, { action: "hotel_exited", entity: "hotel", entityId: hotelId, hotelId });
    const result = await unit.run(async (repos) => {
      const actor = await gate.actor(repos, session);
      const at = now();
      const hotel = await repos.hotels.get(hotelId, at);
      if (!hotel) throw new AppError("NOT_FOUND");
      let auditId: string | undefined;
      let visitId: string | undefined;
      for (const v of await repos.visits.open(actor.userId)) {
        if (v.hotelId !== hotelId) continue;
        const live = v.expiresAt > at;
        await repos.visits.end(v.id, live ? "exit" : "expired", live ? actor.userId : null, at);
        if (live) {
          visitId = v.id;
          auditId = await gate.audit(repos, actor, meta, { action: "hotel_exited", entity: "hotel", entityId: hotelId, hotelId, groupId: hotel.groupId, targetLabel: hotel.name, visitId: v.id });
        }
      }
      return { ok: true as const, hotel: { id: hotel.id, name: hotel.name, slug: hotel.slug, status: hotelStatusOf(hotel) }, auditId, visitId, readOnly: true };
    });
    deps.forgetSession?.(session.sessionId);
    return result;
  }

  /** Called by the route wrapper when the read-only guard refuses a write made inside a hotel: a failed audit row, stamped with the person, the hotel and the visit. */
  async function recordRefusedWrite(session: VerifiedSession, request: Request, traceId: string): Promise<void> {
    if (!session.visit) return;
    const meta = platformMeta(request, traceId);
    const path = new URL(request.url).pathname;
    await unit.run(async (repos) => {
      const who = await repos.accounts.get(session.userId);
      await repos.audit.write(
        auditRow(
          { userId: who ? session.userId : null, name: who?.displayName ?? "Unknown", role: session.accountRole },
          meta,
          { action: "hotel_write_refused", entity: "hotel", entityId: session.visit?.hotelId ?? null, hotelId: session.visit?.hotelId ?? null, targetLabel: session.visit?.hotelName ?? null, reason: `${request.method.toUpperCase()} ${path}`.slice(0, 500), visitId: session.visit?.id ?? null },
          "failed",
          now(),
        ),
      );
    });
  }

  /**
   * Called by the route wrapper BEFORE a hotel write inside a FULL visit (security review round 3, R3-8): the platform log's row of the intent ("hotel_write_started": who, hotel,
   * route, time). The audit table is append-only, so how the write ended is a second row, the "hotel_write" below, with the same trace id; a started row with no such row is a
   * write that was cut off. Unlike the others this one THROWS when it cannot write: the wrapper then does not make the change.
   */
  async function recordIntent(session: VerifiedSession, request: Request, traceId: string): Promise<void> {
    if (!session.visit) return;
    const meta = platformMeta(request, traceId);
    const path = new URL(request.url).pathname;
    await unit.run(async (repos) => {
      const who = await repos.accounts.get(session.userId);
      await repos.audit.write(
        auditRow(
          { userId: who ? session.userId : null, name: who?.displayName ?? "Unknown", role: session.accountRole },
          meta,
          { action: "hotel_write_started", entity: "hotel", entityId: session.visit?.hotelId ?? null, hotelId: session.visit?.hotelId ?? null, targetLabel: session.visit?.hotelName ?? null, reason: `${request.method.toUpperCase()} ${path}`.slice(0, 500), visitId: session.visit?.id ?? null },
          "success",
          now(),
        ),
      );
    });
  }

  /** Called by the route wrapper after a hotel write made inside a FULL visit (platform 0135): the platform log's own row of it ("hotel_write"), with the call and its answer. */
  async function recordWrite(session: VerifiedSession, request: Request, traceId: string, status: number): Promise<void> {
    if (!session.visit) return;
    const meta = platformMeta(request, traceId);
    const path = new URL(request.url).pathname;
    await unit.run(async (repos) => {
      const who = await repos.accounts.get(session.userId);
      await repos.audit.write(
        auditRow(
          { userId: who ? session.userId : null, name: who?.displayName ?? "Unknown", role: session.accountRole },
          meta,
          { action: "hotel_write", entity: "hotel", entityId: session.visit?.hotelId ?? null, hotelId: session.visit?.hotelId ?? null, targetLabel: session.visit?.hotelName ?? null, reason: `${request.method.toUpperCase()} ${path} (${status})`.slice(0, 500), visitId: session.visit?.id ?? null },
          status < 400 ? "success" : "failed",
          now(),
        ),
      );
    });
  }

  return { enter, extend, exit, recordRefusedWrite, recordIntent, recordWrite };
}

export type VisitService = ReturnType<typeof createVisitService>;
