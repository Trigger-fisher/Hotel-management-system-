// Small helpers the payroll adapters (core, pay) and the platform console adapter share. Server query/body schemas are strict (an unknown key is a 422), so only known keys are sent.
import type { DashResult } from '@shared/dashboards/common';

import { buildQuery, get } from '../client';
import { rememberGet } from '../getCache';

const PAGE_SIZES = [10, 25, 50, 100] as const;
/** The server's largest page. */
const MAX_PAGE_SIZE = 100;
/** Most pages fetched for one "every row" list (100 pages of 100 = 10,000 rows). */
const MAX_EVERY_PAGES = 100;
/** How many pages of 100 getEveryPage asks for at the same time (HTTP/2 carries them on one connection; the server's statement limit and pool are the real bound). */
export const PARALLEL_PAGES = 10;

/** The server accepts 10, 25, 50 or 100 per page; anything else becomes the nearest larger one. */
export function snapPageSize(n: number | undefined): number | undefined {
  if (n === undefined) return undefined;
  return PAGE_SIZES.find((s) => s >= n) ?? 100;
}

export function pick<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) if (k in source && source[k] !== undefined) out[k] = source[k];
  return out;
}

/** Lookups (typeaheads) accept 1 to 50 results. */
export function lookupLimit(n: number | undefined): number | undefined {
  if (n === undefined) return undefined;
  return Math.min(50, Math.max(1, Math.floor(n)));
}

/** `deleted=true` only when asked (the server's query is a "true"/"false" word). */
export const deletedFlag = (deleted: boolean | undefined): 'true' | undefined => (deleted ? 'true' : undefined);

type PageShape = { items: unknown[]; total: number; page: number; pageSize: number };
type Query = Record<string, string | number | boolean | null | undefined>;

const isPage = (x: unknown): x is PageShape => typeof x === 'object' && x !== null && Array.isArray((x as PageShape).items) && typeof (x as PageShape).total === 'number';

/** The page of an answer: the answer itself (Page<T> & extras) or its `page` key ({ page, summary, counts }); null when it is neither. */
function pageOf(data: unknown): { page: PageShape; nested: boolean } | null {
  if (isPage(data)) return { page: data, nested: false };
  const inner = (data as { page?: unknown } | null)?.page;
  return isPage(inner) ? { page: inner, nested: true } : null;
}

/**
 * A paged list for a screen. Most screens filter, sort and page the rows themselves and ask for one very large page (500, 1000, 5000, 100,000),
 * but the server's largest page is 100 (a larger one is a 422, and snapping it to 100 would silently cut the list). So a page size above 100
 * fetches every page of 100 (at most 10,000 rows) and joins them into one page; extra keys of the answer (counts, summary, stats) come from the
 * first page. The page may be the answer itself or its `page` key. A page size of 100 or less is one request, snapped to 10, 25, 50 or 100.
 * The joined answer is remembered like one GET (lib/api/getCache.ts, same 20 s), so a screen that mounts again does not fetch every page again.
 */
export function getEveryPage<T>(path: string, query: Query, wantedPageSize: number | undefined, page?: number): Promise<DashResult<T>> {
  if (wantedPageSize === undefined || wantedPageSize <= MAX_PAGE_SIZE) return get<T>(path, { ...query, page, pageSize: snapPageSize(wantedPageSize) });
  return rememberGet<T>(`${path}${buildQuery(query)}#every`, () => joinEveryPage<T>(path, query));
}

async function joinEveryPage<T>(path: string, query: Query): Promise<DashResult<T>> {
  const first = await get<T>(path, { ...query, page: 1, pageSize: MAX_PAGE_SIZE });
  if (!first.ok) return first;
  const found = pageOf(first.data);
  if (!found) return first;
  const items = [...found.page.items];
  // The first answer says how many rows there are, so the other pages are asked together (a few at a time), not one after the other.
  const last = Math.min(Math.ceil(found.page.total / MAX_PAGE_SIZE), MAX_EVERY_PAGES);
  for (let from = 2; from <= last; from += PARALLEL_PAGES) {
    const numbers = Array.from({ length: Math.min(PARALLEL_PAGES, last - from + 1) }, (_, i) => from + i);
    const answers = await Promise.all(numbers.map((n) => get<T>(path, { ...query, page: n, pageSize: MAX_PAGE_SIZE })));
    let done = false;
    for (const r of answers) {
      if (!r.ok) return r;
      const more = pageOf(r.data);
      if (!more || more.page.items.length === 0) { done = true; break; }
      items.push(...more.page.items);
    }
    if (done) break;
  }
  const joined: PageShape = { ...found.page, items, page: 1, pageSize: Math.max(items.length, 1) };
  return { ok: true, data: (found.nested ? { ...(first.data as object), page: joined } : joined) as T };
}
