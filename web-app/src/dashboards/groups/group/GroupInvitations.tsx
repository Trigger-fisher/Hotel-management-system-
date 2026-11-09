'use client';

// group.invitations (params { status?, invite? }) and group.hotels.invite: the invitations THIS group sent to hotels (always "join my group").
// The group's hotel limit sits in one line above the list; status tabs with counts; one DetailCard per invitation with Resend (Cancel in More)
// or Open hotel once the form came back. The invite window shows the group, never lets it be chosen.
import { useMemo, useState } from 'react';

import { formatDate, formatDateTime } from '@shared/dashboards/format';
import { groupCopy } from '@shared/dashboards/groupCopy';
import type { PlatformInvitation } from '@shared/dashboards/platform';

import type { ScreenProps } from '../../types';
import { useAction, useDebounced } from '@/components/ui';
import { Bi, Button, DetailCard, DetailList, Dialog, Dropdown, EmptyState, Field, FieldHint, FilterBar, Modal, PageHead, Pager, SearchField, pagerView } from '@/dashboards/pallav/ui';
import { StaleNote, Wait, useLoaded } from '../payrollCore/load';
import { WrapEmail, useTabStrip } from '../platform/superParts';
import { groupApiFor } from './api';
import { useInviteGate } from './parts';

const t = groupCopy.invitations;
const C = t.card;

type Tab = 'all' | 'pending' | 'submitted' | 'expired' | 'cancelled';
const TABS: Tab[] = ['all', 'pending', 'submitted', 'expired', 'cancelled'];
const DOTS: Partial<Record<Tab, 'paid' | 'due' | 'settled' | 'muted'>> = { pending: 'settled', submitted: 'paid', expired: 'due', cancelled: 'muted' };
const startTab = (v: string | undefined): Tab => (v && (TABS as string[]).includes(v) ? (v as Tab) : 'all');
const PILL: Record<PlatformInvitation['status'], [string, string]> = {
  sent: ['pay-hold', 'send'],
  opened: ['pay-partial', 'envelope-open'],
  submitted: ['pay-paid', 'check-circle'],
  expired: ['pay-failed', 'hourglass-bottom'],
  cancelled: ['pay-hold', 'x-circle'],
};

export function GroupInvitations(props: ScreenProps & { startInvite?: boolean }) {
  const { user, params, navigate, startInvite = false } = props;
  const api = useMemo(() => groupApiFor(user), [user]);
  const [tab, setTab] = useState<Tab>(() => startTab(params.status));
  const [typed, setTyped] = useState('');
  const search = useDebounced(typed.trim(), 250);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [version, setVersion] = useState(0);
  const [inviting, setInviting] = useState(startInvite || params.invite === '1');
  const [cancelling, setCancelling] = useState<PlatformInvitation | null>(null);
  const { busy, run } = useAction();

  const { data, error, reload } = useLoaded(() => api.myInvitations({ status: tab, search, page, pageSize }), [api, tab, search, page, pageSize, version]);
  const gate = useInviteGate(api, version);
  const refresh = () => setVersion((n) => n + 1);
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
  const nothingAtAll = !!data && data.counts.all === 0 && !filtered;
  const strip = useTabStrip(tab, !!data && !nothingAtAll);
  const inviteButton = (extra = '') =>
    gate.canInvite && !gate.atLimit ? (
      <Button icon="envelope-plus" className={extra} onClick={() => setInviting(true)}>
        {t.invite}
      </Button>
    ) : null;
  const resend = (inv: PlatformInvitation) => void run(() => api.resendInvitation(inv.id), { success: t.resendDone(inv.email), onOk: refresh });

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
        <Wait error={error} onRetry={reload} tiles={false} rows={5} />
      ) : nothingAtAll ? (
        <div className="card reveal">
          <EmptyState icon="envelope-paper" title={t.empty.title} text={t.empty.body}>
            {inviteButton('mt-3')}
          </EmptyState>
        </div>
      ) : (
        <>
          <StaleNote error={error} onRetry={reload} />
          {gate.countLine ? (
            <div className="hm-queue pf-ontheway reveal">
              <div className="hm-q gc-line">
                <i className={`hm-dot ${gate.atLimit ? 'tone-warn' : 'tone-info'}`} aria-hidden="true" />
                <div className="hm-q-text">
                  <b>{t.limitLine(gate.countLine)}</b>
                  <small>{gate.limitNote ?? t.noteRule}</small>
                </div>
              </div>
            </div>
          ) : null}
          <div className="d-contents" ref={strip}>
            <FilterBar
              tabsLabel={t.tabsLabel}
              tabs={TABS.map((id) => ({ id, label: t.tabs[id], count: id === 'all' ? data.counts.all : data.counts[id], dot: DOTS[id] }))}
              active={tab}
              onTab={(id) => {
                setTab(startTab(id));
                setPage(1);
              }}
              summary={t.shown(data.total)}
              onReset={filtered ? reset : undefined}
            />
          </div>
          {data.total === 0 ? (
            <div className="card reveal">
              <EmptyState icon="search" title={t.noMatch.title} text={t.noMatch.body}>
                <Button variant="outline" className="mt-3" onClick={reset}>
                  {groupCopy.hotels.clearFilters}
                </Button>
              </EmptyState>
            </div>
          ) : (
            <>
              <div className="reveal">
                {data.items.map((inv) => (
                  <InviteCard
                    key={inv.id}
                    inv={inv}
                    busy={busy}
                    onResend={() => resend(inv)}
                    onCancel={() => setCancelling(inv)}
                    onOpenHotel={inv.hotelId ? () => navigate('group.hotel', { id: inv.hotelId ?? '' }) : undefined}
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
        open={cancelling !== null}
        tone="danger"
        icon="x-circle"
        title={cancelling ? t.cancelTitle(cancelling.hotelName) : ''}
        message={t.cancelBody}
        confirmLabel={t.cancelInvite}
        cancelLabel={groupCopy.detail.cancel}
        busy={busy}
        onCancel={() => setCancelling(null)}
        onConfirm={() =>
          cancelling &&
          void run(() => api.cancelInvitation(cancelling.id), {
            success: t.cancelDone(cancelling.hotelName),
            onOk: () => {
              setCancelling(null);
              refresh();
            },
          })
        }
      />

      {inviting ? (
        <InviteModal
          user={user}
          groupName={gate.groupName ?? user.group?.name ?? ''}
          onClose={() => setInviting(false)}
          onSent={() => {
            setInviting(false);
            refresh();
          }}
        />
      ) : null}
    </>
  );
}

/** The page behind Invite hotel in the menu: the invitations list with the invite window already open. */
export function GroupInviteHotel(props: ScreenProps) {
  return <GroupInvitations {...props} startInvite />;
}

function InviteCard({ inv, busy, onResend, onCancel, onOpenHotel }: { inv: PlatformInvitation; busy: boolean; onResend: () => void; onCancel: () => void; onOpenHotel?: () => void }) {
  const [cls, icon] = PILL[inv.status];
  const waiting = inv.status === 'sent' || inv.status === 'opened';
  const outcome =
    inv.status === 'submitted' && inv.submittedAt
      ? { label: C.answered, value: formatDate(inv.submittedAt) }
      : inv.status === 'cancelled' && inv.cancelledAt
        ? { label: C.cancelled, value: formatDate(inv.cancelledAt) }
        : inv.status === 'expired'
          ? { label: C.expiredOn, value: formatDate(inv.expiresAt) }
          : { label: C.validUntil, value: formatDate(inv.expiresAt) };
  return (
    <DetailCard
      label={`${C.invitation} ${inv.hotelName}`}
      leadWidth="lg"
      className="pf-hotel gc-card"
      warn={inv.status === 'expired'}
      lead={
        <>
          <span className="pf-kind" aria-hidden="true">
            <Bi name="envelope" />
          </span>
          <span className={`pay-pill ${cls}`}>
            <Bi name={icon} />
            {t.status[inv.status]}
          </span>
        </>
      }
      facts={[
        { label: C.hotel, value: inv.hotelName, sub: inv.contactName },
        { label: C.email, value: <WrapEmail email={inv.email} />, title: inv.email },
        { label: C.sent, value: formatDate(inv.createdAt), sub: C.byWhom(inv.sentBy) },
        { label: outcome.label, value: outcome.value, tone: inv.status === 'expired' ? 'warn' : undefined },
      ]}
      sections={[
        {
          icon: 'envelope-paper',
          title: C.aboutInvitation,
          content: (
            <DetailList
              items={[
                { label: C.sentBy, value: inv.sentBy },
                { label: C.sent, value: formatDateTime(inv.createdAt) },
                { label: C.opened, value: inv.openedAt ? formatDateTime(inv.openedAt) : C.notOpened },
                { label: C.resends, value: C.resendCount(inv.resendCount) },
                { label: outcome.label, value: outcome.value },
              ]}
            />
          ),
        },
        {
          icon: 'person',
          title: C.aboutContact,
          content: (
            <DetailList
              items={[
                { label: C.name, value: inv.contactName },
                { label: C.email, value: <WrapEmail email={inv.email} /> },
              ]}
            />
          ),
        },
      ]}
      actions={
        <>
          {onOpenHotel ? (
            <Button variant="outline" size="sm" icon="eye" onClick={onOpenHotel}>
              {C.openHotel}
            </Button>
          ) : null}
          {waiting || inv.status === 'expired' ? (
            <Button variant={inv.status === 'expired' ? 'primary' : 'outline'} size="sm" icon="arrow-repeat" disabled={busy} onClick={onResend}>
              {t.resend}
            </Button>
          ) : null}
          {waiting ? (
            <Dropdown
              align="end"
              button={(p) => (
                <Button variant="outline" size="sm" icon="three-dots" title={C.moreLabel(inv.hotelName)} disabled={busy} {...p}>
                  {C.more}
                </Button>
              )}
            >
              <a
                href="#"
                className="dropdown-item text-danger"
                onClick={(e) => {
                  e.preventDefault();
                  onCancel();
                }}
              >
                <Bi name="x-circle" /> {t.cancelInvite}
              </a>
            </Dropdown>
          ) : null}
        </>
      }
    />
  );
}

function InviteModal({ user, groupName, onClose, onSent }: { user: ScreenProps['user']; groupName: string; onClose: () => void; onSent: () => void }) {
  const api = useMemo(() => groupApiFor(user), [user]);
  const f = t.form;
  const [v, setV] = useState({ hotelName: '', contactName: '', email: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  const set = (k: keyof typeof v, x: string) => {
    setV((p) => ({ ...p, [k]: x }));
    if (errors[k]) setErrors((p) => ({ ...p, [k]: '' }));
  };
  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={f.title}
      staticBackdrop
      onSubmit={() => void run(() => api.inviteHotelToMyGroup(v), { success: (r) => f.sent(r.invitation.email), onFields: (e) => setErrors(e), onOk: onSent })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {groupCopy.detail.cancel}
          </Button>
          <Button type="submit" icon="envelope-plus" busy={busy} busyLabel={f.sending}>
            {f.send}
          </Button>
        </>
      }
    >
      <DetailList items={[{ label: f.group, value: groupName || '-' }]} />
      <p className="small text-muted mt-2">{f.about(groupName || '-')}</p>
      {errors.limit ? (
        <div className="alert alert-danger d-flex align-items-start gap-2" role="alert">
          <Bi name="exclamation-octagon" />
          <div className="flex-grow-1">{errors.limit}</div>
        </div>
      ) : null}
      <fieldset disabled={busy}>
        <div className="row g-3">
          <Field label={f.hotelName} required error={errors.hotelName}>
            <input className={`form-control${errors.hotelName ? ' is-invalid' : ''}`} maxLength={100} value={v.hotelName} onChange={(e) => set('hotelName', e.target.value)} />
          </Field>
          <Field label={f.contactName} required error={errors.contactName}>
            <input className={`form-control${errors.contactName ? ' is-invalid' : ''}`} maxLength={100} autoComplete="off" value={v.contactName} onChange={(e) => set('contactName', e.target.value)} />
          </Field>
          <Field label={f.email} required error={errors.email}>
            <input className={`form-control${errors.email ? ' is-invalid' : ''}`} type="email" inputMode="email" maxLength={150} autoComplete="off" value={v.email} onChange={(e) => set('email', e.target.value)} />
            <FieldHint>{f.emailHint}</FieldHint>
          </Field>
        </div>
      </fieldset>
    </Modal>
  );
}
