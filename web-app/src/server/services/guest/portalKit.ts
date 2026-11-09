import "server-only";
import { recordScopeOf } from "../../auth/permissions";
import type { RecordScope, VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import type { SystemLogEntry } from "../../repos/cashSupport";
import type { PortalRepos } from "../../repos/portal";
import { addDay, freeRooms, istDate, nightsOf } from "../frontOffice/rules";

// What the guest and the company portals share: the record scope check, IST days, the payment-method words, the system-log line, and the room
// search (the front desk's own availability rule, FrontDesk::freeFor, over the website's room categories and their first active plan).

/** The portal's account must point at a record of this kind; staff and the other portal kind are refused (403), whatever their permissions. */
export function requireScope(session: VerifiedSession, kind: RecordScope["kind"]): RecordScope {
  const scope = recordScopeOf(session);
  if (!scope || scope.kind !== kind) throw new AppError("FORBIDDEN");
  return scope;
}

export const DAY_MS = 86_400_000;
export const todayIst = (now: Date): string => istDate(now);
export const daysBetween = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
/** A booked day shown as a moment: midday IST that day (the books keep dates, the portal lists moments). */
export const middayIst = (date: string): string => `${date}T06:30:00.000Z`;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isRealDate = (d: string): boolean => DATE_RE.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

type PortalMethod = "upi" | "card" | "cash" | "netbanking" | "advance";

/** The guest contract's payment methods from the mode typed at the desk ("Cash", "UPI", "Card", "NEFT", "Cheque"...). "Debit" means on account, never a card. */
export function methodOf(mode: string | null): PortalMethod {
  const m = (mode ?? "").toLowerCase();
  if (/upi|gpay|google pay|phonepe|paytm|bhim/.test(m)) return "upi";
  if (m.includes("card")) return "card";
  if (/neft|rtgs|imps|bank|net|cheque|check|online|razorpay|transfer/.test(m)) return "netbanking";
  return "cash";
}

/** A system_logs line written by a portal account (module guest-portal or company-portal), in the same unit as the change. */
export function portalLog(session: VerifiedSession, meta: RequestMeta, line: { module: string; action: SystemLogEntry["action"]; entity: string; summary: string; subject: { id: string; label: string } | null; userName: string; details?: Record<string, unknown> }): SystemLogEntry {
  return {
    module: line.module,
    action: line.action,
    entity: line.entity,
    subjectId: line.subject?.id ?? null,
    subjectLabel: line.subject ? line.subject.label.slice(0, 255) : null,
    summary: line.summary.slice(0, 500),
    details: line.details && Object.keys(line.details).length > 0 ? line.details : null,
    userId: session.userId,
    userName: line.userName.slice(0, 255) || "Portal user",
    ipAddress: meta.ip,
    traceId: meta.traceId,
  };
}

interface RoomAvailability {
  id: string;
  name: string;
  note: string | null;
  size: string | null;
  bedType: string | null;
  maxGuests: number;
  /** The first active plan's double-occupancy price per night (0 when the category has no active plan). */
  ratePaise: bigint;
  planCode: string | null;
  /** Rooms free on every night of [checkIn, checkOut). */
  left: number;
}

/**
 * Every room category of the website with what is free for the dates: capacity (the real rooms of the category that are in service, or the category's
 * count before rooms are set up) less the busiest night held by reservations and in-house walk-ins (reservationService.free, FrontDesk::freeFor :126-137).
 */
export async function roomAvailability(repos: PortalRepos, checkIn: string, checkOut: string, today: string): Promise<RoomAvailability[]> {
  const nights = nightsOf(checkIn, checkOut);
  const types = await repos.siteRooms.list();
  if (types.length === 0) return [];
  const plans = await repos.sitePlans.forRooms(types.map((t) => t.id), { activeOnly: true });
  const rooms = await repos.rooms.all();
  const tomorrow = addDay(today);
  const out: RoomAvailability[] = [];
  for (const t of types) {
    const mine = rooms.filter((r) => r.roomTypeId === t.id);
    const capacity = mine.length > 0 ? mine.filter((r) => !r.outOfOrder).length : t.totalCount;
    let left = 0;
    if (nights.length > 0) {
      const held = await repos.reservations.holding(t.id, nights[0], nights[nights.length - 1]);
      const walkIns = (await repos.stays.walkInsOfType(t.id)).map((s) => ({ from: istDate(s.checkInAt), until: s.expectedCheckOut > tomorrow ? s.expectedCheckOut : tomorrow }));
      left = freeRooms(capacity, held, walkIns, checkIn, checkOut);
    }
    const plan = plans.filter((p) => p.roomId === t.id).sort((a, b) => a.sortOrder - b.sortOrder)[0];
    out.push({ id: t.id, name: t.name, note: t.note, size: t.size, bedType: t.bedType, maxGuests: Math.max(1, t.maxGuests), ratePaise: plan?.doublePaise ?? BigInt(0), planCode: plan?.code ?? null, left });
  }
  return out;
}

/** "240 sq ft" -> 240; anything else -> 0. */
export const sqftOf = (size: string | null): number => {
  const m = /(\d+)/.exec(size ?? "");
  return m ? Number(m[1]) : 0;
};

/** The number to call: the hotel profile phone, else the Website reception phone, else null. */
export const callNumber = (...candidates: (string | null | undefined)[]): string | null => candidates.map((c) => (c ?? "").trim()).find((c) => c !== "") ?? null;
