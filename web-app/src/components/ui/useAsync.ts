'use client';

import { useCallback, useEffect, useEffectEvent, useState } from 'react';
import type { DashError, DashResult } from '@shared/dashboards/common';

import { clearGetCache } from '../../lib/api/getCache';
import { refreshActivity } from './refreshActivity';
import { shareUnchanged } from './shareUnchanged';
import { noteLoadError, registerLoader } from './softRefresh';

export { shareUnchanged };

export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: DashError }
  | { status: 'ready'; data: T };

const LOADING = { status: 'loading' } as const;

function sameDeps(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
}

export interface UseAsyncOptions {
  /**
   * Keep the last answer on screen while the deps CHANGE too (a refresh tick, a filter, a page): use it when the rows of the new deps are the same kind of thing as
   * the old ones. Leave it off when the deps name another record or scope (another company, another id): then the old rows must not show. `reload()` always keeps
   * the old answer, because the deps did not change.
   */
  keep?: boolean;
}

/** `initial`: an answer the page already has (the server read it while drawing the shell): shown at once as ready, and the first load is skipped. */
export type UseAsyncInit<T> = UseAsyncOptions & { initial?: T };

/**
 * Runs `load` when `deps` change (or on `reload()`), and tracks loading / error / ready.
 * Stale answers (deps changed while a call was running) are dropped. Never throws:
 * a rejected promise becomes a SERVER_ERROR state.
 *
 * Stale-while-revalidate (R48): on `reload()` the old answer stays `ready` while the new one loads (`refreshing` is true meanwhile, and the shell shows its slim
 * progress line), so a save or a Refresh never blanks the page; only the FIRST load shows `loading`. The new answer shares every unchanged part with the old one.
 */
export function useAsync<T>(
  load: () => Promise<DashResult<T>>,
  deps: unknown[],
  options: UseAsyncInit<T> = {},
): { state: AsyncState<T>; reload: () => void; refreshing: boolean } {
  // Request number: bumped when deps change (compared here, during render) or on reload().
  const [track, setTrack] = useState<{ deps: unknown[]; gen: number }>(() => ({ deps, gen: 0 }));
  if (!sameDeps(track.deps, deps)) setTrack({ deps, gen: track.gen + 1 });
  const gen = track.gen;

  const [startedWithData] = useState(() => options.initial !== undefined);
  const [result, setResult] = useState<{ gen: number; state: AsyncState<T> } | null>(() =>
    options.initial !== undefined ? { gen: 0, state: { status: 'ready', data: options.initial } } : null,
  );
  const run = useEffectEvent(() => load());
  const [reloadedGens] = useState<Set<number>>(() => new Set());
  const keepAcrossDeps = options.keep === true;

  useEffect(() => {
    // the answer given as `initial` stands for the first load
    if (gen === 0 && startedWithData) return undefined;
    let live = true;
    const done = (state: AsyncState<T>) => {
      if (!live) return;
      if (state.status === 'error') noteLoadError();
      setResult((old) => {
        if (state.status === 'ready' && old && old.state.status === 'ready') return { gen, state: { status: 'ready', data: shareUnchanged(old.state.data, state.data) } };
        // A reload (F5, Refresh, after a save) that fails behind data already on screen keeps that data; the shell says "Could not refresh".
        if (state.status === 'error' && old && old.state.status === 'ready' && reloadedGens.has(gen)) {
          refreshActivity.fail();
          return { gen, state: old.state };
        }
        return { gen, state };
      });
    };
    run().then(
      (r) => done(r.ok ? { status: 'ready', data: r.data } : { status: 'error', error: r.error }),
      () => done({ status: 'error', error: { code: 'SERVER_ERROR', message: 'SERVER_ERROR', traceId: 'client' } }),
    );
    return () => {
      live = false;
    };
  }, [gen, reloadedGens, startedWithData]);

  // The answer of the previous request counts as "current" while the new one runs when it is a reload (same deps) or the caller said `keep`.
  // A reload is an explicit "read again" (Refresh, Retry, after a save): it never gets the 20 s memory of GET answers (lib/api/getCache.ts).
  const reload = useCallback(() => {
    clearGetCache();
    setTrack((t) => {
      reloadedGens.add(t.gen + 1);
      return { deps: t.deps, gen: t.gen + 1 };
    });
  }, [reloadedGens]);

  // F5 / Ctrl+R in the dashboard reloads this screen in place (softRefresh.ts) instead of the whole document.
  useEffect(() => registerLoader(reload), [reload]);

  const current = result !== null && result.gen === gen;
  const stale = !current && result !== null && result.state.status === 'ready' && (keepAcrossDeps || reloadedGens.has(gen));
  const state: AsyncState<T> = current ? result.state : stale ? result.state : LOADING;
  const refreshing = stale;

  useEffect(() => {
    if (!refreshing) return undefined;
    return refreshActivity.begin();
  }, [refreshing]);

  return { state, reload, refreshing };
}
