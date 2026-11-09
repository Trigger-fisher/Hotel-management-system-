'use client';

import { useEffect, useRef, useState } from 'react';
import type { DashResult } from '@shared/dashboards/common';
import { useAsync, type AsyncState } from './useAsync';

type PagedFlat = { items: unknown[]; total: number };
type PagedNested = { page: { items: unknown[]; total: number } };

/**
 * "Load more" lists: page 1 comes from `load(1)`; `loadMore()` asks for page + 1 and appends the rows until `total`
 * is reached. `pageSize` stays fixed (the caller passes 10 in `load`), and rows already loaded are never fetched
 * again. A change in `deps` (filter, search) or `reload()` starts again from page 1. `state.data` has the same shape as
 * the API answer with every row so far. `shape` says where the rows are: 'flat' = `{ items, total }`,
 * 'page' = `{ page: { items, total } }`.
 */
export function usePagedAsync<R extends PagedFlat | PagedNested>(
  load: (page: number) => Promise<DashResult<R>>,
  deps: unknown[],
  shape: R extends PagedNested ? 'page' : 'flat' = 'flat' as R extends PagedNested ? 'page' : 'flat',
): { state: AsyncState<R>; reload: () => void; loadMore: () => void; loadingMore: boolean; hasMore: boolean } {
  const first = useAsync(() => load(1), deps);
  const [more, setMore] = useState<{ base: unknown; items: unknown[]; page: number; busy: boolean }>({ base: null, items: [], page: 1, busy: false });
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  const rowsOf = (r: R): { items: unknown[]; total: number } => (shape === 'page' ? (r as PagedNested).page : (r as PagedFlat));
  const base = first.state.status === 'ready' ? first.state.data : null;
  // A fresh first page (new filter, reload) throws away the appended pages.
  if (more.base !== base) setMore({ base, items: [], page: 1, busy: false });

  const baseRows = base ? rowsOf(base) : null;
  const items = baseRows ? [...baseRows.items, ...more.items] : [];
  const hasMore = !!baseRows && items.length < baseRows.total;

  function loadMore() {
    if (!base || more.busy || !hasMore) return;
    const next = more.page + 1;
    setMore((m) => ({ ...m, busy: true }));
    void loadRef.current(next).then((res) => {
      setMore((m) => (m.base !== base ? m : res.ok ? { base, items: [...m.items, ...rowsOf(res.data).items], page: next, busy: false } : { ...m, busy: false }));
    });
  }

  const merged = base ? (shape === 'page' ? { ...base, page: { ...(base as PagedNested).page, items } } : { ...base, items }) : null;
  const state: AsyncState<R> = first.state.status === 'ready' && merged ? { status: 'ready', data: merged as R } : first.state;
  return { state, reload: first.reload, loadMore, loadingMore: more.busy, hasMore };
}
