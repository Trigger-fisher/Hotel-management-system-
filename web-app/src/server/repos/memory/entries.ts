import "server-only";
import { randomUUID } from "node:crypto";
import type { CashBook, EntryBase, EntryFilter, EntryRepo, EntryTotals, NewEntryBase } from "../entries";
import { RepoError, type VersionedResult } from "../types";

/** What a kind tells the generic in-memory repository: where its rows live, how a new row is built, and its own CHECKs. */
interface MemoryEntryConfig<R extends EntryBase, N extends NewEntryBase, P> {
  rows(book: CashBook): R[];
  /** The kind's own fields from the new input (the base fields are filled by the repository). */
  fieldsOf(input: N): Omit<R, keyof EntryBase>;
  /** The table's CHECK constraints for a new row or a patch (throws RepoError). */
  check(input: N | P): void;
  /** Apply a patch to a row (default: Object.assign). */
  apply?(row: R, patch: P): void;
  /** The words the plain list search looks in (the person's name is added). */
  searchable(row: R): (string | null)[];
}

/** One implementation of EntryRepo over arrays, honouring the table rules: entry numbers, soft delete, version check, CHECKs, copies out. */
export function memoryEntryRepo<R extends EntryBase, N extends NewEntryBase, P, S extends string = string>(config: MemoryEntryConfig<R, N, P>): EntryRepo<R, N, P, S> {
  const { rows } = config;
  const find = (book: CashBook, id: string): R | undefined => rows(book).find((r) => r.id === id);
  // Pallav: one past the highest number on the table, soft-deleted rows included
  const nextNo = (book: CashBook): number => rows(book).reduce((max, r) => Math.max(max, r.entryNo), 0) + 1;
  const copy = (r: R): R => structuredClone(r);

  const matches = (row: R, search: string): boolean => {
    const needle = search.toLowerCase();
    return [...config.searchable(row), row.fullName].some((v) => (v ?? "").toLowerCase().includes(needle));
  };
  type Window = { search?: string; from?: string; to?: string; deleted?: "no" | "only" };
  const inFilter = (row: R, f: Window): boolean => {
    if ((f.deleted === "only") !== (row.deletedAt !== null)) return false;
    if (f.from && row.date < f.from) return false;
    if (f.to && row.date > f.to) return false;
    return f.search ? matches(row, f.search) : true;
  };

  const versioned = (book: CashBook, id: string, expected: number, change: (row: R) => void, deleted: boolean): VersionedResult<R> => {
    const row = find(book, id);
    if (!row || (row.deletedAt !== null) !== deleted) return { ok: false, reason: "not_found" };
    if (row.version !== expected) return { ok: false, reason: "conflict", currentVersion: row.version };
    change(row);
    row.version += 1;
    row.updatedAt = new Date();
    return { ok: true, record: copy(row) };
  };

  const key = (row: R, sort: string): string | number | bigint => {
    const value = (row as unknown as Record<string, unknown>)[sort];
    return typeof value === "string" || typeof value === "number" || typeof value === "bigint" ? value : "";
  };

  return {
    async rows(book, filter) {
      return rows(book).filter((r) => inFilter(r, filter)).map(copy);
    },
    // the memory rows carry everything already
    async hydrate() {},
    async sums(book, windows) {
      const live = rows(book).filter((r) => r.deletedAt === null);
      return windows.map((w) => live.filter((r) => r.date >= w.from && r.date <= w.to).reduce((sum, r) => sum + r.amountPaise, BigInt(0)));
    },
    // Pallav breaks a tie by the id, which is creation order; the entry number is creation order too (uuidv7 ids give the same in PostgreSQL)
    async newestId(book) {
      const live = rows(book).filter((r) => r.deletedAt === null);
      const newest = live.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.time !== b.time ? (a.time < b.time ? 1 : -1) : b.entryNo - a.entryNo))[0];
      return newest ? newest.id : null;
    },
    async list(book, filter: EntryFilter<S>) {
      const all = rows(book).filter((r) => inFilter(r, filter)).sort((a, b) => {
        const x = key(a, filter.sort);
        const y = key(b, filter.sort);
        return x < y ? -1 : x > y ? 1 : a.entryNo - b.entryNo;
      });
      if (filter.dir === "desc") all.reverse();
      const start = (filter.page - 1) * filter.pageSize;
      return { rows: all.slice(start, start + filter.pageSize).map(copy), total: all.length };
    },
    async get(book, id, options) {
      const row = find(book, id);
      if (!row || (row.deletedAt !== null) !== (options?.deleted === true)) return null;
      return copy(row);
    },
    async create(book, input) {
      config.check(input);
      const now = new Date();
      const row = {
        id: randomUUID(),
        book,
        entryNo: nextNo(book),
        date: input.date,
        time: input.time,
        userId: input.userId,
        fullName: input.fullName,
        amountPaise: input.amountPaise,
        amountInWords: input.amountInWords,
        createdBy: input.createdBy,
        updatedBy: null,
        deletedAt: null,
        deletedBy: null,
        createdAt: now,
        updatedAt: now,
        version: 1,
        ...config.fieldsOf(input),
      } as R;
      if (rows(book).some((r) => r.entryNo === row.entryNo)) throw new RepoError("unique", "entry_no");
      rows(book).push(row);
      return copy(row);
    },
    async update(book, id, expectedVersion, patch, actorId) {
      config.check(patch);
      return versioned(book, id, expectedVersion, (row) => {
        if (config.apply) config.apply(row, patch);
        else Object.assign(row, patch);
        row.updatedBy = actorId;
      }, false);
    },
    async softDelete(book, id, expectedVersion, actorId) {
      return versioned(book, id, expectedVersion, (row) => Object.assign(row, { deletedAt: new Date(), deletedBy: actorId }), false);
    },
    async restore(book, id, expectedVersion, actorId) {
      return versioned(book, id, expectedVersion, (row) => Object.assign(row, { deletedAt: null, deletedBy: null, updatedBy: actorId }), true);
    },
    async purge(book, id) {
      const index = rows(book).findIndex((r) => r.id === id && r.deletedAt !== null);
      if (index < 0) return false;
      rows(book).splice(index, 1);
      return true;
    },
    async nextEntryNo(book) {
      return nextNo(book);
    },
    async totals(book, filter): Promise<EntryTotals> {
      const live = rows(book).filter((r) => inFilter(r, filter));
      return { count: live.length, totalPaise: live.reduce((sum, r) => sum + r.amountPaise, BigInt(0)) };
    },
  };
}
