import "server-only";
import type { PlatformActivityAction, PlatformAuditEntry, PlatformAuditPage, PlatformAuditQuery, PlatformSignIn, PlatformSignInPage, PlatformSignInQuery } from "@shared/dashboards/platform";
import { platformCopy } from "@shared/dashboards/platform";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { AuditSearch, PlatformAuditEntryRow, SignInEvent } from "../../repos/platformConsole";
import { deviceLabel } from "../admin/accountService";
import { createGate, type PlatformMeta } from "./access";
import { paged, words, type ConsoleDeps } from "./context";
import { activityText, levelOf } from "./views";

// The Super Admin's audit log, its CSV export and the sign-in history (docs/BACKEND.md 14.5). The audit trail is append-only: nothing here can change or
// remove a row. A search word is matched over what the screen shows (who, action, target, hotel, group, sentence, reason, address); the other filters run in
// SQL, so a search reads at most SEARCH_CAP newest rows that match them.

/** The audit list's query: ction is ll or an action name (an unknown name simply matches nothing). */
type AuditListQuery = Omit<PlatformAuditQuery, "action"> & { action?: string };

const SEARCH_CAP = 20_000;
const EXPORT_CAP = 50_000;
const A = platformCopy.audit;
const S = platformCopy.signIns;
const DAY_MS = 86_400_000;

/** An IST calendar date (YYYY-MM-DD) as the start of that day in India time, or null when it is not a real date. */
function istStart(date: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const d = new Date(`${date}T00:00:00+05:30`);
  return Number.isNaN(d.getTime()) || new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10) !== date ? null : d;
}

/** The query's dates as moments: from inclusive, to inclusive (so the day after, exclusive). A bad date or from after to is a 422 on the field. */
function rangeOf(q: { from?: string; to?: string }): { from?: Date; to?: Date } {
  const fields: Record<string, string> = {};
  const from = q.from ? istStart(q.from) : undefined;
  const to = q.to ? istStart(q.to) : undefined;
  if (q.from && !from) fields.from = "Enter a date like 2026-10-05.";
  if (q.to && !to) fields.to = "Enter a date like 2026-10-05.";
  if (from && to && from > to) fields.to = "The end date is before the start date.";
  if (Object.keys(fields).length > 0) throw new AppError("VALIDATION_FAILED", undefined, { fields });
  return { ...(from ? { from } : {}), ...(to ? { to: new Date(to.getTime() + DAY_MS) } : {}) };
}

function entryView(r: PlatformAuditEntryRow): PlatformAuditEntry {
  const action = r.action as PlatformActivityAction;
  const known = (A.actions as Record<string, string>)[r.action];
  return {
    id: r.id, at: r.at.toISOString(), actorName: r.actorName, action, actionLabel: known ?? r.action, target: r.targetLabel ?? "", hotelId: r.hotelId, hotelName: r.hotelName,
    groupId: r.groupId, groupName: r.groupName,
    text: activityText(action, { hotel: r.hotelName ?? r.targetLabel ?? "", group: r.groupName ?? "", target: r.targetLabel ?? "", reason: r.reason }),
    actorRole: r.actorRole ? levelOf(r.actorRole) : null, insideHotel: r.insideHotel, result: r.result, reason: r.reason, ip: r.ip ?? "", browser: r.userAgent ? deviceLabel(r.userAgent) : "",
  };
}

const haystack = (e: PlatformAuditEntry): string => [e.actorName, e.actionLabel, e.target, e.hotelName ?? "", e.groupName ?? "", e.text, e.reason ?? "", e.ip].join(" ").toLowerCase();

/** A CSV cell: quoted when needed, and a cell that starts like a formula (= + - @ tab, CR) is prefixed with a quote so a spreadsheet never runs it. */
function csvCell(value: string | number | boolean | null): string {
  let s = value === null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const istStamp = (iso: string): string => new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().replace("T", " ").slice(0, 19);

export function createAuditService(deps: ConsoleDeps) {
  const { unit, now } = deps;
  const gate = createGate(unit, now);

  function filterOf(q: { action?: string; hotelId?: string; actor?: string; from?: string; to?: string }): AuditSearch {
    const range = rangeOf(q);
    return { ...(q.action && q.action !== "all" ? { action: q.action } : {}), ...(q.hotelId ? { hotelId: q.hotelId } : {}), ...(q.actor ? { actor: q.actor } : {}), ...range };
  }

  async function list(session: VerifiedSession, q: AuditListQuery & { page: number; pageSize: number }): Promise<PlatformAuditPage> {
    gate.superRead(session);
    const filter = filterOf(q);
    const w = words(q.search);
    return unit.run(async (repos) => {
      await gate.actor(repos, session);
      const actors = await repos.auditLog.actors();
      if (w.length === 0) {
        const r = await repos.auditLog.search(filter, { offset: (q.page - 1) * q.pageSize, limit: q.pageSize });
        return { items: r.rows.map(entryView), total: r.total, page: q.page, pageSize: q.pageSize, actors };
      }
      const all = (await repos.auditLog.search(filter, { offset: 0, limit: SEARCH_CAP })).rows.map(entryView).filter((e) => w.every((x) => haystack(e).includes(x)));
      return { ...paged(all, q.page, q.pageSize), actors };
    });
  }

  /** The CSV of the same filters (no paging). The export is itself an audit entry, with the filters and the row count. */
  async function exportCsv(session: VerifiedSession, q: AuditListQuery, meta: PlatformMeta): Promise<{ bytes: Uint8Array; filename: string; rows: number }> {
    const probe = { action: "audit_exported", entity: "platform", entityId: null } as const;
    await gate.superWrite(session, meta, probe);
    const filter = filterOf(q);
    const w = words(q.search);
    return unit.run(async (repos) => {
      const actor = await gate.actor(repos, session);
      const at = now();
      const found = await repos.auditLog.search(filter, { offset: 0, limit: EXPORT_CAP + 1 });
      const all = found.rows.map(entryView).filter((e) => w.every((x) => haystack(e).includes(x)));
      const cut = all.length > EXPORT_CAP || (w.length === 0 && found.total > EXPORT_CAP);
      const rows = all.slice(0, EXPORT_CAP);
      const head = ["When (IST)", "Who", "Role", "Action", "On", "Hotel", "Group", "What happened", "Result", "Reason", "Inside hotel", "IP address", "Browser"];
      const lines = [head.map(csvCell).join(",")];
      for (const e of rows) {
        lines.push(
          [istStamp(e.at), e.actorName, e.actorRole ? platformCopy.status.level[e.actorRole] : "", e.actionLabel, e.target, e.hotelName ?? "", e.groupName ?? "", e.text, A.results[e.result], e.reason ?? "", e.insideHotel ? A.yes : A.no, e.ip, e.browser]
            .map(csvCell)
            .join(","),
        );
      }
      if (cut) lines.push(csvCell(`The file stops at ${EXPORT_CAP} entries. Narrow the dates to export the rest.`));
      const filters = [q.action && q.action !== "all" ? `action ${q.action}` : "", q.hotelId ? "one hotel" : "", q.actor ? `by ${q.actor}` : "", q.from ? `from ${q.from}` : "", q.to ? `to ${q.to}` : "", q.search ? `search "${q.search}"` : ""].filter(Boolean);
      await gate.audit(repos, actor, meta, { ...probe, reason: `${rows.length} ${rows.length === 1 ? "entry" : "entries"}${filters.length ? `; ${filters.join(", ")}` : ""}` });
      const stamp = new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 10);
      // a UTF-8 byte-order mark so Excel opens the rupee sign and Indian names correctly
      return { bytes: new TextEncoder().encode(`﻿${lines.join("\r\n")}\r\n`), filename: `audit-log-${stamp}.csv`, rows: rows.length };
    });
  }

  /* ------------------------------------------------------------------ sign-in history */

  const REFUSALS: Record<string, string> = {
    disabled: S.reasons.disabled, hotel_suspended: S.reasons.hotelSuspended, hotel_archived: S.reasons.hotelArchived, hotel_rejected: "The hotel was rejected.",
    hotel_pending: "The account is waiting for approval.", group_pending: "The account is waiting for approval.",
  };

  function signInView(e: SignInEvent): PlatformSignIn {
    const result = e.event === "login_success" ? "success" : e.event === "account_locked" ? "locked" : "failed";
    let reason: string | null = null;
    if (e.event === "account_locked") reason = S.reasons.locked;
    else if (e.event === "code_failed") reason = S.reasons.wrongCode;
    else if (e.event === "login_failed") {
      const why = typeof e.detail?.reason === "string" ? e.detail.reason : null;
      reason = why ? (REFUSALS[why] ?? S.reasons.disabled) : e.detail?.known === false || e.userId === null ? S.reasons.unknownUser : S.reasons.wrongPassword;
    }
    return {
      id: e.id, at: e.at.toISOString(), username: e.username ?? "(unknown)", name: e.name, level: e.accountRole ? levelOf(e.accountRole) : null, hotelName: e.hotelName, result, reason,
      ip: e.ip ?? "", device: e.userAgent ? deviceLabel(e.userAgent) : "",
    };
  }

  async function listSignIns(session: VerifiedSession, q: PlatformSignInQuery & { page: number; pageSize: number }): Promise<PlatformSignInPage> {
    gate.superRead(session);
    const w = words(q.search);
    return unit.run(async (repos) => {
      await gate.actor(repos, session);
      const matched = (await repos.signIns.recent(SEARCH_CAP))
        .map(signInView)
        .filter((s) => w.length === 0 || w.every((x) => [s.username, s.name ?? "", s.hotelName ?? "", s.ip, s.device, s.reason ?? ""].join(" ").toLowerCase().includes(x)));
      const n = (r: PlatformSignIn["result"]): number => matched.filter((s) => s.result === r).length;
      const counts = { all: matched.length, success: n("success"), failed: n("failed"), locked: n("locked") };
      const result = q.result ?? "all";
      return { ...paged(matched.filter((s) => result === "all" || s.result === result), q.page, q.pageSize), counts };
    });
  }

  return { list, exportCsv, listSignIns };
}

export type AuditService = ReturnType<typeof createAuditService>;
