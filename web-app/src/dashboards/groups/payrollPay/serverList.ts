'use client';

// The server-paged pay lists (Slips, Advances, Bonus, Resignations), like Salary Payments: the screen keeps the status, the search (sent
// 250 ms after the last key), the order and the page, and asks the server for that one page. The server filters, sorts and pages
// (docs/BACKEND.md 7.6 "Pay lists"); the summary it sends does not follow any of them.
import { useState } from 'react';
import type { TableView } from '@/dashboards/pallav/ui';
import { useDebounced } from '@/components/ui';

type Sort = { id: string; dir: 'asc' | 'desc' } | null;

/** `newest`: the column the list opens sorted by, newest first (R12); the same column clicked again goes oldest first, then back to the server's own order. */
export function useServerList<Status extends string, SortId extends string>(numeric: readonly SortId[], newest?: SortId) {
  const [status, setStatusRaw] = useState<'' | Status>('');
  const [search, setSearchRaw] = useState('');
  const typed = useDebounced(search.trim(), 250);
  const [sort, setSort] = useState<Sort>(newest ? { id: newest, dir: 'desc' } : null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPageRaw] = useState(25);

  const query = { page, pageSize: perPage, status: status || undefined, search: typed || undefined, sort: sort ? (sort.id as SortId) : undefined, dir: sort?.dir };
  /** What the load depends on (add the screen's own: the company, the reload counter). */
  const deps: unknown[] = [page, perPage, status, typed, sort?.id, sort?.dir];

  const setStatus = (s: '' | Status) => {
    setStatusRaw(s);
    setPage(1);
  };

  /** The kit's TableView over the server's page: S.No. counts through the whole list; sort clicks as Pallav (number columns start descending). */
  function viewOf<T>(rows: T[], total: number): TableView<T> {
    const pages = Math.max(1, Math.ceil(total / perPage));
    // A delete or a narrower filter can leave the page past the end: move back to the last page.
    if (page > pages) setPage(pages);
    return {
      rows,
      offset: (page - 1) * perPage,
      total,
      search,
      setSearch: (q) => {
        setSearchRaw(q);
        setPage(1);
      },
      sort,
      toggleSort: (id) => {
        setPage(1);
        setSort((cur) => {
          const first: 'asc' | 'desc' = (numeric as readonly string[]).includes(id) ? 'desc' : 'asc';
          if (!cur || cur.id !== id) return { id, dir: first };
          return cur.dir === first ? { id, dir: first === 'asc' ? 'desc' : 'asc' } : null;
        });
      },
      page,
      pages,
      perPage,
      setPage,
      setPerPage: (n) => {
        setPerPageRaw(n);
        setPage(1);
      },
    };
  }

  /** Something is narrowing the list (a status or a search). */
  const narrowed = status !== '' || search.trim() !== '';

  return { status, setStatus, query, deps, viewOf, narrowed };
}
