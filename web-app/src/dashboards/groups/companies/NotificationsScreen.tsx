'use client';

// hotel.co.notifications - Companies > Notifications: the history of what the hotel sent to its companies (newest first, search, status tabs), with "New notification"
// opening the send form on the same page. A card opens to show the message; its button goes to the page that says which company read it. Sending needs the Companies module's
// write level; reading the history needs only view.
import { useState } from 'react';

import { formatDate, formatDateTime } from '@shared/dashboards/format';
import type { Notification, NotificationStatus } from '@shared/dashboards/notifications';
import { notificationsCopy } from '@shared/dashboards/notificationsCopy';
import { userMayEdit } from '@shared/dashboards/features';

import { useDebounced, usePageSize } from '@/components/ui';
import { Bi, Button, DetailCard, EmptyState, FilterBar, ListSearch, Pager, StatusChip, pagerView } from '@/dashboards/pallav/ui';
import type { ScreenProps } from '../../types';
import { StaleNote, Wait, useLoaded } from '../payrollCore/load';
import { notificationsApi } from '../notifications/api';
import { NotificationForm } from './NotificationForm';
import { Page } from './pageParts';

const T = notificationsCopy.hotel;
const STATUS_TONE: Record<NotificationStatus, 'ok' | 'neutral' | 'warn'> = { active: 'ok', expired: 'neutral', withdrawn: 'warn' };
const TABS: ('all' | NotificationStatus)[] = ['all', 'active', 'expired', 'withdrawn'];

export function NotificationsScreen({ navigate }: ScreenProps) {
  const mayEdit = userMayEdit('companies');
  const [typed, setTyped] = useState('');
  const search = useDebounced(typed.trim(), 250);
  const [tab, setTab] = useState<'all' | NotificationStatus>('all');
  const [page, setPage] = useState(1);
  const pageSize = usePageSize(25);
  const [version, setVersion] = useState(0);
  const [composing, setComposing] = useState(false);
  const loaded = useLoaded(() => notificationsApi.list({ search, status: tab === 'all' ? undefined : tab, page, pageSize }), [search, tab, page, pageSize, version]);
  const data = loaded.data;

  if (composing) {
    return (
      <NotificationForm
        onBack={() => setComposing(false)}
        onSent={(id) => {
          setComposing(false);
          setVersion((n) => n + 1);
          navigate('hotel.co.notification', { id });
        }}
      />
    );
  }
  if (!data) return <Wait error={loaded.error} onRetry={loaded.reload} tiles={false} />;

  const add = mayEdit ? (
    <Button icon="bell" onClick={() => setComposing(true)}>
      {T.add}
    </Button>
  ) : null;
  const filtering = search !== '' || tab !== 'all';

  return (
    <Page
      sub={T.subtitle}
      headActions={
        <div className="sh-head-actions">
          <ListSearch
            value={typed}
            onChange={(v) => {
              setTyped(v);
              setPage(1);
            }}
            onClear={() => {
              setTyped('');
              setPage(1);
            }}
            placeholder={T.search}
          />
          {add}
        </div>
      }
      grid={false}
    >
      <StaleNote error={loaded.error} onRetry={loaded.reload} />
      <FilterBar
        tabsLabel="Status"
        tabs={TABS.map((id) => ({ id, label: T.filters[id] }))}
        active={tab}
        onTab={(id) => {
          setTab(id as 'all' | NotificationStatus);
          setPage(1);
        }}
        summary={T.count(data.total)}
        onReset={filtering ? () => { setTyped(''); setTab('all'); setPage(1); } : undefined}
      />
      {data.items.length === 0 ? (
        <div className="card reveal">
          <EmptyState icon="bell" title={filtering ? T.noMatch.title : T.empty.title} text={filtering ? T.noMatch.body : T.empty.body}>
            {!filtering ? <div className="mt-3">{add}</div> : null}
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="hu-dc-list reveal">
            {data.items.map((n) => (
              <NotificationCard key={n.id} n={n} onOpen={() => navigate('hotel.co.notification', { id: n.id })} />
            ))}
          </div>
          <Pager server view={pagerView(data, { setPage })} />
        </>
      )}
    </Page>
  );
}

function NotificationCard({ n, onOpen }: { n: Notification; onOpen: () => void }) {
  const pct = n.targetCount > 0 ? Math.round((n.readCount / n.targetCount) * 100) : 0;
  return (
    <DetailCard
      className="hu-dc hu-notice"
      label={n.title}
      warn={n.priority === 'important' && n.status === 'active'}
      lead={
        <>
          <span className={`hu-avatar hu-notice-ic${n.priority === 'important' ? ' is-important' : ''}`} aria-hidden="true"><Bi name={n.priority === 'important' ? 'exclamation-lg' : 'bell'} /></span>
          <StatusChip tone={STATUS_TONE[n.status]}>{T.status[n.status]}</StatusChip>
        </>
      }
      facts={[
        { label: T.columns.title, value: n.title, sub: T.sentBy(n.createdBy, formatDateTime(n.createdAt)), wide: true },
        { label: T.columns.audience, value: n.audienceLabel, text: true },
        { label: T.columns.read, value: <span className="hu-meter"><span className="hu-meter-bar"><span style={{ width: `${pct}%` }} /></span>{T.readOf(n.readCount, n.targetCount)}</span> },
      ]}
      sections={[
        { icon: 'chat-left-text', title: T.columns.title, wide: true, content: <pre className="mk-body">{n.body}</pre> },
      ]}
      meta={[n.priority === 'important' ? T.important : null, n.expiresAt ? T.expires(formatDate(n.expiresAt)) : null].filter(Boolean).join(' · ') || undefined}
      actions={<Button size="sm" icon="eye" onClick={onOpen}>{T.open}</Button>}
    />
  );
}