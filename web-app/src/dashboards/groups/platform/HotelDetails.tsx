'use client';

// platform.hotel - one hotel on the platform (docs/plans/PLAN-PLATFORM-CONSOLE.md, page 4; A2 on MJ's model). Header with the
// lifecycle and kind pills; Enter hotel (active only, written reason, audited), Suspend / Reactivate, Add another admin, Archive (no
// delete: sign-in blocked, data kept, export offered) / Restore; an Approve / Reject panel for a hotel waiting for approval;
// tabs Overview (with status history), Admins, Settings (read only) and Activity (the audit trail, paged, newest first).
// Works on the mock or the real server (platformApi). Every write reloads the hotel and its activity, so all four tabs follow. A password is never shown.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { DashError } from '@shared/dashboards/common';
import { formatDate, formatDateTime } from '@shared/dashboards/format';
import { apiMode } from '@/lib/api/mode';
import { groupConsoleCopy } from '@shared/dashboards/groupConsole';
import { blankAdmin, onboardingMoreRows, platformCopy, type PlatformActivityAction, type PlatformAdminInput, type PlatformAdminStatus, type PlatformHotel, type PlatformHotelAdmin, type PlatformHotelDetail } from '@shared/dashboards/platform';
import { errorText, useAction, useDebounced, useToast } from '@/components/ui';
import { Alert, Bi, Button, DetailCard, DetailList, Dialog, Dropdown, EmptyState, Field, FieldHint, FormSection, ListSearch, Modal, PageSkeleton, Pager, SegTabs, pagerView, Textarea } from '@/dashboards/pallav/ui';
import type { ScreenProps } from '../../types';
import { HomeStats, type HomeStat } from '../overview/HomeJobs';
import { initials } from '../payrollCore/pms';
import { useLoaded } from '../payrollCore/load';
import { platformApi } from './api';
import { asActor } from './enter';
import { HotelIntegrations } from './HotelIntegrations';
import { EnterHotelModal, KindPill, LifecyclePill } from './hotelParts';
import { HotelVault } from './HotelVault';
import { Timeline, WrapEmail, When } from './superParts';

import { tr } from '@/lib/i18n/language';
const C = platformCopy.hotel;
const S = platformCopy.status;
const AP = platformCopy.approval;
const AR = platformCopy.archive;
const HC = platformCopy.hotelConsole.details;
const OF = platformCopy.onboarding.fields;

/** Activity that changes the hotel's status: the "Status history" (who, why, when). */
const STATUS_ACTIONS: readonly PlatformActivityAction[] = ['hotel_created', 'hotel_submitted', 'hotel_approved', 'hotel_rejected', 'hotel_suspended', 'hotel_reactivated', 'hotel_archived', 'hotel_restored'];

type Tab = 'overview' | 'admins' | 'settings' | 'integrations' | 'vault' | 'activity';
const TAB_IDS: readonly Tab[] = ['overview', 'admins', 'settings', 'integrations', 'vault', 'activity'];
// the hotel's set-up and its secrets sit together, for the Super Admin only (MJ, 5 Nov 2026); for anyone else the tabs are absent
const SUPER_TABS: readonly Tab[] = ['integrations', 'vault'];
const TAB_ICONS: Record<Tab, string> = { overview: 'grid-1x2', admins: 'people', settings: 'sliders', integrations: 'plug', vault: 'shield-lock', activity: 'clock-history' };
const tabsFor = (role: string): readonly Tab[] => (role === 'super_admin' ? TAB_IDS : TAB_IDS.filter((t) => !SUPER_TABS.includes(t)));

type AdminAsk = { kind: 'reset' | 'unlock' | 'disable' | 'enable'; admin: PlatformHotelAdmin };

/** platform.hotel, params { id, tab? } */
export function PlatformHotelDetails(props: ScreenProps) {
  const { user, params, navigate, back } = props;
  const id = params.id ?? '';
  const toast = useToast();
  // Back returns to where the page was opened from (Hotels, a group, the dashboard); with no history it falls back to Hotels.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [version, setVersion] = useState(0);
  const tabs = tabsFor(user.role);
  const isTab = (x: string | undefined): x is Tab => tabs.includes(x as Tab);
  const [tab, setTab] = useState<Tab>(isTab(params.tab) ? params.tab : 'overview');
  const detail = useLoaded(
    () => {
      asActor(user);
      return platformApi.getHotel(id);
    },
    [id, version],
    id,
  );
  const { busy, run } = useAction();
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [reactivateOpen, setReactivateOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [ask, setAsk] = useState<AdminAsk | null>(null);
  const [entering, setEntering] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);

  const refresh = () => setVersion((n) => n + 1);
  const toHotels = () => navigate('platform.hotels');
  const goBack = () => {
    back();
    setTimeout(() => {
      if (mounted.current) toHotels();
    }, 0);
  };
  // Mock: the test-version toast. Real server: POST /platform/hotels/{id}/export, Super Admin only (a Platform Admin does not see the button).
  // A Group Hotel Admin sees its member hotel: it may Enter (read-only), reset its admins and Unlink it; everything else is the platform team's.
  const groupAdmin = user.role === 'group_hotel_admin';
  const canExport = !groupAdmin && (apiMode() === 'mock' || user.role === 'super_admin');
  // Super Admin only (MJ, 5 Nov 2026): archiving and restoring a hotel; its Integrations and Vault tabs
  const isSuper = user.role === 'super_admin';
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const exportCsv = () => {
    if (apiMode() === 'mock') {
      toast.show({ tone: 'info', text: HC.exportMock });
      return;
    }
    void run(() => platformApi.exportHotelData(id), { success: (r) => `${r.message}. ${platformCopy.archivedHotels.exportFile(r.fileName)}` });
  };

  const d = detail.data;
  if (!d) {
    if (!detail.error) return <PageSkeleton />;
    if (detail.error.code === 'NOT_FOUND') {
      return (
        <div className="card">
          <EmptyState icon="building-x" title={C.notFound.title} text={C.notFound.body}>
            <Button variant="outline" icon="arrow-left" className="mt-3" onClick={toHotels}>
              {C.backToHotels}
            </Button>
          </EmptyState>
        </div>
      );
    }
    return <Failed error={detail.error} onRetry={detail.reload} title={C.loadErrorTitle} />;
  }

  const h = d.hotel;
  const live = h.status === 'active' || h.status === 'suspended';
  const changed = (r: { message: string; note: string | null }) => (r.note ? `${r.message} ${r.note}` : r.message);
  const more: { id: string; icon: string; label: string; run: () => void; danger?: boolean }[] = [
    ...(live && !groupAdmin ? [{ id: 'add', icon: 'person-plus', label: C.addAdmin, run: () => setAdding(true) }] : []),
    ...(h.status === 'archived' && canExport ? [{ id: 'export', icon: 'filetype-csv', label: HC.archiveExport, run: exportCsv }] : []),
    ...(groupAdmin && live && h.groupId ? [{ id: 'unlink', icon: 'link-45deg', label: groupConsoleCopy.unlink, run: () => setUnlinkOpen(true) }] : []),
    ...(h.status === 'active' && !groupAdmin ? [{ id: 'suspend', icon: 'pause-circle', label: C.suspend, run: () => setSuspendOpen(true), danger: true }] : []),
    ...(isSuper && (live || h.status === 'rejected') ? [{ id: 'archive', icon: 'archive', label: AR.archive, run: () => setArchiveOpen(true), danger: true }] : []),
  ];

  function confirmAsk(a: AdminAsk) {
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

  return (
    <>
      <div className="page-head reveal">
        <div>
          <nav className="crumbs" aria-label={tr("Breadcrumb")}>
            <a
              className="crumbs-back"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                goBack();
              }}
            >
              <Bi name="arrow-left" />
              <span>{C.back}</span>
            </a>
            <ol className="crumbs-trail">
              <li>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    toHotels();
                  }}
                >
                  <Bi name="buildings" />
                  <span>{C.crumbHotels}</span>
                </a>
              </li>
              <li aria-current="page">
                <span>{h.name}</span>
              </li>
            </ol>
          </nav>
          <h2 className="pms-title">
            {h.name} <LifecyclePill status={h.status} /> <KindPill kind={h.kind} />
          </h2>
          <p className="pms-sub">{[h.slug, h.city, h.groupName].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="sh-head-actions">
          {h.status === 'active' ? (
            <Button icon="box-arrow-in-right" disabled={busy} onClick={() => setEntering(true)}>
              {C.enter}
            </Button>
          ) : null}
          {h.status === 'suspended' && !groupAdmin ? (
            <Button icon="play-circle" disabled={busy} onClick={() => setReactivateOpen(true)}>
              {C.reactivate}
            </Button>
          ) : null}
          {h.status === 'archived' && isSuper ? (
            <Button icon="arrow-counterclockwise" disabled={busy || h.canRestore === false} title={h.canRestore === false ? AR.restoreOver : undefined} onClick={() => setRestoreOpen(true)}>
              {AR.restore}
            </Button>
          ) : null}
          {more.length ? (
            <Dropdown align="end" button={(p) => <Button variant="outline" icon="three-dots" title={HC.moreLabel(h.name)} disabled={busy} {...p}>{HC.more}</Button>}>
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
        </div>
      </div>

      <Stale error={detail.error} onRetry={detail.reload} />

      {h.status === 'pending_approval' ? (
        <Alert tone="info" icon="hourglass-split" className="reveal">
          <div className="fw-semibold">{AP.pendingBanner}</div>
        </Alert>
      ) : null}

      {h.status === 'rejected' ? (
        <Alert tone="danger" icon="x-circle" role="status" className="reveal">
          <div className="fw-semibold">{AP.rejectedBanner}</div>
          <div className="small">
            {h.rejectedAt ? HC.rejectedOn(formatDateTime(h.rejectedAt)) : null} {h.rejectReason ? AP.rejectedReason(h.rejectReason) : null}
          </div>
        </Alert>
      ) : null}

      {h.status === 'archived' ? (
        <Alert
          tone="neutral"
          icon="archive"
          className="reveal"
          action={
            canExport ? (
              <Button variant="outline" size="sm" icon="filetype-csv" onClick={exportCsv} disabled={busy}>
                {HC.archiveExport}
              </Button>
            ) : null
          }
        >
          <div className="fw-semibold">{AR.archivedBanner}</div>
          <div className="small">
            {h.archivedAt ? AR.archivedOn(formatDateTime(h.archivedAt)) : null} {h.archiveReason ? C.suspendedReason(h.archiveReason) : null}
          </div>
          {h.canRestore === false ? <div className="small">{AR.restoreOver}</div> : null}
        </Alert>
      ) : null}

      {h.status === 'pending_approval' && !groupAdmin ? (
        <ReviewPanel d={d} busy={busy} onApprove={() => setApproveOpen(true)} onReject={() => setRejectOpen(true)} />
      ) : null}

      {h.status === 'suspended' ? (
        <Alert tone="warning" icon="pause-circle" className="reveal">
          <div className="fw-semibold">{C.suspendedBanner}</div>
          <div className="small">
            {h.suspendedAt ? C.suspendedSince(formatDateTime(h.suspendedAt)) : null} {h.suspendReason ? C.suspendedReason(h.suspendReason) : null}
          </div>
        </Alert>
      ) : null}

      <SegTabs className="mb-3" label={C.tabsLabel} active={tab} onChange={(t) => isTab(t) && setTab(t)} tabs={tabs.map((t) => ({ id: t, label: C.tabs[t], icon: TAB_ICONS[t] }))} />

      {tab === 'overview' ? <OverviewTab d={d} onActivity={() => setTab('activity')} /> : null}
      {tab === 'admins' ? <AdminsTab admins={d.admins} busy={busy} onAsk={live ? setAsk : undefined} onAdd={live && !groupAdmin ? () => setAdding(true) : undefined} /> : null}
      {tab === 'settings' ? <SettingsTab d={d} /> : null}
      {tab === 'integrations' && isSuper ? <HotelIntegrations hotel={h} user={user} first={{ service: params.service, step: params.step }} /> : null}
      {tab === 'vault' && isSuper ? <HotelVault hotelId={h.id} onChanged={refresh} /> : null}
      {tab === 'activity' ? <ActivityTab hotelId={h.id} version={version} /> : null}

      {suspendOpen ? (
        <SuspendModal
          hotel={h}
          busy={busy}
          onClose={() => setSuspendOpen(false)}
          onConfirm={(reason) =>
            void run(() => platformApi.suspendHotel(h.id, reason), {
              success: C.suspended(h.name),
              onOk: () => {
                setSuspendOpen(false);
                refresh();
              },
            })
          }
        />
      ) : null}

      <Dialog
        open={reactivateOpen}
        icon="play-circle"
        title={C.reactivateTitle(h.name)}
        message={C.reactivateBody}
        confirmLabel={C.reactivate}
        cancelLabel={C.cancel}
        busy={busy}
        onCancel={() => setReactivateOpen(false)}
        onConfirm={() => void run(() => platformApi.reactivateHotel(h.id), { success: C.reactivated(h.name), onOk: refresh }).then(() => setReactivateOpen(false))}
      />

      <Dialog
        open={ask !== null}
        tone={ask?.kind === 'disable' ? 'danger' : ask?.kind === 'reset' ? 'warning' : 'primary'}
        icon={ask ? { reset: 'key', unlock: 'unlock', disable: 'slash-circle', enable: 'check-circle' }[ask.kind] : undefined}
        title={
          ask
            ? { reset: C.resetTitle, unlock: C.unlockTitle, disable: C.disableTitle, enable: C.enableTitle }[ask.kind](ask.admin.name)
            : ''
        }
        message={ask ? { reset: C.resetBody, unlock: C.unlockBody, disable: C.disableBody, enable: C.enableBody }[ask.kind] : undefined}
        confirmLabel={ask ? { reset: C.resetConfirm, unlock: C.unlock, disable: C.disable, enable: C.enable }[ask.kind] : undefined}
        cancelLabel={C.cancel}
        busy={busy}
        onCancel={() => setAsk(null)}
        onConfirm={() => ask && confirmAsk(ask)}
      />

      <Dialog
        open={unlinkOpen}
        title={groupConsoleCopy.unlinkTitle(h.name)}
        message={groupConsoleCopy.unlinkBody}
        confirmLabel={groupConsoleCopy.unlinkConfirm}
        busy={busy}
        onCancel={() => setUnlinkOpen(false)}
        onConfirm={() =>
          void run(() => platformApi.removeHotelFromGroup(h.groupId ?? '', h.id), { success: groupConsoleCopy.unlinked(h.name), onOk: () => navigate('group.hotels') }).then(() => setUnlinkOpen(false))
        }
      />

      {adding ? (
        <AddAdminModal
          hotelId={h.id}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            setTab('admins');
            refresh();
          }}
        />
      ) : null}

      {entering ? (
        <EnterHotelModal
          props={props}
          hotel={h}
          onClose={() => {
            setEntering(false);
            refresh();
          }}
        />
      ) : null}

      <Dialog
        open={approveOpen}
        icon="check2-circle"
        title={AP.approveTitle(h.name)}
        message={AP.approveBody}
        confirmLabel={AP.approveConfirm}
        cancelLabel={C.cancel}
        busy={busy}
        onCancel={() => setApproveOpen(false)}
        onConfirm={() => void run(() => platformApi.approveHotel(h.id), { success: changed, onOk: refresh }).then(() => setApproveOpen(false))}
      />

      {rejectOpen ? (
        <ReasonModal
          title={AP.rejectTitle(h.name)}
          body={AP.rejectBody}
          label={AP.rejectReason}
          placeholder={AP.rejectReasonPlaceholder}
          hint={HC.rejectReasonHint}
          required
          confirm={AP.rejectConfirm}
          icon="x-circle"
          busy={busy}
          onClose={() => setRejectOpen(false)}
          onConfirm={(reason, setError) =>
            void run(() => platformApi.rejectHotel(h.id, reason), {
              success: changed,
              onFields: (f) => setError(f.reason ?? ''),
              onOk: () => {
                setRejectOpen(false);
                refresh();
              },
            })
          }
        />
      ) : null}

      {archiveOpen ? (
        <ReasonModal
          title={AR.archiveTitle(h.name)}
          body={AR.archiveBody}
          label={AR.archiveReason}
          placeholder={C.reasonPlaceholder}
          hint={C.reasonHint}
          confirm={AR.archiveConfirm}
          icon="archive"
          busy={busy}
          extra={
            <>
              <Alert tone="warning" icon="shield-lock" role="note">
                {HC.archiveBlocked}
              </Alert>
              {canExport ? (
                <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
                  <Button variant="outline" size="sm" icon="filetype-csv" onClick={exportCsv} disabled={busy}>
                    {HC.archiveExport}
                  </Button>
                  <span className="small text-muted">{HC.archiveExportHint}</span>
                </div>
              ) : null}
            </>
          }
          onClose={() => setArchiveOpen(false)}
          onConfirm={(reason, setError) =>
            void run(() => platformApi.archiveHotel(h.id, reason), {
              success: changed,
              onFields: (f) => setError(f.reason ?? ''),
              onOk: () => {
                setArchiveOpen(false);
                refresh();
              },
            })
          }
        />
      ) : null}

      <Dialog
        open={restoreOpen}
        icon="arrow-counterclockwise"
        title={AR.restoreTitle(h.name)}
        message={AR.restoreBodyTo(h.restoresTo ?? 'active')}
        confirmLabel={AR.restoreConfirm}
        cancelLabel={C.cancel}
        busy={busy}
        onCancel={() => setRestoreOpen(false)}
        onConfirm={() => void run(() => platformApi.restoreHotel(h.id), { success: changed, onOk: refresh }).then(() => setRestoreOpen(false))}
      />
    </>
  );
}

// ---------------------------------------------------------------- states

function Failed({ error, onRetry, title }: { error: DashError; onRetry: () => void; title: string }) {
  const offline = error.code === 'NETWORK_OFFLINE';
  return (
    <div className="card">
      <EmptyState icon={offline ? 'wifi-off' : 'exclamation-triangle'} title={offline ? C.offlineTitle : title} text={errorText(error)}>
        <Button variant="outline" icon="arrow-clockwise" className="mt-3" onClick={onRetry}>
          {C.tryAgain}
        </Button>
      </EmptyState>
    </div>
  );
}

/** A reload that failed while the last details are still shown. */
function Stale({ error, onRetry }: { error: DashError | null; onRetry: () => void }) {
  if (!error) return null;
  return (
    <div className="alert alert-warning d-flex flex-wrap align-items-center gap-2" role="alert">
      <Bi name={error.code === 'NETWORK_OFFLINE' ? 'wifi-off' : 'exclamation-triangle'} />
      <span className="flex-grow-1">
        {errorText(error)} {C.staleNote}
      </span>
      <Button variant="outline" size="sm" icon="arrow-clockwise" onClick={onRetry}>
        {C.tryAgain}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- pieces

function AdminPill({ status }: { status: PlatformAdminStatus }) {
  if (status === 'pending')
    return (
      <span className="pay-pill pay-pending">
        <Bi name="hourglass-split" />
        {S.admin.pending}
      </span>
    );
  if (status === 'locked')
    return (
      <span className="pay-pill pay-failed">
        <Bi name="lock-fill" />
        {S.admin.locked}
      </span>
    );
  if (status === 'active')
    return (
      <span className="pay-pill pay-paid">
        <Bi name="check-circle" />
        {S.admin.active}
      </span>
    );
  return (
    <span className="pay-pill pay-hold">
      <Bi name="slash-circle" />
      {S.admin.disabled}
    </span>
  );
}

/** Label and value pairs (Bootstrap's description list in the grid). */
function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return <DetailList items={rows.map(([label, value]) => ({ key: label, label, value }))} />;
}

/** Approve / Reject: the onboarding form exactly as the hotel sent it (read only), with the two decisions. */
function ReviewPanel({ d, busy, onApprove, onReject }: { d: PlatformHotelDetail; busy: boolean; onApprove: () => void; onReject: () => void }) {
  const o = d.onboarding;
  const h = d.hotel;
  return (
    <div className="card p-3 p-md-4 mb-3 reveal">
      <FormSection icon="clipboard-check" title={HC.reviewTitle} hint={HC.reviewHint}>
        {h.groupName ? <p className="small text-muted">{AP.memberHotelNote(h.groupName)}</p> : null}
        {o ? (
          <>
            <p className="small text-muted">{AP.submittedOn(formatDateTime(o.submittedAt))}</p>
            <h4 className="pms-eyebrow mb-2">{HC.hotelSection}</h4>
            <Facts
              rows={[
                [OF.name, h.name],
                [AP.contact, o.contactName],
                [OF.address, o.address],
                [OF.city, o.city],
                [OF.state, o.state],
                [OF.pin, o.pin],
                [OF.gstin, o.gstin],
                [OF.phone, o.phone],
                [OF.email, o.email],
                [AP.logo, o.logoName ?? AP.noLogo],
                ...onboardingMoreRows(o),
              ]}
            />
            <h4 className="pms-eyebrow mb-2 mt-3">{HC.adminSection}</h4>
            <Facts
              rows={[
                [AP.adminFields.name, o.adminName],
                [AP.adminFields.username, o.adminUsername],
                [AP.adminFields.email, o.adminEmail],
                [AP.adminFields.mobile, o.adminMobile],
              ]}
            />
            <p className="small text-muted mt-2 mb-0">{AP.formHint}</p>
          </>
        ) : (
          <EmptyState icon="file-earmark-x" title={AP.formTitle} text={C.noActivity} />
        )}
        <div className="d-flex flex-wrap gap-2 mt-3">
          <Button icon="check2-circle" disabled={busy} onClick={onApprove}>
            {AP.approve}
          </Button>
          <Button variant="danger" icon="x-circle" disabled={busy} onClick={onReject}>
            {AP.reject}
          </Button>
        </div>
      </FormSection>
    </div>
  );
}

/** Status history: who, why and when, from the hotel's own activity (newest first). */
function StatusHistory({ d }: { d: PlatformHotelDetail }) {
  const rows = d.activity.filter((x) => STATUS_ACTIONS.includes(x.action));
  return (
    <div className="card p-3 p-md-4 mb-3 reveal">
      <FormSection icon="signpost-split" title={HC.historyTitle} hint={HC.historyHint}>
        {rows.length === 0 ? <p className="text-muted mb-0">{HC.noHistory}</p> : <Timeline rows={rows} />}
      </FormSection>
    </div>
  );
}

// ---------------------------------------------------------------- tabs

function OverviewTab({ d, onActivity }: { d: PlatformHotelDetail; onActivity: () => void }) {
  const h = d.hotel;
  const F = C.fields;
  const n = (s: PlatformAdminStatus) => d.admins.filter((a) => a.status === s).length;
  const count = (x: number) => String(Math.round(x));
  const stats: HomeStat[] = [
    { id: 'admins', label: C.counts.admins, value: d.admins.length, format: count, note: C.countHints.admins },
    { id: 'active', label: C.counts.active, value: n('active'), format: count, note: C.countHints.active },
    { id: 'locked', label: C.counts.locked, value: n('locked'), format: count, note: n('locked') > 0 ? C.countHints.locked : C.countHints.noneLocked },
    { id: 'disabled', label: C.counts.disabled, value: n('disabled'), format: count, note: C.countHints.disabled },
  ];
  const reason = h.status === 'suspended' ? h.suspendReason : h.status === 'rejected' ? h.rejectReason : h.status === 'archived' ? h.archiveReason : null;
  const since = h.status === 'suspended' ? h.suspendedAt : h.status === 'rejected' ? h.rejectedAt : h.status === 'archived' ? h.archivedAt : null;
  return (
    <>
      <HomeStats stats={stats} />
      <div className="pf-detail-grid reveal">
        <div className="card p-3 p-md-4">
          <FormSection icon="building" title={C.factsTitle} hint={C.factsHint}>
            <DetailList
              items={[
                { label: F.name, value: h.name },
                { label: F.slug, value: h.slug },
                { label: F.city, value: h.city },
                { label: F.state, value: h.state },
                { label: F.gstin, value: h.gstin },
                { label: F.timeZone, value: h.timeZone },
              ]}
            />
          </FormSection>
        </div>
        <div className="card p-3 p-md-4">
          <FormSection icon="diagram-3" title={HC.typeTitle}>
            <DetailList
              items={[
                { label: HC.kind, value: <KindPill kind={h.kind} /> },
                { label: F.group, value: h.groupName ?? C.noGroup },
              ]}
            />
          </FormSection>
          <FormSection icon="flag" title={HC.statusTitle}>
            <DetailList
              items={[
                { label: F.status, value: <LifecyclePill status={h.status} /> },
                since ? { label: HC.since, value: formatDateTime(since) } : null,
                reason ? { label: F.reason, value: reason } : null,
                { label: F.created, value: formatDate(h.createdAt) },
                h.submittedAt ? { label: HC.submitted, value: formatDateTime(h.submittedAt) } : null,
                {
                  label: C.tabs.activity,
                  value: (
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        onActivity();
                      }}
                    >
                      {C.countHints.activity(d.activity.length)}
                    </a>
                  ),
                },
              ]}
            />
          </FormSection>
        </div>
      </div>
      <StatusHistory d={d} />
    </>
  );
}

/** onAsk absent = the hotel is not live (archived, rejected, waiting): no row actions, only a note (review M9). */
function AdminsTab({ admins, busy, onAsk, onAdd }: { admins: PlatformHotelAdmin[]; busy: boolean; onAsk?: (a: AdminAsk) => void; onAdd?: () => void }) {
  const K = C.adminColumns;
  if (admins.length === 0) {
    return (
      <div className="card reveal">
        <EmptyState icon="people" title={C.noAdmins.title} text={C.noAdmins.body}>
          {onAdd ? (
            <Button icon="person-plus" className="mt-3" onClick={onAdd}>
              {C.addAdmin}
            </Button>
          ) : null}
        </EmptyState>
      </div>
    );
  }
  const A = HC.admin;
  const act = (kind: AdminAsk['kind'], a: PlatformHotelAdmin, glyph: string, label: string, variant: 'outline' | 'danger' = 'outline') => (
    <Button variant={variant} size="sm" icon={glyph} title={C.rowAction(label, a.name)} disabled={busy} onClick={() => onAsk?.({ kind, admin: a })}>
      {label}
    </Button>
  );
  return (
    <>
      {onAsk ? null : (
        <Alert tone="neutral" role="note" className="reveal">
          {platformCopy.errors.hotelNotLive}
        </Alert>
      )}
      <div className="reveal">
        {admins.map((a) => (
          <DetailCard
            key={a.id}
            label={`${K.name} ${a.name}`}
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
              { label: K.name, value: a.name, sub: a.groupAdminOf ? C.groupAdminOf(a.groupAdminOf.groupName) : a.username },
              { label: A.email, value: <WrapEmail email={a.email} />, title: a.email, sub: a.mobile },
              {
                label: A.lastSignIn,
                value: a.lastSignInAt ? <When iso={a.lastSignInAt} /> : C.neverSignedIn,
                tone: a.status === 'locked' ? 'warn' : a.lastSignInAt ? undefined : 'muted',
                sub: a.status === 'locked' && a.lockedAt ? C.lockedSince(formatDateTime(a.lockedAt)) : a.status === 'pending' ? HC.pendingAdminHint : undefined,
              },
            ]}
            sections={[
              {
                icon: 'person-badge',
                title: A.account,
                wide: true,
                content: (
                  <DetailList
                    items={[
                      { label: A.username, value: a.username },
                      { label: A.email, value: <WrapEmail email={a.email} /> },
                      { label: A.mobile, value: a.mobile },
                      { label: A.lastSignIn, value: a.lastSignInAt ? formatDateTime(a.lastSignInAt) : C.neverSignedIn },
                    ]}
                  />
                ),
              },
            ]}
            actions={
              a.status === 'pending' || !onAsk ? undefined : (
                <>
                  {a.status === 'locked' ? act('unlock', a, 'unlock', C.unlock) : null}
                  {a.status !== 'disabled' ? act('reset', a, 'key', C.resetPassword) : null}
                  {a.status === 'disabled' ? act('enable', a, 'check-circle', C.enable) : act('disable', a, 'slash-circle', C.disable, 'danger')}
                </>
              )
            }
          />
        ))}
      </div>
    </>
  );
}

function SettingsTab({ d }: { d: PlatformHotelDetail }) {
  const s = d.settings;
  const L = C.settings;
  return (
    <div className="pf-detail-grid reveal">
      <div className="card p-3 p-md-4">
        <FormSection icon="geo-alt" title={C.settingsPlace} hint={C.settingsPlaceHint}>
          <DetailList
            items={[
              { label: L.city, value: s.city },
              { label: L.state, value: s.state },
              { label: L.timeZone, value: s.timeZone },
            ]}
          />
        </FormSection>
      </div>
      <div className="card p-3 p-md-4">
        <FormSection icon="receipt" title={C.settingsTax} hint={C.settingsTaxHint}>
          <DetailList
            items={[
              { label: L.gstin, value: s.gstin },
              { label: L.stateCode, value: s.stateCode },
              { label: L.gstRooms, value: L.percent(s.gstDefaults.roomsPercent) },
              { label: L.gstFood, value: L.percent(s.gstDefaults.foodPercent) },
              { label: L.yearStart, value: C.months[s.accountingYearStartMonth - 1] ?? L.april },
            ]}
          />
        </FormSection>
      </div>
    </div>
  );
}

function ActivityTab({ hotelId, version }: { hotelId: string; version: number }) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [typed, setTyped] = useState('');
  const search = useDebounced(typed.trim(), 250);
  const list = useLoaded(() => platformApi.listActivity({ hotelId, search, page, pageSize: size }), [hotelId, search, page, size, version], hotelId);
  const data = list.data;
  if (!data) {
    if (!list.error) return <PageSkeleton tiles={false} rows={3} />;
    return <Failed error={list.error} onRetry={list.reload} title={C.activityErrorTitle} />;
  }
  const view = {
    ...pagerView(data, { setPage }),
    setPerPage: (n: number) => {
      setSize(n);
      setPage(1);
    },
  };
  return (
    <>
      <Stale error={list.error} onRetry={list.reload} />
      <div className="d-flex justify-content-end mb-2">
        <ListSearch value={typed} onChange={(v) => { setTyped(v); setPage(1); }} onClear={() => { setTyped(''); setPage(1); }} placeholder={tr("Search activity")} />
      </div>
      <div className="card reveal">
        {data.total === 0 ? (
          search ? (
            <EmptyState icon="search" title={tr("No activity matches that search")} text="Try another word.">
              <Button variant="outline" className="mt-3" onClick={() => { setTyped(''); setPage(1); }}>{tr("Clear search")}</Button>
            </EmptyState>
          ) : (
            <EmptyState icon="clock-history" title={C.noActivity} text={C.noActivityHint} />
          )
        ) : (
          <>
            <div className="p-3 p-md-4">
              <Timeline rows={data.items} />
            </div>
            <Pager view={view} sizes={[10, 25, 50]} server />
          </>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- modals

function SuspendModal({ hotel, busy, onClose, onConfirm }: { hotel: PlatformHotel; busy: boolean; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title={C.suspendTitle(hotel.name)}
      staticBackdrop
      onSubmit={() => onConfirm(reason.trim())}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {C.cancel}
          </Button>
          <Button type="submit" variant="dangerSolid" busy={busy} icon="pause-circle">{C.suspendConfirm}</Button>
        </>
      }
    >
      <p>{C.suspendBody}</p>
      <div className="row g-3">
        <Field label={C.suspendReason}>
          <Textarea rows={3} maxLength={200} placeholder={C.reasonPlaceholder} value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} />
          <FieldHint>{C.reasonHint}</FieldHint>
        </Field>
      </div>
    </Modal>
  );
}

/** Reject (reason required) and Archive (reason optional): a reason box, a field error, and an optional block above it. */
function ReasonModal({
  title,
  body,
  label,
  placeholder,
  hint,
  required = false,
  confirm,
  icon,
  busy,
  extra,
  onClose,
  onConfirm,
}: {
  title: string;
  body: string;
  label: string;
  placeholder: string;
  hint: string;
  required?: boolean;
  confirm: string;
  icon: string;
  busy: boolean;
  extra?: ReactNode;
  onClose: () => void;
  onConfirm: (reason: string, setError: (e: string) => void) => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      staticBackdrop
      onSubmit={() => {
        const why = reason.trim();
        if (required && !why) {
          setError(platformCopy.errors.required.reason);
          return;
        }
        onConfirm(why, setError);
      }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {C.cancel}
          </Button>
          <Button type="submit" variant="dangerSolid" busy={busy} icon={icon}>{confirm}</Button>
        </>
      }
    >
      <p>{body}</p>
      {extra}
      <div className="row g-3">
        <Field label={label} required={required} error={error}>
          <textarea
            className={`form-control${error ? ' is-invalid' : ''}`}
            rows={3}
            maxLength={500}
            placeholder={placeholder}
            value={reason}
            disabled={busy}
            aria-label={label}
            aria-required={required || undefined}
            aria-invalid={error ? true : undefined}
            onChange={(e) => {
              setReason(e.target.value);
              if (error) setError('');
            }}
          />
          <FieldHint>{hint}</FieldHint>
        </Field>
      </div>
    </Modal>
  );
}

function AddAdminModal({ hotelId, onClose, onSaved }: { hotelId: string; onClose: () => void; onSaved: () => void }) {
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
      title={C.addAdminTitle}
      staticBackdrop
      onSubmit={() =>
        void run(() => platformApi.addHotelAdmin(hotelId, v), {
          success: (r) => C.adminAdded(r.admin.name, r.admin.email),
          onFields: setErrors,
          onOk: onSaved,
        })
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {C.cancel}
          </Button>
          <Button type="submit" icon="person-plus" disabled={busy}>
            {busy ? C.saving : C.addAdminSave}
          </Button>
        </>
      }
    >
      <p className="small text-muted">{C.addAdminHint}</p>
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
        </div>
      </fieldset>
    </Modal>
  );
}
