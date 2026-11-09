'use client';

// platform.invitations { status?, type?, invite? }: every invitation (hotels, groups, hotels joining a group), one card each; also the Group Hotel
// Admin's own group invitations (GroupInvitations). Mock mode only: the seed links of the public onboarding page and "Open form here".
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { formatDate, formatDateTime } from '@shared/dashboards/format';
import { MOCK_INVITE_TOKENS, platformCopy, type PlatformGroup, type PlatformInvitation, type PlatformInvitationStatus, type PlatformInvitationType } from '@shared/dashboards/platform';

import type { ScreenProps } from '../../types';
import { useAction, useDebounced, useFocusTrap } from '@/components/ui';
import { Alert, Bi, Button, DetailCard, DetailList, Dialog, EmptyState, Field, FilterBar, FilterMenu, Modal, PageHead, Pager, SearchField, pagerView, type TableView } from '@/dashboards/pallav/ui';
import { StaleNote, Wait, useLoaded } from '../payrollCore/load';
import { platformApi } from './api';
import { DevCopyLink, PlatformInviteForm, devInviteLink, devLinksShown } from './InviteForm';
import { PlatformOnboarding } from './Onboarding';
import { WrapEmail, useTabStrip } from './superParts';

const T = platformCopy.invitations;
const I = platformCopy.invitationsPage;
const F = platformCopy.inviteFlow;
const TYPE = platformCopy.status.invitationType;
const ROLE = platformCopy.status.inviterRole;
const AP = platformCopy.approval;
const E = platformCopy.errors;

type Tab = 'all' | 'pending' | 'submitted' | 'expired' | 'cancelled';
const TABS: Tab[] = ['all', 'pending', 'submitted', 'expired', 'cancelled'];
/** A tab id, or an invitation status from another page ("sent" / "opened" are both Pending). */
const startTab = (v: string | undefined): Tab => (v === 'sent' || v === 'opened' ? 'pending' : TABS.includes(v as Tab) ? (v as Tab) : 'all');
type TypeFilter = '' | PlatformInvitationType;
const TYPES: PlatformInvitationType[] = ['individual', 'group', 'member_hotel'];
const TYPE_ICON: Record<PlatformInvitationType, string> = { individual: 'building', group: 'diagram-3', member_hotel: 'buildings' };

const isPending = (s: PlatformInvitationStatus) => s === 'sent' || s === 'opened';

type Ask = { kind: 'resend' | 'revoke'; inv: PlatformInvitation };

/** Seed links of the public page, one per state (the "invalid" one does not exist on purpose). */
const DEV_TOKENS: [keyof typeof F.devTokens, string][] = [
  ['open', MOCK_INVITE_TOKENS.open],
  ['opened', MOCK_INVITE_TOKENS.opened],
  ['groupOpen', MOCK_INVITE_TOKENS.groupOpen],
  ['expired', MOCK_INVITE_TOKENS.expired],
  ['submitted', MOCK_INVITE_TOKENS.submitted],
  ['groupSubmitted', MOCK_INVITE_TOKENS.groupSubmitted],
  ['cancelled', MOCK_INVITE_TOKENS.cancelled],
  ['invalid', 'inv-does-not-exist'],
];

export function PlatformInvitations({ user, params, navigate }: ScreenProps) {
  // A Group Hotel Admin: only its own group's member_hotel invitations, no type filter, no approving; the invite window has the group locked.
  const myGroup = user.role === 'group_hotel_admin' ? user.group : null;
  const [tab, setTab] = useState<Tab>(() => startTab(params.status));
  const [type, setType] = useState<TypeFilter>(() => (TYPES.includes(params.type as PlatformInvitationType) ? (params.type as PlatformInvitationType) : ''));
  const [typed, setTyped] = useState('');
  const search = useDebounced(typed.trim(), 250);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [version, setVersion] = useState(0);
  const { data, error, reload } = useLoaded(
    () => platformApi.listInvitations({ status: tab, type: myGroup ? 'member_hotel' : type || 'all', groupId: myGroup?.id, search, page, pageSize }),
    [tab, type, search, page, pageSize, version, myGroup?.id],
  );
  const { busy, run } = useAction();
  const [ask, setAsk] = useState<Ask | null>(null);
  /** `{ invite: '1' }` (the Dashboard / Hotels "Invite hotel" button) opens the Invite form at once. */
  const [inviting, setInviting] = useState(() => params.invite === '1');
  /** Dev only: the token whose onboarding form is open over the console. */
  const [devForm, setDevForm] = useState<string | null>(null);
  const dev = devLinksShown();
  /** Dev only (review M5): link tokens come from their own mock call, never from the list rows. */
  const { data: devLinks } = useLoaded(
    () => (dev ? platformApi.listDevLinks() : Promise.resolve({ ok: true as const, data: [] })),
    [dev, version],
  );
  const devTokenOf = (id: string) => devLinks?.find((x) => x.id === id)?.token ?? null;
  /** Groups waiting for approval: a sent group form's row gets "Review group" (Approve / Reject). Platform / Super Admin only. */
  const canApprove = user.role === 'platform_admin' || user.role === 'super_admin';
  const { data: pendingGroups } = useLoaded(
    () => (canApprove ? platformApi.listGroups({ status: 'pending_approval' }) : Promise.resolve({ ok: true as const, data: [] as PlatformGroup[] })),
    [canApprove, version],
  );
  const pendingGroupOf = (invId: string) => pendingGroups?.find((g) => g.invitationId === invId) ?? null;
  const [reviewing, setReviewing] = useState<PlatformGroup | null>(null);
  const actor = { name: user.displayName, role: myGroup ? ('group_admin' as const) : user.role === 'super_admin' ? ('super_admin' as const) : ('platform_admin' as const) };

  const refresh = () => setVersion((n) => n + 1);
  const reset = () => {
    setTyped('');
    setTab('all');
    setType('');
    setPage(1);
  };
  const filtered = tab !== 'all' || type !== '' || typed.trim() !== '';

  const view: TableView<PlatformInvitation> | null = data
    ? {
        ...pagerView(data, { setPage }),
        setPerPage: (n: number) => {
          setPageSize(n);
          setPage(1);
        },
      }
    : null;

  function confirmAsk(a: Ask) {
    platformApi.setActor(actor);
    const name = a.inv.hotelName;
    const call =
      a.kind === 'resend'
        ? run(() => platformApi.resendInvitation(a.inv.id), { success: (r) => F.resent(name, r.invitation.email), onOk: refresh })
        : run(() => platformApi.cancelInvitation(a.inv.id), { success: F.revoked(name), onOk: refresh });
    void call.then(() => setAsk(null));
  }

  const openInvite = () => setInviting(true);
  const listShown = !!data && !(data.counts.all === 0 && search === '' && type === '');
  const strip = useTabStrip(tab, listShown);

  return (
    <>
      <PageHead className="reveal" sub={T.subtitle}>
        <SearchField
          wrapClass="pay-toolbar"
          smart
          clear
          value={typed}
          placeholder={T.searchPlaceholder}
          label={T.searchLabel}
          onChange={(v) => {
            setTyped(v);
            setPage(1);
          }}
        />
        <Button icon="envelope-plus" className="sh-new" onClick={openInvite}>
          {F.inviteButton}
        </Button>
      </PageHead>

      {!data || !view ? (
        <Wait error={error} onRetry={reload} tiles={false} rows={6} />
      ) : data.counts.all === 0 && search === '' && type === '' ? (
        <>
          <StaleNote error={error} onRetry={reload} />
          <div className="card reveal">
            <EmptyState icon="envelope-paper" title={T.empty.title} text={T.empty.body}>
              <Button icon="envelope-plus" className="mt-3" onClick={openInvite}>
                {F.inviteButton}
              </Button>
            </EmptyState>
          </div>
        </>
      ) : (
        <>
          <StaleNote error={error} onRetry={reload} />
          {canApprove && (pendingGroups?.length ?? 0) > 0 ? (
            <div className="hm-queue pf-ontheway reveal">
              <div className="hm-q">
                <i className="hm-dot tone-warn" aria-hidden="true" />
                <div className="hm-q-text">
                  <b>{I.groupsWaiting(pendingGroups?.length ?? 0)}</b>
                  <small>{T.approvalNote}</small>
                </div>
                <Button variant="outline" size="sm" icon="clipboard-check" onClick={() => navigate('platform.groups', { status: 'pending' })}>
                  {I.openGroups}
                </Button>
              </div>
            </div>
          ) : null}
          {/* d-contents: no box of its own, only a handle for the phone tab strip (useTabStrip). */}
          <div className="d-contents" ref={strip}>
            <FilterBar
              tabsLabel={T.tabsLabel}
              tabs={TABS.map((id) => ({
                id,
                label: F.tabs[id],
                count: data.counts[id],
                dot: id === 'pending' ? 'due' : id === 'submitted' ? 'paid' : id === 'expired' || id === 'cancelled' ? 'muted' : undefined,
              }))}
              active={tab}
              onTab={(id) => {
                setTab(startTab(id));
                setPage(1);
              }}
              onReset={filtered ? reset : undefined}
            >
              {myGroup ? null : (
                <FilterMenu
                  label={T.typeTabsLabel}
                  icon="diagram-2"
                  any={F.allTypes}
                  ariaLabel={T.typeTabsLabel}
                  value={type}
                  options={TYPES.map((id) => ({ value: id, label: I.typeTabs[id] }))}
                  onChange={(v) => {
                    setType(v === 'individual' || v === 'group' || v === 'member_hotel' ? v : '');
                    setPage(1);
                  }}
                />
              )}
            </FilterBar>
          </div>
          {data.total === 0 ? (
            <div className="card reveal">
              <EmptyState icon="search" title={T.noMatch.title} text={T.noMatch.body}>
                <Button variant="outline" className="mt-3" onClick={reset}>
                  {T.clearFilters}
                </Button>
              </EmptyState>
            </div>
          ) : (
            <>
              <div className="reveal">
                {data.items.map((r) => {
                  const review = canApprove && r.type === 'group' && r.status === 'submitted' ? pendingGroupOf(r.id) : null;
                  const token = dev && isPending(r.status) ? devTokenOf(r.id) : null;
                  return (
                    <InviteCard
                      key={r.id}
                      inv={r}
                      busy={busy}
                      onAsk={(kind) => setAsk({ kind, inv: r })}
                      onReview={review ? () => setReviewing(review) : undefined}
                      dev={token ? { token, openHere: () => setDevForm(token) } : undefined}
                    />
                  );
                })}
              </div>
              <div className="card sh-pager-card">
                <Pager server view={view} />
              </div>
            </>
          )}
        </>
      )}

      {dev ? <DevPanel onOpenHere={setDevForm} /> : null}

      <Dialog
        open={ask !== null}
        tone={ask?.kind === 'revoke' ? 'danger' : 'primary'}
        icon={ask?.kind === 'revoke' ? 'x-circle' : 'arrow-repeat'}
        title={ask ? (ask.kind === 'resend' ? F.resendTitle(ask.inv.hotelName) : F.revokeTitle(ask.inv.hotelName)) : ''}
        message={ask ? (ask.kind === 'resend' ? F.resendBody : F.revokeBody) : undefined}
        confirmLabel={ask?.kind === 'revoke' ? F.revokeConfirm : F.resendConfirm}
        cancelLabel={F.keep}
        busy={busy}
        onCancel={() => setAsk(null)}
        onConfirm={() => ask && confirmAsk(ask)}
      />

      {inviting ? <PlatformInviteForm open actor={actor} group={myGroup ?? undefined} onClose={() => setInviting(false)} onSent={refresh} /> : null}

      {reviewing ? (
        <GroupReview
          group={reviewing}
          actor={{ name: actor.name, role: actor.role === 'super_admin' ? 'super_admin' : 'platform_admin' }}
          onClose={() => setReviewing(null)}
          onDone={() => {
            setReviewing(null);
            refresh();
          }}
        />
      ) : null}

      {devForm ? (
        <DevOnboardingOverlay
          token={devForm}
          onClose={() => {
            setDevForm(null);
            refresh();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Approve / Reject a group whose 'group' invitation form was sent (approveGroup / rejectGroup had no screen yet). Read-only form
 * summary; Reject asks for a reason (required). Only shown to Platform / Super Admins; the mock refuses a group admin as well.
 */
function GroupReview({
  group: g,
  actor,
  onClose,
  onDone,
}: {
  group: PlatformGroup;
  actor: { name: string; role: 'super_admin' | 'platform_admin' };
  onClose: () => void;
  onDone: () => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const { busy, run } = useAction();
  const GF = AP.groupFields;
  const facts: [string, string | null][] = [
    [platformCopy.onboarding.group.fields.name, g.name],
    [GF.legalName, g.legalName],
    [GF.gstin, g.gstin],
    [GF.address, g.address],
    [GF.city, g.city],
    [GF.state, g.state],
    [GF.pin, g.pin],
    [GF.phone, g.phone],
    [GF.email, g.email],
    [GF.admin, g.groupAdmin ? `${g.groupAdmin.name} (${g.groupAdmin.username})` : null],
  ];

  const approve = () => {
    platformApi.setActor(actor);
    void run(() => platformApi.approveGroup(g.id), { success: (r) => r.message, onOk: onDone });
  };
  const reject = () => {
    const why = reason.trim();
    if (!why) {
      setReasonError(E.required.reason);
      document.getElementById('grp_reject_reason')?.focus();
      return;
    }
    platformApi.setActor(actor);
    void run(() => platformApi.rejectGroup(g.id, why), { success: (r) => r.message, onOk: onDone });
  };

  return (
    <Modal
      open
      onClose={() => (busy ? undefined : onClose())}
      title={rejecting ? AP.rejectGroupTitle(g.name) : AP.approveGroupTitle(g.name)}
      eyebrow={AP.groupFormTitle}
      size="lg"
      staticBackdrop
      // No onSubmit: the kit puts a <form> between .modal-content and .modal-body, and in a scrollable dialog on a phone that pushed
      // the footer (Approve / Reject) out of view. The reason is a textarea, so Enter is a new line anyway.
      footer={
        <>
          <Button variant="ghost" className="me-auto" onClick={rejecting ? () => setRejecting(false) : onClose} disabled={busy}>
            {rejecting ? F.back : F.close}
          </Button>
          {rejecting ? (
            <Button variant="dangerSolid" busy={busy} icon="x-circle" onClick={reject}>{AP.rejectGroupConfirm}</Button>
          ) : (
            <>
              <Button variant="danger" icon="x-circle" disabled={busy} onClick={() => setRejecting(true)}>
                {AP.reject}
              </Button>
              <Button icon="check2-circle" disabled={busy} onClick={approve}>
                {AP.approveGroupConfirm}
              </Button>
            </>
          )}
        </>
      }
    >
      <Alert tone="warning" icon="hourglass-split" role="status">
        {AP.groupPendingBanner}
      </Alert>
      {g.submittedAt ? <p className="small text-muted">{AP.submittedOn(formatDateTime(g.submittedAt))}</p> : null}
      <DetailList className="pf-dl-2" items={facts.filter((x): x is [string, string] => !!x[1]).map(([k, v]) => ({ key: k, label: k, value: v }))} />
      <p className="small text-muted mt-2 mb-0">{rejecting ? AP.rejectGroupBody : AP.approveGroupBody}</p>
      {rejecting ? (
        <div className="row g-3 mt-1">
          <Field label={AP.rejectReason} required error={reasonError ?? undefined}>
            <textarea
              id="grp_reject_reason"
              data-autofocus
              className={`form-control${reasonError ? ' is-invalid' : ''}`}
              rows={3}
              maxLength={500}
              placeholder={AP.rejectReasonPlaceholder}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setReasonError(null);
              }}
            />
          </Field>
        </div>
      ) : null}
    </Modal>
  );
}

function InviteCard({
  inv: r,
  busy,
  onAsk,
  onReview,
  dev,
}: {
  inv: PlatformInvitation;
  busy: boolean;
  onAsk: (kind: Ask['kind']) => void;
  onReview?: () => void;
  dev?: { token: string; openHere: () => void };
}) {
  const K = I.card;
  const open = isPending(r.status) || r.status === 'expired';
  const by = r.invitedByName === ROLE[r.invitedByRole] ? r.invitedByName : T.invitedBy(r.invitedByName, ROLE[r.invitedByRole]);
  const link = r.status === 'submitted' || r.status === 'cancelled' ? statusLine(r) : r.status === 'expired' ? I.expiredOn(formatDate(r.expiresAt)) : I.validUntil(formatDate(r.expiresAt));
  return (
    <DetailCard
      label={`${K.invited} ${r.hotelName}`}
      leadWidth="lg"
      className="pf-hotel"
      warn={r.status === 'expired' || !!onReview}
      lead={
        <>
          <span className="pf-kind" aria-hidden="true">
            <Bi name={TYPE_ICON[r.type]} />
          </span>
          <StatusPill status={r.status} />
        </>
      }
      facts={[
        { label: K.invited, value: r.hotelName, sub: r.type === 'member_hotel' && r.groupName ? F.joinsGroup(r.groupName) : TYPE[r.type] },
        { label: K.contact, value: r.contactName, sub: <WrapEmail email={r.email} />, title: r.email },
        { label: K.sent, value: formatDate(r.createdAt), sub: by },
        { label: K.link, value: link, tone: r.status === 'expired' ? 'warn' : r.status === 'cancelled' ? 'muted' : undefined, sub: open ? statusLine(r) : undefined },
      ]}
      sections={[
        {
          icon: TYPE_ICON[r.type],
          title: K.about,
          content: (
            <DetailList
              items={[
                { label: K.type, value: TYPE[r.type] },
                r.groupName ? { label: K.group, value: r.groupName } : null,
                { label: K.contact, value: r.contactName },
                { label: K.email, value: <WrapEmail email={r.email} /> },
              ]}
            />
          ),
        },
        {
          icon: 'clock-history',
          title: K.history,
          tone: r.status === 'expired' ? 'warn' : undefined,
          content: (
            <DetailList
              items={[
                { label: K.sent, value: formatDateTime(r.createdAt) },
                { label: K.by, value: by },
                r.resendCount > 0 ? { label: K.resent, value: T.resendCount(r.resendCount) } : null,
                { label: K.opened, value: r.openedAt ? formatDateTime(r.openedAt) : F.notOpened },
                r.submittedAt ? { label: K.accepted, value: formatDateTime(r.submittedAt) } : null,
                r.cancelledAt ? { label: K.revoked, value: formatDateTime(r.cancelledAt) } : null,
                open ? { label: r.status === 'expired' ? K.expired : K.validUntil, value: formatDateTime(r.expiresAt) } : null,
              ]}
            />
          ),
        },
      ]}
      meta={r.status === 'expired' ? T.expiredHint : undefined}
      actions={
        open || onReview || dev ? (
          <>
            {dev ? (
              <>
                <DevCopyLink token={dev.token} />
                <Button variant="ghost" size="sm" icon="box-arrow-up-right" onClick={dev.openHere}>
                  {F.devOpenHere}
                </Button>
              </>
            ) : null}
            {open ? (
              <Button variant="ghost" size="sm" icon="x-circle" className="pf-quiet" title={F.rowAction(F.revoke, r.hotelName)} disabled={busy} onClick={() => onAsk('revoke')}>
                {F.revoke}
              </Button>
            ) : null}
            {open ? (
              <Button variant={r.status === 'expired' ? 'primary' : 'outline'} size="sm" icon="arrow-repeat" title={F.rowAction(F.resend, r.hotelName)} disabled={busy} onClick={() => onAsk('resend')}>
                {F.resend}
              </Button>
            ) : null}
            {onReview ? (
              <Button size="sm" icon="clipboard-check" onClick={onReview}>
                {F.reviewGroup}
              </Button>
            ) : null}
          </>
        ) : undefined
      }
    />
  );
}

function statusLine(r: PlatformInvitation): string {
  if (r.status === 'submitted') return r.submittedAt ? F.acceptedOn(formatDateTime(r.submittedAt)) : '';
  if (r.status === 'cancelled') return r.cancelledAt ? F.revokedOn(formatDateTime(r.cancelledAt)) : '';
  return r.openedAt ? F.openedOn(formatDateTime(r.openedAt)) : F.notOpened;
}

function StatusPill({ status }: { status: PlatformInvitationStatus }) {
  const [cls, icon] =
    status === 'submitted' ? ['pay-paid', 'check-circle'] : status === 'cancelled' ? ['pay-failed', 'x-circle'] : status === 'expired' ? ['pay-hold', 'hourglass-bottom'] : ['pay-pending', 'envelope'];
  return (
    <span className={`pay-pill ${cls}`}>
      <Bi name={icon} />
      {F.shown[status]}
    </span>
  );
}

/** Dev only (mock): one link per state of the public onboarding page. */
function DevPanel({ onOpenHere }: { onOpenHere: (token: string) => void }) {
  return (
    <div className="alert alert-info mt-3 reveal" role="note">
      <div className="d-flex align-items-center gap-2 mb-1">
        <Bi name="bug" />
        <strong>{F.devPanelTitle}</strong>
      </div>
      <p className="small mb-2">{F.devPanelNote}</p>
      <ul className="list-unstyled small mb-0">
        {DEV_TOKENS.map(([key, token]) => (
          <li key={key} className="d-flex flex-wrap align-items-center gap-2 py-1">
            <span className="flex-grow-1">{F.devTokens[key]}</span>
            <a className="btn btn-sm btn-ghost" href={devInviteLink(token)} target="_blank" rel="noreferrer">
              <Bi name="box-arrow-up-right" /> {F.devOpen}
            </a>
            <Button variant="ghost" size="sm" icon="window" onClick={() => onOpenHere(token)}>
              {F.devOpenHere}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Dev only: the public page over the console, so a link sent just now works (the mock data lives in this tab). Escape closes. */
function DevOnboardingOverlay({ token, onClose }: { token: string; onClose: () => void }) {
  // Not the kit Modal: the public page has its own full-page sign-in look. The kit's focus trap gives Tab-inside, Escape (top layer
  // only) and focus back to the opener; `modal-open` is removed only if this overlay added it (review L15b).
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true, onClose);
  useEffect(() => {
    const body = document.body;
    const added = !body.classList.contains('modal-open');
    if (added) body.classList.add('modal-open');
    return () => {
      if (added) body.classList.remove('modal-open');
    };
  }, []);
  return createPortal(
    <div ref={ref} tabIndex={-1} className="position-fixed top-0 start-0 w-100 h-100 overflow-auto" style={{ zIndex: 1085 }} role="dialog" aria-modal="true" aria-label={F.devOpenHere}>
      {/* First focus here, not on "Close (dev)" (the only control while the page loads: Enter then closed it). */}
      <div tabIndex={-1} data-autofocus style={{ outline: 'none' }}>
        <PlatformOnboarding token={token} onDevClose={onClose} />
      </div>
    </div>,
    document.body,
  );
}

/** The Group Hotel Admin's Invitations page (group.invitations): the same screen, scoped to the signed-in user's group (user.group). */
export const GroupInvitations = PlatformInvitations;

/** group.hotels.invite: the Invitations page with the invite window already open (hotel INTO the user's group). */
export function GroupInviteHotel(props: ScreenProps) {
  return <PlatformInvitations {...props} params={{ ...props.params, invite: '1' }} />;
}
