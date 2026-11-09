import "server-only";
import { isPortalAccount } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { PlatformConsoleUnit } from "../../repos/platformConsole";
import type { MoveState, MoveStore } from "../../whatsapp/move";
import { auditRow, createGate, type AuditInput, type Gate, type PlatformMeta } from "../platform/access";

// A hotel's move to its own WhatsApp number (MJ, 4 Nov 2026; plan part 14): the Super Admin or Platform Admin starts the cut-over, can finish it early, or undo it. The states and what each means are in
// whatsapp/move.ts. The cut-over needs the own number to be connected and at least one approved message on it (so the hotel can write first to a guest whose window closed). Every step is audited.
export interface MoveStatus {
  hotelId: string;
  hotelName: string;
  state: MoveState;
  ownPhone: string | null;
  /** When the shared number stops reaching the hotel by a swipe-reply or its code (only in the transition). */
  transitionEndsAt: string | null;
  approvedMessages: number;
  /** What may be pressed now. */
  can: { cutOver: boolean; finish: boolean; undo: boolean };
  /** Why the cut-over cannot be started yet, in one sentence, or null. */
  cutOverBlockedBy: string | null;
}

type Step = "move_cut_over" | "move_finished" | "move_undone";

export function createMoveService(deps: {
  unit: PlatformConsoleUnit;
  store: MoveStore;
  now: () => Date;
  /** How many approved messages the hotel has on its own number (read from the hotel's schema). */
  approvedMessages: (hotelId: string, lineId: string) => Promise<number>;
  gate?: Gate;
}) {
  const { unit, store, now } = deps;
  const gate = deps.gate ?? createGate(unit, now);
  const probe = (step: Step, id: string | null): AuditInput => ({ action: "settings_updated", entity: "platform", entityId: id, reason: `whatsapp:${step}` });
  const refused = (s: VerifiedSession): boolean => s.token !== undefined || s.visit !== undefined || isPortalAccount(s);

  async function statusOf(hotelId: string): Promise<MoveStatus> {
    const v = await store.view(hotelId);
    if (!v) throw new AppError("NOT_FOUND");
    const approved = v.ownLine ? await deps.approvedMessages(hotelId, v.ownLine.id).catch(() => 0) : 0;
    const lineReady = v.ownLine !== null && (v.ownLine.status === "test" || v.ownLine.status === "active");
    const blocked = v.ownLine === null ? "This hotel has not connected its own number yet." : v.state !== "pending" ? null : !lineReady ? "The hotel's number is not active. Check it on the numbers screen." : approved < 1 ? "Get at least one message approved on the hotel's own number first." : null;
    return {
      hotelId,
      hotelName: v.hotelName,
      state: v.state,
      ownPhone: v.ownLine?.phone ?? null,
      transitionEndsAt: v.transitionEndsAt ? v.transitionEndsAt.toISOString() : null,
      approvedMessages: approved,
      can: { cutOver: v.state === "pending" && blocked === null, finish: v.state === "transition", undo: v.state === "transition" || v.state === "active" },
      cutOverBlockedBy: v.state === "pending" ? blocked : null,
    };
  }

  async function step(session: VerifiedSession, hotelId: string, meta: PlatformMeta, name: Step, work: (status: MoveStatus) => Promise<void>): Promise<MoveStatus> {
    if (refused(session)) throw await gate.refuse(session, meta, probe(name, hotelId), new AppError("FORBIDDEN"));
    await gate.superWrite(session, meta, probe(name, hotelId));
    const before = await statusOf(hotelId);
    await work(before);
    await unit.run(async (repos) => {
      const actor = await gate.actor(repos, session);
      await repos.audit.write(auditRow({ userId: actor.userId, name: actor.name, role: actor.role }, meta, { ...probe(name, hotelId), targetLabel: before.hotelName, reason: `whatsapp:${name}: ok`, after: { hotelId, from: before.state } }, "success", now()));
    });
    return statusOf(hotelId);
  }
  const lost = (): never => {
    throw new AppError("CONFLICT", "The move changed while you were looking. Reload and try again.");
  };

  return {
    async status(session: VerifiedSession, hotelId: string): Promise<MoveStatus> {
      if (refused(session)) throw new AppError("FORBIDDEN");
      gate.superRead(session);
      await unit.run((repos) => gate.actor(repos, session));
      return statusOf(hotelId);
    },

    /** pending -> transition: the hotel sends from its own number from now on; the shared number keeps reaching it for the transition days. */
    cutOver: (session: VerifiedSession, hotelId: string, meta: PlatformMeta) =>
      step(session, hotelId, meta, "move_cut_over", async (before) => {
        if (before.state !== "pending") throw new AppError("CONFLICT", before.state === "none" ? "This hotel has not connected its own number yet." : "The cut-over was already done.");
        if (before.cutOverBlockedBy) throw new AppError("CONFLICT", before.cutOverBlockedBy);
        const days = await store.transitionDays();
        if (!(await store.setState(hotelId, ["pending"], "transition", new Date(now().getTime() + days * 86_400_000)))) lost();
      }),

    /** transition -> active, before the days are over. */
    finish: (session: VerifiedSession, hotelId: string, meta: PlatformMeta) =>
      step(session, hotelId, meta, "move_finished", async (before) => {
        if (before.state !== "transition") throw new AppError("CONFLICT", "Only a hotel in its transition can be finished.");
        if (!(await store.setState(hotelId, ["transition"], "active", null))) lost();
      }),

    /** transition or active -> pending: back to the shared number as before (nothing was moved, so nothing is lost). */
    undo: (session: VerifiedSession, hotelId: string, meta: PlatformMeta) =>
      step(session, hotelId, meta, "move_undone", async (before) => {
        if (before.state !== "transition" && before.state !== "active") throw new AppError("CONFLICT", "There is no cut-over to undo.");
        if (!(await store.setState(hotelId, ["transition", "active"], "pending", null))) lost();
      }),
  };
}
export type MoveService = ReturnType<typeof createMoveService>;
