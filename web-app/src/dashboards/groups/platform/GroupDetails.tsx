'use client';

// platform.group { id }: one hotel group (Super Admin and Platform Admin). { invite }: a group invitation whose admin has not sent the form yet.
import { useEffect, useState, type MouseEvent } from 'react';
import type { DashError, DashResult } from '@shared/dashboards/common';
import { formatDate, formatDateTime } from '@shared/dashboards/format';
import { platformCopy, type PlatformActivity, type PlatformGroupDetail, type PlatformHotel, type PlatformInvitation } from '@shared/dashboards/platform';
import { errorText, useAction } from '@/components/ui';
import { Alert, Bi, Button, DetailCard, DetailList, DetailNone, Dialog, EmptyState, Field, FormSection, Modal, PageSkeleton, Pager, PmsSelect, useTableView } from '@/dashboards/pallav/ui';
import type { ScreenProps } from '../../types';
import { HomeStats, type HomeStat } from '../overview/HomeJobs';
import { useLoaded } from '../payrollCore/load';
import { initials } from '../payrollCore/pms';
import { platformApi } from './api';
import { asActor } from './enter';
import { GroupIntegrations } from './HotelIntegrations';
import { LifecyclePill } from './hotelParts';
import { Timeline, WrapEmail } from './superParts';

import { tr } from '@/lib/i18n/language';
const C = platformCopy.group;
const D = platformCopy.groupDetail;
const L = platformCopy.groupsList;
const P = platformCopy.groupPage;
const H = platformCopy.hotels;

const count = (n: number) => String(Math.round(n));

export function PlatformGroupDetails(props: ScreenProps) {
  return props.params.invite ? <WaitingInvite {...props} /> : <GroupView {...props} />;
}

function Crumbs({ name, toGroups }: { name: string; toGroups: () => void }) {
  const go = (e: MouseEvent) => {
    e.preventDefault();
    toGroups();
  };
  return (
    <nav className="crumbs" aria-label={tr("Breadcrumb")}>
      <a className="crumbs-back" href="#" onClick={go}>
        <Bi name="arrow-left" />
        <span>{D.back}</span>
      </a>
      <ol className="crumbs-trail">
        <li>
          <a href="#" onClick={go}>
            <Bi name="diagram-3" />
            <span>{D.crumbGroups}</span>
          </a>
        </li>
        <li aria-current="page">
          <span>{name}</span>
        </li>
      </ol>
    </nav>
  );
}

function GroupPill({ status }: { status: PlatformGroupDetail['group']['status'] }) {
  const [cls, icon] = status === 'active' ? ['pay-paid', 'check-circle'] : status === 'rejected' ? ['pay-failed', 'x-circle'] : ['pay-pending', 'hourglass-split'];
  return (
    <span className={`pay-pill ${cls}`}>
      <Bi name={icon} />
      {platformCopy.status.group[status]}
    </span>
  );
}

function GroupView({ user, params, navigate }: ScreenProps) {
  const id = params.id ?? '';
  const [version, setVersion] = useState(0);
  const detail = useLoaded(() => platformApi.getGroup(id), [id, version], id);
  const { busy, run } = useAction();
  const [adding, setAdding] = useState(false);
  const [settingAdmin, setSettingAdmin] = useState(false);
  const [removing, setRemoving] = useState<PlatformHotel | null>(null);
  const [clearing, setClearing] = useState(false);

  const refresh = () => setVersion((n) => n + 1);
  const toGroups = () => navigate('platform.groups');
  const asMe = () => asActor(user);

  const d = detail.data;
  if (!d) {
    if (!detail.error) return <PageSkeleton tiles={false} rows={5} />;
    if (detail.error.code === 'NOT_FOUND') {
      return (
        <div className="card">
          <EmptyState icon="diagram-3" title={D.notFound.title} text={D.notFound.body}>
            <Button variant="outline" icon="arrow-left" className="mt-3" onClick={toGroups}>
              {D.backToGroups}
            </Button>
          </EmptyState>
        </div>
      );
    }
    return <Failed error={detail.error} onRetry={detail.reload} title={D.loadErrorTitle} />;
  }

  const grp = d.group;
  const ga = grp.groupAdmin;
  const canLink = grp.status === 'active';
  const canSetAdmin = d.adminChoices.length > 0;
  const activeHotels = d.hotels.filter((h) => h.status === 'active').length;
  const admins = d.hotels.reduce((s, h) => s + h.adminCount, 0);
  const stats: HomeStat[] = [
    { id: 'hotels', label: P.figures.hotels, value: grp.hotelCount, format: count, note: P.figureNotes.hotels },
    { id: 'active', label: P.figures.active, value: activeHotels, format: count, note: P.figureNotes.active },
    { id: 'admins', label: P.figures.admins, value: admins, format: count, note: P.figureNotes.admins },
    grp.maxHotels === null
      ? { id: 'places', label: P.figures.places, value: 0, format: () => '–', note: P.figureNotes.noLimit }
      : { id: 'places', label: P.figures.places, value: Math.max(0, grp.maxHotels - grp.hotelCount), format: count, note: P.figureNotes.places },
  ];
  const about = [grp.legalName, grp.gstin, grp.address, grp.phone, grp.email].some(Boolean);

  return (
    <>
      <div className="page-head reveal">
        <div>
          <Crumbs name={grp.name} toGroups={toGroups} />
          <h2 className="pms-title">
            {grp.name} <GroupPill status={grp.status} />
          </h2>
          <p className="pms-sub">{D.sub(L.hotelCount(grp.hotelCount), formatDate(grp.createdAt))}</p>
        </div>
        {canLink ? (
          <div className="sh-head-actions">
            <Button icon="link-45deg" disabled={busy} onClick={() => setAdding(true)}>
              {C.addHotel}
            </Button>
          </div>
        ) : null}
      </div>

      <Stale error={detail.error} onRetry={detail.reload} />

      {grp.status === 'pending_approval' ? (
        <Alert tone="info" icon="hourglass-split" className="reveal">
          {D.pendingNote(ga?.name ?? '')}
        </Alert>
      ) : null}
      {grp.status === 'rejected' && grp.rejectReason ? (
        <Alert tone="danger" icon="x-circle" className="reveal">
          {platformCopy.approval.rejectedReason(grp.rejectReason)}
        </Alert>
      ) : null}

      <HomeStats stats={stats} />

      <div className="pf-detail-grid reveal">
        <div className="card p-3 p-md-4">
          <FormSection
            icon="person-badge"
            title={P.adminCard}
            hint={C.groupAdminHint}
            aside={
              canSetAdmin ? (
                <Button variant="outline" size="sm" icon={ga ? 'arrow-repeat' : 'person-check'} disabled={busy} onClick={() => setSettingAdmin(true)}>
                  {ga ? C.changeGroupAdmin : C.setGroupAdmin}
                </Button>
              ) : null
            }
          >
            {ga ? (
              <div className="pf-person">
                <span className="pf-kind pf-initials" aria-hidden="true">
                  {initials(ga.name)}
                </span>
                <DetailList
                  items={[
                    { label: P.adminName, value: ga.name },
                    { label: P.adminUsername, value: ga.username },
                    { label: P.adminHotel, value: ga.hotelName ? D.adminFrom(ga.hotelName) : P.groupAccount },
                  ]}
                />
                <Button variant="ghost" size="sm" icon="person-dash" className="pf-quiet" disabled={busy} onClick={() => setClearing(true)}>
                  {C.clearGroupAdmin}
                </Button>
              </div>
            ) : (
              <DetailNone>
                {D.noGroupAdmin} {canSetAdmin ? null : C.noChoices}
              </DetailNone>
            )}
          </FormSection>
        </div>
        <MaxHotelsCard
          key={`${grp.id}:${grp.maxHotels ?? ''}`}
          current={grp.maxHotels}
          busy={busy}
          onSave={(value, onFields) => {
            asMe();
            void run(() => platformApi.setGroupMaxHotels(grp.id, value), {
              success: value === null ? MAX_HOTELS.clearedDone : MAX_HOTELS.savedDone(value),
              onFields,
              onOk: refresh,
            });
          }}
        />
      </div>

      {about ? (
        <div className="card p-3 p-md-4 mb-3 reveal">
          <FormSection icon="diagram-3" title={P.aboutTitle} hint={P.aboutHint}>
            <DetailList
              className="pf-dl-2"
              items={[
                grp.legalName ? { label: P.about.legalName, value: grp.legalName } : null,
                grp.gstin ? { label: P.about.gstin, value: grp.gstin } : null,
                grp.address ? { label: P.about.address, value: grp.address } : null,
                grp.city || grp.state ? { label: P.about.place, value: [grp.city, grp.state].filter(Boolean).join(', ') } : null,
                grp.pin ? { label: P.about.pin, value: grp.pin } : null,
                grp.phone ? { label: P.about.phone, value: grp.phone } : null,
                grp.email ? { label: P.about.email, value: <WrapEmail email={grp.email} /> } : null,
                grp.submittedAt ? { label: P.about.submitted, value: formatDateTime(grp.submittedAt) } : null,
                grp.approvedAt ? { label: P.about.approved, value: formatDateTime(grp.approvedAt) } : null,
              ]}
            />
          </FormSection>
        </div>
      ) : null}

      {user.role === 'super_admin' ? <GroupIntegrations group={grp} user={user} /> : null}

      <div className="pf-sec">
        <h3>
          {P.hotelsHead} <span>{d.hotels.length}</span>
        </h3>
      </div>
      {d.hotels.length === 0 ? (
        <div className="card reveal mb-3">
          <EmptyState icon="building-add" title={C.noHotels} text={canLink ? D.noHotelsHint : D.noHotelsWaiting}>
            {canLink ? (
              <Button variant="outline" icon="link-45deg" className="mt-3" onClick={() => setAdding(true)}>
                {C.addHotel}
              </Button>
            ) : null}
          </EmptyState>
        </div>
      ) : (
        <div className="reveal mb-3">
          {d.hotels.map((h) => (
            <MemberCard key={h.id} hotel={h} busy={busy} onOpen={() => navigate('platform.hotel', { id: h.id })} onUnlink={() => setRemoving(h)} groupName={grp.name} />
          ))}
        </div>
      )}

      <ActivityCard activity={d.activity} />

      <Dialog
        open={removing !== null}
        tone="danger"
        icon="x-circle"
        title={removing ? C.removeTitle(removing.name, grp.name) : ''}
        message={C.removeBody}
        confirmLabel={D.removeConfirm}
        cancelLabel={D.cancel}
        busy={busy}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (!removing) return;
          const h = removing;
          asMe();
          void run(() => platformApi.removeHotelFromGroup(grp.id, h.id), { success: C.removed(h.name, grp.name), onOk: refresh }).then(() => setRemoving(null));
        }}
      />

      <Dialog
        open={clearing}
        tone="danger"
        icon="person-dash"
        title={D.clearAdminTitle(grp.name)}
        message={D.clearAdminBody}
        confirmLabel={C.clearGroupAdmin}
        cancelLabel={D.cancel}
        busy={busy}
        onCancel={() => setClearing(false)}
        onConfirm={() => {
          asMe();
          void run(() => platformApi.setGroupAdmin(grp.id, null), { success: C.adminCleared(grp.name), onOk: refresh }).then(() => setClearing(false));
        }}
      />

      {adding ? (
        <AddHotelModal
          detail={d}
          onClose={() => setAdding(false)}
          onSave={(hotelId, onFields) => {
            const h = d.availableHotels.find((x) => x.id === hotelId);
            asMe();
            void run(() => platformApi.addHotelToGroup(grp.id, hotelId), {
              success: C.added(h?.name ?? '', grp.name),
              onFields,
              onOk: () => {
                setAdding(false);
                refresh();
              },
            });
          }}
          busy={busy}
        />
      ) : null}

      {settingAdmin ? (
        <SetAdminModal
          detail={d}
          busy={busy}
          onClose={() => setSettingAdmin(false)}
          onSave={(adminId, onFields) => {
            const a = d.adminChoices.find((x) => x.id === adminId);
            asMe();
            void run(() => platformApi.setGroupAdmin(grp.id, adminId), {
              success: C.adminSet(a?.name ?? '', grp.name),
              onFields,
              onOk: () => {
                setSettingAdmin(false);
                refresh();
              },
            });
          }}
        />
      ) : null}
    </>
  );
}

function MemberCard({ hotel: h, groupName, busy, onOpen, onUnlink }: { hotel: PlatformHotel; groupName: string; busy: boolean; onOpen: () => void; onUnlink: () => void }) {
  const place = [h.city, h.state].filter(Boolean).join(', ');
  return (
    <DetailCard
      label={`${P.hotel} ${h.name}`}
      leadWidth="lg"
      className="pf-hotel"
      warn={h.lockedAdminCount > 0 || (h.status === 'active' && h.adminCount === 0)}
      lead={
        <>
          <span className="pf-kind" aria-hidden="true">
            <Bi name="building" />
          </span>
          <LifecyclePill status={h.status} />
        </>
      }
      facts={[
        { label: P.hotel, value: h.name, sub: place || undefined },
        { label: P.webAddress, value: h.slug },
        {
          label: P.admins,
          value: h.adminCount ? P.adminCount(h.adminCount) : P.noAdmin,
          tone: h.adminCount ? undefined : 'warn',
          sub: h.lockedAdminCount > 0 ? <><Bi name="lock-fill" /> {H.lockedCount(h.lockedAdminCount)}</> : undefined,
        },
        { label: P.created, value: formatDate(h.createdAt) },
      ]}
      sections={[
        {
          icon: 'building',
          title: P.aboutHotel,
          wide: true,
          content: (
            <DetailList
              items={[
                { label: P.webAddress, value: h.slug },
                { label: P.place, value: place || platformCopy.hotelConsole.list.card.notGiven },
                { label: P.gstin, value: h.gstin || platformCopy.hotelConsole.list.card.notGiven },
                { label: P.timeZone, value: h.timeZone },
              ]}
            />
          ),
        },
      ]}
      meta={C.unlinkHint}
      actions={
        <>
          <Button variant="ghost" size="sm" icon="x-circle" title={C.removeTitle(h.name, groupName)} disabled={busy} onClick={onUnlink}>
            {C.removeHotel}
          </Button>
          <Button variant="outline" size="sm" icon="eye" title={H.detailsTitle(h.name)} onClick={onOpen}>
            {P.openHotel}
          </Button>
        </>
      }
    />
  );
}

// ---------------------------------------------------------------- waiting (invited, not onboarded)

type InviteLook = { inv: PlatformInvitation | null; groupId: string | null };

async function loadInvite(id: string): Promise<DashResult<InviteLook>> {
  const [invites, groups] = await Promise.all([platformApi.listInvitations({ type: 'group', pageSize: 500 }), platformApi.listGroups()]);
  if (!invites.ok) return invites;
  if (!groups.ok) return groups;
  return { ok: true, data: { inv: invites.data.items.find((r) => r.id === id) ?? null, groupId: groups.data.find((x) => x.invitationId === id)?.id ?? null } };
}

function WaitingInvite({ params, navigate }: ScreenProps) {
  const id = params.invite ?? '';
  const look = useLoaded(() => loadInvite(id), [id], id);
  const toGroups = () => navigate('platform.groups');
  const madeGroup = look.data?.groupId ?? null;

  useEffect(() => {
    if (madeGroup) navigate('platform.group', { id: madeGroup });
  }, [madeGroup, navigate]);

  const v = look.data;
  if (!v || madeGroup) {
    if (!look.error || madeGroup) return <PageSkeleton tiles={false} rows={5} />;
    return <Failed error={look.error} onRetry={look.reload} title={D.loadErrorTitle} />;
  }
  const inv = v.inv;
  if (!inv || inv.status === 'cancelled') {
    return (
      <div className="card">
        <EmptyState icon="diagram-3" title={D.inviteNotFound.title} text={D.inviteNotFound.body}>
          <Button variant="outline" icon="arrow-left" className="mt-3" onClick={toGroups}>
            {D.backToGroups}
          </Button>
        </EmptyState>
      </div>
    );
  }
  const expired = inv.status === 'expired';

  return (
    <>
      <div className="page-head reveal">
        <div>
          <Crumbs name={inv.hotelName} toGroups={toGroups} />
          <h2 className="pms-title">
            {inv.hotelName}{' '}
            <span className={`pay-pill ${expired ? 'pay-hold' : 'pay-pending'}`}>
              <Bi name={expired ? 'hourglass-bottom' : 'envelope'} />
              {expired ? platformCopy.groups.invitePill.expired : platformCopy.groups.invitePill.waiting}
            </span>
          </h2>
          <p className="pms-sub">{D.inviteSub(formatDate(inv.createdAt))}</p>
        </div>
        <div className="sh-head-actions">
          <Button variant="outline" icon="envelope-paper" onClick={() => navigate('platform.invitations', { type: 'group', status: inv.status })}>
            {D.toInvitations}
          </Button>
        </div>
      </div>

      <Stale error={look.error} onRetry={look.reload} />

      <Alert tone={expired ? 'warning' : 'info'} icon={expired ? 'hourglass-bottom' : 'hourglass-split'} className="reveal">
        {D.waitingNote(inv.contactName)}
      </Alert>

      <div className="pf-detail-grid reveal">
        <div className="card p-3 p-md-4">
          <FormSection icon="envelope" title={P.inviteCard} hint={D.waitingHint}>
            <DetailList
              items={[
                { label: P.inviteContact, value: inv.contactName },
                { label: P.inviteEmail, value: inv.email },
                { label: P.inviteStatus, value: platformCopy.status.invitation[inv.status] },
                { label: P.inviteSent, value: formatDateTime(inv.createdAt) },
                { label: expired ? P.inviteExpired : P.inviteValid, value: formatDateTime(inv.expiresAt) },
              ]}
            />
          </FormSection>
        </div>
        <div className="card p-3 p-md-4">
          <FormSection icon="signpost-split" title={P.nextCard}>
            <ol className="pf-steps">
              {P.next.map((s, i) => (
                <li key={s}>
                  <span className="pf-step-n" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          </FormSection>
        </div>
      </div>

      <div className="pf-sec">
        <h3>
          {P.hotelsHead} <span>0</span>
        </h3>
      </div>
      <div className="card reveal mb-3">
        <EmptyState icon="building" title={C.noHotels} text={D.noHotelsWaiting} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------- states

const MAX_HOTELS = {
  title: 'Maximum hotels',
  hint: 'The most hotels this group may have. Hotels waiting for approval, active and suspended ones, and open invitations all count. Leave empty for no limit.',
  label: 'Maximum hotels',
  placeholder: 'No limit',
  save: 'Save limit',
  saving: 'Saving...',
  savedDone: (n: number) => `The group can now have up to ${n} ${n === 1 ? 'hotel' : 'hotels'}.`,
  clearedDone: 'The group has no hotel limit now.',
  wholeNumber: 'Enter a whole number up to 10,000, or leave it empty for no limit.',
} as const;

function MaxHotelsCard({ current, busy, onSave }: { current: number | null; busy: boolean; onSave: (value: number | null, onFields: (e: Record<string, string>) => void) => void }) {
  const [text, setText] = useState(current === null ? '' : String(current));
  const [error, setError] = useState('');
  const trimmed = text.trim();
  const changed = trimmed !== (current === null ? '' : String(current));
  const submit = () => {
    if (trimmed !== '' && !(/^\d{1,5}$/.test(trimmed) && Number(trimmed) <= 10000)) {
      setError(MAX_HOTELS.wholeNumber);
      return;
    }
    setError('');
    onSave(trimmed === '' ? null : Number(trimmed), (e) => setError(e.maxHotels ?? Object.values(e)[0] ?? ''));
  };
  return (
    <div className="card p-3 p-md-4">
      <FormSection icon="speedometer2" title={MAX_HOTELS.title} hint={MAX_HOTELS.hint}>
        <form
          className="pf-inline-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label={MAX_HOTELS.label} error={error} col="pf-inline-field">
            <input
              className={`form-control${error ? ' is-invalid' : ''}`}
              inputMode="numeric"
              autoComplete="off"
              placeholder={MAX_HOTELS.placeholder}
              value={text}
              disabled={busy}
              onChange={(e) => {
                setText(e.target.value);
                if (error) setError('');
              }}
            />
          </Field>
          <Button type="submit" variant="outline" icon="check2" disabled={busy || !changed}>
            {busy ? MAX_HOTELS.saving : MAX_HOTELS.save}
          </Button>
        </form>
      </FormSection>
    </div>
  );
}

function Failed({ error, onRetry, title }: { error: DashError; onRetry: () => void; title: string }) {
  const offline = error.code === 'NETWORK_OFFLINE';
  return (
    <div className="card">
      <EmptyState icon={offline ? 'wifi-off' : 'exclamation-triangle'} title={offline ? D.offlineTitle : title} text={errorText(error)}>
        <Button variant="outline" icon="arrow-clockwise" className="mt-3" onClick={onRetry}>
          {D.tryAgain}
        </Button>
      </EmptyState>
    </div>
  );
}

function Stale({ error, onRetry }: { error: DashError | null; onRetry: () => void }) {
  if (!error) return null;
  return (
    <div className="alert alert-warning d-flex flex-wrap align-items-center gap-2" role="alert">
      <Bi name={error.code === 'NETWORK_OFFLINE' ? 'wifi-off' : 'exclamation-triangle'} />
      <span className="flex-grow-1">
        {errorText(error)} {D.staleNote}
      </span>
      <Button variant="outline" size="sm" icon="arrow-clockwise" onClick={onRetry}>
        {D.tryAgain}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- activity

function ActivityCard({ activity }: { activity: PlatformActivity[] }) {
  const view = useTableView(activity, { perPage: 10 });
  return (
    <>
      <div className="pf-sec">
        <h3>{P.activityHead}</h3>
        <span className="pf-sec-note">{D.activityHint}</span>
      </div>
      <div className="card reveal mb-3">
        {activity.length === 0 ? (
          <EmptyState icon="clock-history" title={platformCopy.hotel.noActivity} text={D.activityHint} />
        ) : (
          <>
            <div className="p-3 p-md-4">
              <Timeline rows={view.rows} />
            </div>
            <Pager view={view} sizes={[10, 25, 50]} />
          </>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- modals

type SaveFn = (id: string, onFields: (f: Record<string, string>) => void) => void;

function AddHotelModal({ detail, busy, onClose, onSave }: { detail: PlatformGroupDetail; busy: boolean; onClose: () => void; onSave: SaveFn }) {
  const [hotelId, setHotelId] = useState('');
  const [error, setError] = useState('');
  const choices = detail.availableHotels.filter((h) => h.status !== 'archived' && h.status !== 'rejected');
  return (
    <Modal
      open
      onClose={onClose}
      title={D.addHotelTitle(detail.group.name)}
      staticBackdrop
      onSubmit={() => {
        if (!hotelId) {
          setError(D.chooseHotelError);
          return;
        }
        onSave(hotelId, (f) => setError(f.hotelId ?? ''));
      }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {D.cancel}
          </Button>
          <Button type="submit" icon="link-45deg" disabled={busy || choices.length === 0}>
            {busy ? D.saving : C.addHotel}
          </Button>
        </>
      }
    >
      {choices.length === 0 ? (
        <p className="mb-0">{C.noAvailable}</p>
      ) : (
        <>
          <p className="small text-muted">{D.addHotelHint}</p>
          <div className="row g-3">
            <Field label={D.hotelField} required error={error}>
              <PmsSelect
                value={hotelId}
                disabled={busy}
                aria-label={D.hotelField}
                onChange={(e) => {
                  setHotelId(e.target.value);
                  setError('');
                }}
              >
                <option value="">{D.chooseHotel}</option>
                {choices.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name} · {h.city}
                  </option>
                ))}
              </PmsSelect>
            </Field>
          </div>
        </>
      )}
    </Modal>
  );
}

function SetAdminModal({ detail, busy, onClose, onSave }: { detail: PlatformGroupDetail; busy: boolean; onClose: () => void; onSave: SaveFn }) {
  const [adminId, setAdminId] = useState(detail.group.groupAdmin?.adminId ?? '');
  const [error, setError] = useState('');
  const choices = detail.adminChoices;
  return (
    <Modal
      open
      onClose={onClose}
      title={D.adminTitle(detail.group.name)}
      staticBackdrop
      onSubmit={() => {
        if (!adminId) {
          setError(D.chooseAdminError);
          return;
        }
        onSave(adminId, (f) => setError(f.adminId ?? ''));
      }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {D.cancel}
          </Button>
          <Button type="submit" icon="person-check" disabled={busy || choices.length === 0}>
            {busy ? D.saving : D.saveAdmin}
          </Button>
        </>
      }
    >
      <p className="small text-muted">{C.groupAdminHint}</p>
      {choices.length === 0 ? (
        <p className="mb-0">{C.noChoices}</p>
      ) : (
        <div className="row g-3">
          <Field label={D.adminField} required error={error}>
            <PmsSelect
              value={adminId}
              disabled={busy}
              aria-label={D.adminField}
              onChange={(e) => {
                setAdminId(e.target.value);
                setError('');
              }}
            >
              <option value="">{D.chooseAdmin}</option>
              {choices.map((a) => (
                <option key={a.id} value={a.id}>
                  {D.adminOption(a.name, a.hotelName)}
                </option>
              ))}
            </PmsSelect>
          </Field>
        </div>
      )}
    </Modal>
  );
}
