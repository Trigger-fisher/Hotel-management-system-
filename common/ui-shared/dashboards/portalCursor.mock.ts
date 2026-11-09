// Mock-only (dev and local-demo builds): cursor paging and "a hotel that cannot be reached" for the portal mocks, the same rules as the server (web-app/src/server/services/portal/cursor.ts
// and multiHotel.ts gather). Send `limit` (10, 25, 50, 100) to page by cursor; each answer carries `nextCursor` (null on the last page), `total` and `unavailable`. The order is the
// server's: date newest first, then hotel id, then the row id newest first. A cursor is bound to the list and its filters: one used with other filters is a 422 on `cursor`.
// Unreachable hotels on demand: `setMockUnreachableHotels(['h-2'])`, or `?mockDown=h-2` (comma-separated) in the page address.
import { mockError, type DashError } from './common';
import { PORTAL_CURSOR_LIMITS, type PortalUnavailableHotel } from './portalHotels';

let unreachable = new Set<string>();

/** Mock only: these hotel ids answer as unreachable (their rows are left out and they are named in `unavailable`). Empty = every hotel answers. */
export function setMockUnreachableHotels(ids: readonly string[]): void {
  unreachable = new Set(ids);
}

/** The hotels the mock treats as unreachable now (the setter, plus `?mockDown=` in the address when there is one). */
export function mockUnreachableHotels(): ReadonlySet<string> {
  const out = new Set(unreachable);
  try {
    const search = (globalThis as { location?: { search?: string } }).location?.search ?? '';
    const down = new URLSearchParams(search).get('mockDown');
    for (const id of (down ?? '').split(',').map((s) => s.trim()).filter(Boolean)) out.add(id);
  } catch {
    // no address (tests, server): only the setter counts
  }
  return out;
}

/** The hotels of `inScope` that are unreachable, as the server names them. */
export function mockUnavailable(hotels: readonly { hotelId: string; name: string }[], inScope: (hotelId: string) => boolean): PortalUnavailableHotel[] {
  const down = mockUnreachableHotels();
  return hotels.filter((h) => inScope(h.hotelId) && down.has(h.hotelId)).map((h) => ({ hotelId: h.hotelId, hotelName: h.name }));
}

export interface MockKey {
  d: string;
  h: string;
  i: string;
}

const text = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const compare = (a: MockKey, b: MockKey): number => -text(a.d, b.d) || text(a.h, b.h) || -text(a.i, b.i);

// the cursor is the key and the list's scope as hex of ASCII-safe JSON (the server signs its own; the mock only needs to be opaque and checkable)
const toHex = (s: string): string => Array.from(encodeURIComponent(s)).map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
const fromHex = (h: string): string => decodeURIComponent((h.match(/../g) ?? []).map((x) => String.fromCharCode(parseInt(x, 16))).join(''));

const START_AGAIN = 'That page link is no longer valid. Please start again from the first page.';

export interface MockListQuery {
  page?: number;
  pageSize?: number;
  cursor?: string;
  limit?: number;
}

/**
 * One list answer in the server's shape: by page (as before) when no `limit` / `cursor` is sent, else by cursor. `scope` names the list and its filters (hotel, search, tab ...).
 * Returns an error result for a cursor that does not belong to this scope or a limit that is not 10, 25, 50 or 100.
 */
export function mockListPage<T>(rows: readonly T[], q: MockListQuery, scope: string, keyOf: (row: T) => MockKey):
  | { ok: true; page: { items: T[]; total: number; page: number; pageSize: number; nextCursor: string | null } }
  | { ok: false; error: { ok: false; error: DashError } } {
  if (q.cursor === undefined && q.limit === undefined) {
    const pageSize = q.pageSize ?? 20;
    const page = Math.max(1, q.page ?? 1);
    return { ok: true, page: { items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize, nextCursor: null } };
  }
  const limit = q.limit ?? 25;
  if (!(PORTAL_CURSOR_LIMITS as readonly number[]).includes(limit)) return { ok: false, error: mockError('VALIDATION_FAILED', { limit: 'Choose 10, 25, 50 or 100 rows.' }) };
  let after: MockKey | null = null;
  if (q.cursor !== undefined) {
    try {
      const parsed = JSON.parse(fromHex(q.cursor)) as { s?: string; k?: MockKey };
      if (parsed.s !== scope || !parsed.k) throw new Error('scope');
      after = parsed.k;
    } catch {
      return { ok: false, error: mockError('VALIDATION_FAILED', { cursor: START_AGAIN }, { message: START_AGAIN }) };
    }
  }
  const ordered = rows.map((row) => ({ row, key: keyOf(row) })).sort((a, b) => compare(a.key, b.key));
  const from = after === null ? 0 : ordered.findIndex((x) => compare(x.key, after as MockKey) > 0);
  const rest = from < 0 ? [] : ordered.slice(from);
  const items = rest.slice(0, limit);
  const next = rest.length > limit && items.length > 0 ? toHex(JSON.stringify({ s: scope, k: items[items.length - 1].key })) : null;
  return { ok: true, page: { items: items.map((x) => x.row), total: rows.length, page: 1, pageSize: limit, nextCursor: next } };
}
