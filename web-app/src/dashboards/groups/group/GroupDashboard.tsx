'use client';

// group.overview: the Group Hotel Admin's Today page (the Platform Today pattern for one group): greeting, Set up your group (until done), the jobs that wait, Needs attention,
// one quiet row of figures, then the member hotels and the group's recent activity. Only the signed-in group is ever read.
import { useMemo, type ReactNode } from 'react';

import { formatDate, formatINR, formatWeekdayDate, istWallClock } from '@shared/dashboards/format';
import { groupCopy } from '@shared/dashboards/groupCopy';
import { groupConsoleCopy, type GroupOverview } from '@shared/dashboards/groupConsole';
import type { GroupPaymentsOverview } from '@shared/dashboards/groupPayments';
import { overviewCopy } from '@shared/dashboards/overview';
import type { PlatformHotel, PlatformHotelAdmin, PlatformInvitationPage } from '@shared/dashboards/platform';

import type { ScreenProps } from '../../types';
import { Bi, Button, EmptyState, PageHead } from '@/dashboards/pallav/ui';
import { HomeJobs, HomeStats, type HomeJob, type HomeStat } from '../overview/HomeJobs';
import { StaleNote, Wait, useLoaded } from '../payrollCore/load';
import { LifecyclePill } from '../platform/hotelParts';
import { Timeline } from '../platform/superParts';
import { groupApiFor } from './api';
import { groupPaymentsApi } from './paymentsApi';
import { GroupSetupCard } from './SetupCard';

const c = groupCopy.overview;
const H = c.home;
const G = overviewCopy.dashboard.home.greeting;
const greeting = (hh: number) => (hh < 12 ? G.morning : hh < 17 ? G.afternoon : G.evening);
const count = (n: number) => String(Math.round(n));
const money = (paise: number) => formatINR(Math.round(paise));

type Stamped = GroupOverview & { now: number };
type Attention = { id: string; tone: 'warn' | 'info'; text: string; action: string; run: () => void };

export function GroupDashboard({ user, navigate }: ScreenProps) {
  const api = useMemo(() => groupApiFor(user), [user]);
  const { data, error, reload } = useLoaded<Stamped>(async () => {
    const r = await api.groupOverview();
    return r.ok ? { ok: true, data: { ...r.data, now: Date.now() } } : r;
  }, [api]);
  const hotels = useLoaded(() => api.myHotels({ pageSize: 500 }), [api]);
  const expired = useLoaded(() => api.myInvitations({ status: 'expired', pageSize: 5 }), [api]);
  const locked = useLoaded(() => api.myHotelAdmins({ status: 'locked', liveOnly: true, pageSize: 5 }), [api]);
  const pay = useLoaded(() => groupPaymentsApi.overview(), []);
  const side = [hotels, expired, locked, pay];
  const sideFailed = side.some((s) => s.error && !s.data);
  const retrySide = () => side.forEach((s) => s.error && s.reload());

  return (
    <>
      <PageHead sub={data ? c.subtitle(data.group.name) : undefined} actionsClass="hd-head-actions">
        {data?.group.isPrimaryAdmin === false || (data && data.group.maxHotels !== null && data.tiles.hotelsCounted >= data.group.maxHotels) ? null : (
          <Button icon="envelope-plus" onClick={() => navigate('group.hotels.invite')}>
            {c.inviteHotel}
          </Button>
        )}
      </PageHead>
      {!data ? (
        <Wait error={error} onRetry={reload} />
      ) : (
        <Body
          name={user.displayName}
          data={data}
          navigate={navigate}
          hotels={hotels.data?.items ?? null}
          expired={expired.data}
          locked={locked.data?.items ?? null}
          pay={pay.data}
          payRetry={pay.error && !pay.data ? pay.reload : undefined}
          stale={
            <>
              <StaleNote error={error} onRetry={reload} />
              {!error && sideFailed ? (
                <div className="alert alert-warning d-flex flex-wrap align-items-center gap-2" role="alert">
                  <Bi name="exclamation-triangle" />
                  <span className="flex-grow-1">{H.partialError}</span>
                  <Button variant="outline" size="sm" icon="arrow-clockwise" onClick={retrySide}>
                    {H.tryAgain}
                  </Button>
                </div>
              ) : null}
            </>
          }
        />
      )}
    </>
  );
}

function Body({
  name,
  data,
  navigate,
  hotels,
  expired,
  locked,
  pay,
  payRetry,
  stale,
}: {
  name: string;
  data: Stamped;
  navigate: ScreenProps['navigate'];
  hotels: PlatformHotel[] | null;
  expired: PlatformInvitationPage | null;
  locked: PlatformHotelAdmin[] | null;
  pay: GroupPaymentsOverview | null;
  payRetry?: () => void;
  stale: ReactNode;
}) {
  const t = data.tiles;
  const firstName = name.split(' ')[0] || name;
  const clock = istWallClock(data.now);
  const A = H.attentionText;
  const K = H.attentionAction;

  const attention: Attention[] = [
    ...(locked ?? []).map((a) => ({ id: `l-${a.id}`, tone: 'warn' as const, text: A.locked(a.name, a.hotelName), action: K.locked, run: () => navigate('group.admins', { status: 'locked', hotelId: a.hotelId }) })),
    ...(expired?.items ?? []).map((i) => ({ id: `e-${i.id}`, tone: 'warn' as const, text: A.expired(i.hotelName), action: K.expired, run: () => navigate('group.invitations', { status: 'expired' }) })),
    ...(pay?.hotels ?? []).filter((h) => h.openProblems > 0).map((h) => ({ id: `p-${h.hotelId}`, tone: 'warn' as const, text: A.problems(h.hotelName, h.openProblems), action: K.problems, run: () => navigate('group.payments') })),
    ...(hotels ?? []).filter((h) => h.status === 'suspended').map((h) => ({ id: `s-${h.id}`, tone: 'info' as const, text: A.suspended(h.name), action: K.suspended, run: () => navigate('group.hotel', { id: h.id }) })),
    ...(hotels ?? []).filter((h) => h.status === 'active' && h.adminCount === 0).map((h) => ({ id: `n-${h.id}`, tone: 'info' as const, text: A.noAdmin(h.name), action: K.noAdmin, run: () => navigate('group.hotel', { id: h.id }) })),
  ].slice(0, 8);

  const expiredCount = expired ? expired.total : null;
  const problems = pay ? pay.totals.openProblems : null;
  const jobs: HomeJob[] = [
    { id: 'invites', label: H.jobs.invites.label, note: t.invitationsOpen > 0 ? H.jobs.invites.note : H.jobs.invites.none, count: t.invitationsOpen, onOpen: () => navigate('group.invitations', { status: 'pending' }) },
    { id: 'expired', label: H.jobs.expired.label, note: expiredCount ? H.jobs.expired.note : H.jobs.expired.none, count: expiredCount, hot: !!expiredCount, onOpen: () => navigate('group.invitations', { status: 'expired' }) },
    { id: 'locked', label: H.jobs.locked.label, note: t.lockedAccounts > 0 ? H.jobs.locked.note : H.jobs.locked.none, count: t.lockedAccounts, hot: t.lockedAccounts > 0, onOpen: () => navigate('group.admins', { status: 'locked' }) },
    { id: 'problems', label: H.jobs.problems.label, note: problems ? H.jobs.problems.note : H.jobs.problems.none, count: problems, hot: !!problems, onOpen: () => navigate('group.payments'), retry: payRetry },
  ];
  const stats: HomeStat[] = [
    { id: 'hotels', label: H.figures.hotels, value: t.hotels, format: count, note: groupConsoleCopy.groupHotel.note(t.hotels, t.hotelsCounted, data.group.maxHotels, t.invitationsOpen) },
    { id: 'active', label: H.figures.active, value: t.hotelsActive, format: count, note: H.figureNotes.active },
    { id: 'admins', label: H.figures.admins, value: t.hotelAdmins, format: count, note: H.figureNotes.admins },
    ...(pay ? [{ id: 'month', label: H.figures.month, value: pay.totals.monthPaise, format: money, note: H.figureNotes.month }] : []),
  ];

  return (
    <div className="hd gc-home">
      {stale}
      <div className="hm-greet">
        <div>
          <h2>
            {greeting(clock.hh)}, {firstName}
          </h2>
          <p>{H.line(formatWeekdayDate(clock.date, { long: true }), data.group.name)}</p>
        </div>
        <span className="hm-greet-note">{H.summary(t.hotels, t.hotelAdmins)}</span>
      </div>

      <GroupSetupCard data={data} hotelsWithoutAdmin={hotels ? hotels.filter((h) => h.status === 'active' && h.adminCount === 0).length : null} navigate={navigate} />

      <HomeJobs jobs={jobs} label={H.jobsLabel} />

      <div className="hd-sec">
        <h3>{attention.length ? `${H.attention} · ${attention.length}` : H.attention}</h3>
      </div>
      {attention.length ? (
        <div className="hm-queue gc-stack">
          {attention.map((a) => (
            <div key={a.id} className="hm-q">
              <i className={`hm-dot tone-${a.tone}`} aria-hidden="true" />
              <div className="hm-q-text">
                <b title={a.text}>{a.text}</b>
              </div>
              <Button variant="outline" size="sm" onClick={a.run}>
                {a.action}
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="hm-empty">
          <EmptyState icon="check2-circle" title={H.attentionEmpty} />
        </div>
      )}

      <HomeStats stats={stats} />

      <div className="hm-cols gc-cols">
        <section className="hm-col">
          <div className="hd-sec">
            <h3>{H.hotels}</h3>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                navigate('group.hotels');
              }}
            >
              {c.viewAll} <Bi name="arrow-right-short" />
            </a>
          </div>
          {data.recentHotels.length ? (
            <div className="hm-queue gc-stack">
              {data.recentHotels.map((h) => (
                <div key={h.id} className="hm-q pf-recent">
                  <span className="pf-kind" aria-hidden="true">
                    <Bi name="building" />
                  </span>
                  <div className="hm-q-text">
                    <b title={h.name}>{h.name}</b>
                    <small>{H.hotelLine([h.city, h.state].filter(Boolean).join(', '), formatDate(h.createdAt))}</small>
                  </div>
                  <LifecyclePill status={h.status} />
                  <Button variant="outline" size="sm" onClick={() => navigate('group.hotel', { id: h.id })}>
                    {H.open}
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="card hm-empty">
              <EmptyState icon="building-add" title={c.noHotels} text={c.noHotelsBody} />
            </div>
          )}
        </section>
        <section className="hm-col">
          <div className="hd-sec">
            <h3>{H.activity}</h3>
          </div>
          <div className="card p-3 p-md-4">
            {data.recentActivity.length ? <Timeline rows={data.recentActivity} /> : <p className="text-muted mb-0">{c.noActivity}</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
