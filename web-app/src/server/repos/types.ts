import "server-only";
import type { VerifiedSession } from "../auth/session";

/**
 * A unit of work: everything inside `work` happens in ONE database transaction on ONE hotel, and is undone if `work` throws.
 * Services receive `repos` and never see SQL, `pg` or a connection. The hotel comes from the verified session, never from the
 * request. The PostgreSQL implementation wraps withHotel (BEGIN, SET LOCAL ROLE, search_path, COMMIT); the in-memory one is the
 * test double and honours the same rules (see memory/).
 */
export interface Unit<Repos> {
  run<T>(session: Pick<VerifiedSession, "hotelId" | "userId" | "visit" | "scope">, work: (repos: Repos) => Promise<T>): Promise<T>;
}

/** A rule the database itself would enforce (a CHECK or a UNIQUE index). The service validates first; this is the backstop. */
export class RepoError extends Error {
  readonly kind: "check" | "unique";
  constructor(kind: "check" | "unique", message: string) {
    super(message);
    this.name = "RepoError";
    this.kind = kind;
  }
}

/** The result of an optimistic update or delete: UPDATE ... WHERE id = $1 AND version = $2 matched a row, did not match (stale), or the row is gone. */
export type VersionedResult<T> =
  | { ok: true; record: T }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "conflict"; currentVersion: number };

export interface Page {
  page: number;
  pageSize: number;
  /**
   * false: the caller needs this page only (the global search), so a list that honours it skips counting every match and reports `total` as -1.
   * Left out (or true): `total` is the number of matches, as every screen needs. The in-memory doubles always count.
   */
  countTotal?: boolean;
}

export interface ListResult<T> {
  rows: T[];
  /** Every match, not just this page; -1 when the query said `countTotal: false` and the list skipped the count. */
  total: number;
}
