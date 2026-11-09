'use client';

// Pallav's list controls (pms.js: data-paginate, data-sortable, data-filter-target; partials/_pager.blade.php), shared by every list screen.
// Markup and class names are Pallav's; the behaviour is the same rules as pms.js in React.
import { useMemo, useState, type ReactNode } from 'react';
import { Bi } from '../Bi';
import { SearchBox } from './SearchBox';

import { tr, trn } from '@/lib/i18n/language';
/* ------------------------------------------------------------------ table controls */

export interface SortSpec<T> {
  kind: 'text' | 'num';
  value: (row: T) => string | number;
}

export interface TableView<T> {
  /** Rows of the current page, in the current order (after search). */
  rows: T[];
  /** First S.No. on this page minus one (S.No. counts through the whole list). */
  offset: number;
  total: number;
  search: string;
  setSearch: (q: string) => void;
  sort: { id: string; dir: 'asc' | 'desc' } | null;
  toggleSort: (id: string) => void;
  page: number;
  pages: number;
  perPage: number;
  setPage: (n: number) => void;
  setPerPage: (n: number) => void;
}

/**
 * Search, sort and paginate a list like Pallav's tables. Sorting: the first click on a text column is ascending and on a number column
 * descending; the next click flips it; a third click returns to the delivered order (pms.js).
 */
export function useTableView<T>(all: T[], opts: { perPage?: number; match?: (row: T, q: string) => boolean; sorters?: Record<string, SortSpec<T>> } = {}): TableView<T> {
  const [search, setSearchRaw] = useState('');
  const [sort, setSort] = useState<{ id: string; dir: 'asc' | 'desc' } | null>(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPageRaw] = useState(opts.perPage ?? 25);
  const { match, sorters } = opts;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q && match ? all.filter((r) => match(r, q)) : all;
  }, [all, search, match]);

  const ordered = useMemo(() => {
    const spec = sort && sorters ? sorters[sort.id] : undefined;
    if (!sort || !spec) return filtered;
    const f = sort.dir === 'asc' ? 1 : -1;
    return filtered
      .map((r, i) => ({ r, i }))
      .sort((a, b) => {
        const av = spec.value(a.r);
        const bv = spec.value(b.r);
        if (av < bv) return -1 * f;
        if (av > bv) return 1 * f;
        return a.i - b.i;
      })
      .map((x) => x.r);
  }, [filtered, sort, sorters]);

  const pages = Math.max(1, Math.ceil(ordered.length / perPage));
  const current = Math.min(page, pages);
  const start = (current - 1) * perPage;

  return {
    rows: ordered.slice(start, start + perPage),
    offset: start,
    total: ordered.length,
    search,
    setSearch: (q) => {
      setSearchRaw(q);
      setPage(1);
    },
    sort,
    toggleSort: (id) => {
      const kind = sorters?.[id]?.kind ?? 'text';
      setSort((s) => {
        if (!s || s.id !== id) return { id, dir: kind === 'text' ? 'asc' : 'desc' };
        return s.dir === 'desc' ? { id, dir: 'asc' } : null;
      });
      setPage(1);
    },
    page: current,
    pages,
    perPage,
    setPage,
    setPerPage: (n) => {
      setPerPageRaw(n);
      setPage(1);
    },
  };
}

/** `<th data-sort>`: a sortable header with Pallav's caret. */
export function Th<T>({ view, id, children, className = '' }: { view: TableView<T>; id: string; children: ReactNode; className?: string }) {
  const on = view.sort?.id === id;
  return (
    <th
      className={`sortable ${on ? 'sorted' : ''} ${className}`.trim()}
      data-dir={on ? view.sort?.dir : ''}
      aria-sort={on ? (view.sort?.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      tabIndex={0}
      role="columnheader"
      onClick={() => view.toggleSort(id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          view.toggleSort(id);
        }
      }}
    >
      {trn(children)}
      <i className="bi sort-caret" aria-hidden="true" />
    </th>
  );
}

/**
 * `payroll/partials/_pager.blade.php` (a list the page filters itself: `div.pms-pager`) or, with `server`, `partials/_server-pager.blade.php`
 * (a list the server pages: `form.pms-pager`). What you are looking at, rows per page, and the page buttons; the current page carries
 * `aria-current="page"` (the server pager's markup; pms.js leaves it off, it changes nothing on screen).
 */
export function Pager<T>({ view, sizes = [10, 25, 50, 100], server = false }: { view: TableView<T>; sizes?: number[]; server?: boolean }) {
  const { page, pages, total, offset, perPage } = view;
  const items: (number | '…')[] = [];
  for (let n = 1; n <= pages; n++) {
    if (n === 1 || n === pages || Math.abs(n - page) <= 1) items.push(n);
    else if (items[items.length - 1] !== '…') items.push('…');
  }
  const body = (
    <>
      <div className="pg-left">
        <span className="pg-info">{total === 0 ? tr("No records") : `Showing ${offset + 1}-${Math.min(offset + perPage, total)} of ${total}`}</span>
        <span className="pg-size">
          <span className="pg-size-label">{tr("Rows")}</span>
          <select aria-label={tr("Rows per page")} value={perPage} onChange={(e) => view.setPerPage(Number(e.target.value))}>
            {sizes.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </span>
      </div>
      <div className="pg-controls">
        <button type="button" disabled={page === 1} aria-label={tr("Previous page")} onClick={() => view.setPage(page - 1)}>
          <Bi name="chevron-left" />
        </button>
        {items.map((n, i) =>
          n === '…' ? (
            <button key={`g${i}`} type="button" disabled>
              …
            </button>
          ) : (
            <button key={n} type="button" className={n === page ? 'current' : ''} aria-current={n === page ? 'page' : undefined} onClick={() => view.setPage(n)}>
              {n}
            </button>
          ),
        )}
        <button type="button" disabled={page === pages} aria-label={tr("Next page")} onClick={() => view.setPage(page + 1)}>
          <Bi name="chevron-right" />
        </button>
      </div>
    </>
  );
  return server ? (
    <form className="pms-pager" onSubmit={(e) => e.preventDefault()}>
      {body}
    </form>
  ) : (
    <div className="pms-pager">{body}</div>
  );
}

export interface SearchFieldProps {
  value: string;
  onChange: (q: string) => void;
  placeholder: string;
  label: string;
  /**
   * The wrapper Pallav's Blade puts around the field: `pay-toolbar`, `cb-search`, `log-search` ... Rendered as `<form role="search">`
   * (or a plain `<div>` with `wrapTag="div"`, as `users/index` does) holding `div.search-field`. Without it the old shape stays:
   * `form.search-field.mb-0` (as `payroll/companies/index`), or with `bare` only `div.search-field` (the payroll pages).
   */
  wrapClass?: string;
  wrapTag?: 'form' | 'div';
  bare?: boolean;
  /** `.search-field.smart` (the live search look: room for the clear button). */
  smart?: boolean;
  /** `a.search-clear` (bi-x-lg) after the box while there is text, as the server-drawn Blade fields. */
  clear?: boolean;
  clearLabel?: string;
  /** Extra classes on `div.search-field` (`mb-0`, `bm-fbar-search`, `se-pick-search`). */
  fieldClass?: string;
  /** A hint on the box (`title`). */
  title?: string;
}

/**
 * Pallav's `.search-field` (icon + `form-control` search box) that filters the list below it. Escape empties a box that has text (bill-master.js,
 * pms-search.js). Blade: `<form class="pay-toolbar|cb-search|log-search" role="search"><div class="search-field [smart]"><i class="bi bi-search"></i>
 * <input type="search" class="form-control" autocomplete="off"><a class="search-clear"><i class="bi bi-x-lg"></i></a></div></form>`.
 */
export function SearchField({ value, onChange, placeholder, label, wrapClass, wrapTag, bare, smart, clearLabel, fieldClass, title }: SearchFieldProps) {
  // The one search box (SearchBox.tsx). `clear` stays in the props for the old call sites: every box shows its clear cross while there is text now.
  return <SearchBox value={value} onChange={onChange} placeholder={placeholder} label={label} title={title} wrapClass={wrapClass} wrapTag={wrapTag} bare={bare} smart={smart} fieldClass={fieldClass} clearLabel={clearLabel} />;
}
/** The "No records / no match" block of Pallav (`.empty-state`). */
export function EmptyState({ icon, title, text, children }: { icon: string; title: string; text: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="es-icon">
        <Bi name={icon} />
      </div>
      <div className="es-title">{tr(title)}</div>
      <div className="es-text">{tr(text)}</div>
      {children}
    </div>
  );
}
