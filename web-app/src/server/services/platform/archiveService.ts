import "server-only";
import type { PlatformArchivedHotel, PlatformHotelDeleted, PlatformHotelExport } from "@shared/dashboards/platform";
import { ARCHIVE_GRACE_DAYS, platformCopy } from "@shared/dashboards/platform";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import { ProvisionError } from "../../provisioner/port";
import type { HotelExportRow, PlatformHotelRow } from "../../repos/platformConsole";
import { RepoError } from "../../repos/types";
import { createGate, type AuditInput, type PlatformMeta } from "./access";
import { words, type InviteDeps } from "./context";
import { inGrace } from "./lifecycle";

// Archived hotels, the data export and the permanent delete, Super Admin only (docs/BACKEND.md 14.6).
// DELETE order (nothing is dropped before it is recorded): (1) check every rule in a unit, a refusal is audited as failed; (2) in ONE unit write the
// permanent-delete record (the database trigger checks the rules again: Super Admin, archived, grace over, typed address, a ready export of THIS hotel),
// mark the hotel deleted, close the accounts that belonged only to it, unlink it from its group, write the status history and the audit row;
// (3) only then the provisioner drops the schema and role. If (3) fails, the platform side stays deleted (the record is kept), the failure is logged
// with the schema name and audited as failed, and the answer says so: the leftover schema is dropped by `npm run db:cli -- drop-hotel-schema <name>`.

const C = platformCopy.archivedHotels;
const X = platformCopy.a8Errors;
const DAY_MS = 86_400_000;

const daysLeftOf = (h: Pick<PlatformHotelRow, "restoreUntil">, now: Date): number => (h.restoreUntil === null ? 0 : Math.max(0, Math.ceil((h.restoreUntil.getTime() - now.getTime()) / DAY_MS)));

export function createArchiveService(deps: InviteDeps) {
  const { unit, now } = deps;
  const gate = createGate(unit, now);

  function view(h: PlatformHotelRow, at: Date, by: string | undefined, ex: HotelExportRow | undefined): PlatformArchivedHotel {
    const left = daysLeftOf(h, at);
    const archivedAt = h.archivedAt ?? h.createdAt;
    return {
      id: h.id, name: h.name, slug: h.slug, city: h.city ?? "", state: h.state ?? "", groupName: h.groupName, archivedAt: archivedAt.toISOString(), archivedBy: by ?? "Unknown",
      reason: h.archiveReason, graceDays: ARCHIVE_GRACE_DAYS, daysLeft: left, graceEndsAt: (h.restoreUntil ?? new Date(archivedAt.getTime() + ARCHIVE_GRACE_DAYS * DAY_MS)).toISOString(),
      canRestore: inGrace(h, at), canDelete: left === 0 && ex !== undefined, exportedAt: ex ? ex.finishedAt.toISOString() : null, exportFileName: ex ? ex.fileName : null, adminCount: h.adminCount,
    };
  }

  async function list(session: VerifiedSession, q: { search?: string }): Promise<PlatformArchivedHotel[]> {
    gate.superRead(session);
    const w = words(q.search);
    return unit.run(async (repos) => {
      await gate.actor(repos, session);
      const at = now();
      const archived = (await repos.hotels.list({ words: [] }, at)).filter((h) => h.status === "archived");
      const ids = archived.map((h) => h.id);
      const [exportsOf, byWho] = await Promise.all([repos.exports.readyOf(ids), repos.auditLog.lastActors("hotel_archived", ids)]);
      return archived
        .map((h) => view(h, at, byWho.get(h.id), exportsOf.get(h.id)))
        .filter((a) => w.every((x) => [a.name, a.slug, a.city, a.state, a.reason ?? "", a.archivedBy].join(" ").toLowerCase().includes(x)))
        .sort((x, y) => (x.archivedAt < y.archivedAt ? 1 : x.archivedAt > y.archivedAt ? -1 : 0));
    });
  }

  async function exportData(session: VerifiedSession, id: string, meta: PlatformMeta): Promise<PlatformHotelExport> {
    const probe: AuditInput = { action: "hotel_exported", entity: "hotel", entityId: id, hotelId: id };
    await gate.superWrite(session, meta, probe);
    const hotel = await unit.run(async (repos) => {
      await gate.actor(repos, session);
      const h = await repos.hotels.get(id, now());
      if (!h) throw new AppError("NOT_FOUND");
      return h;
    });
    const input: AuditInput = { ...probe, groupId: hotel.groupId, targetLabel: hotel.name };
    const startedAt = now();
    let file: Awaited<ReturnType<typeof deps.provisioner.exportHotel>>;
    try {
      file = await deps.provisioner.exportHotel({ hotelId: id, slug: hotel.slug, at: startedAt });
    } catch (error) {
      deps.report?.("hotel export: the provisioner failed", error, meta.traceId);
      const notConfigured = error instanceof ProvisionError && error.failure === "NOT_CONFIGURED";
      throw await gate.refuse(session, meta, input, new AppError("SERVER_ERROR", notConfigured ? "Exporting hotel data is not set up on this server yet." : "The export failed. Nothing was kept. Please try again."));
    }
    return unit.run(async (repos) => {
      const actor = await gate.actor(repos, session);
      const finishedAt = now();
      await repos.exports.record({ hotelId: id, requestedBy: actor.userId, fileName: file.fileName, fileRef: file.fileRef, byteSize: file.byteSize, sha256: file.sha256, startedAt, finishedAt });
      await gate.audit(repos, actor, meta, { ...input, reason: file.fileName });
      return { hotelId: id, fileName: file.fileName, exportedAt: finishedAt.toISOString(), message: C.exportDone, note: "The file is kept in private storage on the server." };
    });
  }

  async function deletePermanently(session: VerifiedSession, id: string, confirmSlug: string, meta: PlatformMeta): Promise<PlatformHotelDeleted> {
    const probe: AuditInput = { action: "hotel_deleted", entity: "hotel", entityId: id, hotelId: id };
    await gate.superWrite(session, meta, probe);
    // the owner-side worker must be there BEFORE anything is recorded: a delete that could not finish is refused up front
    try {
      await deps.provisioner.inspect({ hotelIds: [] });
    } catch (error) {
      if (error instanceof ProvisionError && error.failure === "NOT_CONFIGURED") throw await gate.refuse(session, meta, probe, new AppError("SERVER_ERROR", "Deleting a hotel is not set up on this server yet."));
    }
    type Outcome = { ok: { hotel: PlatformHotelRow; schema: string; closed: number } } | { refused: AppError; input: AuditInput };
    const outcome = await unit.run(async (repos): Promise<Outcome> => {
      const actor = await gate.actor(repos, session);
      const at = now();
      const h = await repos.hotels.get(id, at, { forUpdate: true });
      if (!h) throw new AppError("NOT_FOUND");
      const input: AuditInput = { ...probe, groupId: h.groupId, targetLabel: h.name };
      const refuse = (e: AppError): Outcome => ({ refused: e, input });
      if (h.status !== "archived") return refuse(new AppError("CONFLICT", X.deleteNotArchived));
      const left = daysLeftOf(h, at);
      if (left > 0) return refuse(new AppError("CONFLICT", X.deleteInGrace(left)));
      const ex = (await repos.exports.readyOf([id])).get(id);
      if (!ex) return refuse(new AppError("CONFLICT", X.deleteNeedsExport));
      if ((confirmSlug ?? "").trim() !== h.slug) return refuse(new AppError("VALIDATION_FAILED", C.deleteSlugMismatch, { fields: { confirmSlug: C.deleteSlugMismatch } }));
      const schema = await repos.exports.schemaOf(id);
      if (!schema) throw new AppError("NOT_FOUND");
      try {
        await repos.exports.recordDeletion({ hotelId: id, hotelName: h.name, slug: h.slug, schemaName: schema, confirmSlug: confirmSlug.trim(), exportId: ex.id, deletedBy: actor.userId, reason: h.archiveReason, traceId: meta.traceId, at });
      } catch (error) {
        // the database refused what the checks above allowed (a rule changed meanwhile): nothing was written
        if (error instanceof RepoError) return refuse(new AppError("CONFLICT", X.deleteNotArchived));
        throw error;
      }
      await repos.hotels.markDeleted(id, at);
      await repos.hotels.endSessions(id, at);
      const closed = await repos.accounts.closeOfHotel(id, actor.userId, at);
      if (h.groupId) {
        await repos.groups.unlink(h.groupId, id);
        await repos.groups.addHistory({ groupId: h.groupId, event: "hotel_unlinked", fromStatus: null, toStatus: null, hotelId: id, adminUserId: null, changedBy: actor.userId, actorRole: actor.role, reason: "Hotel deleted for good", traceId: meta.traceId, at });
      }
      await repos.hotels.addStatusHistory({ hotelId: id, fromStatus: "archived", toStatus: "deleted", changedBy: actor.userId, actorRole: actor.role, reason: null, traceId: meta.traceId, at });
      await gate.audit(repos, actor, meta, { ...input, after: { accountsClosed: closed, export: ex.fileName } });
      return { ok: { hotel: h, schema, closed } };
    });
    if ("refused" in outcome) throw await gate.refuse(session, meta, outcome.input, outcome.refused);
    const { hotel, schema } = outcome.ok;
    try {
      await deps.provisioner.dropHotel({ hotelId: id, schema });
    } catch (error) {
      deps.report?.(`hotel delete: the schema ${schema} was NOT dropped (the platform record is already deleted)`, error, meta.traceId);
      throw await gate.refuse(session, meta, { ...probe, groupId: hotel.groupId, targetLabel: hotel.name }, new AppError("SERVER_ERROR", `${hotel.name} was deleted from the platform, but its stored data could not be removed yet. A developer must finish it (schema ${schema}). Nothing else is needed from you.`));
    }
    return { hotelId: id, name: hotel.name, message: C.deleted(hotel.name) };
  }

  return { list, exportData, deletePermanently };
}

export type ArchiveService = ReturnType<typeof createArchiveService>;
