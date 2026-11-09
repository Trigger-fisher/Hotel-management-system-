// A short memory of GET answers for the dashboards' `dash('GET', ...)` (client.ts): a page change inside the app that reads the same list again within
// 20 seconds (the payroll company list, options, names) costs no request, and two identical GETs in flight share one request.
// Rules:
//  - only a successful answer is kept, never an error; a stale answer is at most GET_CACHE_MS old and lives in this tab only;
//  - every write through `http()` (any non-GET), a 401, a soft refresh (F5, components/ui/softRefresh.ts), an explicit `reload()` of a screen (useAsync)
//    and a sign-out (lib/auth/signOut.ts) forget everything, so a change made on this PC is seen by the very next read;
//  - never written to storage (the shared front-desk PC rule: nothing of one account outlives its session in the browser);
//  - a reader that must see the latest (a poll every few seconds) passes `{ fresh: true }` and never reads from here.
// Mock mode is untouched: the mock adapters do not go through `dash`.
import type { DashResult } from '@shared/dashboards/common';

/** How long a GET answer is reused. Short on purpose: another tab or PC that wrote a record is not seen here for at most this long. */
export const GET_CACHE_MS = 20_000;

const kept = new Map<string, { at: number; result: DashResult<unknown> }>();
const inFlight = new Map<string, Promise<DashResult<unknown>>>();
/** Bumped by every clear: an answer that started before a clear (it may be from before the write) is not kept. */
let generation = 0;

/** The kept answer for `key` while it is younger than GET_CACHE_MS, else the request in flight for it, else a new `run()` whose success is kept. */
export function rememberGet<T>(key: string, run: () => Promise<DashResult<T>>): Promise<DashResult<T>> {
  const hit = kept.get(key);
  if (hit && Date.now() - hit.at < GET_CACHE_MS) return Promise.resolve(hit.result as DashResult<T>);
  if (hit) kept.delete(key);
  const flying = inFlight.get(key);
  if (flying) return flying as Promise<DashResult<T>>;
  const started = generation;
  const p: Promise<DashResult<unknown>> = run().then(
    (result) => {
      if (inFlight.get(key) === p) inFlight.delete(key);
      if (result.ok && started === generation) kept.set(key, { at: Date.now(), result });
      return result;
    },
    (e: unknown) => {
      if (inFlight.get(key) === p) inFlight.delete(key);
      throw e;
    },
  );
  inFlight.set(key, p);
  return p as Promise<DashResult<T>>;
}

/** Forgets every kept answer and stops sharing the requests in flight (their answers are not kept either). */
export function clearGetCache(): void {
  kept.clear();
  inFlight.clear();
  generation += 1;
}

/** How many answers are kept right now (tests). */
export function getCacheSize(): number {
  return kept.size;
}
