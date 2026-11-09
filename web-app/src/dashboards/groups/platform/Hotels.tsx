'use client';

// platform.hotels: every hotel on the platform for the Super Admin and the Platform Admin. Status tabs with counts, Type and Group filters,
// one DetailCard per hotel (the summary row, the full record when opened), a server pager. Invitation links still on their way are not hotels:
// one line above the list counts them and opens the Invitations page. Row actions: Review (waiting), Enter hotel (active, audited), Details.
import { useState } from 'react';

import { formatDate, formatMonthLong } from '@shared/dashboards/format';
import { platformCopy, type PlatformHotel, type PlatformHotelKind, type PlatformHotelStatus } from '@shared/dashboards/platform';

import type { ScreenProps } from '../../types';
import { useDebounced } from '@/components/ui';
import { Bi, Button, DetailCard, DetailList, EmptyState, FilterBar, FilterMenu, PageHead, Pager, SearchField, pagerView } from '@/dashboards/pallav/ui';
import { StaleNote, Wait, useLoaded } from '../payrollCore/load';
import { platformApi } from './api';
import { EnterHotelModal, KindPill, LifecyclePill, loadHotelFacts, type HotelFacts } from './hotelParts';
import { WrapEmail, useTabStrip } from './superParts';

const t = platformCopy.hotels;
const K = platformCopy.hotelConsole;
const T = K.list;
const C = T.card;

type Tab = 'all' | PlatformHotelStatus;
const TABS: Tab[] = ['all', 'pending_approval', 'active', 'suspended', 'rejected', 'archived'];
const DOTS: Partial<Record<Tab, 'paid' | 'due' | 'settled' | 'muted'>> = { active: 'paid', suspended: 'due', pending_approval: 'settled', rejected: 'muted', archived: 'muted' };

const startTab = (v: string | undefined): Tab => (v && (TABS as string[]).includes(v) ? (v as Tab) : 'all');
const startKind = (v: string | undefined): '' | PlatformHotelKind => (v === 'individual' || v === 'group' ? v : '');

export function PlatformHotels(props: ScreenProps) {
  const { params, navigate } = props;
  const [tab, setTab] = useState<Tab>(() => startTab(params.status));
  const [kind, setKind] = useState<'' | PlatformHotelKind>(() => startKind(params.kind));
  const [groupId, setGroupId] = useState(params.groupId ?? '');
  const [created, setCreated] = useState(() => (/^\d{4}-\d{2}$/.test(params.created ?? '') ? (params.created as string) : ''));
  const [typed, setTyped] = useState('');
  const search = useDebounced(typed.trim(), 250);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [entering, setEntering] = useState<PlatformHotel | null>(null);

  const { data, error, reload } = useLoaded(
    () => platformApi.listHotels({ status: tab, kind: kind || 'all', groupId: groupId || undefined, createdMonth: created || undefined, search, page, pageSize }),
    [tab, kind, groupId, created, search, page, pageSize],
  );
  const invites = useLoaded(() => platformApi.listInvitations({ pageSize: 10_000 }), []);
  const groupAdmin = props.user.role === 'group_hotel_admin';
  const groups = useLoaded(() => (groupAdmin ? Promise.resolve({ ok: true as const, data: [] }) : platformApi.listGroups({ status: 'active' })), [groupAdmin]);
  const facts = useLoaded(() => loadHotelFacts(), []);

  const onTheWay = (invites.data?.items ?? []).filter(
    (i) =>
      i.type !== 'group' &&
      (i.status === 'sent' || i.status === 'opened') &&
      (!kind || (i.type === 'member_hotel' ? 'group' : 'individual') === kind) &&
      (!groupId || i.groupId === groupId),
  ).length;

  const inviteHotel = () => navigate('platform.invitations', { invite: '1' });
  const reset = () => {
    setTyped('');
    setTab('all');
    setKind('');
    setGroupId('');
    setCreated('');
    setPage(1);
  };
  const filtered = tab !== 'all' || kind !== '' || groupId !== '' || created !== '' || typed.trim() !== '';
  const nothingAtAll = !!data && data.counts.all === 0 && data.counts.archived === 0 && onTheWay === 0 && !filtered;
  const strip = useTabStrip(tab, !!data && !nothingAtAll);

  const view = data
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
        <SearchField
          wrapClass="pay-toolbar"
          smart
          clear
          value={typed}
          placeholder={T.searchPlaceholder}
          label={t.searchLabel}
          onChange={(v) => {
            setTyped(v);
            setPage(1);
          }}
        />
        <Button icon="envelope-plus" className="sh-new" onClick={inviteHotel}>
          {t.inviteHotel}
        </Button>
      </PageHead>

      {!data || !view ? (
        <Wait error={error} onRetry={reload} tiles={false} rows={6} />
      ) : nothingAtAll ? (
        <>
          <StaleNote error={error} onRetry={reload} />
          <div className="card reveal">
            <EmptyState icon="building-add" title={t.empty.title} text={t.empty.body}>
              <Button icon="envelope-plus" className="mt-3" onClick={inviteHotel}>
                {t.inviteHotel}
              </Button>
            </EmptyState>
          </div>
        </>
      ) : (
        <>
          <StaleNote error={error} onRetry={reload} />
          {facts.error && !facts.data ? (
            <div className="alert alert-warning d-flex flex-wrap align-items-center gap-2" role="alert">
              <Bi name={facts.error.code === 'NETWORK_OFFLINE' ? 'wifi-off' : 'exclamation-triangle'} />
              <span className="flex-grow-1">{T.factsError}</span>
              <Button variant="outline" size="sm" icon="arrow-clockwise" onClick={facts.reload}>
                {platformCopy.hotel.tryAgain}
              </Button>
            </div>
          ) : null}

          {onTheWay > 0 && !groupAdmin ? (
            <div className="hm-queue pf-ontheway reveal">
              <div className="hm-q">
                <i className="hm-dot tone-info" aria-hidden="true" />
                <div className="hm-q-text">
                  <b>{T.onTheWay(onTheWay)}</b>
                  <small>{T.onTheWayNote}</small>
                </div>
                <Button variant="outline" size="sm" icon="envelope-paper" onClick={() => navigate('platform.invitations', { status: 'pending' })}>
                  {T.openInvitations}
                </Button>
              </div>
            </div>
          ) : null}

          <div className="d-contents" ref={strip}>
            <FilterBar
              tabsLabel={t.tabsLabel}
              tabs={TABS.map((id) => ({ id, label: id === 'all' ? t.tabs.all : K.lifecycle[id], count: id === 'all' ? data.counts.all : data.counts[id], dot: DOTS[id] }))}
              active={tab}
              onTab={(id) => {
                setTab(startTab(id));
                setPage(1);
              }}
              summary={created ? T.createdIn(formatMonthLong(created)) : tab === 'all' ? T.archivedHidden : T.shown(data.total)}
              onReset={filtered ? reset : undefined}
            >
              {groupAdmin ? null : (
                <FilterMenu
                  label={T.typeFilter}
                  icon="diagram-2"
                  any={T.allTypes}
                  ariaLabel={T.typeFilter}
                  value={kind}
                  options={(['individual', 'group'] as const).map((k) => ({ value: k, label: K.kind[k], count: data.kindCounts[k] }))}
                  onChange={(v) => {
                    setKind(startKind(v));
                    setPage(1);
                  }}
                />
              )}
              {groupAdmin ? null : (
                <FilterMenu
                  label={T.groupFilter}
                  icon="diagram-3"
                  any={T.allGroups}
                  ariaLabel={T.groupFilter}
                  value={groupId}
                  options={(groups.data ?? []).map((g) => ({ value: g.id, label: g.name }))}
                  onChange={(v) => {
                    setGroupId(v);
                    setPage(1);
                  }}
                />
              )}
            </FilterBar>
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
                    facts={facts.data ? (facts.data[h.id] ?? null) : undefined}
                    onEnter={() => setEntering(h)}
                    onOpen={() => navigate('platform.hotel', { id: h.id })}
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

      {entering ? <EnterHotelModal props={props} hotel={entering} onClose={() => setEntering(null)} /> : null}
    </>
  );
}

/** One hotel: who it is, its type, its admin and its last activity; opened, the full record. facts undefined = still loading or failed. */
function HotelCard({ hotel: h, facts: x, onEnter, onOpen }: { hotel: PlatformHotel; facts: HotelFacts | null | undefined; onEnter: () => void; onOpen: () => void }) {
  const known = x !== undefined;
  const dash = K.dashboard.notAvailable;
  const place = [h.city, h.state].filter(Boolean).join(', ');
  const noAdmin = known && !x?.adminEmail;
  const users = known ? T.fit.users(x?.userCount ?? 0) : dash;
  const activity = known ? (x?.lastActivityAt ? formatDate(x.lastActivityAt) : T.fit.noActivity) : dash;
  return (
    <DetailCard
      label={`${C.hotel} ${h.name}`}
      leadWidth="lg"
      className="pf-hotel"
      warn={h.lockedAdminCount > 0 || (noAdmin && h.status === 'active')}
      lead={
        <>
          <span className="pf-kind" aria-hidden="true">
            <Bi name={h.kind === 'group' ? 'diagram-3' : 'building'} />
          </span>
          <LifecyclePill status={h.status} />
        </>
      }
      facts={[
        { label: C.hotel, value: h.name, sub: place || C.notGiven },
        { label: C.type, value: K.kind[h.kind], sub: h.groupName ?? undefined },
        {
          label: C.admin,
          value: known ? (x?.adminEmail ? <WrapEmail email={x.adminEmail} /> : T.noAdmin) : dash,
          title: x?.adminEmail ?? undefined,
          tone: noAdmin ? 'warn' : undefined,
          sub: h.lockedAdminCount > 0 ? <><Bi name="lock-fill" /> {t.lockedCount(h.lockedAdminCount)}</> : users,
        },
        { label: C.activity, value: activity, sub: C.createdOn(formatDate(h.createdAt)), tone: known && !x?.lastActivityAt ? 'muted' : undefined },
      ]}
      sections={[
        {
          icon: 'building',
          title: C.aboutHotel,
          content: (
            <DetailList
              items={[
                { label: C.webAddress, value: h.slug || C.notGiven },
                { label: C.gstin, value: h.gstin || C.notGiven },
                { label: C.place, value: place || C.notGiven },
                { label: C.created, value: formatDate(h.createdAt) },
              ]}
            />
          ),
        },
        {
          icon: 'person-badge',
          title: C.aboutAdmin,
          tone: noAdmin || h.lockedAdminCount > 0 ? 'warn' : undefined,
          content: (
            <DetailList
              items={[
                { label: C.email, value: known ? (x?.adminEmail ? <WrapEmail email={x.adminEmail} /> : T.noAdmin) : dash },
                { label: C.users, value: users },
                { label: C.locked, value: String(h.lockedAdminCount) },
                { label: C.activity, value: activity },
              ]}
            />
          ),
        },
        {
          icon: 'diagram-3',
          title: C.aboutGroup,
          content: (
            <DetailList
              items={[
                { label: C.type, value: <KindPill kind={h.kind} /> },
                { label: C.group, value: h.groupName ?? T.individual },
              ]}
            />
          ),
        },
      ]}
      actions={
        <>
          {h.status === 'pending_approval' ? (
            <Button size="sm" icon="clipboard-check" title={T.reviewTitle(h.name)} onClick={onOpen}>
              {T.review}
            </Button>
          ) : null}
          {h.status === 'active' ? (
            <Button variant="outline" size="sm" icon="box-arrow-in-right" title={t.enterTitle(h.name)} onClick={onEnter}>
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
