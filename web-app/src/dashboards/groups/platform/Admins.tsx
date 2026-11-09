'use client';

// platform.admins { status?, hotelId? }: the Hotel Admins of every hotel, one card each (Super Admin and Platform Admin). Platform Admins are never listed here.
import { useState } from 'react';

import { formatDate, formatDateTime } from '@shared/dashboards/format';
import { blankAdmin, platformCopy, type PlatformAdminInput, type PlatformAdminStatus, type PlatformHotel, type PlatformHotelAdmin } from '@shared/dashboards/platform';

import type { ScreenProps } from '../../types';
import { useAction, useDebounced } from '@/components/ui';
import { Bi, Button, DetailCard, DetailList, Dialog, Dropdown, EmptyState, Field, FieldHint, FilterBar, FilterBarExtra, FilterMenu, Modal, PageHead, Pager, PmsSelect, SearchField, pagerView, type TableView } from '@/dashboards/pallav/ui';
import { StaleNote, Wait, useLoaded } from '../payrollCore/load';
import { initials } from '../payrollCore/pms';
import { platformApi } from './api';
import { asActor } from './enter';
import { When, WrapEmail } from './superParts';

const P = platformCopy.adminsPage;
const A = platformCopy.admins;
const T = platformCopy.adminsList;
const C = platformCopy.hotel;
const S = platformCopy.status.admin;

type Tab = 'all' | PlatformAdminStatus;
const TABS: Tab[] = ['all', 'active', 'locked', 'disabled'];
const startTab = (v: string | undefined): Tab => (v === 'active' || v === 'locked' || v === 'disabled' ? v : 'all');

type Ask = { kind: 'reset' | 'unlock' | 'disable' | 'enable'; admin: PlatformHotelAdmin };

/** Live = active or suspended, the dashboard tile's rule (platform.ts LIVE_STATUSES). listHotels leaves archived hotels out, so a missing hotel is not live. */
const liveHotel = (h: PlatformHotel) => h.status === 'active' || h.status === 'suspended';

export function PlatformAdmins({ user, params, navigate }: ScreenProps) {
  const [tab, setTab] = useState<Tab>(() => startTab(params.status));
  const [hotelId, setHotelId] = useState(params.hotelId ?? '');
  const [typed, setTyped] = useState('');
  const search = useDebounced(typed.trim(), 250);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [version, setVersion] = useState(0);
  // Off by default: only admins of live hotels, so the count matches the dashboard's Hotel admins tile.
  const [withArchived, setWithArchived] = useState(false);
  // The contract has no live-only filter yet, so the whole matching list is loaded and narrowed and paged here.
  const loaded = useLoaded(() => platformApi.listHotelAdmins({ status: 'all', hotelId: hotelId || undefined, search, pageSize: 1000 }), [hotelId, search, version]);
  const { error, reload } = loaded;
  const hotels = useLoaded(() => platformApi.listHotels({ pageSize: 500 }), [version]);
  const hotelList: PlatformHotel[] = hotels.data?.items ?? [];
  const { busy, run } = useAction();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [creating, setCreating] = useState(false);

  const liveIds = new Set(hotelList.filter(liveHotel).map((h) => h.id));
  const scoped = loaded.data && hotels.data ? (withArchived ? loaded.data.items : loaded.data.items.filter((a) => liveIds.has(a.hotelId))) : null;
  const data = scoped
    ? (() => {
        const rows = scoped.filter((a) => tab === 'all' || a.status === tab);
        const n = Math.min(page, Math.max(1, Math.ceil(rows.length / pageSize)));
        const count = (s: PlatformAdminStatus) => scoped.filter((a) => a.status === s).length;
        return {
          items: rows.slice((n - 1) * pageSize, n * pageSize),
          total: rows.length,
          page: n,
          pageSize,
          counts: { all: scoped.length, active: count('active'), locked: count('locked'), disabled: count('disabled'), pending: count('pending') },
          unfiltered: loaded.data?.total ?? 0,
        };
      })()
    : null;

  const refresh = () => setVersion((n) => n + 1);
  const reset = () => {
    setTyped('');
    setTab('all');
    setHotelId('');
    setWithArchived(false);
    setPage(1);
  };
  const filtered = tab !== 'all' || hotelId !== '' || typed.trim() !== '' || withArchived;

  const view: TableView<PlatformHotelAdmin> | null = data
    ? {
        ...pagerView(data, { setPage }),
        setPerPage: (n: number) => {
          setPageSize(n);
          setPage(1);
        },
      }
    : null;

  function confirmAsk(a: Ask) {
    asActor(user);
    const done = { onOk: refresh };
    const name = a.admin.name;
    const call =
      a.kind === 'reset'
        ? run(() => platformApi.resetAdminPassword(a.admin.id), { ...done, success: (r) => C.resetDone(r.message, platformCopy.newHotel.devLogNote) })
        : a.kind === 'unlock'
          ? run(() => platformApi.unlockAdmin(a.admin.id), { ...done, success: C.unlocked(name) })
          : a.kind === 'disable'
            ? run(() => platformApi.disableAdmin(a.admin.id), { ...done, success: C.disabled(name) })
            : run(() => platformApi.enableAdmin(a.admin.id), { ...done, success: C.enabled(name) });
    void call.then(() => setAsk(null));
  }

  const isSuper = user.role === 'super_admin';

  return (
    <>
      <PageHead className="reveal" sub={A.subtitle}>
        <SearchField
          wrapClass="pay-toolbar"
          smart
          clear
          value={typed}
          placeholder={A.searchPlaceholder}
          label={T.searchLabel}
          onChange={(v) => {
            setTyped(v);
            setPage(1);
          }}
        />
        <Button icon="person-plus" className="sh-new" onClick={() => setCreating(true)}>
          {A.newAdmin}
        </Button>
      </PageHead>

      {!data || !view ? (
        <Wait error={error ?? hotels.error} onRetry={error ? reload : hotels.reload} tiles={false} rows={6} />
      ) : data.unfiltered === 0 && search === '' && hotelId === '' ? (
        <>
          <StaleNote error={error} onRetry={reload} />
          <div className="card reveal">
            <EmptyState icon="people" title={A.empty.title} text={A.empty.body}>
              <Button icon="person-plus" className="mt-3" onClick={() => setCreating(true)}>
                {A.newAdmin}
              </Button>
            </EmptyState>
          </div>
        </>
      ) : (
        <>
          <StaleNote error={error} onRetry={reload} />
          <div className="hm-queue pf-ontheway reveal">
            {data.counts.locked > 0 && tab !== 'locked' ? (
              <div className="hm-q">
                <i className="hm-dot tone-warn" aria-hidden="true" />
                <div className="hm-q-text">
                  <b>{P.lockedLine(data.counts.locked)}</b>
                  <small>{P.lockedNote}</small>
                </div>
                <Button variant="outline" size="sm" icon="lock" onClick={() => { setTab('locked'); setPage(1); }}>
                  {P.showLocked}
                </Button>
              </div>
            ) : null}
            <div className="hm-q">
              <i className="hm-dot tone-muted" aria-hidden="true" />
              <div className="hm-q-text">
                <b>{P.scopeTitle}</b>
                <small>{isSuper ? P.scopeSuper : A.scopeNote}</small>
              </div>
              {isSuper ? (
                <Button variant="outline" size="sm" icon="person-gear" onClick={() => navigate('platform.staff')}>
                  {P.openTeam}
                </Button>
              ) : <span />}
            </div>
          </div>
          <FilterBar
            tabsLabel={T.tabsLabel}
            tabs={TABS.map((id) => ({ id, label: A.tabs[id], count: data.counts[id], dot: id === 'active' ? 'paid' : id === 'locked' ? 'due' : id === 'disabled' ? 'muted' : undefined }))}
            active={tab}
            onTab={(id) => {
              setTab(startTab(id));
              setPage(1);
            }}
            summary={T.summary(data.counts.all, withArchived)}
            extra={
              <FilterBarExtra
                icon={withArchived ? 'check-square' : 'square'}
                label={T.includeArchived}
                onPress={() => {
                  setWithArchived((v) => !v);
                  setPage(1);
                }}
              />
            }
            onReset={filtered ? reset : undefined}
          >
            <FilterMenu
              label={T.hotelFilter}
              icon="building"
              any={A.allHotels}
              ariaLabel={T.hotelFilter}
              value={hotelId}
              options={hotelList.map((h) => ({ value: h.id, label: h.name }))}
              onChange={(v) => {
                setHotelId(v);
                setPage(1);
              }}
            />
          </FilterBar>
          {data.total === 0 ? (
            <div className="card reveal">
              <EmptyState icon="search" title={A.noMatch.title} text={A.noMatch.body}>
                <Button variant="outline" className="mt-3" onClick={reset}>
                  {T.clearFilters}
                </Button>
              </EmptyState>
            </div>
          ) : (
            <>
              <div className="reveal">
                {data.items.map((a) => (
                  <AdminCard
                    key={a.id}
                    admin={a}
                    hotel={hotelList.find((h) => h.id === a.hotelId)}
                    busy={busy}
                    onAsk={(kind) => setAsk({ kind, admin: a })}
                    onHotel={() => navigate('platform.hotel', { id: a.hotelId, tab: 'admins' })}
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

      <Dialog
        open={ask !== null}
        tone={ask?.kind === 'disable' ? 'danger' : ask?.kind === 'reset' ? 'warning' : 'primary'}
        icon={ask ? { reset: 'key', unlock: 'unlock', disable: 'slash-circle', enable: 'check-circle' }[ask.kind] : undefined}
        title={ask ? { reset: C.resetTitle, unlock: C.unlockTitle, disable: C.disableTitle, enable: C.enableTitle }[ask.kind](ask.admin.name) : ''}
        message={ask ? { reset: C.resetBody, unlock: C.unlockBody, disable: C.disableBody, enable: C.enableBody }[ask.kind] : undefined}
        confirmLabel={ask ? { reset: C.resetConfirm, unlock: C.unlock, disable: C.disable, enable: C.enable }[ask.kind] : undefined}
        cancelLabel={C.cancel}
        busy={busy}
        onCancel={() => setAsk(null)}
        onConfirm={() => ask && confirmAsk(ask)}
      />

      {creating ? (
        <CreateAdminModal
          actor={user}
          hotels={hotelList}
          hotelsError={hotels.error ? hotels.reload : null}
          startHotel={hotelId}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            refresh();
          }}
        />
      ) : null}
    </>
  );
}

function AdminCard({ admin: a, hotel, busy, onAsk, onHotel }: { admin: PlatformHotelAdmin; hotel: PlatformHotel | undefined; busy: boolean; onAsk: (kind: Ask['kind']) => void; onHotel: () => void }) {
  const K = P.card;
  const main: [Ask['kind'], string, string] = a.status === 'locked' ? ['unlock', 'unlock', C.unlock] : a.status === 'disabled' ? ['enable', 'check-circle', C.enable] : ['reset', 'key', C.resetPassword];
  const more: { id: string; icon: string; label: string; run: () => void; danger?: boolean }[] = [
    { id: 'hotel', icon: 'building', label: P.openHotel, run: onHotel },
    ...(a.status === 'locked' ? [{ id: 'reset', icon: 'key', label: C.resetPassword, run: () => onAsk('reset') }] : []),
    ...(a.status !== 'disabled' ? [{ id: 'disable', icon: 'slash-circle', label: C.disable, run: () => onAsk('disable'), danger: true }] : []),
  ];
  const suspended = hotel?.status === 'suspended';
  return (
    <DetailCard
      label={`${K.admin} ${a.name}`}
      className="pf-admin"
      warn={a.status === 'locked'}
      lead={
        <>
          <span className="pf-kind pf-initials" aria-hidden="true">
            {initials(a.name)}
          </span>
          <AdminPill status={a.status} />
        </>
      }
      facts={[
        { label: K.admin, value: a.name, sub: a.username },
        { label: K.hotel, value: a.hotelName, sub: suspended ? T.hotelSuspended : a.groupAdminOf ? C.groupAdminOf(a.groupAdminOf.groupName) : undefined, tone: suspended ? 'warn' : undefined },
        { label: K.email, value: <WrapEmail email={a.email} />, title: a.email, sub: a.mobile },
        {
          label: K.lastSignIn,
          value: a.lastSignInAt ? <When iso={a.lastSignInAt} /> : C.neverSignedIn,
          tone: a.status === 'locked' ? 'warn' : a.lastSignInAt ? undefined : 'muted',
          sub: a.status === 'locked' && a.lockedAt ? C.lockedSince(formatDateTime(a.lockedAt)) : undefined,
        },
      ]}
      sections={[
        {
          icon: 'person-badge',
          title: K.account,
          content: (
            <DetailList
              items={[
                { label: K.username, value: a.username },
                { label: K.email, value: <WrapEmail email={a.email} /> },
                { label: K.mobile, value: a.mobile },
                { label: K.created, value: formatDate(a.createdAt) },
              ]}
            />
          ),
        },
        {
          icon: 'building',
          title: K.theHotel,
          tone: suspended ? 'warn' : undefined,
          content: (
            <DetailList
              items={[
                { label: K.hotel, value: a.hotelName },
                hotel ? { label: K.hotelStatus, value: platformCopy.hotelConsole.lifecycle[hotel.status] } : null,
                a.groupAdminOf ? { label: K.groupAdmin, value: a.groupAdminOf.groupName } : null,
              ]}
            />
          ),
        },
      ]}
      actions={
        <>
          <Dropdown align="end" button={(p) => <Button variant="ghost" size="sm" icon="three-dots" title={P.moreLabel(a.name)} disabled={busy} {...p}>{P.more}</Button>}>
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
          <Button variant={a.status === 'locked' ? 'primary' : 'outline'} size="sm" icon={main[1]} title={C.rowAction(main[2], a.name)} disabled={busy} onClick={() => onAsk(main[0])}>
            {main[2]}
          </Button>
        </>
      }
    />
  );
}

function AdminPill({ status }: { status: PlatformAdminStatus }) {
  if (status === 'pending')
    return (
      <span className="pay-pill pay-pending">
        <Bi name="hourglass-split" />
        {S.pending}
      </span>
    );
  if (status === 'locked')
    return (
      <span className="pay-pill pay-failed">
        <Bi name="lock-fill" />
        {S.locked}
      </span>
    );
  if (status === 'active')
    return (
      <span className="pay-pill pay-paid">
        <Bi name="check-circle" />
        {S.active}
      </span>
    );
  return (
    <span className="pay-pill pay-hold">
      <Bi name="slash-circle" />
      {S.disabled}
    </span>
  );
}

function CreateAdminModal({
  actor,
  hotels,
  hotelsError,
  startHotel,
  onClose,
  onSaved,
}: {
  /** The signed-in person; every write is made as them (asActor: name and role). */
  actor: ScreenProps['user'];
  hotels: PlatformHotel[];
  /** Set when the hotel list failed to load: Try again. */
  hotelsError: (() => void) | null;
  startHotel: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [hotelId, setHotelId] = useState(startHotel);
  const [v, setV] = useState<PlatformAdminInput>(blankAdmin);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  const F = platformCopy.newHotel.fields;
  const H = platformCopy.newHotel.hints;
  const box = (k: keyof PlatformAdminInput, extra: { type?: string; inputMode?: 'email' | 'tel' | 'text'; autoComplete?: string; maxLength?: number } = {}) => (
    <input
      className={`form-control${errors[k] ? ' is-invalid' : ''}`}
      type={extra.type ?? 'text'}
      inputMode={extra.inputMode}
      autoComplete={extra.autoComplete ?? 'off'}
      maxLength={extra.maxLength ?? 100}
      required
      aria-invalid={errors[k] ? true : undefined}
      value={v[k]}
      onChange={(e) => {
        const x = e.target.value;
        setV((p) => ({ ...p, [k]: x }));
        if (errors[k]) setErrors((p) => ({ ...p, [k]: '' }));
      }}
    />
  );
  return (
    <Modal
      open
      onClose={onClose}
      title={A.newAdmin}
      staticBackdrop
      onSubmit={() => {
        if (!hotelId) {
          setErrors((p) => ({ ...p, hotelId: T.hotelRequired }));
          return;
        }
        asActor(actor);
        void run(() => platformApi.addHotelAdmin(hotelId, v), {
          success: (r) => C.adminAdded(r.admin.name, r.admin.email),
          onFields: (f) => setErrors(f),
          onOk: onSaved,
        });
      }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {C.cancel}
          </Button>
          <Button type="submit" icon="person-plus" disabled={busy}>
            {busy ? C.saving : T.createSave}
          </Button>
        </>
      }
    >
      <p className="small text-muted">{T.createHint}</p>
      <fieldset disabled={busy}>
        <div className="row g-3">
          <Field label={A.hotelField} required error={errors.hotelId}>
            <PmsSelect
              value={hotelId}
              disabled={busy}
              aria-label={A.hotelField}
              onChange={(e) => {
                setHotelId(e.target.value);
                if (errors.hotelId) setErrors((p) => ({ ...p, hotelId: '' }));
              }}
            >
              <option value="">{T.chooseHotel}</option>
              {/* No new admin for an archived or rejected hotel. */}
              {hotels.filter((h) => h.status !== 'archived' && h.status !== 'rejected').map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} · {h.city}
                </option>
              ))}
            </PmsSelect>
            {hotelsError ? (
              <Button variant="outline" size="sm" icon="arrow-clockwise" className="mt-2" onClick={hotelsError}>
                {C.tryAgain}
              </Button>
            ) : null}
          </Field>
          <Field label={F.adminName} required error={errors.name}>
            {box('name', { autoComplete: 'name' })}
          </Field>
          <Field label={F.username} col="col-sm-6" required error={errors.username}>
            {box('username', { maxLength: 30 })}
            <FieldHint>{H.username}</FieldHint>
          </Field>
          <Field label={F.mobile} col="col-sm-6" required error={errors.mobile}>
            {box('mobile', { type: 'tel', inputMode: 'tel', maxLength: 16 })}
            <FieldHint>{H.mobile}</FieldHint>
          </Field>
          <Field label={F.email} required error={errors.email}>
            {box('email', { type: 'email', inputMode: 'email', maxLength: 150 })}
          </Field>
        </div>
      </fieldset>
    </Modal>
  );
}
