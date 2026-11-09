'use client';

// group.hotel, params { id }: one member hotel (a hotel outside the group is "not found"). One main action (Look inside, active only) and a More
// menu (Manage admins, Remove from group; archiving is Super Admin only); the figures row; About the hotel and its status side by side; its Hotel Admins as
// cards with labelled buttons; what happened as a timeline.
import { useMemo, useState } from 'react';

import { formatDate, formatDateTime } from '@shared/dashboards/format';
import { groupCopy } from '@shared/dashboards/groupCopy';
import type { PlatformAdminStatus, PlatformHotel } from '@shared/dashboards/platform';

import type { ScreenProps } from '../../types';
import { useAction } from '@/components/ui';
import { Alert, Bi, Button, DetailList, Dialog, Dropdown, EmptyState, FormSection } from '@/dashboards/pallav/ui';
import { HomeStats, type HomeStat } from '../overview/HomeJobs';
import { StaleNote, Wait, useLoaded } from '../payrollCore/load';
import { LifecyclePill } from '../platform/hotelParts';
import { StickyActions } from '../portal/AppKit';
import { Timeline } from '../platform/superParts';
import { groupApiFor } from './api';
import { AdminCard, GroupEnterModal, useAdminAsk } from './parts';

const D = groupCopy.detail;
const NOT_GIVEN = groupCopy.hotels.card.notGiven;
const count = (n: number) => String(Math.round(n));

export function GroupHotelDetails(props: ScreenProps) {
  const { user, params, navigate } = props;
  const id = params.id ?? '';
  const api = useMemo(() => groupApiFor(user), [user]);
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((n) => n + 1);
  const { data, error, reload } = useLoaded(() => api.getMyHotel(id), [api, id, version], id);
  const { busy, run } = useAction();
  const admins = useAdminAsk(api, refresh);
  const [unlinking, setUnlinking] = useState(false);
  const [entering, setEntering] = useState(false);

  const toHotels = () => navigate('group.hotels');
  if (error?.code === 'NOT_FOUND') {
    return (
      <div className="card">
        <EmptyState icon="building-x" title={D.notFound} text={D.notFoundBody}>
          <Button variant="outline" icon="arrow-left" className="mt-3" onClick={toHotels}>
            {D.back}
          </Button>
        </EmptyState>
      </div>
    );
  }
  if (!data) return <Wait error={error} onRetry={reload} />;
  const h = data.hotel;
  const live = h.status === 'active' || h.status === 'suspended';
  const confirmUnlink = () => void run(() => api.unlinkHotel(h.id), { success: D.unlinkDone(h.name), onOk: toHotels });
  const more: { id: string; icon: string; label: string; run: () => void; danger?: boolean }[] = [
    ...(data.admins.length ? [{ id: 'admins', icon: 'people', label: D.manageAdmins, run: () => navigate('group.admins', { hotelId: h.id }) }] : []),
    ...(live || h.status === 'pending_approval' ? [{ id: 'unlink', icon: 'box-arrow-right', label: D.unlink, run: () => setUnlinking(true), danger: true }] : []),
  ];
  const n = (s: PlatformAdminStatus) => data.admins.filter((a) => a.status === s).length;
  const stats: HomeStat[] = [
    { id: 'admins', label: D.counts.admins, value: data.admins.length, format: count, note: D.countNotes.admins },
    { id: 'active', label: D.counts.active, value: n('active'), format: count, note: D.countNotes.active },
    { id: 'locked', label: D.counts.locked, value: n('locked'), format: count, note: n('locked') > 0 ? D.countNotes.locked : D.countNotes.noneLocked },
    { id: 'disabled', label: D.counts.disabled, value: n('disabled'), format: count, note: D.countNotes.disabled },
  ];

  return (
    <>
      <div className="page-head reveal">
        <div>
          <nav className="crumbs" aria-label={D.breadcrumb}>
            <a
              className="crumbs-back"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                toHotels();
              }}
            >
              <Bi name="arrow-left" />
              <span>{D.back}</span>
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
                  <span>{D.crumbHotels}</span>
                </a>
              </li>
              <li aria-current="page">
                <span>{h.name}</span>
              </li>
            </ol>
          </nav>
          <h2 className="pms-title">
            {h.name} <LifecyclePill status={h.status} />
          </h2>
          <p className="pms-sub">{[h.slug, [h.city, h.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="sh-head-actions">
          {h.status === 'active' ? (
            <Button icon="box-arrow-in-right" className="gc-head-enter" disabled={busy} onClick={() => setEntering(true)}>
              {groupCopy.hotels.enter}
            </Button>
          ) : null}
          {more.length ? (
            <Dropdown
              align="end"
              className="gc-head-more"
              button={(p) => (
                <Button variant="outline" icon="three-dots" title={D.moreLabel(h.name)} disabled={busy} {...p}>
                  {D.more}
                </Button>
              )}
            >
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

      <StaleNote error={error} onRetry={reload} />
      <StatusBanner hotel={h} />

      <div className="hd gc-detail">
        <HomeStats stats={stats} />

        <div className="pf-detail-grid">
          <div className="card p-3 p-md-4">
            <FormSection icon="building" title={D.factsTitle} hint={D.factsHint}>
              <DetailList
                items={[
                  { label: D.facts.slug, value: <span className="hms-wrap-any">{h.slug}</span> },
                  { label: D.facts.city, value: [h.city, h.state].filter(Boolean).join(', ') || NOT_GIVEN },
                  { label: D.facts.gstin, value: h.gstin || NOT_GIVEN },
                  { label: D.facts.timeZone, value: h.timeZone },
                ]}
              />
            </FormSection>
          </div>
          <div className="card p-3 p-md-4">
            <FormSection icon="flag" title={D.statusTitle}>
              <DetailList items={statusRows(h)} />
            </FormSection>
          </div>
        </div>

        <div className="hd-sec">
          <h3>{data.admins.length ? `${D.adminsTitle} · ${data.admins.length}` : D.adminsTitle}</h3>
          {data.admins.length ? (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                navigate('group.admins', { hotelId: h.id });
              }}
            >
              {D.manageAdmins} <Bi name="arrow-right-short" />
            </a>
          ) : null}
        </div>
        {data.admins.length ? (
          <div>
            {live ? null : (
              <Alert tone="neutral" role="note">
                {D.notLive}
              </Alert>
            )}
            {data.admins.map((a) => (
              <AdminCard key={a.id} admin={a} busy={admins.busy} onAsk={live ? admins.setAsk : undefined} />
            ))}
          </div>
        ) : (
          <div className="card hm-empty">
            <EmptyState icon="people" title={D.noAdmins} text={D.noAdminsBody} />
          </div>
        )}

        <div className="card p-3 p-md-4">
          <FormSection icon="clock-history" title={D.activityTitle} hint={D.activityHint}>
            {data.activity.length ? <Timeline rows={data.activity.slice(0, 12)} /> : <p className="text-muted mb-0">{D.noActivity}</p>}
          </FormSection>
        </div>
      </div>

      {admins.dialog}

      <Dialog
        open={unlinking}
        tone="warning"
        icon="box-arrow-right"
        title={D.unlinkTitle(h.name)}
        message={D.unlinkBody}
        confirmLabel={D.unlink}
        cancelLabel={D.cancel}
        busy={busy}
        onCancel={() => setUnlinking(false)}
        onConfirm={confirmUnlink}
      />

      {h.status === 'active' ? (
        <StickyActions label={groupCopy.hotels.enterTitle(h.name)}>
          <Button icon="box-arrow-in-right" disabled={busy} onClick={() => setEntering(true)}>
            {groupCopy.hotels.enter}
          </Button>
        </StickyActions>
      ) : null}

      {entering ? <GroupEnterModal props={props} hotel={{ id: h.id, name: h.name }} onClose={() => setEntering(false)} /> : null}
    </>
  );
}

function since(h: PlatformHotel): { at: string | null; reason: string | null } {
  if (h.status === 'suspended') return { at: h.suspendedAt, reason: h.suspendReason };
  if (h.status === 'rejected') return { at: h.rejectedAt, reason: h.rejectReason };
  if (h.status === 'archived') return { at: h.archivedAt, reason: h.archiveReason };
  return { at: null, reason: null };
}

function statusRows(h: PlatformHotel) {
  const s = since(h);
  return [
    { label: D.facts.status, value: <LifecyclePill status={h.status} /> },
    s.at ? { label: D.since, value: formatDateTime(s.at) } : null,
    s.reason ? { label: D.reason, value: s.reason } : null,
    { label: D.group, value: h.groupName ?? NOT_GIVEN },
    { label: D.facts.joined, value: formatDate(h.createdAt) },
    h.submittedAt ? { label: D.submitted, value: formatDateTime(h.submittedAt) } : null,
  ];
}

function StatusBanner({ hotel: h }: { hotel: PlatformHotel }) {
  const B = D.banner;
  const s = since(h);
  const extra = [s.at ? B.since(formatDateTime(s.at)) : '', s.reason ? B.reason(s.reason) : ''].filter(Boolean).join(' ');
  const shown =
    h.status === 'suspended'
      ? { tone: 'warning' as const, icon: 'pause-circle', text: B.suspended }
      : h.status === 'pending_approval'
        ? { tone: 'info' as const, icon: 'hourglass-split', text: B.pending }
        : h.status === 'rejected'
          ? { tone: 'danger' as const, icon: 'x-circle', text: B.rejected }
          : h.status === 'archived'
            ? { tone: 'neutral' as const, icon: 'archive', text: B.archived }
            : null;
  if (!shown) return null;
  return (
    <Alert tone={shown.tone} icon={shown.icon} role="status" className="reveal">
      <div className="fw-semibold">{shown.text}</div>
      {extra ? <div className="small">{extra}</div> : null}
    </Alert>
  );
}
