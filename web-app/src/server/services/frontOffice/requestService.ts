import "server-only";
import type { GuestRequestRow } from "@shared/dashboards/guestRequests";
import { guestRequestKindLabel } from "@shared/dashboards/guestRequests";
import type { Page } from "@shared/dashboards/common";
import { requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import type { GuestRequestRecord } from "../../repos/frontOffice";
import { actorOf, logLine, type FrontOfficeDeps, type Who } from "./context";

// Guest requests on the desk side (MJ's plan, G2): the queue of what guests asked for from the portal (oldest first), closed ones newest first, and
// closing one as done or not possible with an optional word back. Needs the In House part (pms.stays): view to look, edit to close. Every close is logged.

const PART = "pms.stays";
const REPLY_MAX = 300;

export function createRequestService(deps: Pick<FrontOfficeDeps, "unit" | "people" | "catalog" | "now">) {
  const { unit, catalog, now } = deps;
  const who = async (session: VerifiedSession, meta: RequestMeta): Promise<Who> => ({ session, meta, actor: await actorOf(deps as FrontOfficeDeps, session) });

  return {
    async list(session: VerifiedSession, q: { view: "open" | "closed"; page: number; pageSize: number }): Promise<{ page: Page<GuestRequestRow>; counts: { open: number } }> {
      requirePermission(session, catalog, PART, "view");
      return unit.run(session, async (repos) => {
        const r = await repos.guestRequests.list(q);
        const stays = new Map<string, { guestName: string; roomNumber: string }>();
        for (const row of r.rows) {
          if (stays.has(row.stayId)) continue;
          const stay = await repos.stays.get(row.stayId);
          const room = stay ? await repos.rooms.get(stay.roomId) : null;
          stays.set(row.stayId, { guestName: stay?.guestName ?? "", roomNumber: room?.number ?? "" });
        }
        const ids = [...new Set(r.rows.map((x) => x.doneBy).filter((x): x is string => x !== null))];
        const names = new Map([...(await deps.people.get(ids))].map(([id, p]) => [id, p.name]));
        const dto = (x: GuestRequestRecord): GuestRequestRow => ({
          id: x.id, kind: x.kind, note: x.note, status: x.status, reply: x.reply, at: x.createdAt.toISOString(), doneAt: x.doneAt ? x.doneAt.toISOString() : null,
          stayId: x.stayId, roomNumber: stays.get(x.stayId)?.roomNumber ?? "", guestName: stays.get(x.stayId)?.guestName ?? "", doneBy: x.doneBy ? (names.get(x.doneBy) ?? null) : null,
        });
        return { page: { items: r.rows.map(dto), total: r.total, page: q.page, pageSize: q.pageSize }, counts: { open: await repos.guestRequests.countOpen() } };
      });
    },

    /** Done or not possible, with an optional word back (300 characters); 404 when gone, 409 when already closed. */
    async close(session: VerifiedSession, id: string, body: { status: "done" | "declined"; reply: string }, meta: RequestMeta): Promise<GuestRequestRow> {
      requirePermission(session, catalog, PART, "edit");
      const w = await who(session, meta);
      const reply = body.reply.trim();
      if (Array.from(reply).length > REPLY_MAX) throw new AppError("VALIDATION_FAILED", `Keep the reply under ${REPLY_MAX} characters.`, { fields: { reply: `Keep the reply under ${REPLY_MAX} characters.` } });
      return unit.run(session, async (repos) => {
        const before = await repos.guestRequests.get(id);
        if (!before) throw new AppError("NOT_FOUND");
        if (before.status !== "open") throw new AppError("CONFLICT", "This request is already closed.");
        const at = now();
        const closed = await repos.guestRequests.close(id, { status: body.status, reply: reply === "" ? null : reply, doneBy: session.userId, doneAt: at });
        if (!closed) throw new AppError("CONFLICT", "This request is already closed.");
        const stay = await repos.stays.get(closed.stayId);
        const room = stay ? await repos.rooms.get(stay.roomId) : null;
        const label = `${guestRequestKindLabel(closed.kind)} - room ${room?.number ?? ""}`;
        await repos.systemLogs.write(logLine(w, { action: "updated", entity: "Guest request", summary: `${body.status === "done" ? "Done" : "Not possible"}: ${label}`, subject: { id: closed.id, label }, details: reply ? { Reply: reply } : undefined }));
        return {
          id: closed.id, kind: closed.kind, note: closed.note, status: closed.status, reply: closed.reply, at: closed.createdAt.toISOString(), doneAt: closed.doneAt ? closed.doneAt.toISOString() : null,
          stayId: closed.stayId, roomNumber: room?.number ?? "", guestName: stay?.guestName ?? "", doneBy: w.actor?.name ?? null,
        };
      });
    },
  };
}

export type RequestService = ReturnType<typeof createRequestService>;
