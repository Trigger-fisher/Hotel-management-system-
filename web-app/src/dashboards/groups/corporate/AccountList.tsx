'use client';

// The frame of the company's account lists (Bills, Payments, Statement): the search in the page head with the page's one main action, an optional line
// that says how the page works, the filter bar (tabs, count) when the page has tabs or else a plain count line, the server's own figures as one quiet row, then one DetailCard per row
// and Load more. When a login is linked to several hotels and "All hotels" is chosen, each row also names its hotel.
import { useState, type ReactNode } from 'react';

import type { DashResult, Page } from '@shared/dashboards/common';
import { portalNotSetUp } from '@shared/dashboards/portalState';
import { PORTAL_ALL_HOTELS } from '@shared/dashboards/portalHotel';
import type { PortalPartial } from '@shared/dashboards/portalHotels';

import { useDebounced } from '@/components/ui';
import type { AsyncState } from '@/components/ui/useAsync';
import { Button, EmptyState, FilterBar, ListSearch, LoadError, PageHead, PageSkeleton, type FilterTab } from '@/dashboards/pallav/ui';
import { CURSOR_LIMIT, LoadMore, useCursorList } from '../portal/AppKit';
import { UnavailableNote } from '../portal/HotelParts';
import { usePortalHotel } from '../portal/HotelSwitch';
import { PtNotSetUp } from '../portal/parts';
import { cpWords } from './words';

/** The loading, "not set up yet" and error states of a portal page in the kit's look, then `children(data)`. */
export function PortalLoad<T>({ state, onRetry, children }: { state: AsyncState<T>; onRetry: () => void; children: (data: T) => ReactNode }) {
  if (state.status === 'loading') return <PageSkeleton />;
  if (state.status === 'error') {
    const notSetUp = portalNotSetUp(state.error);
    return notSetUp ? <PtNotSetUp info={notSetUp} /> : <LoadError error={state.error} onRetry={onRetry} />;
  }
  return <>{children(state.data)}</>;
}

/** One cursor page: the first has no cursor (docs/BACKEND.md, cursor paging over all hotels). */
export interface AccountQuery {
  search: string;
  limit: 25;
  cursor?: string;
}

export interface AccountListProps<T extends { id: string }, S> {
  /** One line under the page title: what this page is for. */
  sub: string;
  searchPlaceholder: string;
  fetch: (q: AccountQuery) => Promise<DashResult<Page<T> & S>>;
  /** Re-reads the list when any of these change (for example the ledger's period). */
  deps?: readonly unknown[];
  /** The page's one main action, beside the search; a function draws it from the first page's answer (Pay all due with its amount). */
  actions?: ReactNode | ((data: Page<T> & S) => ReactNode);
  /** A line above the list that says how the page works (where paying is done). */
  note?: ReactNode | ((data: Page<T> & S) => ReactNode);
  /** The list's tabs (status, period), in the filter bar on every screen size. */
  tabs?: {
    label: string;
    items: FilterTab[];
    active: string;
    onTab: (id: string) => void;
  };
  /** The figures row, from the server's own totals. */
  summary: (data: Page<T> & S) => ReactNode;
  row: (row: T, showHotel: boolean, data: Page<T> & S) => ReactNode;
  empty: { icon: string; title: string; text: string; filteredText: string };
  /** "3 bills" in the filter bar. */
  count: (total: number) => string;
}

export function AccountList<T extends { id: string }, S>({
  sub,
  searchPlaceholder,
  fetch,
  deps = [],
  actions,
  note,
  tabs,
  summary,
  row,
  empty,
  count,
}: AccountListProps<T, S>) {
  const [typed, setTyped] = useState('');
  const search = useDebounced(typed.trim(), 250);
  const showHotel = usePortalHotel() === PORTAL_ALL_HOTELS;
  const list = useCursorList<T, Page<T> & S & PortalPartial>((cursor) => fetch({ search, limit: CURSOR_LIMIT, cursor }), [search, ...deps]);
  const data = list.head;

  return (
    <div className="cp-page">
      <PageHead sub={sub}>
        <ListSearch value={typed} onChange={setTyped} onClear={() => setTyped('')} placeholder={searchPlaceholder} />
        {typeof actions === 'function' ? (data ? actions(data) : null) : actions}
      </PageHead>

      {list.state.status === 'error' ? (
        (() => {
          const notSetUp = portalNotSetUp(list.state.error);
          return notSetUp ? <PtNotSetUp info={notSetUp} /> : <LoadError error={list.state.error} onRetry={list.reload} />;
        })()
      ) : !data ? (
        <PageSkeleton />
      ) : (
        <>
          <UnavailableNote hotels={data.unavailable} />
          {summary(data)}
          {typeof note === 'function' ? note(data) : note}
          {tabs ? (
            <FilterBar
              tabsLabel={tabs.label}
              tabs={tabs.items}
              active={tabs.active}
              onTab={tabs.onTab}
              summary={count(data.total)}
              onReset={search ? () => setTyped('') : undefined}
            />
          ) : data.items.length > 0 ? (
            <div className="cp-count">
              <span aria-live="polite">{count(data.total)}</span>
              {search ? (
                <Button variant="ghost" size="sm" icon="arrow-counterclockwise" onClick={() => setTyped('')}>
                  {cpWords.list.clearSearch}
                </Button>
              ) : null}
            </div>
          ) : null}
          {data.items.length === 0 ? (
            <div className="card cp-empty-card">
              <EmptyState icon={search ? 'search' : empty.icon} title={search ? cpWords.list.noMatch : empty.title}text={search ? empty.filteredText : empty.text}>
                {search ? (
                  <Button variant="outline" className="mt-3" onClick={() => setTyped('')}>
                    {cpWords.list.clearSearch}
                  </Button>
                ) : null}
              </EmptyState>
            </div>
          ) : (
            <div className="cp-rows">
              {list.items.map((r) => (
                <div key={r.id}>{row(r, showHotel, data)}</div>
              ))}
              <LoadMore list={list} total={data.total} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
