import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { AppError } from "../../errors";

// Keyset ("cursor") paging for the portals' "All hotels" lists (docs/plans/PORTAL-ALL-HOTELS-PLAN-2026-10-18.md). Every row has a key (date, hotel, token): the list is ordered by date
// newest first, then hotel id, then the token (the row's id, newest first; or, for a list whose order inside a day matters, its position). The cursor is the key of the last row sent.
// It is SIGNED with the server's key and bound to the login and to the list, hotel and filters it was made for: a changed, foreign or reused-with-other-filters cursor is a 422 on `cursor`.
// Nothing in a cursor is secret (a date, a hotel id of the login's own, a row id); the signature only keeps it from being forged or carried over.

export interface Keyset {
  /** The date (or timestamp) the list is ordered by; compared as text, newest first. */
  d: string;
  /** The hotel's id. */
  h: string;
  /** The row's tie token. */
  i: string;
}

/** How the token breaks a tie: "desc" = larger first (ids), "asc" = smaller first (a position already in display order). */
export type TieOrder = "desc" | "asc";

export const CURSOR_LIMITS = [10, 25, 50, 100] as const;
export const DEFAULT_CURSOR_LIMIT = 25;

const text = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Display order of two keys: date newest first, then hotel id, then the token per `tie`. Negative = `a` comes first. */
export function compareKeys(a: Keyset, b: Keyset, tie: TieOrder): number {
  return -text(a.d, b.d) || text(a.h, b.h) || (tie === "desc" ? -text(a.i, b.i) : text(a.i, b.i));
}

/** A process-wide fallback key for when the server has none configured (cursors then only live as long as the process). */
let fallback: Buffer | undefined;
export const cursorSecretOr = (secret: (() => Buffer) | undefined): Buffer => (secret ? secret() : (fallback ??= randomBytes(32)));

const sign = (secret: Buffer, userId: string, scope: string, payload: string): string => createHmac("sha256", secret).update(`cursor\n${userId}\n${scope}\n${payload}`).digest("base64url").slice(0, 22);

export function makeCursor(secret: Buffer, userId: string, scope: string, key: Keyset): string {
  const payload = Buffer.from(JSON.stringify([key.d, key.h, key.i]), "utf8").toString("base64url");
  return `${payload}.${sign(secret, userId, scope, payload)}`;
}

const START_AGAIN = "That page link is no longer valid. Please start again from the first page.";
const bad = (): AppError => new AppError("VALIDATION_FAILED", START_AGAIN, { fields: { cursor: START_AGAIN } });

/** The key inside a cursor made by `makeCursor` for this login and this scope; anything else is a 422 on `cursor`. */
export function readCursor(secret: Buffer, userId: string, scope: string, cursor: string): Keyset {
  const [payload, signature, ...rest] = cursor.split(".");
  if (!payload || !signature || rest.length > 0) throw bad();
  const want = Buffer.from(sign(secret, userId, scope, payload));
  const got = Buffer.from(signature);
  if (want.length !== got.length || !timingSafeEqual(want, got)) throw bad();
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 3 || !parsed.every((x) => typeof x === "string")) throw bad();
    return { d: parsed[0] as string, h: parsed[1] as string, i: parsed[2] as string };
  } catch {
    throw bad();
  }
}

/**
 * One page of `rows` in key order: the rows after `after` (the cursor's key; none = from the start), at most `limit`. `next` is the key to send back, or null on the last page.
 * Rows are sorted here, so the caller may hand them over merged from several hotels in any order.
 */
export function pageByKeyset<T>(rows: readonly T[], keyOf: (row: T) => Keyset, after: Keyset | null, limit: number, tie: TieOrder): { items: T[]; next: Keyset | null } {
  const ordered = rows.map((row) => ({ row, key: keyOf(row) })).sort((a, b) => compareKeys(a.key, b.key, tie));
  const from = after === null ? 0 : ordered.findIndex((x) => compareKeys(x.key, after, tie) > 0);
  const rest = from < 0 ? [] : ordered.slice(from);
  const items = rest.slice(0, limit);
  const more = rest.length > limit;
  return { items: items.map((x) => x.row), next: more && items.length > 0 ? items[items.length - 1].key : null };
}

/** The filters a list cursor is bound to (any that the list has). */
export interface CursorListQuery {
  hotel?: string;
  search?: string;
  period?: string;
  tab?: string;
  unread?: boolean;
  page: number;
  pageSize: number;
  cursor?: string;
  limit?: number;
}

/**
 * One list answer from rows already merged from the hotels: by page (`page`, `pageSize`) or, when a `limit` or `cursor` is sent, by cursor in key order. The cursor is signed for this
 * login and this list, hotel and filters; `nextCursor` is null on the last page (and always in page mode).
 */
export function listByCursorOrPage<T>(secret: (() => Buffer) | undefined, userId: string, name: string, q: CursorListQuery, rows: T[], keyOf: (row: T) => Keyset, tie: TieOrder) {
  const mode = cursorModeOf(q);
  if (!mode) return { items: rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), total: rows.length, page: q.page, pageSize: q.pageSize, nextCursor: null as string | null };
  const key = cursorSecretOr(secret);
  const scope = [name, q.hotel || "all", q.search ?? "", q.period ?? "", q.tab ?? "", q.unread ? "unread" : ""].join("|");
  const after = q.cursor === undefined ? null : readCursor(key, userId, scope, q.cursor);
  const { items, next } = pageByKeyset(rows, keyOf, after, mode.limit, tie);
  return { items, total: rows.length, page: 1, pageSize: mode.limit, nextCursor: next ? makeCursor(key, userId, scope, next) : null };
}

/** `cursor` mode is on when a `limit` or a `cursor` is sent; the size is then the limit (default 25). */
export const cursorModeOf = (q: { cursor?: string; limit?: number }): { limit: number } | null => (q.cursor === undefined && q.limit === undefined ? null : { limit: q.limit ?? DEFAULT_CURSOR_LIMIT });
