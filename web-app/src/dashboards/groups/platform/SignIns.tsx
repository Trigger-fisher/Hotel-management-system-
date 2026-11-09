'use client';

// platform.signins (Super Admin): every sign-in across the platform, newest first, one card each. Result tabs with counts and one search;
// a locked-out sign-in leads to the locked accounts in All users, where it is unlocked.
import { useState } from 'react';

import { formatDateTime } from '@shared/dashboards/format';
import { platformCopy, type PlatformSignIn, type PlatformSignInResult } from '@shared/dashboards/platform';

import type { ScreenProps } from '../../types';
import { useDebounced } from '@/components/ui';
import { Bi, Button, DetailCard, DetailList, EmptyState, FilterBar, PageHead, Pager, SearchField, pagerView, type TableView } from '@/dashboards/pallav/ui';
import { StaleNote, Wait, useLoaded } from '../payrollCore/load';
import { platformApi } from './api';
import { LevelPill, SuperOnly, When } from './superParts';

const T = platformCopy.signIns;
const R = platformCopy.status.signIn;

type Tab = 'all' | PlatformSignInResult;
const TABS: Tab[] = ['all', 'success', 'failed', 'locked'];
const startTab = (v: string | undefined): Tab => (TABS.includes(v as Tab) ? (v as Tab) : 'all');

const PILL: Record<PlatformSignInResult, [string, string]> = {
  success: ['pay-paid', 'check-circle'],
  failed: ['pay-hold', 'x-circle'],
  locked: ['pay-failed', 'lock-fill'],
};

export function PlatformSignIns(props: ScreenProps) {
  if (props.user.role !== 'super_admin') return <SuperOnly />;
  return <SignInList {...props} />;
}

function SignInList({ params, navigate }: ScreenProps) {
  const [tab, setTab] = useState<Tab>(() => startTab(params.result));
  const [typed, setTyped] = useState('');
  const search = useDebounced(typed.trim(), 250);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const { data, error, reload } = useLoaded(() => platformApi.listSignIns({ result: tab, search, page, pageSize }), [tab, search, page, pageSize]);

  const reset = () => {
    setTyped('');
    setTab('all');
    setPage(1);
  };
  const filtered = tab !== 'all' || typed.trim() !== '';

  const view: TableView<PlatformSignIn> | null = data
    ? {
        ...pagerView(data, { setPage }),
        setPerPage: (n: number) => {
          setPageSize(n);
          setPage(1);
        },
      }
    : null;

  return (
    <>
      <PageHead className="reveal" sub={T.subtitle}>
        {/* pay-toolbar, as All users and Audit log: the same field size on every Super Admin list (log-search drew a larger box). */}
        <SearchField
          wrapClass="pay-toolbar"
          clear
          value={typed}
          placeholder={T.searchPlaceholder}
          label={T.searchLabel}
          onChange={(v) => {
            setTyped(v);
            setPage(1);
          }}
        />
      </PageHead>

      {!data || !view ? (
        <Wait error={error} onRetry={reload} tiles={false} rows={8} />
      ) : data.counts.all === 0 && search === '' ? (
        <>
          <StaleNote error={error} onRetry={reload} />
          <div className="card reveal">
            <EmptyState icon="box-arrow-in-right" title={T.empty.title} text={T.empty.body} />
          </div>
        </>
      ) : (
        <>
          <StaleNote error={error} onRetry={reload} />
          <FilterBar
            tabsLabel={T.tabsLabel}
            tabs={TABS.map((id) => ({ id, label: T.tabs[id], count: data.counts[id], dot: id === 'success' ? 'paid' : id === 'failed' ? 'muted' : id === 'locked' ? 'due' : undefined }))}
            active={tab}
            onTab={(id) => {
              setTab(startTab(id));
              setPage(1);
            }}
            summary={T.summary(data.total)}
            onReset={filtered ? reset : undefined}
          />
          {data.total === 0 ? (
            <div className="card reveal">
              <EmptyState icon="search" title={T.noMatch.title} text={T.noMatch.body}>
                <Button variant="outline" className="mt-3" onClick={reset}>
                  {T.clearFilters}
                </Button>
              </EmptyState>
            </div>
          ) : (
            <>
              <div className="reveal">
                {data.items.map((r) => (
                  <SignInCard key={r.id} r={r} onLocked={() => navigate('platform.users', { status: 'locked' })} />
                ))}
              </div>
              <div className="card sh-pager-card">
                <Pager server view={view} />
              </div>
            </>          )}
        </>
      )}
    </>
  );
}

function SignInCard({ r, onLocked }: { r: PlatformSignIn; onLocked: () => void }) {
  const K = platformCopy.signInsPage;
  const [cls, glyph] = PILL[r.result];
  return (
    <DetailCard
      label={`${K.signIn} ${r.name ?? r.username}`}
      className="pf-admin"
      warn={r.result === 'locked'}
      lead={
        <span className={`pay-pill ${cls}`}>
          <Bi name={glyph} />
          {R[r.result]}
        </span>
      }
      facts={[
        { label: K.when, value: <When iso={r.at} /> },
        { label: K.person, value: r.name ?? T.unknownUser, sub: r.username },
        { label: K.where, value: r.hotelName ?? T.noHotel, sub: r.level ? <LevelPill level={r.level} /> : undefined },
        { label: K.reason, value: r.reason ?? undefined, empty: K.noReason, tone: r.result === 'success' ? 'muted' : undefined },
      ]}
      sections={[
        {
          icon: 'laptop',
          title: K.from,
          content: (
            <DetailList
              items={[
                { label: K.device, value: r.device },
                { label: K.ip, value: <span className="pf-mono">{r.ip}</span> },
                { label: K.at, value: formatDateTime(r.at) },
              ]}
            />
          ),
        },
      ]}
      actions={
        r.result === 'locked' ? (
          <Button size="sm" icon="unlock" onClick={onLocked}>
            {K.unlock}
          </Button>
        ) : undefined
      }
    />
  );
}
