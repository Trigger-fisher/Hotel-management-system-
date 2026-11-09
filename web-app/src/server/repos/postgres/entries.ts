import "server-only";
// The PostgreSQL version of the generic Daily Cash entry repository (repos/entries.ts). One implementation serves every entry table (deposits,
// withdrawals, miscellaneous expenses; later advances and handovers): a kind says its table per book, its own columns and what its plain search
// looks in. Runs inside withHotel (a TxClient), so every statement is the hotel's own and unqualified table names mean this hotel's tables.
//
// Rules kept exactly (the in-memory double, repos/memory/entries.ts, is the reference):
//   * entry number = one past the highest on the table, soft-deleted rows included, under an advisory lock (data/entryNo.ts); UNIQUE(entry_no) is the backstop;
//   * soft delete sets deleted_at/deleted_by, every change raises version by one (the trigger refuses anything else), a stale version matches nothing;
//   * the plain search is a case-insensitive SUBSTRING (position(), never LIKE): % and _ are ordinary characters and nothing needs escaping;
//   * ORDER BY the chosen column, ties by entry number, the same direction (the double reverses the whole list for "desc").
import { toBigInt } from "../../../db/convert";
import type { TxClient } from "../../../db/types";
import { nextEntryNo, type EntryNumberTable } from "../../data/entryNo";
import { classifyPgError } from "../../db/pgErrors";
import type { CashBook, EntryBase, EntryFilter, EntryRepo, EntryTotals, NewEntryBase } from "../entries";
import { RepoError, type ListResult, type VersionedResult } from "../types";

/** What one kind tells the generic repository. */
export interface PgEntryKind<R extends EntryBase, N extends NewEntryBase, P> {
  table(book: CashBook): EntryNumberTable;
  /** The kind's own columns: [record field, column]. The base columns are the same for every kind. */
  own: readonly (readonly [string, string])[];
  /** Columns the plain search looks in (the person's name is added). */
  searchable: readonly string[];
  /** A sort name from the screen -> its column. */
  sorts: Readonly<Record<string, string>>;
  /** Reads the kind's own values from a row. */
  read(row: Record<string, unknown>): Omit<R, keyof EntryBase>;
  /** Extra work after the rows are read (miscellaneous expenses load their lines). */
  hydrate?(tx: TxClient, book: CashBook, records: R[]): Promise<void>;
  /** Extra SQL condition for the search, with its own parameters starting at $first (miscellaneous expenses also look in their lines). */
  searchExtra?(book: CashBook, needleParam: string): string;
  /** After an insert or an update: write the kind's children (lines). `patch` has the new values when the patch carries them. */
  afterWrite?(tx: TxClient, book: CashBook, id: string, values: N | P): Promise<void>;
  /** Before a purge: remove the kind's children. */
  beforePurge?(tx: TxClient, book: CashBook, id: string): Promise<void>;
}

const BASE_FIELDS: readonly (readonly [string, string])[] = [
  ["date", "date"],
  ["time", "time"],
  ["userId", "user_id"],
  ["fullName", "full_name"],
  ["amountPaise", "amount_paise"],
  ["amountInWords", "amount_in_words"],
];

const iso = (v: unknown): Date | null => (v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v)));

export function baseOf(book: CashBook, r: Record<string, unknown>): EntryBase {
  return {
    id: String(r.id),
    book,
    entryNo: Number(r.entry_no),
    date: String(r.date),
    time: String(r.time),
    userId: String(r.user_id),
    fullName: (r.full_name as string | null) ?? null,
    amountPaise: toBigInt(r.amount_paise),
    amountInWords: (r.amount_in_words as string | null) ?? null,
    createdBy: (r.created_by as string | null) ?? null,
    updatedBy: (r.updated_by as string | null) ?? null,
    deletedAt: iso(r.deleted_at),
    deletedBy: (r.deleted_by as string | null) ?? null,
    createdAt: iso(r.created_at) as Date,
    updatedAt: iso(r.updated_at) as Date,
    version: Number(r.version),
  };
}

/** Rule violations the table enforces become the RepoError the in-memory double throws. */
async function guard<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    const info = classifyPgError(error);
    if (info.kind === "unique" || info.kind === "check") throw new RepoError(info.kind, info.constraint ?? "database rule");
    throw error;
  }
}

type Window = { search?: string; from?: string; to?: string; deleted?: "no" | "only" };

export function pgEntryRepo<R extends EntryBase, N extends NewEntryBase, P extends object, S extends string = string>(tx: TxClient, kind: PgEntryKind<R, N, P>): EntryRepo<R, N, P, S> {
  const q = (text: string, params?: readonly unknown[]) => tx.query(text, params);
  const fields = [...BASE_FIELDS, ...kind.own];
  const columnOf = new Map(fields.map(([field, column]) => [field, column]));

  const record = (book: CashBook, row: Record<string, unknown>): R => ({ ...baseOf(book, row), ...kind.read(row) }) as R;
  const load = async (book: CashBook, rows: Record<string, unknown>[], withDetails = true): Promise<R[]> => {
    const records = rows.map((r) => record(book, r));
    if (withDetails && kind.hydrate) await kind.hydrate(tx, book, records);
    return records;
  };

  /** WHERE for a window: live or bin, the dates, the search. `params` is filled in order. */
  function where(book: CashBook, f: Window, params: unknown[], alias = "e"): string {
    const parts = [f.deleted === "only" ? `${alias}.deleted_at IS NOT NULL` : `${alias}.deleted_at IS NULL`];
    if (f.from) {
      params.push(f.from);
      parts.push(`${alias}.date >= $${params.length}`);
    }
    if (f.to) {
      params.push(f.to);
      parts.push(`${alias}.date <= $${params.length}`);
    }
    if (f.search) {
      params.push(f.search.toLowerCase());
      const n = `$${params.length}`;
      const likes = [...kind.searchable, "full_name"].map((c) => `position(${n}::text in lower(coalesce(${alias}.${c}, ''))) > 0`);
      if (kind.searchExtra) likes.push(kind.searchExtra(book, n));
      parts.push(`(${likes.join(" OR ")})`);
    }
    return parts.join(" AND ");
  }

  async function versioned(book: CashBook, id: string, expected: number, set: string, setParams: unknown[], deleted: boolean): Promise<VersionedResult<R>> {
    const params = [id, expected, ...setParams];
    const updated = await guard(
      q(`UPDATE ${kind.table(book)} SET ${set}, version = version + 1 WHERE id = $1 AND version = $2 AND deleted_at IS ${deleted ? "NOT NULL" : "NULL"} RETURNING *`, params),
    );
    if (updated.rows[0]) {
      const [rec] = await load(book, updated.rows);
      return { ok: true, record: rec };
    }
    const current = await q(`SELECT version, deleted_at FROM ${kind.table(book)} WHERE id = $1`, [id]);
    const row = current.rows[0];
    if (!row || (row.deleted_at !== null) !== deleted) return { ok: false, reason: "not_found" };
    return { ok: false, reason: "conflict", currentVersion: Number(row.version) };
  }

  function setOf(patch: object, firstParam: number): { set: string; params: unknown[] } {
    const set: string[] = [];
    const params: unknown[] = [];
    for (const [field, value] of Object.entries(patch)) {
      const column = columnOf.get(field);
      if (value === undefined || !column) continue;
      params.push(typeof value === "bigint" ? value.toString() : value);
      set.push(`${column} = $${firstParam + params.length - 1}`);
    }
    return { set: set.join(", "), params };
  }

  const repo: EntryRepo<R, N, P, S> = {
    async rows(book, filter, options) {
      const params: unknown[] = [];
      const r = await q(`SELECT e.* FROM ${kind.table(book)} e WHERE ${where(book, filter, params)} ORDER BY e.entry_no`, params);
      return load(book, r.rows, options?.withDetails !== false);
    },
    async hydrate(book, records) {
      if (kind.hydrate && records.length > 0) await kind.hydrate(tx, book, records);
    },
    async sums(book, windows) {
      if (windows.length === 0) return [];
      const params = windows.flatMap((w) => [w.from, w.to]);
      const columns = windows.map((_, i) => `COALESCE(SUM(amount_paise) FILTER (WHERE date >= $${2 * i + 1} AND date <= $${2 * i + 2}), 0) AS s${i}`);
      const r = await q(`SELECT ${columns.join(", ")} FROM ${kind.table(book)} WHERE deleted_at IS NULL`, params);
      return windows.map((_, i) => toBigInt(r.rows[0][`s${i}`]));
    },
    async newestId(book) {
      const r = await q(`SELECT id FROM ${kind.table(book)} WHERE deleted_at IS NULL ORDER BY date DESC, time DESC, entry_no DESC LIMIT 1`);
      return r.rows[0] ? String(r.rows[0].id) : null;
    },
    async list(book, filter: EntryFilter<S>): Promise<ListResult<R>> {
      const column = kind.sorts[filter.sort];
      if (!column) throw new Error("Not a sort column");
      const dir = filter.dir === "desc" ? "DESC" : "ASC";
      const params: unknown[] = [];
      const w = where(book, filter, params);
      const total = await q(`SELECT COUNT(*) AS n FROM ${kind.table(book)} e WHERE ${w}`, params);
      params.push(filter.pageSize, (filter.page - 1) * filter.pageSize);
      const r = await q(`SELECT e.* FROM ${kind.table(book)} e WHERE ${w} ORDER BY e.${column} ${dir}, e.entry_no ${dir} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
      return { rows: await load(book, r.rows), total: Number(total.rows[0].n) };
    },
    async get(book, id, options) {
      const r = await q(`SELECT * FROM ${kind.table(book)} WHERE id = $1 AND deleted_at IS ${options?.deleted === true ? "NOT NULL" : "NULL"}`, [id]);
      if (!r.rows[0]) return null;
      return (await load(book, r.rows))[0];
    },
    async create(book, input) {
      const entryNo = await nextEntryNo(tx, kind.table(book));
      const values = new Map<string, unknown>();
      for (const [field, column] of fields) {
        const v = (input as unknown as Record<string, unknown>)[field];
        values.set(column, typeof v === "bigint" ? v.toString() : v);
      }
      values.set("created_by", input.createdBy);
      values.set("entry_no", entryNo);
      const columns = [...values.keys()];
      const inserted = await guard(q(`INSERT INTO ${kind.table(book)} (${columns.join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`, [...values.values()]));
      const id = String(inserted.rows[0].id);
      if (kind.afterWrite) await guard(kind.afterWrite(tx, book, id, input));
      const [rec] = await load(book, inserted.rows);
      return kind.afterWrite ? ((await repo.get(book, id)) as R) : rec;
    },
    async update(book, id, expectedVersion, patch, actorId) {
      const { set, params } = setOf(patch, 3);
      const result = await versioned(book, id, expectedVersion, `${set === "" ? "" : `${set}, `}updated_by = $${3 + params.length}`, [...params, actorId], false);
      if (result.ok && kind.afterWrite) {
        await guard(kind.afterWrite(tx, book, id, patch));
        return { ok: true, record: (await repo.get(book, id)) as R };
      }
      return result;
    },
    async softDelete(book, id, expectedVersion, actorId) {
      return versioned(book, id, expectedVersion, "deleted_at = now(), deleted_by = $3", [actorId], false);
    },
    async restore(book, id, expectedVersion, actorId) {
      return versioned(book, id, expectedVersion, "deleted_at = NULL, deleted_by = NULL, updated_by = $3", [actorId], true);
    },
    async purge(book, id) {
      const row = await q(`SELECT 1 AS x FROM ${kind.table(book)} WHERE id = $1 AND deleted_at IS NOT NULL`, [id]);
      if (!row.rows[0]) return false;
      if (kind.beforePurge) await kind.beforePurge(tx, book, id);
      await q(`DELETE FROM ${kind.table(book)} WHERE id = $1 AND deleted_at IS NOT NULL`, [id]);
      return true;
    },
    async nextEntryNo(book) {
      const r = await q(`SELECT COALESCE(MAX(entry_no), 0) + 1 AS next FROM ${kind.table(book)}`);
      return Number(r.rows[0].next);
    },
    async totals(book, filter): Promise<EntryTotals> {
      const params: unknown[] = [];
      const r = await q(`SELECT COUNT(*) AS n, COALESCE(SUM(e.amount_paise), 0) AS s FROM ${kind.table(book)} e WHERE ${where(book, filter, params)}`, params);
      return { count: Number(r.rows[0].n), totalPaise: toBigInt(r.rows[0].s) };
    },
  };
  return repo;
}
