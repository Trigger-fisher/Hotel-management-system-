'use client';

// platform.health (Super Admin only): each live hotel as a card with its state and its first problem in words; opened: every problem and the checks
// (database, storage, mail, database changes, bills this month). Tiles, a Needs attention tab and Check now (audited). Open hotel is the next step.
import { useState } from 'react';

import { formatDateTime, formatINR, formatBytes } from '@shared/dashboards/format';
import { platformCopy, type PlatformHealth, type PlatformHealthRow } from '@shared/dashboards/platform';

import type { ScreenProps } from '../../types';
import { useAction } from '@/components/ui';
import { apiMode } from '@/lib/api/mode';
import { Bi, Button, DetailCard, DetailList, EmptyState, FilterBar, PageHead, Pager, useTableView } from '@/dashboards/pallav/ui';
import { HomeJobs } from '../overview/HomeJobs';
import { StaleNote, Wait, useLoaded } from '../payrollCore/load';
import { platformApi } from './api';
import { When } from './superParts';
import d from './desktop.module.css';
import { SuperOnlyCard, actAs } from './PlatformStaff';

const H = platformCopy.platformHealth;
type Tab = 'all' | 'attention';

export function PlatformHealthScreen(props: ScreenProps) {
  if (props.user.role !== 'super_admin') return <SuperOnlyCard />;
  return <HealthBody {...props} />;
}

function HealthBody({ user, navigate }: ScreenProps) {
  const [tab, setTab] = useState<Tab>('all');
  const [fresh, setFresh] = useState<PlatformHealth | null>(null);
  const { data: loaded, error, reload } = useLoaded(() => platformApi.getPlatformHealth(), []);
  const { busy, run } = useAction();
  const data = fresh && (!loaded || fresh.checkedAt >= loaded.checkedAt) ? fresh : loaded;

  const checkNow = () => {
    actAs(user);
    void run(() => platformApi.runHealthCheck(), { success: H.checked, onOk: (d) => setFresh(d) });
  };

  return (
    <>
      <PageHead className="reveal" sub={H.subtitle}>
        {data ? <span className="small text-muted me-2">{H.checkedAt(formatDateTime(data.checkedAt))}</span> : null}
        <Button icon="arrow-repeat" className="sh-new" onClick={checkNow} disabled={busy || !data}>
          {busy ? H.checking : H.checkNow}
        </Button>
      </PageHead>

      {!data ? (
        <Wait error={error} onRetry={reload} />
      ) : (
        <>
          <StaleNote error={error} onRetry={reload} />
          <HomeJobs
            label={H.tilesLabel}
            jobs={[
              { id: 'healthy', label: H.tiles.healthy, note: H.tileHints.healthy, count: data.tiles.healthy, onOpen: () => setTab('all') },
              { id: 'attention', label: H.tiles.attention, note: H.tileHints.attention, count: data.tiles.attention, hot: data.tiles.attention > 0, onOpen: () => setTab('attention') },
              { id: 'backup', label: H.tiles.noBackup, note: H.tileHints.noBackup, count: data.tiles.noBackup, hot: data.tiles.noBackup > 0, onOpen: () => setTab('attention') },
              { id: 'changes', label: H.tiles.pending, note: H.tileHints.pending(data.latestMigration), count: data.tiles.pendingMigrations, hot: data.tiles.pendingMigrations > 0, onOpen: () => setTab('attention') },
            ]}
          />

          <FilterBar
            tabsLabel={H.tabsLabel}
            tabs={[
              { id: 'all', label: H.tabs.all, count: data.rows.length },
              { id: 'attention', label: H.tabs.attention, count: data.tiles.attention, dot: 'due' },
            ]}
            active={tab}
            onTab={(id) => setTab(id === 'attention' ? 'attention' : 'all')}
          />
          {/* keyed by the tab, so a new tab starts on page 1 */}
          <Rows key={tab} rows={tab === 'attention' ? data.rows.filter((r) => r.status !== 'healthy') : data.rows} empty={data.rows.length === 0} attention={tab === 'attention'} note={apiMode() === 'mock'} onOpen={(id) => navigate('platform.hotel', { id })} />
        </>
      )}
    </>
  );
}

/** The test-version line (mock only), the card's foot: the figures are sample data. */
function SampleNote({ show }: { show: boolean }) {
  return show ? (
    <p className={`small text-muted mb-0 ${d.noteFoot}`}>
      <Bi name="info-circle" /> {H.note}
    </p>
  ) : null;
}

function Rows({ rows, empty, attention, note, onOpen }: { rows: PlatformHealthRow[]; empty: boolean; attention: boolean; note: boolean; onOpen: (id: string) => void }) {
  const view = useTableView(rows, { perPage: 25 });
  if (empty)
    return (
      <div className="card reveal">
        <EmptyState icon="building" title={H.empty.title} text={H.empty.body} />
        <SampleNote show={note} />
      </div>
    );
  if (rows.length === 0 && attention)
    return (
      <div className="card reveal">
        <EmptyState icon="check2-circle" title={H.allClear.title} text={H.allClear.body} />
        <SampleNote show={note} />
      </div>
    );
  return (
    <>
      <div className="reveal">
        {view.rows.map((r) => (
          <HealthCard key={r.hotelId} r={r} onOpen={() => onOpen(r.hotelId)} />
        ))}
      </div>
      <div className="card sh-pager-card">
        <Pager view={view} />
        <SampleNote show={note} />
      </div>
    </>
  );
}

const TONE = { healthy: 'pay-paid', attention: 'pay-pending', down: 'pay-failed' } as const;
const GLYPH = { healthy: 'check-circle', attention: 'exclamation-triangle', down: 'x-octagon' } as const;

function HealthCard({ r, onOpen }: { r: PlatformHealthRow; onOpen: () => void }) {
  const K = platformCopy.healthPage;
  return (
    <DetailCard
      label={`${K.hotel} ${r.hotelName}`}
      className="pf-hotel"
      warn={r.status !== 'healthy'}
      lead={
        <span className={`pay-pill ${TONE[r.status]}`}>
          <Bi name={GLYPH[r.status]} />
          {H.status[r.status]}
        </span>
      }
      facts={[
        { label: K.hotel, value: r.hotelName, sub: [r.city, r.hotelStatus === 'suspended' ? H.suspended : null].filter(Boolean).join(' · ') || undefined },
        { label: K.problem, value: r.problems[0] ?? K.none, tone: r.problems.length ? 'warn' : 'muted', sub: r.problems.length > 1 ? K.more(r.problems.length - 1) : undefined, wide: true },
        { label: H.columns.backup, value: r.lastBackupAt ? <When iso={r.lastBackupAt} /> : H.noBackup, tone: r.lastBackupAt ? undefined : 'warn' },
        { label: H.columns.activity, value: r.lastActivityAt ? <When iso={r.lastActivityAt} /> : H.never, tone: r.lastActivityAt ? undefined : 'muted' },
      ]}
      sections={[
        ...(r.problems.length
          ? [
              {
                icon: 'exclamation-triangle',
                title: K.problems,
                tone: 'warn' as const,
                content: (
                  <ul className="pf-problems">
                    {r.problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                ),
              },
            ]
          : []),
        {
          icon: 'activity',
          title: K.checks,
          content: (
            <DetailList
              items={[
                { label: H.columns.database, value: `${H.database[r.database]}${r.databaseMs !== null ? ` · ${H.ms(r.databaseMs)}` : ''}` },
                typeof r.storageBytes === 'number' ? { label: K.storage, value: formatBytes(r.storageBytes) } : null,
                { label: H.columns.mail, value: H.mail[r.mail] },
                { label: H.columns.migrations, value: H.migrations(r.migrationsApplied, r.migrationsPending) },
                r.bills ? { label: K.bills, value: r.bills.count === 0 ? H.bills.none : `${H.bills.count(r.bills.count)} · ${formatINR(r.bills.billedPaise)}` } : null,
              ]}
            />
          ),
        },
      ]}
      actions={
        <Button size="sm" variant={r.status === 'healthy' ? 'outline' : 'primary'} icon="building" onClick={onOpen}>
          {K.open}
        </Button>
      }
    />
  );
}
