'use client';

// platform.groups: the hotel groups of the platform for the Super Admin and the Platform Admin. Status tabs with counts (All, Active,
// Pending review, Rejected), search, one DetailCard per group, Invite group. A group invitation whose admin has not sent the form yet is
// not a group: one line above the list counts them and opens the Invitations page on group invitations.
import { useMemo, useState } from 'react';

import { formatDate } from '@shared/dashboards/format';
import { platformCopy, type PlatformGroup, type PlatformGroupStatus } from '@shared/dashboards/platform';

import type { ScreenProps } from '../../types';
import { Bi, Button, DetailCard, DetailList, EmptyState, FilterBar, PageHead, Pager, SearchField, useTableView } from '@/dashboards/pallav/ui';
import { StaleNote, Wait, useLoaded } from '../payrollCore/load';
import { platformApi } from './api';
import { PlatformInviteForm } from './InviteForm';

const g = platformCopy.groups;
const t = platformCopy.groupsList;
const C = t.card;

const NONE: PlatformGroup[] = [];

type Tab = 'all' | 'active' | 'pending' | 'rejected';
const TABS: Tab[] = ['all', 'active', 'pending', 'rejected'];
const DOTS: Partial<Record<Tab, 'paid' | 'due' | 'settled' | 'muted'>> = { active: 'paid', pending: 'due', rejected: 'muted' };
const startTab = (v: string | undefined): Tab => (v === 'active' || v === 'pending' || v === 'rejected' ? v : v === 'pending_approval' ? 'pending' : 'all');
const tabOf = (x: PlatformGroup): Exclude<Tab, 'all'> => (x.status === 'pending_approval' ? 'pending' : x.status);
const tabLabel = (id: Tab) => (id === 'all' ? platformCopy.admins.tabs.all : platformCopy.status.group[id === 'pending' ? 'pending_approval' : id]);
const matches = (x: PlatformGroup, q: string) => `${x.name} ${x.groupAdmin?.name ?? ''} ${x.groupAdmin?.hotelName ?? ''}`.toLowerCase().includes(q);

export function PlatformGroups({ user, params, navigate }: ScreenProps) {
  const { data, error, reload } = useLoaded(() => platformApi.listGroups(), []);
  const invites = useLoaded(() => platformApi.listInvitations({ type: 'group', pageSize: 500 }), []);
  const waiting = (invites.data?.items ?? []).filter((r) => r.type === 'group' && (r.status === 'sent' || r.status === 'opened' || r.status === 'expired')).length;
  const [tab, setTab] = useState<Tab>(() => startTab(params.status));
  const shown = useMemo(() => (data ? (tab === 'all' ? data : data.filter((x) => tabOf(x) === tab)) : NONE), [data, tab]);
  const countOf = (id: Tab) => (!data ? 0 : id === 'all' ? data.length : data.filter((x) => tabOf(x) === id).length);
  const view = useTableView(shown, { perPage: 25, match: matches });
  const [inviting, setInviting] = useState(false);
  const actor = { name: user.displayName, role: user.role === 'super_admin' ? ('super_admin' as const) : ('platform_admin' as const) };
  const resetAll = () => {
    setTab('all');
    view.setSearch('');
  };
  const open = (x: PlatformGroup) => navigate('platform.group', { id: x.id });
  const reloadAll = () => {
    reload();
    invites.reload();
  };

  const inviteButton = (cls: string) => (
    <Button icon="envelope-plus" className={cls} onClick={() => setInviting(true)}>
      {g.newGroup}
    </Button>
  );

  return (
    <>
      <PageHead className="reveal" sub={g.subtitle}>
        {data && data.length > 0 ? <SearchField wrapClass="pay-toolbar" smart clear value={view.search} placeholder={t.searchPlaceholder} label={t.searchLabel} onChange={view.setSearch} /> : null}
        {inviteButton('sh-new')}
      </PageHead>

      {waiting > 0 ? (
        <div className="hm-queue pf-ontheway reveal">
          <div className="hm-q">
            <i className="hm-dot tone-info" aria-hidden="true" />
            <div className="hm-q-text">
              <b>{t.onTheWay(waiting)}</b>
              <small>{t.onTheWayNote}</small>
            </div>
            <Button variant="outline" size="sm" icon="envelope-paper" onClick={() => navigate('platform.invitations', { type: 'group' })}>
              {t.openInvitations}
            </Button>
          </div>
        </div>
      ) : null}

      {!data ? (
        <Wait error={error} onRetry={reload} tiles={false} rows={4} />
      ) : data.length === 0 ? (
        <>
          <StaleNote error={error} onRetry={reload} />
          <div className="card reveal">
            <EmptyState icon="diagram-3" title={g.empty.title} text={g.empty.body}>
              {inviteButton('mt-3')}
            </EmptyState>
          </div>
        </>
      ) : (
        <>
          <StaleNote error={error} onRetry={reload} />
          <FilterBar
            tabsLabel={t.tabsLabel}
            tabs={TABS.map((id) => ({ id, label: tabLabel(id), count: countOf(id), dot: DOTS[id] }))}
            active={tab}
            onTab={(id) => {
              setTab(startTab(id));
              view.setPage(1);
            }}
            onReset={tab !== 'all' || view.search !== '' ? resetAll : undefined}
          />
          {view.total === 0 ? (
            <div className="card reveal">
              <EmptyState icon="search" title={t.noMatch.title} text={t.noMatch.body}>
                <Button variant="outline" className="mt-3" onClick={resetAll}>
                  {t.clearSearch}
                </Button>
              </EmptyState>
            </div>
          ) : (
            <>
              <div className="reveal">
                {view.rows.map((x) => (
                  <GroupCard key={x.id} group={x} onOpen={() => open(x)} />
                ))}
              </div>
              <div className="card sh-pager-card">
                <Pager view={view} />
              </div>
            </>
          )}
        </>
      )}

      {inviting ? <PlatformInviteForm open actor={actor} initialType="group" onClose={() => setInviting(false)} onSent={reloadAll} /> : null}
    </>
  );
}

function GroupCard({ group: x, onOpen }: { group: PlatformGroup; onOpen: () => void }) {
  const a = x.groupAdmin;
  const statusLine = x.status === 'pending_approval' ? g.waitingApproval : undefined;
  return (
    <DetailCard
      label={`${C.group} ${x.name}`}
      leadWidth="lg"
      className="pf-hotel"
      warn={!a && x.status === 'active'}
      lead={
        <>
          <span className="pf-kind" aria-hidden="true">
            <Bi name="diagram-3" />
          </span>
          <StatusPill status={x.status} />
        </>
      }
      facts={[
        { label: C.group, value: x.name, sub: statusLine },
        { label: C.hotels, value: t.hotelCount(x.hotelCount), tone: x.hotelCount ? undefined : 'muted' },
        { label: C.admin, value: a?.name ?? g.noGroupAdmin, sub: a?.hotelName, tone: a ? undefined : 'warn' },
        { label: C.created, value: formatDate(x.createdAt) },
      ]}
      sections={[
        {
          icon: 'diagram-3',
          title: C.aboutGroup,
          content: (
            <DetailList
              items={[
                { label: C.status, value: <StatusPill status={x.status} /> },
                { label: C.hotels, value: t.hotelCount(x.hotelCount) },
                { label: C.created, value: formatDate(x.createdAt) },
              ]}
            />
          ),
        },
        {
          icon: 'person-badge',
          title: C.aboutAdmin,
          tone: a ? undefined : 'warn',
          content: (
            <DetailList
              items={[
                { label: C.admin, value: a?.name ?? g.noGroupAdmin },
                { label: C.adminHotel, value: a?.hotelName ?? g.noGroupAdmin },
              ]}
            />
          ),
        },
      ]}
      actions={
        <Button size="sm" icon={x.status === 'pending_approval' ? 'clipboard-check' : 'eye'} title={t.detailsTitle(x.name)} variant={x.status === 'pending_approval' ? 'primary' : 'outline'} onClick={onOpen}>
          {x.status === 'pending_approval' ? platformCopy.hotelConsole.list.review : g.details}
        </Button>
      }
    />
  );
}

function StatusPill({ status: s }: { status: PlatformGroupStatus }) {
  const [cls, icon] = s === 'active' ? ['pay-paid', 'check-circle'] : s === 'rejected' ? ['pay-failed', 'x-circle'] : ['pay-pending', 'hourglass-split'];
  return (
    <span className={`pay-pill ${cls}`}>
      <Bi name={icon} />
      {platformCopy.status.group[s]}
    </span>
  );
}
