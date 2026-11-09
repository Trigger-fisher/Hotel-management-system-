'use client';

// platform.overview: the Platform console's Today page for the Super Admin and the Platform Admin (MJ, 5 Nov 2026: the hotel Home's pattern). A greeting,
// the jobs that wait (hotels and groups to review, invitations, locked accounts), Needs attention with one button per row, the figures as one quiet row,
// then the recent hotels. Archived hotels are never counted. Works on the mock or the real server; every word comes from platformCopy.
import { useState, type MouseEvent, type ReactNode } from 'react';

import { formatDate, formatWeekdayDate, istWallClock } from '@shared/dashboards/format';
import { overviewCopy } from '@shared/dashboards/overview';
import { PLATFORM_MOCK_TODAY, platformCopy, type PlatformAttentionItem, type PlatformHotelPage, type PlatformInvitationPage, type PlatformOverview } from '@shared/dashboards/platform';

import type { ScreenProps } from '../../types';
import { useToast } from '@/components/ui';
import { Bi, Button, Dialog, EmptyState, PageHead } from '@/dashboards/pallav/ui';
import { HomeJobs, HomeStats, type HomeJob, type HomeStat } from '../overview/HomeJobs';
import { StaleNote, Wait, useLoaded } from '../payrollCore/load';
import { platformApi, platformDemoKept, resetPlatformDemo } from './api';
import { LifecyclePill, isInactive, loadHotelFacts, type HotelFacts } from './hotelParts';

const c = platformCopy.overview;
const D = platformCopy.hotelConsole.dashboard;
const H = D.home;
const K = platformCopy.hotelConsole;
const R = platformCopy.demoReset;
const G = overviewCopy.dashboard.home.greeting;
const greeting = (hh: number) => (hh < 12 ? G.morning : hh < 17 ? G.afternoon : G.evening);
const count = (n: number) => String(Math.round(n));

export function PlatformDashboard({ user, navigate }: ScreenProps) {
  const { data, error, reload } = useLoaded(() => platformApi.getOverview(), []);
  // Side figures: the page still opens when one of them fails (its tiles show a dash and a Try again note).
  const hotels = useLoaded(() => platformApi.listHotels({ pageSize: 10_000 }), []);
  const invites = useLoaded(() => platformApi.listInvitations({ pageSize: 1 }), []);
  const facts = useLoaded(() => loadHotelFacts(), []);
  const go = (fn: () => void) => (e: MouseEvent) => {
    e.preventDefault();
    fn();
  };
  const openHotel = (id: string, tab?: string) => navigate('platform.hotel', tab ? { id, tab } : { id });
  const sideError = hotels.error ?? invites.error ?? facts.error;
  const retrySide = () => {
    if (hotels.error) hotels.reload();
    if (invites.error) invites.reload();
    if (facts.error) facts.reload();
  };

  return (
    <>
      <PageHead sub={D.subtitle} actionsClass="hd-head-actions">
        <a className="btn btn-p" href="#" onClick={go(() => navigate('platform.invitations', { invite: '1' }))}>
          <Bi name="envelope-plus" /> {D.inviteHotel}
        </a>
      </PageHead>
      {data ? (
        <Body
          name={user.displayName}
          data={data}
          hotels={hotels.data}
          invites={invites.data}
          facts={facts.data}
          navigate={navigate}
          openHotel={openHotel}
          go={go}
          stale={
            <>
              <StaleNote error={error} onRetry={reload} />
              {!error && sideError && !(hotels.data && invites.data && facts.data) ? (
                <div className="alert alert-warning d-flex flex-wrap align-items-center gap-2" role="alert">
                  <Bi name={sideError.code === 'NETWORK_OFFLINE' ? 'wifi-off' : 'exclamation-triangle'} />
                  <span className="flex-grow-1">{D.partialError}</span>
                  <Button variant="outline" size="sm" icon="arrow-clockwise" onClick={retrySide}>
                    {platformCopy.hotel.tryAgain}
                  </Button>
                </div>
              ) : null}
            </>
          }
        />
      ) : (
        <Wait error={error} onRetry={reload} />
      )}
      {user.role === 'super_admin' && platformDemoKept() ? (
        <DemoReset
          onDone={() => {
            reload();
            hotels.reload();
            invites.reload();
            facts.reload();
          }}
        />
      ) : null}
    </>
  );
}

/** Super Admin, mock mode only: the footer's "Reset demo data" (confirm, then the console's starting test data again). Not Pallav. */
function DemoReset({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  return (
    <footer className="d-flex flex-wrap align-items-center justify-content-end gap-2 mt-4 pt-3 border-top">
      <small className="text-muted">{R.note}</small>
      <Button variant="outline" size="sm" icon="arrow-counterclockwise" onClick={() => setAsking(true)}>
        {R.button}
      </Button>
      <Dialog
        open={asking}
        tone="danger"
        icon="arrow-counterclockwise"
        title={R.title}
        message={R.message}
        confirmLabel={R.confirm}
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          resetPlatformDemo();
          setAsking(false);
          toast.show({ tone: 'success', text: R.done });
          onDone();
        }}
      />
    </footer>
  );
}

function Body({
  name,
  data,
  hotels,
  invites,
  facts,
  navigate,
  openHotel,
  stale,
}: {
  name: string;
  data: PlatformOverview;
  hotels: PlatformHotelPage | null;
  invites: PlatformInvitationPage | null;
  facts: Record<string, HotelFacts> | null;
  navigate: ScreenProps['navigate'];
  openHotel: (id: string, tab?: string) => void;
  go: (fn: () => void) => (e: MouseEvent) => void;
  stale: ReactNode;
}) {
  const t = data.tiles;
  const attention = data.needsAttention;
  const active = hotels ? hotels.items.filter((h) => h.status === 'active') : [];
  const stuck = hotels && facts ? active.filter((h) => !facts[h.id]?.adminSignedIn).length : null;
  const inactive = hotels && facts ? active.filter((h) => isInactive(facts[h.id], h.createdAt)).length : null;
  const invitesOpen = invites ? invites.counts.sent + invites.counts.opened : null;
  const invitesExpired = invites ? invites.counts.expired : 0;
  const pendingHotels = t.pendingHotels ?? t.pendingApproval;
  const pendingGroups = t.pendingGroups ?? 0;
  const firstName = name.split(' ')[0] ?? name;
  const today = PLATFORM_MOCK_TODAY;

  const openAttention = (a: PlatformAttentionItem) => {
    if (a.kind === 'pending_group' && a.groupId) navigate('platform.group', { id: a.groupId });
    else if (a.kind === 'locked_account' || a.kind === 'no_admin') openHotel(a.hotelId, 'admins');
    else openHotel(a.hotelId);
  };

  const jobs: HomeJob[] = [
    { id: 'hotels', label: H.jobs.hotels.label, note: pendingHotels > 0 ? H.jobs.hotels.note : H.jobs.hotels.none, count: pendingHotels, hot: pendingHotels > 0, onOpen: () => navigate('platform.hotels', { status: 'pending_approval' }) },
    { id: 'groups', label: H.jobs.groups.label, note: pendingGroups > 0 ? H.jobs.groups.note : H.jobs.groups.none, count: pendingGroups, hot: pendingGroups > 0, onOpen: () => navigate('platform.groups', { status: 'pending' }) },
    { id: 'invites', label: H.jobs.invites.label, note: H.jobs.invites.note(invitesExpired), count: invitesOpen, onOpen: () => navigate('platform.invitations', { status: 'pending' }) },
    { id: 'locked', label: H.jobs.locked.label, note: t.lockedAccounts > 0 ? H.jobs.locked.note : H.jobs.locked.none, count: t.lockedAccounts, hot: t.lockedAccounts > 0, onOpen: () => navigate('platform.admins', { status: 'locked' }) },
  ];
  const stats: HomeStat[] = [
    { id: 'active', label: H.figures.active, value: t.hotelsActive, format: count, note: H.figureNotes.active },
    { id: 'created', label: H.figures.created, value: t.createdThisMonth, format: count, note: H.figureNotes.created },
    { id: 'suspended', label: H.figures.suspended, value: t.hotelsSuspended, format: count, note: H.figureNotes.suspended },
    
    
    { id: 'admins', label: H.figures.admins, value: t.hotelAdmins, format: count, note: H.figureNotes.admins },
  ];

  return (
    <div className="hd">
      {stale}
      <div className="hm-greet">
        <div>
          <h2>{greeting(istWallClock().hh)}, {firstName}</h2>
          <p>{H.line(formatWeekdayDate(today, { long: true }))}</p>
        </div>
        <span className="hm-greet-note">{H.summary(t.hotelsActive, t.groups, t.hotelAdmins)}</span>
      </div>

      <HomeJobs jobs={jobs} label={H.jobsLabel} />

      <div className="hd-sec"><h3>{attention.length ? `${H.attention} · ${attention.length}` : H.attention}</h3></div>
      {attention.length ? (
        <div className="hm-queue pf-attn">
          {attention.map((a) => (
            <div key={a.id} className="hm-q">
              <i className={`hm-dot ${a.kind === 'no_admin' || a.kind === 'pending_approval' || a.kind === 'pending_group' ? 'tone-info' : 'tone-warn'}`} aria-hidden="true" />
              <div className="hm-q-text"><b>{a.text}</b></div>
              <Button variant="outline" size="sm" onClick={() => openAttention(a)}>{c.attentionAction[a.kind]}</Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="hm-empty"><EmptyState icon="check2-circle" title={c.attentionEmpty} /></div>
      )}

      <div className={`pf-figs n-${stats.length}`}>
        <HomeStats stats={stats} />
      </div>

      <div className="hd-sec">
        <h3>{H.recent}</h3>
        <a href="#" onClick={(e) => { e.preventDefault(); navigate('platform.hotels'); }}>{c.viewAll} <Bi name="arrow-right-short" /></a>
      </div>
      {data.recentHotels.length ? (
        <div className="hm-queue">
          {data.recentHotels.map((h) => (
            <div key={h.id} className="hm-q pf-recent">
              <span className="pf-kind" aria-hidden="true"><Bi name={h.kind === 'group' ? 'diagram-3' : 'building'} /></span>
              <div className="hm-q-text">
                <b title={h.name}>{h.name}</b>
                <small>{c.recentDetail(h.city, h.groupName ?? K.list.individual)} · {c.createdOn(formatDate(h.createdAt))}</small>
              </div>
              <LifecyclePill status={h.status} />
              <Button variant="outline" size="sm" onClick={() => openHotel(h.id)}>{H.open}</Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="hm-empty"><EmptyState icon="building-add" title={c.recentEmpty} /></div>
      )}
    </div>
  );
}
