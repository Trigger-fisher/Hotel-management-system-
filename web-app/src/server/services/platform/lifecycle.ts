import "server-only";
import { ARCHIVE_GRACE_DAYS, platformCopy } from "@shared/dashboards/platform";
import { AppError } from "../../errors";
import type { HotelLifecyclePatch, HotelLifecycleStatus, PlatformHotelRow } from "../../repos/platformConsole";

// The hotel status machine (BRIEF-BACKEND-PLATFORM rule 1, migration 0102), pure so every move is unit-testable:
//   (none) | invited | onboarding -> pending_approval            submit        (P3: the public onboarding form)
//   pending_approval -> active | rejected                          approve / reject (P3: approve runs create-hotel)
//   active -> suspended -> active                                  suspend / reactivate
//   active | suspended | rejected -> archived                      archive (reason, archived_at, restore_until = +ARCHIVE_GRACE_DAYS)
//   archived -> the status it had before, only before restore_until restore (never straight to active for a suspended or rejected hotel)
//   archived -> deleted                                            permanent delete (P5: Super Admin, after the grace period and an export)
// Anything else (rejected -> active, pending_approval -> archived, archived -> archived ...) is refused with the contract's sentence.

export type HotelAction = "submit" | "approve" | "reject" | "suspend" | "reactivate" | "archive" | "restore" | "delete";

const E = platformCopy.errors;
const DAY_MS = 86_400_000;

/** Where an action may start, and the sentence when the hotel is somewhere else. */
const FROM: Record<HotelAction, { from: readonly HotelLifecycleStatus[]; refuse: (s: HotelLifecycleStatus) => string }> = {
  submit: { from: ["invited", "onboarding"], refuse: () => E.inviteUsed },
  approve: { from: ["pending_approval"], refuse: () => E.notPending },
  reject: { from: ["pending_approval"], refuse: () => E.notPending },
  suspend: { from: ["active"], refuse: (s) => (s === "suspended" ? E.alreadySuspended : E.suspendNotActive) },
  reactivate: { from: ["suspended"], refuse: (s) => (s === "active" ? E.alreadyActive : E.notSuspended) },
  archive: { from: ["active", "suspended", "rejected"], refuse: (s) => (s === "archived" ? E.alreadyArchived : s === "pending_approval" ? E.archivePending : E.notArchived) },
  restore: { from: ["archived"], refuse: () => E.notArchived },
  delete: { from: ["archived"], refuse: () => platformCopy.a8Errors.deleteNotArchived },
};

/**
 * Actions that must say why. docs/BACKEND.md 14.1 (the agreed route table, Lead 11 Oct) makes the reason REQUIRED for reject and OPTIONAL (at most
 * 500) for suspend and archive, as the contract's screens send it; when one is typed it is stored on the hotel, the history and the audit row.
 */
const REASON_REQUIRED: ReadonlySet<HotelAction> = new Set<HotelAction>(["reject"]);

/** The reason as stored: trimmed, 1 to 500 characters; VALIDATION_FAILED (field "reason") when required and missing, or too long. */
export function reasonFor(action: HotelAction, raw: string | null | undefined): string | null {
  const why = (raw ?? "").trim();
  if (why === "") {
    if (REASON_REQUIRED.has(action)) throw new AppError("VALIDATION_FAILED", E.required.reason, { fields: { reason: E.required.reason } });
    return null;
  }
  if (Array.from(why).length > 500) throw new AppError("VALIDATION_FAILED", E.reasonLong, { fields: { reason: E.reasonLong } });
  return why;
}

/** Inside the archive grace period: restore_until still ahead. */
export const inGrace = (h: Pick<PlatformHotelRow, "restoreUntil">, now: Date): boolean => h.restoreUntil !== null && h.restoreUntil.getTime() > now.getTime();

/**
 * The move an action makes from the hotel's current state: the target status and the lifecycle columns to write. Throws CONFLICT with the
 * contract's sentence for a move the machine does not allow.
 */
export function transition(h: PlatformHotelRow, action: HotelAction, reason: string | null, now: Date): HotelLifecyclePatch {
  const rule = FROM[action];
  if (!rule.from.includes(h.status)) throw new AppError("CONFLICT", rule.refuse(h.status));
  switch (action) {
    case "suspend":
      return { status: "suspended", suspendedAt: now, suspendReason: reason };
    case "reactivate":
      return { status: "active", suspendedAt: null, suspendReason: null };
    case "archive":
      return {
        status: "archived", archivedAt: now, archiveReason: reason, restoreUntil: new Date(now.getTime() + ARCHIVE_GRACE_DAYS * DAY_MS),
        statusBeforeArchive: h.status as "active" | "suspended" | "rejected",
      };
    case "restore": {
      if (!inGrace(h, now)) throw new AppError("CONFLICT", platformCopy.a8Errors.restoreGraceOver);
      const back = h.statusBeforeArchive ?? "active";
      return {
        status: back, archivedAt: null, archiveReason: null, restoreUntil: null, statusBeforeArchive: null,
        ...(back === "active" ? { suspendedAt: null, suspendReason: null } : {}),
      };
    }
    case "submit":
      return { status: "pending_approval" };
    case "approve":
      return { status: "active" };
    case "reject":
      return { status: "rejected" };
    case "delete":
      return { status: "deleted" };
  }
}
