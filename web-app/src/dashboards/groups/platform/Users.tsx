'use client';

// platform.users (Super Admin): every staff account at every level, one card each. Level tabs and a status filter with counts, one search;
// per card the state's action (Unlock, Enable) or Email addresses, Reset password and Disable (red, last) in More, each confirmed and audited.
import { useState } from 'react';

import { formatDate, formatDateTime } from '@shared/dashboards/format';
import { platformCopy, type PlatformUser, type PlatformUserLevel, type PlatformUserStatus } from '@shared/dashboards/platform';

import type { ScreenProps } from '../../types';
import { useAction, useDebounced } from '@/components/ui';
import { Bi, Button, DetailCard, DetailList, Dialog, Dropdown, EmptyState, FilterBar, FilterMenu, PageHead, Pager, SearchField, pagerView, type TableView } from '@/dashboards/pallav/ui';
import { StaleNote, Wait, useLoaded } from '../payrollCore/load';
import { platformApi } from './api';
import { initials } from '../payrollCore/pms';
import { MailAddressesModal } from './MailAddresses';
import { LevelPill, SuperOnly, When, WrapEmail } from './superParts';

const U = platformCopy.users;
const V = platformCopy.usersPage;
const S = platformCopy.status.user;

type Level = 'all' | PlatformUserLevel;
type Status = '' | PlatformUserStatus;
const LEVELS: Level[] = ['all', 'super_admin', 'platform_admin', 'group_admin', 'hotel_admin', 'hotel_user'];
const STATUSES: PlatformUserStatus[] = ['active', 'locked', 'disabled', 'pending'];
const startLevel = (v: string | undefined): Level => (LEVELS.includes(v as Level) ? (v as Level) : 'all');
const startStatus = (v: string | undefined): Status => (STATUSES.includes(v as PlatformUserStatus) ? (v as PlatformUserStatus) : '');

type Ask = { kind: 'reset' | 'unlock' | 'disable' | 'enable'; user: PlatformUser };

export function PlatformUsers(props: ScreenProps) {
  if (props.user.role !== 'super_admin') return <SuperOnly />;
  return <UsersList {...props} />;
}

function UsersList({ user, params }: ScreenProps) {
  const [level, setLevel] = useState<Level>(() => startLevel(params.level));
  const [status, setStatus] = useState<Status>(() => startStatus(params.status));
  const [typed, setTyped] = useState('');
  const search = useDebounced(typed.trim(), 250);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [version, setVersion] = useState(0);
  const { data, error, reload } = useLoaded(
    () => platformApi.listUsers({ level, status: status || 'all', search, page, pageSize }),
    [level, status, search, page, pageSize, version],
  );
  const { busy, run } = useAction();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [addresses, setAddresses] = useState<PlatformUser | null>(null);

  const refresh = () => setVersion((n) => n + 1);
  const reset = () => {
    setTyped('');
    setLevel('all');
    setStatus('');
    setPage(1);
  };
  const filtered = level !== 'all' || status !== '' || typed.trim() !== '';

  const view: TableView<PlatformUser> | null = data
    ? {
        ...pagerView(data, { setPage }),
        setPerPage: (n: number) => {
          setPageSize(n);
          setPage(1);
        },
      }
    : null;

  function confirmAsk(a: Ask) {
    platformApi.setActor({ name: user.displayName, role: 'super_admin' });
    const name = a.user.name;
    const done = { onOk: refresh };
    const call =
      a.kind === 'reset'
        ? run(() => platformApi.resetUserPassword(a.user.id), { ...done, success: (r) => U.resetDone(r.message, r.tempPasswordNote) })
        : a.kind === 'unlock'
          ? run(() => platformApi.unlockUser(a.user.id), { ...done, success: U.unlocked(name) })
          : a.kind === 'disable'
            ? run(() => platformApi.disableUser(a.user.id), { ...done, success: U.disabled(name) })
            : run(() => platformApi.enableUser(a.user.id), { ...done, success: U.enabled(name) });
    // A refusal (e.g. the last active Super Admin) is shown as the API's own sentence by useAction's error toast.
    void call.then(() => setAsk(null));
  }


  return (
    <>
      <PageHead className="reveal" sub={U.subtitle}>
        <SearchField
          wrapClass="pay-toolbar"
          smart
          clear
          value={typed}
          placeholder={U.searchPlaceholder}
          label={U.searchLabel}
          onChange={(v) => {
            setTyped(v);
            setPage(1);
          }}
        />
      </PageHead>

      {!data || !view ? (
        <Wait error={error} onRetry={reload} tiles={false} rows={8} />
      ) : data.counts.levels.all === 0 && data.counts.statuses.all === 0 && !filtered ? (
        <>
          <StaleNote error={error} onRetry={reload} />
          <div className="card reveal">
            <EmptyState icon="people" title={U.empty.title} text={U.empty.body} />
          </div>
        </>
      ) : (
        <>
          <StaleNote error={error} onRetry={reload} />
          <div className="hm-queue pf-ontheway reveal">
            <div className="hm-q">
              <i className="hm-dot tone-muted" aria-hidden="true" />
              <div className="hm-q-text">
                <b>{V.rulesTitle}</b>
                <small>{U.rules}</small>
              </div>
              <span />
            </div>
          </div>
          <FilterBar
            tabsLabel={U.levelTabsLabel}
            tabs={LEVELS.map((id) => ({ id, label: U.levelTabs[id], count: data.counts.levels[id] }))}
            active={level}
            onTab={(id) => {
              setLevel(startLevel(id));
              setPage(1);
            }}
            summary={U.summary(data.total, data.counts.levels.all)}
            onReset={filtered ? reset : undefined}
          >
            <FilterMenu
              label={U.statusFilter}
              icon="person-check"
              any={U.anyStatus}
              ariaLabel={U.statusFilterHead}
              value={status}
              options={STATUSES.map((st) => ({ value: st, label: U.statusTabs[st], count: data.counts.statuses[st] }))}
              onChange={(v) => {
                setStatus(startStatus(v));
                setPage(1);
              }}
            />
          </FilterBar>
          {data.total === 0 ? (
            <div className="card reveal">
              <EmptyState icon="search" title={U.noMatch.title} text={U.noMatch.body}>
                <Button variant="outline" className="mt-3" onClick={reset}>
                  {U.clearFilters}
                </Button>
              </EmptyState>
            </div>
          ) : (
            <>
              <div className="reveal">
                {data.items.map((u) => (
                  <UserCard key={u.id} u={u} busy={busy} onAsk={(kind) => setAsk({ kind, user: u })} onAddresses={() => setAddresses(u)} />
                ))}
              </div>
              <div className="card sh-pager-card">
                <Pager server view={view} />
              </div>
            </>
          )}
        </>
      )}

      <Dialog
        open={ask !== null}
        tone={ask?.kind === 'disable' ? 'danger' : ask?.kind === 'reset' ? 'warning' : 'primary'}
        icon={ask ? { reset: 'key', unlock: 'unlock', disable: 'slash-circle', enable: 'check-circle' }[ask.kind] : undefined}
        title={ask ? { reset: U.resetTitle, unlock: U.unlockTitle, disable: U.disableTitle, enable: U.enableTitle }[ask.kind](ask.user.name) : ''}
        message={ask ? { reset: U.resetBody, unlock: U.unlockBody, disable: U.disableBody, enable: U.enableBody }[ask.kind] : undefined}
        confirmLabel={ask ? { reset: U.resetConfirm, unlock: U.unlock, disable: U.disable, enable: U.enable }[ask.kind] : undefined}
        cancelLabel={U.cancel}
        busy={busy}
        onCancel={() => setAsk(null)}
        onConfirm={() => ask && confirmAsk(ask)}
      />
      {addresses ? <MailAddressesModal person={{ id: addresses.id, name: addresses.name }} onClose={() => setAddresses(null)} /> : null}
    </>
  );
}

function UserCard({ u, busy, onAsk, onAddresses }: { u: PlatformUser; busy: boolean; onAsk: (kind: Ask['kind']) => void; onAddresses: () => void }) {
  const K = V.card;
  const where = u.hotelName ?? u.groupName ?? K.platform;
  const main: [Ask['kind'], string, string] | null = u.status === 'locked' ? ['unlock', 'unlock', U.unlock] : u.status === 'disabled' ? ['enable', 'check-circle', U.enable] : null;
  const more: { id: string; icon: string; label: string; run: () => void; danger?: boolean }[] = [
    ...(u.status === 'active' || u.status === 'locked' ? [{ id: 'reset', icon: 'key', label: U.resetPassword, run: () => onAsk('reset') }] : []),
    ...(u.status !== 'disabled' && u.status !== 'pending' ? [{ id: 'disable', icon: 'slash-circle', label: U.disable, run: () => onAsk('disable'), danger: true }] : []),
  ];
  return (
    <DetailCard
      label={`${K.person} ${u.name}`}
      className="pf-admin"
      warn={u.status === 'locked'}
      lead={
        <>
          <span className="pf-kind pf-initials" aria-hidden="true">
            {initials(u.name)}
          </span>
          <UserPill status={u.status} />
        </>
      }
      facts={[
        { label: K.person, value: u.name, sub: u.username },
        { label: K.where, value: where, sub: <LevelPill level={u.level} />, title: where },
        { label: K.email, value: <WrapEmail email={u.email} />, title: u.email, sub: u.mobile || undefined },
        {
          label: K.lastSignIn,
          value: u.lastSignInAt ? <When iso={u.lastSignInAt} /> : U.neverSignedIn,
          tone: u.status === 'locked' ? 'warn' : u.lastSignInAt ? undefined : 'muted',
          sub: u.status === 'locked' && u.lockedAt ? U.lockedSince(formatDateTime(u.lockedAt)) : undefined,
        },
      ]}
      sections={[
        {
          icon: 'person-badge',
          title: K.account,
          content: (
            <DetailList
              items={[
                { label: K.level, value: <LevelPill level={u.level} /> },
                { label: K.username, value: u.username },
                { label: K.email, value: <WrapEmail email={u.email} /> },
                u.mobile ? { label: K.mobile, value: u.mobile } : null,
                { label: K.where, value: u.hotelName && u.groupName ? `${u.hotelName} (${u.groupName})` : where },
                { label: K.created, value: formatDate(u.createdAt) },
              ]}
            />
          ),
        },
      ]}
      actions={
        <>
          {more.length ? (
            <Dropdown align="end" button={(p) => <Button variant="ghost" size="sm" icon="three-dots" title={V.moreLabel(u.name)} disabled={busy} {...p}>{V.more}</Button>}>
              {more.map((m) => (
                <a
                  key={m.id}
                  href="#"
                  className={`dropdown-item${m.danger ? ' text-danger' : ''}`}
                  onClick={(e) => {
                    e.preventDefault();
                    m.run();
                  }}
                >
                  <Bi name={m.icon} /> {m.label}
                </a>
              ))}
            </Dropdown>
          ) : null}
          {u.status !== 'pending' ? (
            <Button variant={main ? 'outline' : 'primary'} size="sm" icon="envelope-plus" disabled={busy} onClick={onAddresses}>
              {platformCopy.mailAddresses.action}
            </Button>
          ) : null}
          {main ? (
            <Button size="sm" icon={main[1]} title={U.rowAction(main[2], u.name)} disabled={busy} onClick={() => onAsk(main[0])}>
              {main[2]}
            </Button>
          ) : null}
        </>
      }
    />
  );
}

function UserPill({ status }: { status: PlatformUserStatus }) {
  const look: Record<PlatformUserStatus, [string, string]> = {
    active: ['pay-paid', 'check-circle'],
    locked: ['pay-failed', 'lock-fill'],
    disabled: ['pay-hold', 'slash-circle'],
    pending: ['pay-hold', 'hourglass-split'],
  };
  const [cls, glyph] = look[status];
  return (
    <span className={`pay-pill ${cls}`}>
      <Bi name={glyph} />
      {S[status]}
    </span>
  );
}
