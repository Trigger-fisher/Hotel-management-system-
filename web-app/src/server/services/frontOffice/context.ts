import "server-only";
import type { Catalog } from "../../auth/catalog";
import type { VerifiedSession } from "../../auth/session";
import type { RequestMeta } from "../../http/meta";
import type { SystemLogEntry } from "../../repos/cashSupport";
import type { FrontOfficeRepos, RoomRecord, RoomTypeRecord, StayRecord } from "../../repos/frontOffice";
import type { Unit } from "../../repos/types";
import type { BillService } from "../billing/billService";
import type { PeopleDirectory, Person, PlatformAudit } from "../cash/ports";
import { istDate } from "./rules";

// What every front-office service shares: its dependencies, the system-log line in Pallav's words (module `frontdesk`), and the batched
// lookups a DTO needs (no N+1).
const FRONTDESK = "frontdesk";

export interface FrontOfficeDeps {
  unit: Unit<FrontOfficeRepos>;
  people: PeopleDirectory;
  audit: PlatformAudit;
  catalog: Catalog;
  now: () => Date;
  /** The bill service: check-out writes its bill through `writeBillInUnit` (ruled (f): no copied bill logic). */
  bills: BillService;
}

export interface Who {
  session: VerifiedSession;
  meta: RequestMeta;
  actor: Person | undefined;
}

export const today = (deps: Pick<FrontOfficeDeps, "now">): string => istDate(deps.now());
export const year2 = (deps: Pick<FrontOfficeDeps, "now">): string => today(deps).slice(2, 4);

/** SystemLogger::record (Support/SystemLogger.php:23-52) in the front desk's words. */
export function logLine(w: Who, line: { module?: string; action: SystemLogEntry["action"]; entity: string; summary: string; subject: { id: string; label: string } | null; details?: Record<string, unknown> }): SystemLogEntry {
  return {
    module: line.module ?? FRONTDESK,
    action: line.action,
    entity: line.entity,
    subjectId: line.subject?.id ?? null,
    subjectLabel: line.subject ? line.subject.label.slice(0, 255) : null,
    summary: line.summary.slice(0, 500),
    details: line.details && Object.keys(line.details).length > 0 ? line.details : null,
    userId: w.session.userId,
    userName: w.actor?.name ?? "System",
    ipAddress: w.meta.ip,
    traceId: w.meta.traceId,
  };
}

/**
 * The same repositories, but the whole-table reads that a page's helpers each repeat (the rooms, the room types, the current stays of a given set of rooms) are made
 * ONCE and shared for the rest of this unit of work. Only for a READ-ONLY unit (the board): inside one transaction a repeated read answers the same, so nothing changes
 * but the number of statements (the board read the rooms and the room types three times each). Never use it in a unit that writes: a write between two reads must be seen.
 */
export function readOnce(repos: FrontOfficeRepos): FrontOfficeRepos {
  let rooms: Promise<RoomRecord[]> | undefined;
  let types: Promise<RoomTypeRecord[]> | undefined;
  const current = new Map<string, Promise<Map<string, StayRecord>>>();
  return {
    ...repos,
    rooms: { ...repos.rooms, all: () => (rooms ??= repos.rooms.all()) },
    roomTypes: { ...repos.roomTypes, all: () => (types ??= repos.roomTypes.all()) },
    stays: {
      ...repos.stays,
      currentByRoom: (ids) => {
        const key = ids.join(",");
        let made = current.get(key);
        if (!made) current.set(key, (made = repos.stays.currentByRoom(ids)));
        return made;
      },
    },
  };
}

export async function typeMap(repos: FrontOfficeRepos): Promise<Map<string, RoomTypeRecord>> {
  return new Map((await repos.roomTypes.all()).map((t) => [t.id, t]));
}

export const companyIds = (rows: readonly { companyId: string | null }[]): string[] => [...new Set(rows.flatMap((r) => (r.companyId ? [r.companyId] : [])))];

export async function actorOf(deps: Pick<FrontOfficeDeps, "people">, session: VerifiedSession): Promise<Person | undefined> {
  return (await deps.people.get([session.userId])).get(session.userId);
}
