import "server-only";
import { cashBookShort, type CashStats, type StampInput } from "@shared/dashboards/cash";
import type { Catalog } from "../../auth/catalog";
import { requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import { amountInWords } from "../../money/words";
import { toPaise } from "../../money/paise";
import type { CashRepos } from "../../repos/cashDeposit";
import type { CatalogCategory } from "../../repos/expenses";
import type { CashBook, EntryBase, EntryRepo } from "../../repos/entries";
import { CASH_BOOKS } from "../../repos/entries";
import type { Unit, VersionedResult } from "../../repos/types";
import { unwrapVersioned } from "../../repos/unwrap";
import { guardBooks, guardWouldRefuse } from "./books";
import { istMoment, monthRange } from "./ist";
import type { PeopleDirectory, PlatformAudit, Person } from "./ports";
import { canUseRecycleBin } from "../../auth/access";
import { canBackdate, deleteRefusal, editDecision, forceOn, isSuperAdmin } from "./rules";
import { matchesSearch, parseSearch, type SearchRow } from "./search";
import { finalStamp, type Stamp } from "./stamp";
import { createdEntry, deletedEntry, updatedEntry, type LogContext } from "./syslog";

// THE engine behind every Daily Cash entry kind (deposits, withdrawals, miscellaneous expenses, and later advances and handovers). The rules that
// are the same for all of them live here ONCE: who may edit or delete, the date and time stamp, the accounting-year lock, force mode, entry
// numbers, the version check, the recycle bin, the list with Pallav's search and its numbers, the system-log line in the SAME unit as the
// change. A kind (kinds/*.ts) supplies only what differs: its fields, its validation and arithmetic, its words, its DTO.
// docs/specs/cash-revenue.md, cash-withdrawals.md and cash-expenses.md give every rule with its Pallav file and line.

export interface EntryDeps {
  unit: Unit<CashRepos>;
  people: PeopleDirectory;
  audit: PlatformAudit;
  catalog: Catalog;
  now: () => Date;
}

/** What the engine knows about any input: the book and an optional hand-picked date and time. */
interface EntryInput {
  book: CashBook;
  stamp: StampInput | null;
}

interface PrepareArgs<R, I> {
  repos: CashRepos;
  input: I;
  book: CashBook;
  existing: R | null;
  canBackdate: boolean;
  /** Today in IST, YYYY-MM-DD. */
  today: string;
  /** Force mode is on: Pallav's field validation steps aside (ForceMode::relax) except the checks the database needs. */
  force: boolean;
}

export interface Prepared {
  /** The validated hand-picked date and time, or null when the system stamps it. */
  stamp: Stamp | null;
  /** The kind's own record fields (for create) and the same fields as a patch (for update). */
  fields: Record<string, unknown>;
  amountPaise: number;
}

export interface DtoContext {
  newestId: string | null;
  people: ReadonlyMap<string, Person>;
  /** The expense catalogue by book, loaded only when a kind needs it (a line whose item has left the catalogue is shown as "keep"). */
  catalog?: Record<CashBook, CatalogCategory[]>;
}

export interface EntryKind<R extends EntryBase, I extends EntryInput> {
  name: string;
  /** The permission module that reads go through ("revenue", "expense"). */
  moduleKey: string;
  /** The system-log module. */
  logModule: string;
  /** How refusals call an entry: "deposit" or "entry". */
  noun: string;
  /** The DTO needs the catalogue (miscellaneous expenses). */
  needsCatalog?: boolean;
  /** The part that writes need, for a book. */
  partKey(book: CashBook): string;
  /** "Hotel deposit": the system-log entity. */
  entity(book: CashBook): string;
  /** An extra search word of the kind ("Cash Withdrawal"); deposits add "deposit". */
  searchWords: readonly string[];
  /** Expenses hand the entry to whoever last corrected it (ExpenseController.php:504-507); deposits do not. */
  reassignOnEdit: boolean;
  forceEditLock: string;
  // the repository is typed per kind; the engine only needs the common surface
  repo(repos: CashRepos): EntryRepo<R, never, never, never>;
  /** The kind's own repository calls take its own input types: these two hand them over without the engine knowing them. */
  create(repos: CashRepos, book: CashBook, base: NewBase, fields: Record<string, unknown>): Promise<R>;
  update(repos: CashRepos, book: CashBook, id: string, version: number, patch: Record<string, unknown>, actorId: string): Promise<VersionedResult<R>>;
  prepare(args: PrepareArgs<R, I>): Promise<Prepared>;
  /** More words a row shows that are not columns (a miscellaneous expense's line categories and items). */
  searchExtra?(r: R): string[];
  searchRow(r: R): Pick<SearchRow, "depositor" | "withdrawer" | "expenseName" | "expenseHead" | "reason" | "instruction">;
  held(r: R): Record<string, unknown>;
  watched(r: R): Record<string, unknown>;
  toDto(r: R, ctx: DtoContext): unknown;
  /** The value each list sort token orders by. */
  sortKey(r: R, token: string): string | number | bigint;
}

interface NewBase {
  date: string;
  time: string;
  userId: string;
  fullName: string | null;
  amountPaise: bigint;
  amountInWords: string;
  createdBy: string;
}

interface EntryListQuery {
  book: "all" | CashBook;
  /** Narrow to one kind (expenses: withdrawal or misc); revenue has one kind. */
  kind?: string;
  search?: string;
  from?: string;
  to?: string;
  sort: string;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
  /** "only" = the recycle bin (the hotel's SuperAdmin role). */
  deleted: "exclude" | "only";
}

interface EntryListResult {
  items: unknown[];
  total: number;
  page: number;
  pageSize: number;
  stats: CashStats;
  counts: { all: number; hotel: number; food: number };
  shownTotalPaise: number;
}

const ymdAt = (d: string): string => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
export { ymdAt as dayMonthYear };

type AnyKind = EntryKind<EntryBase, EntryInput>;

export function createEntryEngine(deps: EntryDeps, kinds: readonly AnyKind[]) {
  const { unit, people, audit, catalog, now } = deps;
  const kindByName = new Map(kinds.map((k) => [k.name, k]));

  const peopleFor = (ids: readonly string[]): Promise<Map<string, Person>> => people.get([...new Set(ids)]);
  const logContext = (session: VerifiedSession, meta: RequestMeta, actor: Person | undefined): LogContext => ({ userId: session.userId, userName: actor?.name ?? "System", ip: meta.ip, traceId: meta.traceId });

  /** Finds a live (or recycle-bin) entry by id in any of the engine's kinds and either book. Another hotel's id is simply not found. */
  async function findAny(repos: CashRepos, id: string, deleted: boolean): Promise<{ kind: AnyKind; record: EntryBase } | null> {
    for (const kind of kinds) {
      for (const book of CASH_BOOKS) {
        const record = await (kind.repo(repos) as unknown as EntryRepo<EntryBase, never, never, never>).get(book, id, { deleted });
        if (record) return { kind, record };
      }
    }
    return null;
  }

  async function forceAudit(repos: CashRepos, kind: AnyKind, session: VerifiedSession, meta: RequestMeta, actor: Person | undefined, what: string): Promise<void> {
    await repos.forceLogs.write({ userId: session.userId, userName: actor?.name ?? "System", action: "lock", module: kind.logModule, summary: `Forced past a lock: ${what}`, details: { Lock: what }, route: null, method: null, ipAddress: meta.ip });
    await audit.record({ action: "force.override", userId: session.userId, hotelId: session.hotelId, details: { lock: what, traceId: meta.traceId } });
  }

  const requirePart = (session: VerifiedSession, kind: AnyKind, book: CashBook, level: "create" | "edit" | "full"): void => requirePermission(session, catalog, kind.partKey(book), level);

  const dtoOf = (kind: AnyKind, r: EntryBase, ctx: DtoContext): unknown => kind.toDto(r, ctx);
  const needsCatalog = kinds.some((k) => k.needsCatalog);
  const loadCatalog = async (repos: CashRepos): Promise<Record<CashBook, CatalogCategory[]> | undefined> => (needsCatalog ? { hotel: await repos.expenseCatalog.forBook("hotel"), food: await repos.expenseCatalog.forBook("food") } : undefined);

  return {
    kindByName,

    /** The list screen: the engine's kinds, both books, Pallav's search, paging and the numbers on top (CashLedger::search/page, RevenueController::index). */
    async list(session: VerifiedSession, query: EntryListQuery): Promise<EntryListResult> {
      if (query.deleted === "only" && !canUseRecycleBin(session)) throw new AppError("FORBIDDEN");
      const today = istMoment(now()).date;
      const month = monthRange(today);
      const live = query.deleted === "exclude";
      const shownBooks = query.book === "all" ? CASH_BOOKS : [query.book];
      const activeKinds = kinds.filter((k) => !query.kind || query.kind === "all" || k.name === query.kind);

      // the details (an expense's lines) are read for every row only when the search needs them; otherwise only for the rows the page shows (below)
      const searching = parseSearch(query.search ?? "") !== null;
      const gathered = await unit.run(session, async (repos) => {
        const rows: { kind: AnyKind; record: EntryBase }[] = [];
        const newest = new Map<string, string | null>();
        for (const kind of activeKinds) {
          const repo = kind.repo(repos) as unknown as EntryRepo<EntryBase, never, never, never>;
          for (const book of CASH_BOOKS) {
            for (const record of await repo.rows(book, { deleted: live ? "no" : "only", from: query.from, to: query.to }, { withDetails: searching })) rows.push({ kind, record });
            newest.set(`${kind.name}:${book}`, await repo.newestId(book));
          }
        }
        // the numbers on top count EVERY kind of the engine, not just the filtered one (RevenueController:65-76, ExpenseController:98-133):
        // today and this month per kind and book, in one read each
        const perBook: Record<CashBook, { today: number; month: number }> = { hotel: { today: 0, month: 0 }, food: { today: 0, month: 0 } };
        for (const kind of kinds) {
          for (const book of CASH_BOOKS) {
            const [t, m] = await (kind.repo(repos) as unknown as EntryRepo<EntryBase, never, never, never>).sums(book, [{ from: today, to: today }, month]);
            perBook[book].today += Number(t);
            perBook[book].month += Number(m);
          }
        }
        const stats: CashStats = {
          todayPaise: shownBooks.reduce((s, b) => s + perBook[b].today, 0),
          monthPaise: shownBooks.reduce((s, b) => s + perBook[b].month, 0),
          hotelMonthPaise: perBook.hotel.month,
          foodMonthPaise: perBook.food.month,
        };
        return { rows, newest, stats, catalog: await loadCatalog(repos) };
      });

      const directory = await peopleFor(gathered.rows.map((r) => r.record.userId));
      const search = parseSearch(query.search ?? "");
      const matched = gathered.rows.filter(({ kind, record }) => {
        const person = directory.get(record.userId);
        const row: SearchRow = {
          entryNo: record.entryNo,
          date: record.date,
          time: record.time,
          ...kind.searchRow(record),
          fullName: record.fullName,
          recordedByName: person ? (person.deleted ? `${person.name} (deleted)` : person.name) : null,
          amountInWords: record.amountInWords,
          amountPaise: record.amountPaise,
          extra: [cashBookShort[record.book], ...kind.searchWords, ...(kind.searchExtra?.(record) ?? [])],
        };
        return matchesSearch(row, search);
      });
      const shown = matched.filter(({ record }) => query.book === "all" || record.book === query.book);

      const dir = query.dir === "asc" ? 1 : -1;
      shown.sort((a, b) => {
        const x = a.kind.sortKey(a.record, query.sort);
        const y = b.kind.sortKey(b.record, query.sort);
        if (x !== y) return (x < y ? -1 : 1) * dir;
        // Pallav breaks a tie by the id, newest first; here by when it was written, then its number
        return (a.record.createdAt.getTime() - b.record.createdAt.getTime() || a.record.entryNo - b.record.entryNo) * dir;
      });
      const start = (query.page - 1) * query.pageSize;
      const page = shown.slice(start, start + query.pageSize);
      if (!searching && page.length > 0) {
        await unit.run(session, async (repos) => {
          for (const kind of activeKinds) {
            for (const book of CASH_BOOKS) {
              const records = page.filter((r) => r.kind === kind && r.record.book === book).map((r) => r.record);
              if (records.length > 0) await (kind.repo(repos) as unknown as EntryRepo<EntryBase, never, never, never>).hydrate(book, records);
            }
          }
        });
      }
      const items = page.map(({ kind, record }) => dtoOf(kind, record, { newestId: live ? (gathered.newest.get(`${kind.name}:${record.book}`) ?? null) : null, people: directory, catalog: gathered.catalog }));
      return {
        items,
        total: shown.length,
        page: query.page,
        pageSize: query.pageSize,
        stats: gathered.stats,
        counts: { all: matched.length, hotel: matched.filter((r) => r.record.book === "hotel").length, food: matched.filter((r) => r.record.book === "food").length },
        shownTotalPaise: shown.reduce((sum, r) => sum + Number(r.record.amountPaise), 0),
      };
    },

    async get(session: VerifiedSession, id: string): Promise<unknown> {
      const found = await unit.run(session, async (repos) => {
        const hit = await findAny(repos, id, false);
        return hit ? { ...hit, newestId: await (hit.kind.repo(repos) as unknown as EntryRepo<EntryBase, never, never, never>).newestId(hit.record.book), catalog: await loadCatalog(repos) } : null;
      });
      if (!found) throw new AppError("NOT_FOUND");
      const directory = await peopleFor([found.record.userId]);
      return dtoOf(found.kind, found.record, { newestId: found.newestId, people: directory, catalog: found.catalog });
    },

    async create(session: VerifiedSession, kindName: string, input: EntryInput, meta: RequestMeta): Promise<unknown> {
      const kind = kindByName.get(kindName);
      if (!kind) throw new AppError("VALIDATION_FAILED", undefined, { fields: { kind: "Not valid" } });
      requirePart(session, kind, input.book, "create");
      const directory = await peopleFor([session.userId]);
      const actor = directory.get(session.userId);
      const moment = istMoment(now());
      const backdate = canBackdate(session, catalog);
      const force = forceOn(session, catalog);
      return unit.run(session, async (repos) => {
        const prepared = await kind.prepare({ repos, input, book: input.book, existing: null, canBackdate: backdate, today: moment.date, force });
        const stamp = finalStamp({ chosen: prepared.stamp, canBackdate: backdate, editing: false, now: moment }) as Stamp;
        const years = await repos.accountingYears.list();
        if (!force) guardBooks({ years, was: null, now: stamp.date, action: "save" });
        else if (guardWouldRefuse({ years, was: null, now: stamp.date, action: "save" })) await forceAudit(repos, kind, session, meta, actor, "Accounting year lock");

        const record = await kind.create(
          repos,
          input.book,
          { date: stamp.date, time: stamp.time, userId: session.userId, fullName: actor ? Array.from(actor.name).slice(0, 20).join("") : null, amountPaise: toPaise(prepared.amountPaise), amountInWords: amountInWords(prepared.amountPaise), createdBy: session.userId },
          prepared.fields,
        );
        await repos.systemLogs.write(createdEntry(logContext(session, meta, actor), kind.entity(input.book), { id: record.id, label: String(record.entryNo).padStart(4, "0") }, kind.held(record), kind.logModule));
        return dtoOf(kind, record, { newestId: await (kind.repo(repos) as unknown as EntryRepo<EntryBase, never, never, never>).newestId(input.book), people: directory, catalog: await loadCatalog(repos) });
      });
    },

    async update(session: VerifiedSession, id: string, input: EntryInput & { version: number }, meta: RequestMeta): Promise<unknown> {
      const moment = istMoment(now());
      const backdate = canBackdate(session, catalog);
      const force = forceOn(session, catalog);
      return unit.run(session, async (repos) => {
        const hit = await findAny(repos, id, false);
        if (!hit) throw new AppError("NOT_FOUND");
        const { kind, record } = hit;
        requirePart(session, kind, record.book, "edit");
        const directory = await peopleFor([session.userId, record.userId]);
        const actor = directory.get(session.userId);
        const repo = kind.repo(repos) as unknown as EntryRepo<EntryBase, never, never, never>;

        const decision = editDecision(session, catalog, { recordId: record.id, newestId: await repo.newestId(record.book), owner: directory.get(record.userId) ?? null }, kind.noun);
        if (!decision.allowed) throw new AppError("FORBIDDEN", decision.refusal ?? undefined);
        if (input.book !== record.book) throw new AppError("VALIDATION_FAILED", undefined, { fields: { book: `The cash book of a saved ${kind.noun} cannot change.` } });
        if (input.version !== record.version) throw new AppError("CONFLICT", undefined, { currentVersion: record.version });

        const prepared = await kind.prepare({ repos, input, book: record.book, existing: record, canBackdate: backdate, today: moment.date, force });
        const stamp = finalStamp({ chosen: prepared.stamp, canBackdate: backdate, editing: true, now: moment });
        const years = await repos.accountingYears.list();
        const guard = { years, was: record.date, now: stamp?.date ?? record.date, action: "save" as const };
        if (!force) guardBooks(guard);
        else if (guardWouldRefuse(guard)) await forceAudit(repos, kind, session, meta, actor, "Accounting year lock");
        if (decision.viaForce) await forceAudit(repos, kind, session, meta, actor, kind.forceEditLock);

        const patch: Record<string, unknown> = { ...prepared.fields, amountPaise: toPaise(prepared.amountPaise), amountInWords: amountInWords(prepared.amountPaise), ...(stamp ? { date: stamp.date, time: stamp.time } : {}) };
        // an expense goes to whoever last corrected it, unless that is the SuperAdmin (ExpenseController.php:504-507)
        if (kind.reassignOnEdit && !isSuperAdmin(session)) Object.assign(patch, { userId: session.userId, fullName: actor ? Array.from(actor.name).slice(0, 20).join("") : null });
        const updated = unwrapVersioned(await kind.update(repos, record.book, record.id, input.version, patch, session.userId));
        await repos.systemLogs.write(updatedEntry(logContext(session, meta, actor), kind.entity(record.book), { id: record.id, label: String(record.entryNo).padStart(4, "0") }, kind.watched(record), kind.watched(updated), kind.logModule));
        const names = await peopleFor([updated.userId]);
        return dtoOf(kind, updated, { newestId: await repo.newestId(record.book), people: new Map([...directory, ...names]), catalog: await loadCatalog(repos) });
      });
    },

    async remove(session: VerifiedSession, id: string, version: number, meta: RequestMeta): Promise<{ id: string }> {
      const force = forceOn(session, catalog);
      return unit.run(session, async (repos) => {
        const hit = await findAny(repos, id, false);
        if (!hit) throw new AppError("NOT_FOUND");
        const { kind, record } = hit;
        requirePart(session, kind, record.book, "full");
        const directory = await peopleFor([session.userId, record.userId]);
        const actor = directory.get(session.userId);
        const refusal = deleteRefusal(session, catalog, directory.get(record.userId) ?? null);
        if (refusal) throw new AppError("FORBIDDEN", refusal);
        if (version !== record.version) throw new AppError("CONFLICT", undefined, { currentVersion: record.version });

        const guard = { years: await repos.accountingYears.list(), was: record.date, now: null, action: "delete" as const };
        if (!force) guardBooks(guard);
        else if (guardWouldRefuse(guard)) await forceAudit(repos, kind, session, meta, actor, "Accounting year lock");

        unwrapVersioned(await (kind.repo(repos) as unknown as EntryRepo<EntryBase, never, never, never>).softDelete(record.book, record.id, version, session.userId));
        await repos.systemLogs.write(deletedEntry(logContext(session, meta, actor), kind.entity(record.book), { id: record.id, label: String(record.entryNo).padStart(4, "0") }, kind.held(record), kind.logModule));
        return { id: record.id };
      });
    },

    /** Recycle bin: the hotel's SuperAdmin role only (Pallav RecycleBinController, route group `superadmin`). */
    async restore(session: VerifiedSession, id: string, version: number, meta: RequestMeta): Promise<unknown> {
      if (!canUseRecycleBin(session)) throw new AppError("FORBIDDEN");
      return unit.run(session, async (repos) => {
        const hit = await findAny(repos, id, true);
        if (!hit) throw new AppError("NOT_FOUND");
        const { kind, record } = hit;
        const directory = await peopleFor([session.userId, record.userId]);
        const actor = directory.get(session.userId);
        const repo = kind.repo(repos) as unknown as EntryRepo<EntryBase, never, never, never>;
        const restored = unwrapVersioned(await repo.restore(record.book, record.id, version, session.userId));
        // Pallav: SystemLogger::created('recycle-bin', label, record, title, ['Restored by' => name])
        await repos.systemLogs.write(createdEntry(logContext(session, meta, actor), kind.entity(record.book), { id: record.id, label: String(record.entryNo).padStart(4, "0") }, { "Restored by": actor?.name ?? "System" }, "recycle-bin"));
        return dtoOf(kind, restored, { newestId: await repo.newestId(record.book), people: directory, catalog: await loadCatalog(repos) });
      });
    },

    /** Removes a recycle-bin row for good; writes no log line (RecycleBinController::destroy). Live rows are never purged. */
    async purge(session: VerifiedSession, id: string): Promise<{ id: string }> {
      if (!canUseRecycleBin(session)) throw new AppError("FORBIDDEN");
      return unit.run(session, async (repos) => {
        const hit = await findAny(repos, id, true);
        if (!hit || !(await (hit.kind.repo(repos) as unknown as EntryRepo<EntryBase, never, never, never>).purge(hit.record.book, hit.record.id))) throw new AppError("NOT_FOUND");
        return { id: hit.record.id };
      });
    },
  };
}

export type EntryEngine = ReturnType<typeof createEntryEngine>;
