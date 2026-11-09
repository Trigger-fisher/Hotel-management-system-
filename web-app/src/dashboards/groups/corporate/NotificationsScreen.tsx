'use client';

// corporate.notifications, "Notices": what the hotels sent to this company, newest first, grouped by day; information, apart from paying. One layout for
// every screen size: the filter bar (All, Unread with its count, Read), then one DetailCard per notice (time and New at the left, gold edge while unread,
// amber when important); opened, the full text, the page it points at and Mark as read. Withdrawn and expired notices are not sent here by the server.
import { Fragment, useState } from 'react';

import { formatDate, formatDateTime, formatTime } from '@shared/dashboards/format';
import type { PortalNotification, PortalNotificationPage } from '@shared/dashboards/notifications';
import { notificationsPortalCopyByLanguage } from '@shared/dashboards/notificationsCopy.lang';
import { PORTAL_ALL_HOTELS } from '@shared/dashboards/portalHotel';

import { useAction, useDebounced, useToast } from '@/components/ui';
import { Button, DetailCard, EmptyState, FilterBar, ListSearch, PageHead } from '@/dashboards/pallav/ui';
import { tr, useCopy } from '@/lib/i18n/language';
import type { ScreenProps } from '../../types';
import { portalNotificationsApi } from '../notifications/api';
import { DesktopAlertsSwitch } from '../notifications/NoticeToaster';
import { adjustPortalUnread, refreshPortalUnread } from '../notifications/unread';
import { CURSOR_LIMIT, LoadMore, useCursorList } from '../portal/AppKit';
import { UnavailableNote } from '../portal/HotelParts';
import { usePortalHotel } from '../portal/HotelSwitch';
import { PortalLoad } from './AccountList';
import { CpSec } from './cpParts';
import { cpWords } from './words';

type Tab = 'all' | 'unread' | 'read';
type Stamped = PortalNotificationPage & { today: string; yesterday: string };
const W = cpWords.notices;

/** The day of a moment in India time (the hotels' clock): 'YYYY-MM-DD'. */
const dayOf = (iso?: string): string => (iso ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(iso)) : '');

async function loadPage(q: Parameters<typeof portalNotificationsApi.list>[0]) {
  const res = await portalNotificationsApi.list(q);
  if (!res.ok) return res;
  const now = Date.now();
  return { ok: true as const, data: { ...res.data, today: dayOf(new Date(now).toISOString()), yesterday: dayOf(new Date(now - 86_400_000).toISOString()) } };
}

export function CorporateNotificationsScreen({ navigate }: ScreenProps) {
  const T = useCopy(notificationsPortalCopyByLanguage);
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('all');
  const [version, setVersion] = useState(0);
  const showHotel = usePortalHotel() === PORTAL_ALL_HOTELS;
  const { busy, run } = useAction();
  const [typed, setTyped] = useState('');
  const search = useDebounced(typed.trim(), 250);
  const list = useCursorList<PortalNotification, Stamped>((cursor) => loadPage({ unread: tab === 'unread', read: tab === 'read', search: search || undefined, limit: CURSOR_LIMIT, cursor }), [tab, version, search]);
  const changed = () => {
    setVersion((n) => n + 1);
    void refreshPortalUnread();
  };
  const data = list.state.status === 'ready' ? list.state.data : null;
  const unread = data?.unread ?? 0;

  const markOne = (n: PortalNotification) =>
    void run(() => portalNotificationsApi.markRead(n.id), {
      onOk: () => {
        adjustPortalUnread(-1);
        changed();
      },
    });
  const markAll = () =>
    void run(() => portalNotificationsApi.markAllRead(), {
      onOk: (r) => {
        toast.show({ tone: 'success', text: T.markAllDone(r.marked) });
        adjustPortalUnread(-r.marked);
        changed();
      },
    });
  const open = (n: PortalNotification) => {
    if (!n.linkView) return;
    if (n.readAt === null) {
      adjustPortalUnread(-1);
      void portalNotificationsApi.markRead(n.id).then(() => refreshPortalUnread());
    }
    navigate(n.linkView, n.linkId ? { id: n.linkId } : {});
  };
  const dayLabel = (iso: string, p: Stamped) => {
    const day = dayOf(iso);
    return day === p.today ? 'Today' : day === p.yesterday ? 'Yesterday' : formatDate(day);
  };
  const empty = tab === 'unread' ? T.emptyUnread : tab === 'read' ? T.emptyRead : T.empty;

  return (
    <div className="cp-page">
      <PageHead sub={T.subtitle}>
        <ListSearch value={typed} onChange={setTyped} onClear={() => setTyped('')} placeholder={tr('Search notices')} />
        <DesktopAlertsSwitch />
        {unread > 0 ? (
          <Button icon="check2-all" disabled={busy} onClick={markAll}>
            {T.markAll}
          </Button>
        ) : null}
      </PageHead>
      <PortalLoad state={list.state} onRetry={list.reload}>
        {(p: Stamped) => (
          <>
            <UnavailableNote hotels={p.unavailable} />
            <FilterBar
              tabsLabel="Show"
              tabs={[
                { id: 'all', label: T.filters.all },
                { id: 'unread', label: T.filters.unread, count: unread > 0 ? unread : undefined },
                { id: 'read', label: T.filters.read },
              ]}
              active={tab}
              onTab={(id) => setTab(id as Tab)}
              summary={unread > 0 ? W.unreadLine(unread) : W.allRead}
              onReset={search ? () => setTyped('') : undefined}
            />
            {p.items.length === 0 ? (
              <div className="card">
                {search ? (
                  <EmptyState icon="search" title={cpWords.list.noMatch}>
                    <Button variant="outline" className="mt-3" onClick={() => setTyped('')}>
                      {cpWords.list.clearSearch}
                    </Button>
                  </EmptyState>
                ) : (
                  <EmptyState icon={tab === 'unread' ? 'check2-circle' : 'bell'} title={empty.title} text={empty.body} />
                )}
              </div>
            ) : (
              <div className="cp-rows">
                {list.items.map((n, i) => (
                  <Fragment key={n.id}>
                    {dayOf(n.createdAt) !== dayOf(list.items[i - 1]?.createdAt) ? <CpSec title={dayLabel(n.createdAt, p)} /> : null}
                    <Notice n={n} showHotel={showHotel} busy={busy} onOpen={() => open(n)} onRead={() => markOne(n)} />
                  </Fragment>
                ))}
                <LoadMore list={list} total={p.total} />
              </div>
            )}
          </>
        )}
      </PortalLoad>
    </div>
  );
}

function Notice({ n, showHotel, busy, onOpen, onRead }: { n: PortalNotification; showHotel: boolean; busy: boolean; onOpen: () => void; onRead: () => void }) {
  const T = useCopy(notificationsPortalCopyByLanguage);
  const isNew = n.readAt === null;
  const important = n.priority === 'important';
  return (
    <DetailCard
      label={n.title}
      className={`cp-nt${isNew ? ' is-new' : ''}`}
      warn={important}
      lead={{ big: formatTime(n.createdAt), tag: isNew ? T.newBadge : undefined, title: formatDateTime(n.createdAt) }}
      facts={[
        { label: important ? T.important : 'Notice', value: n.title, sub: n.body, wide: true, tone: important ? 'warn' : undefined },
        ...(showHotel ? [{ label: W.from, value: n.hotelName }] : []),
      ]}
      sections={[{ icon: 'bell', title: 'Notice', wide: true, content: <p className="cp-nt-text">{n.body}</p> }]}
      meta={`${tr(W.sent)} ${formatDateTime(n.createdAt)}${showHotel ? '' : ` · ${n.hotelName}`}`}
      actions={
        n.linkView || isNew ? (
          <>
            {isNew ? (
              <Button variant="outline" size="sm" icon="check2" disabled={busy} onClick={onRead}>
                {T.markOne}
              </Button>
            ) : null}
            {n.linkView ? (
              <Button size="sm" icon="box-arrow-up-right" onClick={onOpen}>
                {T.openLink(n.linkView)}
              </Button>
            ) : null}
          </>
        ) : undefined
      }
    />
  );
}
