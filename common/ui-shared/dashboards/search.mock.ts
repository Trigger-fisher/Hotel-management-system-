// The in-memory mock of search.ts (dev and local-demo builds only): loaded through ui-shared/mocks (web-app/src/lib/api/mockLoader.ts), never by app code.
import type { MockClock, DashResult } from './common';
import { mockError, ok } from './common';
import { SEARCH_PER_KIND, SEARCH_PER_MINUTE, capHits, searchCopy, searchKinds, searchable, type SearchApi, type SearchHit, type SearchKind, type SearchResult, type SearchSource } from './search';

/**
 * The mock of GET /api/v1/search: asks every source in parallel, keeps at most 8 hits per kind and 50 in all, counts what each kind found,
 * and refuses with the 429 sentence after 20 searches in a minute.
 */
export function createSearchApi(sources: SearchSource[], clock: MockClock = {}): SearchApi {
  const asked: number[] = [];
  return {
    search: async (raw): Promise<DashResult<SearchResult>> => {
      if (clock.offline?.()) return mockError('NETWORK_OFFLINE');
      const q = raw.trim();
      const now = Date.now();
      while (asked.length && now - (asked[0] ?? 0) > 60_000) asked.shift();
      if (asked.length >= SEARCH_PER_MINUTE) return mockError('SERVER_ERROR', undefined, { message: searchCopy.tooMany });
      asked.push(now);
      const counts = Object.fromEntries(searchKinds.map((k) => [k.kind, 0])) as Record<SearchKind, number>;
      if (!searchable(q, true)) return ok({ query: q, hits: [], counts });
      const found = (await Promise.all(sources.map((s) => s(q, SEARCH_PER_KIND).catch(() => [] as SearchHit[])))).flat();
      for (const { kind } of searchKinds) counts[kind] = Math.min(SEARCH_PER_KIND, found.filter((h) => h.kind === kind).length);
      return ok({ query: q, hits: capHits(found), counts });
    },
  };
}
