'use client';

// platform.staff (Super Admin only): the Platform Admins who run the platform, one card each. Super Admins are never listed or changed here.
import { useState } from 'react';

import { formatDate, formatDateTime } from '@shared/dashboards/format';
import { blankAdmin, platformCopy, type PlatformAdminInput, type PlatformStaff, type PlatformStaffStatus } from '@shared/dashboards/platform';

import type { ScreenProps } from '../../types';
import { useAction, useDebounced } from '@/components/ui';
import { Bi, Button, DetailCard, DetailList, Dialog, Dropdown, EmptyState, Field, FieldHint, FilterBar, Modal, PageHead, Pager, SearchField, pagerView, type TableView } from '@/dashboards/pallav/ui';
import { StaleNote, Wait, useLoaded } from '../payrollCore/load';
import { initials } from '../payrollCore/pms';
import { platformApi } from './api';
import { asActor } from './enter';
import { HotelAccessModal } from './HotelAccessModal';
import { When, WrapEmail } from './superParts';

const P = platformCopy.platformStaff;
const Q = platformCopy.staffPage;
const C = platformCopy.hotel;
const S = platformCopy.status.user;

/** Every A8 write is made as the signed-in account (the mock refuses a Platform Admin and logs the refusal). Same as asActor (enter.ts): one way. */
export function actAs(user: ScreenProps['user']): void {
  asActor(user);
}

/** Shown instead of a Super Admin page to anyone else (the menu already hides it; this covers a direct open). */
export function SuperOnlyCard() {
  return (
    <div className="card reveal">
      <EmptyState icon="shield-lock" title={platformCopy.superOnlyPage.title} text={platformCopy.superOnlyPage.body} />
    </div>
  );
}

type Tab = 'all' | PlatformStaffStatus;
const TABS: Tab[] = ['all', 'active', 'locked', 'disabled'];
type Ask = { kind: 'reset' | 'unlock' | 'disable' | 'enable'; staff: PlatformStaff };

export function PlatformStaffScreen(props: ScreenProps) {
  if (props.user.role !== 'super_admin') return <SuperOnlyCard />;
  return <StaffBody {...props} />;
}

function StaffBody({ user }: ScreenProps) {
  const [tab, setTab] = useState<Tab>('all');
  const [typed, setTyped] = useState('');
  const search = useDebounced(typed.trim(), 250);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [version, setVersion] = useState(0);
  const { data, error, reload } = useLoaded(
    () => {
      actAs(user);
      return platformApi.listPlatformStaff({ status: tab, search, page, pageSize });
    },
    [tab, search, page, pageSize, version],
  );
  const { busy, run } = useAction();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [creating, setCreating] = useState(false);
  const [accessFor, setAccessFor] = useState<PlatformStaff | null>(null);

  const refresh = () => setVersion((n) => n + 1);
  const reset = () => {
    setTyped('');
    setTab('all');
    setPage(1);
  };
  const filtered = tab !== 'all' || typed.trim() !== '';
  const view: TableView<PlatformStaff> | null = data
    ? {
        ...pagerView(data, { setPage }),
        setPerPage: (n: number) => {
          setPageSize(n);
          setPage(1);
        },
      }
    : null;

  function confirmAsk(a: Ask) {
    actAs(user);
    const done = { onOk: refresh };
    const name = a.staff.name;
    const call =
      a.kind === 'reset'
        ? run(() => platformApi.resetPlatformStaffPassword(a.staff.id), { ...done, success: (r) => C.resetDone(r.message, platformCopy.newHotel.devLogNote) })
        : a.kind === 'unlock'
          ? run(() => platformApi.unlockPlatformStaff(a.staff.id), { ...done, success: C.unlocked(name) })
          : a.kind === 'disable'
            ? run(() => platformApi.disablePlatformStaff(a.staff.id), { ...done, success: C.disabled(name) })
            : run(() => platformApi.enablePlatformStaff(a.staff.id), { ...done, success: C.enabled(name) });
    void call.then(() => setAsk(null));
  }

  const notes = (
    <div className="hm-queue pf-ontheway reveal">
      <div className="hm-q">
        <i className="hm-dot tone-muted" aria-hidden="true" />
        <div className="hm-q-text">
          <b>{data ? P.superCount(data.superAdminCount) : Q.superTitle}</b>
          <small>{P.superNote} {P.rulesNote}</small>
        </div>
        <span />
      </div>
      <div className="hm-q">
        <i className="hm-dot tone-info" aria-hidden="true" />
        <div className="hm-q-text">
          <b>{Q.twoStepTitle}</b>
          <small>{P.twoStepNote}</small>
        </div>
        <span />
      </div>
    </div>
  );

  return (
    <>
      <PageHead className="reveal" sub={P.subtitle}>
        <SearchField
          wrapClass="pay-toolbar"
          smart
          clear
          value={typed}
          placeholder={P.searchPlaceholder}
          label={P.searchLabel}
          onChange={(v) => {
            setTyped(v);
            setPage(1);
          }}
        />
        <Button icon="person-plus" className="sh-new" onClick={() => setCreating(true)}>
          {P.newStaff}
        </Button>
      </PageHead>

      {!data || !view ? (
        <Wait error={error} onRetry={reload} tiles={false} rows={4} />
      ) : data.counts.all === 0 && search === '' ? (
        <>
          <StaleNote error={error} onRetry={reload} />
          {notes}
          <div className="card reveal">
            <EmptyState icon="person-gear" title={P.empty.title} text={P.empty.body}>
              <Button icon="person-plus" className="mt-3" onClick={() => setCreating(true)}>
                {P.newStaff}
              </Button>
            </EmptyState>
          </div>
        </>
      ) : (
        <>
          <StaleNote error={error} onRetry={reload} />
          {notes}
          <FilterBar
            tabsLabel={P.tabsLabel}
            tabs={TABS.map((id) => ({ id, label: P.tabs[id], count: data.counts[id], dot: id === 'active' ? 'paid' : id === 'locked' ? 'due' : id === 'disabled' ? 'muted' : undefined }))}
            active={tab}
            onTab={(id) => {
              setTab(TABS.includes(id as Tab) ? (id as Tab) : 'all');
              setPage(1);
            }}
            onReset={filtered ? reset : undefined}
          />
          {data.total === 0 ? (
            <div className="card reveal">
              <EmptyState icon="search" title={P.noMatch.title} text={P.noMatch.body}>
                <Button variant="outline" className="mt-3" onClick={reset}>
                  {P.clearFilters}
                </Button>
              </EmptyState>
            </div>
          ) : (
            <>
              <div className="reveal">
                {data.items.map((s) => (
                  <StaffCard key={s.id} s={s} busy={busy} onAsk={(kind) => setAsk({ kind, staff: s })} onAccess={() => setAccessFor(s)} />
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
        title={ask ? { reset: C.resetTitle, unlock: C.unlockTitle, disable: C.disableTitle, enable: C.enableTitle }[ask.kind](ask.staff.name) : ''}
        message={ask ? { reset: C.resetBody, unlock: C.unlockBody, disable: C.disableBody, enable: C.enableBody }[ask.kind] : undefined}
        confirmLabel={ask ? { reset: C.resetConfirm, unlock: C.unlock, disable: C.disable, enable: C.enable }[ask.kind] : undefined}
        cancelLabel={C.cancel}
        busy={busy}
        onCancel={() => setAsk(null)}
        onConfirm={() => ask && confirmAsk(ask)}
      />

      {accessFor ? (
        <HotelAccessModal
          user={user}
          staff={accessFor}
          onClose={() => setAccessFor(null)}
          onSaved={() => {
            setAccessFor(null);
            refresh();
          }}
        />
      ) : null}

      {creating ? (
        <CreateStaffModal
          user={user}
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

function StaffCard({ s, busy, onAsk, onAccess }: { s: PlatformStaff; busy: boolean; onAsk: (kind: Ask['kind']) => void; onAccess: () => void }) {
  const K = Q.card;
  const main: [Ask['kind'], string, string] = s.status === 'locked' ? ['unlock', 'unlock', C.unlock] : s.status === 'disabled' ? ['enable', 'check-circle', C.enable] : ['reset', 'key', C.resetPassword];
  const more: { id: string; icon: string; label: string; run: () => void; danger?: boolean }[] = [
    ...(s.status === 'locked' ? [{ id: 'reset', icon: 'key', label: C.resetPassword, run: () => onAsk('reset') }] : []),
    ...(s.status !== 'disabled' && !s.isYou ? [{ id: 'disable', icon: 'slash-circle', label: C.disable, run: () => onAsk('disable'), danger: true }] : []),
  ];
  return (
    <DetailCard
      label={`${K.admin} ${s.name}`}
      className="pf-admin"
      warn={s.status === 'locked'}
      lead={
        <>
          <span className="pf-kind pf-initials" aria-hidden="true">
            {initials(s.name)}
          </span>
          <StaffPill status={s.status} />
        </>
      }
      facts={[
        { label: K.admin, value: s.isYou ? `${s.name} (${P.you})` : s.name, sub: s.username },
        { label: K.email, value: <WrapEmail email={s.email} />, title: s.email, sub: s.mobile },
        {
          label: K.lastSignIn,
          value: s.lastSignInAt ? <When iso={s.lastSignInAt} /> : P.neverSignedIn,
          tone: s.status === 'locked' ? 'warn' : s.lastSignInAt ? undefined : 'muted',
          sub: s.status === 'locked' && s.lockedAt ? P.lockedSince(formatDateTime(s.lockedAt)) : undefined,
        },
      ]}
      sections={[
        {
          icon: 'person-badge',
          title: K.account,
          content: (
            <DetailList
              items={[
                { label: K.role, value: platformCopy.status.level[s.role] },
                { label: K.username, value: s.username },
                { label: K.email, value: <WrapEmail email={s.email} /> },
                { label: K.mobile, value: s.mobile },
                { label: K.created, value: formatDate(s.createdAt) },
              ]}
            />
          ),
        },
      ]}
      actions={
        <>
          {more.length ? (
            <Dropdown align="end" button={(p) => <Button variant="ghost" size="sm" icon="three-dots" title={Q.moreLabel(s.name)} disabled={busy} {...p}>{Q.more}</Button>}>
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
          <Button variant="outline" size="sm" icon="door-open" title={P.rowAction(P.hotelAccess.action, s.name)} disabled={busy} onClick={onAccess}>
            {P.hotelAccess.action}
          </Button>
          <Button variant={s.status === 'locked' ? 'primary' : 'outline'} size="sm" icon={main[1]} title={P.rowAction(main[2], s.name)} disabled={busy} onClick={() => onAsk(main[0])}>
            {main[2]}
          </Button>
        </>
      }
    />
  );
}

function StaffPill({ status }: { status: PlatformStaffStatus }) {
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

function CreateStaffModal({ user, onClose, onSaved }: { user: ScreenProps['user']; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<PlatformAdminInput>(blankAdmin);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  const F = platformCopy.newHotel.fields;
  const H = platformCopy.newHotel.hints;
  const T = P.form;
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
      title={T.title}
      staticBackdrop
      onSubmit={() => {
        actAs(user);
        void run(() => platformApi.createPlatformStaff(v), {
          success: (r) => P.created(r.staff.name, r.staff.email),
          onFields: (f) => setErrors(f),
          onOk: onSaved,
        });
      }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {T.cancel}
          </Button>
          <Button type="submit" icon="person-plus" disabled={busy}>
            {busy ? T.saving : T.save}
          </Button>
        </>
      }
    >
      <p className="small text-muted">{T.hint}</p>
      <fieldset disabled={busy}>
        <div className="row g-3">
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
          <Field label={T.role}>
            <input className="form-control" value={T.roleValue} readOnly aria-readonly="true" />
            <FieldHint>
              <Bi name="lock" /> {T.roleHint}
            </FieldHint>
          </Field>
        </div>
      </fieldset>
    </Modal>
  );
}
