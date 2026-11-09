'use client';

// group.admins (params { status?, hotelId? }): the Hotel Admins of the hotels in this group. Locked accounts are called out in one line above
// the list; status tabs, a hotel filter, one card per admin (Unlock or Enable, Reset password, Disable in More), a server pager.
import { useMemo, useState } from 'react';

import { groupCopy } from '@shared/dashboards/groupCopy';

import type { ScreenProps } from '../../types';
import { useDebounced } from '@/components/ui';
import { Button, EmptyState, FilterBar, FilterMenu, PageHead, Pager, SearchField, pagerView } from '@/dashboards/pallav/ui';
import { StaleNote, Wait, useLoaded } from '../payrollCore/load';
import { useTabStrip } from '../platform/superParts';
import { groupApiFor } from './api';
import { AdminCard, useAdminAsk } from './parts';

const A = groupCopy.admins;

type Tab = 'all' | 'active' | 'locked' | 'disabled';
const TABS: Tab[] = ['all', 'active', 'locked', 'disabled'];
const DOTS: Partial<Record<Tab, 'paid' | 'due' | 'muted'>> = { active: 'paid', locked: 'due', disabled: 'muted' };
const startTab = (v: string | undefined): Tab => (v === 'active' || v === 'locked' || v === 'disabled' ? v : 'all');

export function GroupAdmins({ user, params }: ScreenProps) {
  const api = useMemo(() => groupApiFor(user), [user]);
  const [tab, setTab] = useState<Tab>(() => startTab(params.status));
  const [hotelId, setHotelId] = useState(params.hotelId ?? '');
  const [typed, setTyped] = useState('');
  const search = useDebounced(typed.trim(), 250);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((n) => n + 1);
  const ask = useAdminAsk(api, refresh);

  const { data, error, reload } = useLoaded(
    () => api.myHotelAdmins({ status: tab, hotelId: hotelId || undefined, search, page, pageSize, liveOnly: true }),
    [api, tab, hotelId, search, page, pageSize, version],
  );
  const hotels = useLoaded(() => api.myHotels({ pageSize: 500 }), [api]);
  const hotelList = hotels.data?.items ?? [];
  const filtered = tab !== 'all' || hotelId !== '' || typed.trim() !== '';
  const reset = () => {
    setTyped('');
    setTab('all');
    setHotelId('');
    setPage(1);
  };
  const view = data
    ? {
        ...pagerView(data, { setPage }),
        setPerPage: (n: number) => {
          setPageSize(n);
          setPage(1);
        },
      }
    : null;
  const nothingAtAll = !!data && data.counts.all === 0 && !filtered;
  const strip = useTabStrip(tab, !!data && !nothingAtAll);
  const lockedCount = data?.counts.locked ?? 0;

  return (
    <>
      <PageHead className="reveal" sub={A.subtitle}>
        <SearchField
          wrapClass="pay-toolbar"
          smart
          clear
          value={typed}
          placeholder={A.search}
          label={A.searchLabel}
          onChange={(v) => {
            setTyped(v);
            setPage(1);
          }}
        />
      </PageHead>

      {!data || !view ? (
        <Wait error={error} onRetry={reload} tiles={false} rows={5} />
      ) : nothingAtAll ? (
        <div className="card reveal">
          <EmptyState icon="people" title={A.empty.title} text={A.empty.body} />
        </div>
      ) : (
        <>
          <StaleNote error={error} onRetry={reload} />
          {lockedCount > 0 && tab !== 'locked' ? (
            <div className="hm-queue pf-ontheway reveal">
              <div className="hm-q">
                <i className="hm-dot tone-warn" aria-hidden="true" />
                <div className="hm-q-text">
                  <b>{A.lockedLine(lockedCount)}</b>
                  <small>{A.lockedNote}</small>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  icon="lock"
                  onClick={() => {
                    setTab('locked');
                    setPage(1);
                  }}
                >
                  {A.showLocked}
                </Button>
              </div>
            </div>
          ) : null}
          <div className="d-contents" ref={strip}>
            <FilterBar
              tabsLabel={A.tabsLabel}
              tabs={TABS.map((id) => ({ id, label: A.tabs[id], count: data.counts[id], dot: DOTS[id] }))}
              active={tab}
              onTab={(id) => {
                setTab(startTab(id));
                setPage(1);
              }}
              summary={`${A.shown(data.total)}. ${A.scopeNote}`}
              onReset={filtered ? reset : undefined}
            >
              <FilterMenu
                label={A.hotelFilter}
                icon="building"
                any={A.allHotels}
                ariaLabel={A.hotelFilter}
                value={hotelId}
                options={hotelList.map((h) => ({ value: h.id, label: h.name }))}
                onChange={(v) => {
                  setHotelId(v);
                  setPage(1);
                }}
              />
            </FilterBar>
          </div>
          {data.total === 0 ? (
            <div className="card reveal">
              <EmptyState icon="search" title={A.noMatch.title} text={A.noMatch.body}>
                <Button variant="outline" className="mt-3" onClick={reset}>
                  {A.clearFilters}
                </Button>
              </EmptyState>
            </div>
          ) : (
            <>
              <div className="reveal">
                {data.items.map((a) => (
                  <AdminCard key={a.id} admin={a} busy={ask.busy} onAsk={ask.setAsk} showHotel />
                ))}
              </div>
              <div className="card sh-pager-card">
                <Pager server view={view} />
              </div>
            </>
          )}
        </>
      )}

      {ask.dialog}
    </>
  );
}
