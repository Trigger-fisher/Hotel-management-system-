import "server-only";
import { handoverReceipt, type CashReceipt, type HandoverStats, type ShiftHandover, type StaffMember } from "@shared/dashboards/cash";
import type { Catalog } from "../../auth/catalog";
import { canUseRecycleBin } from "../../auth/access";
import { can, requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import { amountInWords } from "../../money/words";
import { paiseToNumber } from "../../money/paise";
import type { HandoverRecord, HandoverRepos } from "../../repos/handovers";
import type { Unit } from "../../repos/types";
import { unwrapVersioned } from "../../repos/unwrap";
import { guardBooks, guardWouldRefuse } from "../cash/books";
import { istInstant, istMoment, monthRange } from "../cash/ist";
import { displayName, type PeopleDirectory, type Person, type PlatformAudit } from "../cash/ports";
import { canBackdate, canManage, forceOn, isAdmin, isSuperAdmin, SUPER_ADMIN_ROLE } from "../cash/rules";
import { finalStamp } from "../cash/stamp";
import { createdEntry, deletedEntry, updatedEntry, type LogContext } from "../cash/syslog";
import { matchesHandover, shiftAt, totalsOf, validateHandover, type HandoverFields } from "./rules";

// Shift Handover: a port of Pallav's ShiftHandoverController and Models/ShiftHandover.php over the repository interfaces. Count the till at the end
// of a shift and hand it to the next person, with notes and instructions. One running number for the hotel; only the NEWEST handover can still be
// corrected (by the SuperAdmin, an Admin or whoever recorded it), any one under the SuperAdmin's force mode (audited); only an Admin or the SuperAdmin
// deletes (to the recycle bin); the accounting-year lock applies (InAccountingYear). Every change writes its system-log line (module `handover`,
// entity `Handover`, money in paise) in the SAME unit. HMS differences: notes are plain text (no HTML), the recycle bin is the SuperAdmin's (as every bin).

export interface HandoverDeps {
  unit: Unit<HandoverRepos>;
  people: PeopleDirectory;
  audit: PlatformAudit;
  catalog: Catalog;
  now: () => Date;
}

export const HANDOVER_SORTS = ["at", "entryNo", "totalPaise"] as const;
type HandoverSort = (typeof HANDOVER_SORTS)[number];

interface HandoverListQuery {
  search?: string;
  from?: string;
  to?: string;
  sort: HandoverSort;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
  deleted: "exclude" | "only";
}

interface HandoverInputBody extends HandoverFields {
  version?: number;
}

/** The DTO: ui-shared ShiftHandover plus the row version (contract request: `version` on ShiftHandover and HandoverInput). */
type HandoverDto = ShiftHandover & { version: number };

interface HandoverListResult {
  items: HandoverDto[];
  total: number;
  page: number;
  pageSize: number;
  stats: HandoverStats;
}

const ENTITY = "Handover";
const MODULE = "handover";
const label = (r: HandoverRecord): string => String(r.entryNo).padStart(4, "0");
const dmy = (date: string): string => `${date.slice(8, 10)}-${date.slice(5, 7)}-${date.slice(0, 4)}`;
const SHIFT_SET = "shift";
const BOOK_OF: Record<string, "hotel" | "food"> = { PF01: "food" };

export function createHandoverService(deps: HandoverDeps) {
  const { unit, people, audit, catalog, now } = deps;

  const peopleFor = (ids: readonly string[]): Promise<Map<string, Person>> => people.get([...new Set(ids)]);
  const logContext = (session: VerifiedSession, meta: RequestMeta, actor: Person | undefined): LogContext => ({ userId: session.userId, userName: actor?.name ?? "System", ip: meta.ip, traceId: meta.traceId });

  function toDto(r: HandoverRecord, newestId: string | null, directory: ReadonlyMap<string, Person>): HandoverDto {
    const person = directory.get(r.userId);
    return {
      id: r.id,
      entryNo: r.entryNo,
      at: istInstant(r.date, r.time).toISOString(),
      shift: r.shift as ShiftHandover["shift"],
      handedBy: { id: r.userId, name: person ? displayName(person) : (r.fullName ?? "") },
      handedTo: r.handoverToName ? { id: r.employeeId ?? "", name: r.handoverToName } : null,
      counts: { ...r.counts },
      totalPaise: paiseToNumber(r.totalPaise),
      notes: [...r.notes],
      instructions: [...r.instructions],
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      isLatest: newestId === r.id,
      version: r.version,
    };
  }

  /** Created / deleted details (store :259-262, destroy :309-310): money in paise. */
  const held = (r: HandoverRecord): Record<string, unknown> => ({ Shift: r.shift, Date: dmy(r.date), Time: r.time.slice(0, 5), "Total cash": Number(r.totalPaise) });
  /** What an edit is compared on (update :285, :295-296). */
  const watched = (r: HandoverRecord): Record<string, unknown> => ({ date: r.date, time: r.time, shift: r.shift, total: Number(r.totalPaise) });

  async function forceAudit(repos: HandoverRepos, session: VerifiedSession, meta: RequestMeta, actor: Person | undefined, what: string): Promise<void> {
    await repos.forceLogs.write({ userId: session.userId, userName: actor?.name ?? "System", action: "lock", module: MODULE, summary: `Forced past a lock: ${what}`, details: { Lock: what }, route: null, method: null, ipAddress: meta.ip });
    await audit.record({ action: "force.override", userId: session.userId, hotelId: session.hotelId, details: { lock: what, traceId: meta.traceId } });
  }

  async function validated(repos: HandoverRepos, input: HandoverFields, session: VerifiedSession, today: string) {
    const force = forceOn(session, catalog);
    const staff = await repos.handoverStaff.active();
    const clean = validateHandover(input, { shifts: force ? [] : await repos.masterLists.activeValues(SHIFT_SET), force, staffIds: new Set(staff.map((s) => s.id)), canBackdate: canBackdate(session, catalog), today });
    const handoverToName = staff.find((s) => s.id === clean.employeeId)?.name ?? "";
    const totalPaise = totalsOf(clean.counts);
    return { clean, handoverToName, totalPaise };
  }

  return {
    /** index: newest first (date, time, id), Pallav's search, 10/25/50/100 a page, and the numbers on top. `deleted: only` is the recycle bin (SuperAdmin). */
    async list(session: VerifiedSession, query: HandoverListQuery): Promise<HandoverListResult> {
      if (query.deleted === "only" && !canUseRecycleBin(session)) throw new AppError("FORBIDDEN");
      const today = istMoment(now()).date;
      const month = monthRange(today);
      const gathered = await unit.run(session, async (repos) => ({
        rows: await repos.handovers.rows({ deleted: query.deleted === "only" ? "only" : "no", from: query.from, to: query.to }),
        newestId: await repos.handovers.newestId(),
        todayTotals: await repos.handovers.totals(today, today),
        monthTotals: await repos.handovers.totals(month.from, month.to),
        latest: await (async () => {
          const id = await repos.handovers.newestId();
          return id ? repos.handovers.get(id) : null;
        })(),
      }));
      const directory = await peopleFor([...gathered.rows.map((r) => r.userId), ...(gathered.latest ? [gathered.latest.userId] : [])]);
      const nameOf = (r: HandoverRecord): string | null => {
        const p = directory.get(r.userId);
        return p ? p.name : null;
      };
      const shown = gathered.rows.filter((r) => matchesHandover(r, nameOf(r), query.search ?? ""));
      const dir = query.dir === "asc" ? 1 : -1;
      const key = (r: HandoverRecord): string | number => (query.sort === "entryNo" ? r.entryNo : query.sort === "totalPaise" ? Number(r.totalPaise) : `${r.date} ${r.time}`);
      shown.sort((a, b) => {
        const x = key(a);
        const y = key(b);
        if (x !== y) return (x < y ? -1 : 1) * dir;
        return (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) * dir;
      });
      const start = (query.page - 1) * query.pageSize;
      const live = query.deleted !== "only";
      return {
        items: shown.slice(start, start + query.pageSize).map((r) => toDto(r, live ? gathered.newestId : null, directory)),
        total: shown.length,
        page: query.page,
        pageSize: query.pageSize,
        stats: {
          todayCount: gathered.todayTotals.count,
          todayCashPaise: paiseToNumber(gathered.todayTotals.totalPaise),
          monthCount: gathered.monthTotals.count,
          monthCashPaise: paiseToNumber(gathered.monthTotals.totalPaise),
          latest: gathered.latest ? toDto(gathered.latest, gathered.newestId, directory) : null,
        },
      };
    },

    async get(session: VerifiedSession, id: string): Promise<HandoverDto> {
      const found = await unit.run(session, async (repos) => ({ record: await repos.handovers.get(id), newestId: await repos.handovers.newestId() }));
      if (!found.record) throw new AppError("NOT_FOUND");
      return toDto(found.record, found.newestId, await peopleFor([found.record.userId]));
    },

    /** What the form needs: who a shift can be handed to (every active employee, one row per person: index :60-63) and the Master Data shifts, with the one the clock is in. */
    async options(session: VerifiedSession): Promise<{ staff: StaffMember[]; shifts: string[]; currentShift: string | null }> {
      const moment = istMoment(now());
      return unit.run(session, async (repos) => {
        const shifts = await repos.masterLists.activeValues(SHIFT_SET);
        const seen = new Set<string>();
        const staff: StaffMember[] = [];
        for (const s of await repos.handoverStaff.active()) {
          // the same person on both payrolls (name, email and mobile all alike) is one person, not two
          const who = [s.name, s.email, s.mobile].map((v) => (v ?? "").trim().toLowerCase()).join("|");
          if (seen.has(who)) continue;
          seen.add(who);
          staff.push({ id: s.id, name: s.name, code: s.code, book: BOOK_OF[s.companyCode] ?? "hotel" });
        }
        return { staff, shifts, currentShift: shiftAt(moment.time, shifts) };
      });
    },

    /** store: stamped with the moment of saving unless a person with system.backdate chose it; the recorder is the signed-in person. "Handover 0001 recorded." */
    async create(session: VerifiedSession, input: HandoverFields, meta: RequestMeta): Promise<HandoverDto> {
      requirePermission(session, catalog, "handover", "create");
      const moment = istMoment(now());
      const force = forceOn(session, catalog);
      const directory = await peopleFor([session.userId]);
      const actor = directory.get(session.userId);
      return unit.run(session, async (repos) => {
        const { clean, handoverToName, totalPaise } = await validated(repos, input, session, moment.date);
        const stamp = finalStamp({ chosen: clean.stamp, canBackdate: canBackdate(session, catalog), editing: false, now: moment }) ?? { date: moment.date, time: moment.time };
        const guard = { years: await repos.accountingYears.list(), was: null, now: stamp.date, action: "save" as const };
        if (!force) guardBooks(guard);
        else if (guardWouldRefuse(guard)) await forceAudit(repos, session, meta, actor, "Accounting year lock");

        const record = await repos.handovers.create({
          date: stamp.date,
          time: stamp.time,
          userId: session.userId,
          fullName: actor ? Array.from(actor.name).slice(0, 20).join("") : null,
          shift: clean.shift,
          counts: clean.counts,
          totalPaise,
          totalInWords: amountInWords(totalPaise),
          notes: clean.notes,
          instructions: clean.instructions,
          employeeId: clean.employeeId,
          handoverToName: Array.from(handoverToName).slice(0, 150).join(""),
          createdBy: session.userId,
        });
        await repos.systemLogs.write(createdEntry(logContext(session, meta, actor), ENTITY, { id: record.id, label: label(record) }, held(record), MODULE));
        return toDto(record, await repos.handovers.newestId(), directory);
      });
    },

    /** update: re-checked on save (it may have stopped being the newest while the form was open); the date and time stay unless chosen by hand. */
    async update(session: VerifiedSession, id: string, input: HandoverInputBody & { version: number }, meta: RequestMeta): Promise<HandoverDto> {
      requirePermission(session, catalog, "handover", "edit");
      const moment = istMoment(now());
      const force = forceOn(session, catalog);
      return unit.run(session, async (repos) => {
        const record = await repos.handovers.get(id);
        if (!record) throw new AppError("NOT_FOUND");
        const directory = await peopleFor([session.userId, record.userId]);
        const actor = directory.get(session.userId);
        const isLatest = (await repos.handovers.newestId()) === record.id;
        const everyday = can(session, catalog, "handover", "edit") && canManage(session, catalog, directory.get(record.userId) ?? null) && isLatest;
        if (!everyday && !force) throw new AppError("FORBIDDEN", isLatest ? "Not allowed to edit this Handover." : "Only the latest Handover can be edited.");
        if (input.version !== record.version) throw new AppError("CONFLICT", undefined, { currentVersion: record.version });

        const { clean, handoverToName, totalPaise } = await validated(repos, input, session, moment.date);
        const stamp = finalStamp({ chosen: clean.stamp, canBackdate: canBackdate(session, catalog), editing: true, now: moment });
        const guard = { years: await repos.accountingYears.list(), was: record.date, now: stamp?.date ?? record.date, action: "save" as const };
        if (!force) guardBooks(guard);
        else if (guardWouldRefuse(guard)) await forceAudit(repos, session, meta, actor, "Accounting year lock");
        if (!everyday) await forceAudit(repos, session, meta, actor, "Edited a closed Handover");

        const updated = unwrapVersioned(
          await repos.handovers.update(
            record.id,
            input.version,
            {
              ...(stamp ? { date: stamp.date, time: stamp.time } : {}),
              shift: clean.shift,
              counts: clean.counts,
              totalPaise,
              totalInWords: amountInWords(totalPaise),
              notes: clean.notes,
              instructions: clean.instructions,
              employeeId: clean.employeeId,
              handoverToName: Array.from(handoverToName).slice(0, 150).join(""),
            },
            session.userId,
          ),
        );
        await repos.systemLogs.write(updatedEntry(logContext(session, meta, actor), ENTITY, { id: record.id, label: label(record) }, watched(record), watched(updated), MODULE));
        return toDto(updated, await repos.handovers.newestId(), directory);
      });
    },

    /** destroy: only the SuperAdmin, or an Admin over a record that is not the SuperAdmin's (deletableBy); force mode steps past it, audited. */
    async remove(session: VerifiedSession, id: string, version: number, meta: RequestMeta): Promise<{ id: string }> {
      requirePermission(session, catalog, "handover", "full");
      const force = forceOn(session, catalog);
      return unit.run(session, async (repos) => {
        const record = await repos.handovers.get(id);
        if (!record) throw new AppError("NOT_FOUND");
        const directory = await peopleFor([session.userId, record.userId]);
        const actor = directory.get(session.userId);
        const owner = directory.get(record.userId);
        const allowed = isSuperAdmin(session) || (isAdmin(session, catalog) && owner?.roleKey !== SUPER_ADMIN_ROLE);
        if (!allowed && !force) throw new AppError("FORBIDDEN", "Only an Admin can delete a Handover.");
        if (version !== record.version) throw new AppError("CONFLICT", undefined, { currentVersion: record.version });
        const guard = { years: await repos.accountingYears.list(), was: record.date, now: null, action: "delete" as const };
        if (!force) guardBooks(guard);
        else if (guardWouldRefuse(guard)) await forceAudit(repos, session, meta, actor, "Accounting year lock");
        if (!allowed) await forceAudit(repos, session, meta, actor, "Not allowed to delete this record");

        unwrapVersioned(await repos.handovers.softDelete(record.id, version, session.userId));
        await repos.systemLogs.write(deletedEntry(logContext(session, meta, actor), ENTITY, { id: record.id, label: label(record) }, held(record), MODULE));
        return { id: record.id };
      });
    },

    /** Recycle bin: the hotel's SuperAdmin only; the line Pallav writes is module `recycle-bin`, "Restored by". */
    async restore(session: VerifiedSession, id: string, version: number, meta: RequestMeta): Promise<HandoverDto> {
      if (!canUseRecycleBin(session)) throw new AppError("FORBIDDEN");
      return unit.run(session, async (repos) => {
        const record = await repos.handovers.get(id, { deleted: true });
        if (!record) throw new AppError("NOT_FOUND");
        const directory = await peopleFor([session.userId, record.userId]);
        const actor = directory.get(session.userId);
        const restored = unwrapVersioned(await repos.handovers.restore(record.id, version, session.userId));
        await repos.systemLogs.write(createdEntry(logContext(session, meta, actor), ENTITY, { id: record.id, label: label(record) }, { "Restored by": actor?.name ?? "System" }, "recycle-bin"));
        return toDto(restored, await repos.handovers.newestId(), directory);
      });
    },

    /** Removed for good from the bin (no log line, as RecycleBinController::destroy). Live rows are never purged. */
    async purge(session: VerifiedSession, id: string): Promise<{ id: string }> {
      if (!canUseRecycleBin(session)) throw new AppError("FORBIDDEN");
      return unit.run(session, async (repos) => {
        if (!(await repos.handovers.purge(id))) throw new AppError("NOT_FOUND");
        return { id };
      });
    },

    /** The printed handover (view(): the PDF): the SAME data as the screen's receipt preview. */
    async receipt(session: VerifiedSession, id: string): Promise<CashReceipt> {
      const found = await unit.run(session, async (repos) => ({ record: await repos.handovers.get(id), newestId: await repos.handovers.newestId(), hotel: await repos.hotelName() }));
      if (!found.record) throw new AppError("NOT_FOUND");
      return handoverReceipt(toDto(found.record, found.newestId, await peopleFor([found.record.userId])), found.hotel);
    },
  };
}

export type HandoverService = ReturnType<typeof createHandoverService>;
