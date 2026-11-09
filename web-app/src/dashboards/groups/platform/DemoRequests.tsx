'use client';

// platform.demoRequests (Super Admin): hotels that asked for a demo on the product website, newest first, one card each.
import { useState } from 'react';

import { DEMO_REQUEST_STATUSES, demoRequestCopy as T, type DemoRequest, type DemoRequestStatus } from '@shared/dashboards/demoRequests';
import { formatDateTime } from '@shared/dashboards/format';
import { platformCopy } from '@shared/dashboards/platform';

import type { ScreenProps } from '../../types';
import { useToast } from '@/components/ui';
import { Bi, Button, DetailCard, DetailList, DetailNone, EmptyState, FilterBar, PageHead, Pager, pagerView, type TableView } from '@/dashboards/pallav/ui';
import { StaleNote, Wait, useLoaded } from '../payrollCore/load';
import { PlatformInviteForm } from './InviteForm';
import { demoRequestsApi } from './demoRequestsApi';
import { SuperOnly, When } from './superParts';

const P = platformCopy.demoPage;
type Tab = 'all' | DemoRequestStatus;
const TABS: Tab[] = ['new', 'contacted', 'closed', 'all'];
const PILL: Record<DemoRequestStatus, [string, string]> = { new: ['pay-pending', 'circle-fill'], contacted: ['pay-paid', 'telephone'], closed: ['pay-hold', 'check2'] };
const NEXT: Record<DemoRequestStatus, DemoRequestStatus> = { new: 'contacted', contacted: 'closed', closed: 'new' };

export function PlatformDemoRequests(props: ScreenProps) {
  if (props.user.role !== 'super_admin') return <SuperOnly />;
  return <DemoRequestList user={props.user} />;
}

function DemoRequestList({ user }: { user: ScreenProps['user'] }) {
  const toast = useToast();
  const [inviting, setInviting] = useState<DemoRequest | null>(null);
  const [tab, setTab] = useState<Tab>('new');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [busy, setBusy] = useState<string | null>(null);
  const { data, error, reload } = useLoaded(() => demoRequestsApi.list({ status: tab, page, pageSize }), [tab, page, pageSize]);

  const move = async (r: DemoRequest) => {
    setBusy(r.id);
    const to = NEXT[r.status];
    const res = await demoRequestsApi.setStatus(r.id, to);
    setBusy(null);
    if (res.ok) {
      toast.show({ tone: 'success', text: P.moved(r.hotelName, T.status[to]) });
      reload();
    } else toast.show({ tone: 'error', text: res.error.message });
  };

  const view: TableView<DemoRequest> | null = data
    ? { ...pagerView(data, { setPage }), setPerPage: (n: number) => { setPageSize(n); setPage(1); } }
    : null;
  const all = data ? DEMO_REQUEST_STATUSES.reduce((s, k) => s + data.counts[k], 0) : 0;

  return (
    <>
      <PageHead className="reveal" sub={T.sub} />
      {!data || !view ? (
        <Wait error={error} onRetry={reload} tiles={false} rows={6} />
      ) : (
        <>
          <StaleNote error={error} onRetry={reload} />
          <FilterBar
            tabsLabel={P.tabsLabel}
            tabs={TABS.map((id) => ({ id, label: id === 'all' ? P.all : T.status[id], count: id === 'all' ? all : data.counts[id], dot: id === 'new' ? 'due' : id === 'contacted' ? 'paid' : undefined }))}
            active={tab}
            onTab={(id) => { setTab(id as Tab); setPage(1); }}
            summary={P.summary(data.total)}
          />
          {data.total === 0 ? (
            <div className="card reveal">
              <EmptyState icon="person-plus" title={tab === 'all' ? P.noneYet : T.empty[tab]} text={T.emptyText} />
            </div>
          ) : (
            <>
              <div className="reveal">
                {data.items.map((r) => (
                  <RequestCard key={r.id} r={r} busy={busy === r.id} onMove={() => void move(r)} onInvite={() => setInviting(r)} />
                ))}
              </div>
              <div className="card sh-pager-card">
                <Pager server view={view} />
              </div>
            </>
          )}
        </>
      )}
      {inviting ? (
        <PlatformInviteForm
          open
          actor={{ name: user.displayName, role: 'super_admin' }}
          initial={{ type: inviting.properties && inviting.properties > 1 ? 'group' : 'individual', hotelName: inviting.hotelName, contactName: inviting.name, email: inviting.email }}
          onClose={() => setInviting(null)}
          onSent={() => {
            const r = inviting;
            if (r.status === 'new') void demoRequestsApi.setStatus(r.id, 'contacted').then(() => reload());
            toast.show({ tone: 'success', text: P.invited(r.hotelName) });
          }}
        />
      ) : null}
    </>
  );
}

function RequestCard({ r, busy, onMove, onInvite }: { r: DemoRequest; busy: boolean; onMove: () => void; onInvite: () => void }) {
  const K = P.card;
  const [cls, glyph] = PILL[r.status];
  const size = [r.rooms ? T.rooms(r.rooms) : null, r.properties && r.properties > 1 ? T.properties(r.properties) : null, r.city].filter(Boolean).join(' · ');
  return (
    <DetailCard
      label={`${K.hotel} ${r.hotelName}`}
      leadWidth="lg"
      className="pf-hotel"
      warn={r.status === 'new'}
      lead={
        <>
          <span className="pf-kind" aria-hidden="true">
            <Bi name="building" />
          </span>
          <span className={`pay-pill ${cls}`}>
            <Bi name={glyph} />
            {T.status[r.status]}
          </span>
        </>
      }
      facts={[
        { label: K.hotel, value: r.hotelName, sub: size || undefined },
        { label: K.contact, value: r.name, sub: r.email, title: r.email },
        { label: K.received, value: <When iso={r.createdAt} /> },
        { label: K.handled, value: r.handledByName ?? undefined, empty: K.nobody, sub: r.handledAt ? formatDateTime(r.handledAt) : undefined, tone: r.handledByName ? undefined : 'muted' },
      ]}
      sections={[
        {
          icon: 'chat-left-text',
          title: K.message,
          wide: !r.phone,
          content: r.message ? <p className="pf-text mb-0">{r.message}</p> : <DetailNone>{K.noMessage}</DetailNone>,
        },
        {
          icon: 'person-lines-fill',
          title: K.reach,
          content: (
            <DetailList
              items={[
                { label: K.name, value: r.name },
                { label: K.email, value: <a href={`mailto:${r.email}`}>{r.email}</a> },
                r.phone ? { label: K.phone, value: <a href={`tel:${r.phone}`}>{r.phone}</a> } : null,
                r.city ? { label: K.city, value: r.city } : null,
              ]}
            />
          ),
        },
      ]}
      actions={
        <>
          <a className="btn btn-sm btn-ghost" href={`mailto:${r.email}`}>
            <Bi name="envelope" /> {K.writeEmail}
          </a>
          <Button size="sm" variant={r.status === 'closed' ? 'outline' : 'ghost'} busy={busy} onClick={onMove}>
            {T.markAs[NEXT[r.status]]}
          </Button>
          {r.status !== 'closed' ? (
            <Button size="sm" icon="send" disabled={busy} onClick={onInvite}>
              {P.invite}
            </Button>
          ) : null}
        </>
      }
    />
  );
}
