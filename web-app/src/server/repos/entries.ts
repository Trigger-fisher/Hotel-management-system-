import "server-only";
import type { Paise } from "../money/paise";
import type { ListResult, Page, VersionedResult } from "./types";

// The shape every Daily Cash entry table shares (deposits, withdrawals, miscellaneous expenses, and later advances and handovers): a book
// (hotel or food), a running entry number, the shift clock date and time, who recorded it, an amount in paise with its words, soft delete
// and a version. One generic repository interface and one in-memory implementation serve all of them; each kind adds only its own fields.

export type CashBook = "hotel" | "food";
export const CASH_BOOKS: readonly CashBook[] = ["hotel", "food"];

export interface EntryBase {
  id: string;
  book: CashBook;
  /** The running number in the book: one past the highest ever used, soft-deleted rows included (Pallav HasEntryNumber). */
  entryNo: number;
  /** YYYY-MM-DD and HH:MM:SS as written on the entry (Pallav stores the shift clock, not an instant). */
  date: string;
  time: string;
  userId: string;
  fullName: string | null;
  amountPaise: Paise;
  amountInWords: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Optimistic locking: starts at 1 and rises by exactly one on every update (the database trigger enforces it). */
  version: number;
}

export interface NewEntryBase {
  date: string;
  time: string;
  userId: string;
  fullName: string | null;
  amountPaise: Paise;
  amountInWords: string | null;
  createdBy: string | null;
}

export interface EntryFilter<S extends string> extends Page {
  /** Plain-text search over the kind's own fields (the list screen uses Pallav's token search in the service instead). */
  search?: string;
  from?: string;
  to?: string;
  /** "no" = live rows only (default), "only" = the recycle bin. */
  deleted?: "no" | "only";
  sort: S;
  dir: "asc" | "desc";
}

export interface EntryTotals {
  count: number;
  totalPaise: Paise;
}

export interface EntryRepo<R extends EntryBase, N extends NewEntryBase, P, S extends string = string> {
  /** Every row of the book in the date window (live, or the recycle bin), unsorted and unpaged: the list screen searches, sorts and pages them like Pallav does. */
  rows(book: CashBook, filter: { deleted?: "no" | "only"; from?: string; to?: string }, options?: { withDetails?: boolean }): Promise<R[]>;
  /** Fills in what `rows(..., { withDetails: false })` left out (an expense's lines), for the rows a page actually shows. */
  hydrate(book: CashBook, records: R[]): Promise<void>;
  /** The live amount in each date window, in one read (the numbers on top of the list screen). */
  sums(book: CashBook, windows: readonly { from: string; to: string }[]): Promise<Paise[]>;
  /** The newest live entry of the book: date, then time, then id, all descending (Pallav CashLedger::newestId). */
  newestId(book: CashBook): Promise<string | null>;
  list(book: CashBook, filter: EntryFilter<S>): Promise<ListResult<R>>;
  /** A live row; soft-deleted rows are found only with `deleted: true`. Another hotel's id is simply not found. */
  get(book: CashBook, id: string, options?: { deleted?: boolean }): Promise<R | null>;
  /** Assigns the next entry number inside the same unit and inserts. */
  create(book: CashBook, input: N): Promise<R>;
  update(book: CashBook, id: string, expectedVersion: number, patch: P, actorId: string): Promise<VersionedResult<R>>;
  /** Sets deleted_at/deleted_by (Pallav SoftDeletes); the version rises by one like any update. */
  softDelete(book: CashBook, id: string, expectedVersion: number, actorId: string): Promise<VersionedResult<R>>;
  /** Takes a row out of the recycle bin. */
  restore(book: CashBook, id: string, expectedVersion: number, actorId: string): Promise<VersionedResult<R>>;
  /** Removes a recycle-bin row for good (the table is marked -- hard-delete). Live rows are never purged. */
  purge(book: CashBook, id: string): Promise<boolean>;
  /** What the next entry number would be (read-only; create assigns its own under the lock). */
  nextEntryNo(book: CashBook): Promise<number>;
  totals(book: CashBook, filter: { search?: string; from?: string; to?: string; deleted?: "no" | "only" }): Promise<EntryTotals>;
}
