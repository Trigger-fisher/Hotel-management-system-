'use client';

// group.hotels, params { status? }: the member hotels of the signed-in group. Invitations still on their way are not hotels: one line above the
// list counts them and opens Invitations. Status tabs with counts, one DetailCard per hotel, a server pager. Look inside (active) and Details.
import { useMemo, useState } from 'react';

import { formatDate, formatDateTime } from '@shared/dashboards/format';
import { groupCopy } from '@shared/dashboards/groupCopy';
import type { PlatformHotel, PlatformHotelStatus } from '@shared/dashboards/platform';

import type { ScreenProps } from '../../types';
import { useDebounced } from '@/components/ui';
import { Alert, Bi, Button, DetailCard, DetailList, EmptyState, FilterBar, PageHead, Pager, SearchField, pagerView } from '@/dashboards/pallav/ui';
import { StaleNote, Wait, useLoaded } from '../payrollCore/load';
import { LifecyclePill } from '../platform/hotelParts';
import { useTabStrip } from '../platform/superParts';
import { groupApiFor } from './api';
import { GroupEnterModal, useInviteGate } from './parts';

const t = groupCopy.hotels;
const C = t.card;

type Tab = 'all' | PlatformHotelStatus;
const TABS: Tab[] = ['all', 'active', 'suspended', 'pending_approval', 'rejected', 'archived'];
const DOTS: Partial<Record<Tab, 'paid' | 'due' | 'settled' | 'muted'>> = { active: 'paid', suspended: 'due', pending_approval: 'settled', rejected: 'muted', archived: 'muted' };
const startTab = (v: string | undefined): Tab => (v && (TABS as string[]).includes(v) ? (v as Tab) : 'all');

export function GroupHotels(props: ScreenProps) {
  const { user, params, navigate } = props;
  const api = useMemo(() => groupApiFor(user), [user]);
  const [tab, setTab] = useState<Tab>(() => startTab(params.status));
  const [typed, setTyped] = useState('');
  const search = useDebounced(typed.trim(), 250);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [entering, setEntering] = useState<PlatformHotel | null>(null);

  const { data, error, reload } = useLoaded(() => api.myHotels({ status: tab, search, page, pageSize }), [api, tab, search, page, pageSize]);
  const invites = useLoaded(() => api.myInvitations({ status: 'pending', pageSize: 1 }), [api]);
  const gate = useInviteGate(api);
  const onTheWay = invites.data?.counts.pending ?? 0;
  const filtered = tab !== 'all' || typed.trim() !== '';
  const reset = () => {
    setTyped('');
    setTab('all');
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
  const nothingAtAll = !!data && data.counts.all === 0 && data.counts.archived === 0 && onTheWay === 0 && !filtered;
  const strip = useTabStrip(tab, !!data && !nothingAtAll);
  const invite = () => navigate('group.hotels.invite');
  const inviteButton = (extra = '') =>
    gate.canInvite && !gate.atLimit ? (
      <Button icon="envelope-plus" className={extra} onClick={invite}>
        {groupCopy.overview.inviteHotel}
      </Button>
    ) : null;
  const summary = [tab === 'all' ? t.archivedHidden : t.shown(data?.total ?? 0), gate.countLine ? t.limitLine(gate.countLine) : ''].filter(Boolean).join(' ');

  return (
    <>
      <PageHead className="reveal" sub={t.subtitle}>
        <SearchField
          wrapClass="pay-toolbar"
          smart
          clear
          value={typed}
          placeholder={t.search}
          label={t.searchLabel}
          onChange={(v) => {
            setTyped(v);
            setPage(1);
          }}
        />
        {inviteButton('sh-new')}
      </PageHead>

      {!data || !view ? (
        <Wait error={error} onRetry={reload} tiles={false} rows={6} />
      ) : nothingAtAll ? (
        <div className="card reveal">
          <EmptyState icon="building-add" title={t.empty.title} text={t.empty.body}>
            {inviteButton('mt-3')}
          </EmptyState>
        </div>
      ) : (
        <>
          <StaleNote error={error} onRetry={reload} />
          {gate.canInvite && gate.limitNote ? (
            <Alert tone="warning" icon="exclamation-triangle" role="status" className="reveal">
              {gate.limitNote}
            </Alert>
          ) : null}
          {onTheWay > 0 ? (
            <div className="hm-queue pf-ontheway reveal">
              <div className="hm-q">
                <i className="hm-dot tone-info" aria-hidden="true" />
                <div className="hm-q-text">
                  <b>{t.onTheWay(onTheWay)}</b>
                  <small>{t.onTheWayNote}</small>
                </div>
                <Button variant="outline" size="sm" icon="envelope-paper" onClick={() => navigate('group.invitations', { status: 'pending' })}>
                  {t.openInvitations}
                </Button>
              </div>
            </div>
          ) : null}
          <div className="d-contents" ref={strip}>
            <FilterBar
              tabsLabel={t.tabsLabel}
              tabs={TABS.map((id) => ({ id, label: t.tabs[id], count: data.counts[id], dot: DOTS[id] }))}
              active={tab}
              onTab={(id) => {
                setTab(startTab(id));
                setPage(1);
              }}
              summary={summary}
              onReset={filtered ? reset : undefined}
            />
          </div>
          {data.total === 0 ? (
            <div className="card reveal">
              <EmptyState icon="search" title={t.noMatch.title} text={t.noMatch.body}>
                <Button variant="outline" className="mt-3" onClick={reset}>
                  {t.clearFilters}
                </Button>
              </EmptyState>
            </div>
          ) : (
            <>
              <div className="reveal">
                {data.items.map((h) => (
                  <HotelCard
                    key={h.id}
                    hotel={h}
                    onEnter={() => setEntering(h)}
                    onOpen={() => navigate('group.hotel', { id: h.id })}
                    onAdmins={() => navigate('group.admins', { hotelId: h.id })}
                  />
                ))}
              </div>
              <div className="card sh-pager-card">
                <Pager server view={view} />
              </div>
            </>
          )}
        </>
      )}

      {entering ? <GroupEnterModal props={props} hotel={entering} onClose={() => setEntering(null)} /> : null}
    </>
  );
}

function HotelCard({ hotel: h, onEnter, onOpen, onAdmins }: { hotel: PlatformHotel; onEnter: () => void; onOpen: () => void; onAdmins: () => void }) {
  const place = [h.city, h.state].filter(Boolean).join(', ');
  const noAdmin = h.adminCount === 0;
  const live = h.status === 'active' || h.status === 'suspended';
  const reason = h.status === 'suspended' ? h.suspendReason : h.status === 'rejected' ? h.rejectReason : h.status === 'archived' ? h.archiveReason : null;
  const since = h.status === 'suspended' ? h.suspendedAt : h.status === 'rejected' ? h.rejectedAt : h.status === 'archived' ? h.archivedAt : null;
  return (
    <DetailCard
      label={`${C.hotel} ${h.name}`}
      leadWidth="lg"
      className="pf-hotel gc-card"
      warn={h.lockedAdminCount > 0 || (noAdmin && h.status === 'active')}
      lead={
        <>
          <span className="pf-kind" aria-hidden="true">
            <Bi name="building" />
          </span>
          <LifecyclePill status={h.status} />
        </>
      }
      facts={[
        { label: C.hotel, value: h.name, sub: place || C.notGiven },
        {
          label: C.admin,
          value: noAdmin ? C.noAdmin : t.admins(h.adminCount, 0),
          tone: noAdmin && live ? 'warn' : undefined,
          sub:
            h.lockedAdminCount > 0 ? (
              <>
                <Bi name="lock-fill" /> {C.lockedCount(h.lockedAdminCount)}
              </>
            ) : undefined,
        },
        { label: C.address, value: h.slug, text: true },
        { label: C.joined, value: formatDate(h.createdAt) },
      ]}
      sections={[
        {
          icon: 'building',
          title: C.aboutHotel,
          content: (
            <DetailList
              items={[
                { label: C.address, value: <span className="hms-wrap-any">{h.slug}</span> },
                { label: C.place, value: place || C.notGiven },
                { label: C.gstin, value: h.gstin || C.notGiven },
                { label: C.timeZone, value: h.timeZone },
                { label: C.joined, value: formatDate(h.createdAt) },
              ]}
            />
          ),
        },
        {
          icon: 'person-badge',
          title: C.aboutAdmins,
          tone: (noAdmin && live) || h.lockedAdminCount > 0 ? 'warn' : undefined,
          content: (
            <>
              <DetailList
                items={[
                  { label: C.adminCount, value: noAdmin ? C.noAdmin : String(h.adminCount) },
                  { label: C.locked, value: String(h.lockedAdminCount) },
                ]}
              />
              {h.adminCount > 0 ? (
                <Button variant="ghost" size="sm" icon="people" className="mt-2" onClick={onAdmins}>
                  {C.manageAdmins}
                </Button>
              ) : null}
            </>
          ),
        },
        ...(reason || since
          ? [
              {
                icon: 'flag',
                title: C.status,
                content: (
                  <DetailList
                    items={[
                      { label: C.status, value: <LifecyclePill status={h.status} /> },
                      since ? { label: C.since, value: formatDateTime(since) } : null,
                      reason ? { label: C.reason, value: reason } : null,
                    ]}
                  />
                ),
              },
            ]
          : []),
      ]}
      actions={
        <>
          {h.status === 'active' ? (
            <Button size="sm" icon="box-arrow-in-right" title={t.enterTitle(h.name)} onClick={onEnter}>
              {t.enter}
            </Button>
          ) : null}
          <Button variant="outline" size="sm" icon="eye" title={t.detailsTitle(h.name)} onClick={onOpen}>
            {t.details}
          </Button>
        </>
      }
    />
  );
}
