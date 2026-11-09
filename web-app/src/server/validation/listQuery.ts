import "server-only";
import { z } from "zod";

// The one list-screen query: bounded and whitelisted, so a hostile `search`, `sort` or `pageSize` can neither reach SQL as anything
// but a bound parameter nor ask for an unbounded page. `sort` is an enum of column names the module lists; nothing else is accepted.
const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function listQuerySchema<const S extends readonly [string, ...string[]]>(sorts: S, defaultSort: S[number]) {
  return z.strictObject({
    search: z.string().trim().max(200).regex(NO_CONTROL).optional(),
    from: z.string().regex(DAY).optional(),
    to: z.string().regex(DAY).optional(),
    sort: z.enum(sorts).default(defaultSort),
    dir: z.enum(["asc", "desc"]).default("desc"),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    deleted: z.enum(["no", "only"]).default("no"),
  });
}

/** A path id: a UUID, nothing else. */
export const idParams = z.strictObject({ id: z.uuid() });

/** The optimistic-locking field every update and delete body carries. */
export const versionField = z.number().int().min(1).max(2_147_483_646);

/** The one page-search rule (decision 51): trimmed, at most 200 characters, no control characters. Every list route's `search` is this long. */
export const SEARCH_MAX = 200;
export const searchParam = z.string().trim().max(SEARCH_MAX).regex(NO_CONTROL).optional();

/** The words of a search text: lower-cased, split on spaces, empty ones dropped. */
export function searchWords(search: string | undefined): string[] {
  return (search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * The in-memory page search for a list the service already holds (short lists, master data): EVERY word must appear, case-insensitively, as a plain
 * substring of the row's visible text (`text` returns the visible columns; null and undefined are skipped). No text keeps every row.
 */
export function matchWords<T>(rows: readonly T[], search: string | undefined, text: (row: T) => ReadonlyArray<string | number | null | undefined>): T[] {
  const words = searchWords(search);
  if (words.length === 0) return [...rows];
  return rows.filter((row) => {
    const hay = text(row).filter((v) => v !== null && v !== undefined).join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
