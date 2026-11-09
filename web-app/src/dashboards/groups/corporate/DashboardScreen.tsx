'use client';

// corporate.dashboard, the company's home (MJ, 5 Nov 2026: the hotel Home's pattern). A greeting; the first sign-in guide (FirstSteps.tsx) until it is
// done or hidden; "To pay" (what is owed, how old it is, one Pay button,
// the oldest open bills); "Your account" (the information pages as job tiles, the quiet figures, recent payments, what is owed at each hotel).
import { formatDate, formatINR, formatWeekdayDate, istWallClock } from '@shared/dashboards/format';
import { type CorpDashboard, type PortalProfile } from '@shared/dashboards/corporate';
import { PORTAL_ALL_HOTELS } from '@shared/dashboards/portalHotel';
import { useState } from 'react';

import { useAsync } from '@/components/ui';
import { Bi, Button, EmptyState, StatusChip } from '@/dashboards/pallav/ui';
import { tr } from '@/lib/i18n/language';
import type { ScreenProps } from '../../types';
import { HomeJobs, HomeStats, type HomeJob, type HomeStat } from '../overview/HomeJobs';
import { UnavailableNote, useLinkedHotels } from '../portal/HotelParts';
import { usePortalHotel } from '../portal/HotelSwitch';
import { corporateApi, corporateToday } from './api';
import { PortalLoad } from './AccountList';
import { BillPill, CpPart, CpSec } from './cpParts';
import { FirstSteps } from './FirstSteps';
import { corporateCanPayOnline } from './online';
import { PayAllDialog } from './PayAll';
import { cpWords } from './words';

const W = cpWords.home;
const AGES = ['Up to 30 days', '31 to 60 days', '61 to 90 days', 'Over 90 days'] as const;

interface Home {
  d: CorpDashboard;
  /** For the first sign-in guide; null when it could not be read (the home shows without the guide). */
  profile: PortalProfile | null;
  today: string;
  hh: number;
}

async function loadHome() {
  const [res, prof] = await Promise.all([corporateApi.getDashboard(), corporateApi.getPortalProfile()]);
  if (!res.ok) return res;
  return {
    ok: true as const,
    data: { d: res.data, profile: prof.ok ? prof.data : null, today: corporateToday(), hh: istWallClock().hh },
  };
}

export function CorporateDashboardScreen({ user, navigate }: ScreenProps) {
  const { state, reload } = useAsync(loadHome, []);
  const showHotel = usePortalHotel() === PORTAL_ALL_HOTELS;
  const hotels = useLinkedHotels('corporate');
  const firstName = user.displayName.split(' ')[0] ?? user.displayName;
  return (
    <PortalLoad state={state} onRetry={reload}>
      {(h: Home) => (
        <Body home={h} userId={user.id} firstName={firstName} hotelCount={hotels.length} showHotel={showHotel} navigate={navigate} reload={reload} />
      )}
    </PortalLoad>
  );
}

interface BodyProps {
  home: Home;
  userId: string;
  firstName: string;
  hotelCount: number;
  showHotel: boolean;
  navigate: ScreenProps['navigate'];
  reload: () => void;
}

function Body({ home, userId, firstName, hotelCount, showHotel, navigate, reload }: BodyProps) {
  const { d, profile, today, hh } = home;
  const overdue = d.attention.filter((b) => b.status === 'overdue');
  const a = d.ageing ?? {
    upTo30Paise: 0,
    upTo60Paise: 0,
    upTo90Paise: 0,
    over90Paise: 0,
    overdueCount: overdue.length,
    overduePaise: overdue.reduce((s, b) => s + b.duePaise, 0),
  };
  const ages = [a.upTo30Paise, a.upTo60Paise, a.upTo90Paise, a.over90Paise];
  const owed = d.cards.totalDuePaise;
  const greeting = hh < 12 ? W.greeting.morning : hh < 17 ? W.greeting.afternoon : W.greeting.evening;
  const last = d.cards.lastPayment;
  const byHotel = showHotel && d.byHotel.length > 1;
  const online = corporateCanPayOnline(d);
  // Pay all due pays the whole account, so the home offers it only when it shows the whole account.
  const payAll = online && (showHotel || hotelCount <= 1);
  const [paying, setPaying] = useState<number | null>(null);

  const jobs: HomeJob[] = [
    {
      id: 'notices',
      label: W.jobs.notices.label,
      note: d.unreadNotifications > 0 ? W.jobs.notices.note : W.jobs.notices.none,
      count: d.unreadNotifications,
      hot: d.unreadNotifications > 0,
      onOpen: () => navigate('corporate.notifications'),
    },
    {
      id: 'payments',
      label: W.jobs.payments.label,
      note: last ? W.jobs.payments.note(formatDate(last.date)) : W.jobs.payments.none,
      count: null,
      onOpen: () => navigate('corporate.payments'),
    },
    {
      id: 'statement',
      label: W.jobs.statement.label,
      note: W.jobs.statement.note,
      count: null,
      onOpen: () => navigate('corporate.ledger'),
    },
    {
      id: 'support',
      label: W.jobs.support.label,
      note: W.jobs.support.note,
      count: null,
      onOpen: () => navigate('corporate.support'),
    },
  ];
  const stats: HomeStat[] = [
    {
      id: 'overdue',
      label: W.figures.overdue,
      value: a.overduePaise,
      format: (n) => formatINR(Math.round(n)),
      note: W.figureNotes.overdue,
    },
    {
      id: 'last',
      label: W.figures.lastPayment,
      value: last?.amountPaise ?? 0,
      format: (n) => formatINR(Math.round(n)),
      note: last ? `${formatDate(last.date)}${last.mode ? ` · ${last.mode}` : ''}` : W.jobs.payments.none,
    },
    {
      id: 'credit',
      label: W.figures.credit,
      value: d.cards.creditPaise,
      format: (n) => formatINR(Math.round(n)),
      note: W.figureNotes.credit,
    },
    {
      id: 'month',
      label: W.figures.billsThisMonth,
      value: d.cards.billsThisMonth,
      format: (n) => String(Math.round(n)),
      note: W.figureNotes.billsThisMonth,
    },
  ];

  return (
    <div className="cp-home">
      <UnavailableNote hotels={d.unavailable} />
      <div className="hm-greet">
        <div>
          <h2>
            {tr(greeting)}, {firstName}
          </h2>
          <p>{W.line(formatWeekdayDate(today, { long: true }))}</p>
        </div>
        {hotelCount > 0 ? <span className="hm-greet-note">{W.hotels(hotelCount)}</span> : null}
      </div>

      <FirstSteps userId={userId} profile={profile} navigate={navigate} />

      <CpPart title={W.toPay} note={W.toPayNote} />
      <section className={`card cp-due${owed > 0 ? '' : ' is-clear'}`} aria-label={W.toPay}>
        <div className="cp-due-top">
          <div className="cp-due-fig">
            <span className="cp-due-lab">{owed > 0 ? W.owes : W.nothingOwed}</span>
            <b>{formatINR(owed)}</b>
            <span className="cp-due-line">
              {owed > 0 ? (a.overdueCount > 0 ? W.overdueLine(formatINR(a.overduePaise), a.overdueCount) : W.noneOverdue) : W.allPaid}
            </span>
          </div>
          {owed > 0 ? (
            payAll ? (
              <Button icon="credit-card" className="cp-due-btn" onClick={() => setPaying(owed)}>
                {cpWords.bills.payAll(formatINR(owed))}
              </Button>
            ) : (
              <Button icon={online ? 'credit-card' : 'receipt'} className="cp-due-btn" onClick={() => navigate('corporate.bills')}>
                {online ? W.payDue : W.seeDue}
              </Button>
            )
          ) : null}
        </div>
        {owed > 0 ? (
          <div className="cp-aging">
            <span className="cp-aging-title">{W.byAge}</span>
            <div className="cp-aging-bar" role="img" aria-label={AGES.map((label, i) => `${label}: ${formatINR(ages[i] ?? 0)}`).join(', ')}>
              {ages.map((x, i) =>
                x > 0 ? (
                  // check-shared-ignore: each part is as wide as its share of what is owed (data, not a design value)
                  <span key={AGES[i]} className={`cp-ag-${i}`} style={{ flexGrow: x }} />
                ) : null,
              )}
            </div>
            <ul className="cp-aging-keys">
              {AGES.map((label, i) => (
                <li key={label}>
                  <i className={`cp-ag-${i}`} aria-hidden="true" />
                  <span>{tr(label)}</span>
                  <b>{formatINR(ages[i] ?? 0)}</b>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {d.attention.length > 0 ? (
        <>
          <CpSec title={`${W.waiting} · ${d.attention.length}`} link={W.allBills} onLink={() => navigate('corporate.bills')} />
          <div className="hm-queue cp-stack">
            {d.attention.map((b) => (
              <div key={`${b.hotelId}-${b.billId}`} className="hm-q cp-q">
                <i className={`hm-dot ${b.status === 'overdue' ? 'tone-bad' : 'tone-warn'}`} aria-hidden="true" />
                <div className="hm-q-text">
                  <b title={`${b.billNumber} · ${b.guestName}`}>
                    {b.billNumber} · {b.guestName}
                  </b>
                  <small>{[showHotel ? b.hotelName : '', formatDate(b.billDate), W.age(b.ageDays)].filter(Boolean).join(' · ')}</small>
                </div>
                <div className="cp-q-amt">
                  <b>{formatINR(b.duePaise)}</b>
                  <BillPill status={b.status === 'overdue' ? 'overdue' : 'due'} />
                </div>
                <Button variant="outline" size="sm" icon={online ? 'credit-card' : 'receipt'} onClick={() => navigate('corporate.bill', { id: b.billId })}>
                  {online ? cpWords.bills.review : cpWords.bills.openBill}
                </Button>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <CpPart title={W.account} note={W.accountNote} />
      <HomeJobs jobs={jobs} label={W.jobsLabel} />
      <HomeStats stats={stats} />

      <div className={byHotel ? 'hm-cols' : undefined}>
        <div className="hm-col">
          <CpSec title={W.recent} link={W.allPayments} onLink={() => navigate('corporate.payments')} />
          {d.recentPayments.length > 0 ? (
            <div className="hm-queue cp-list">
              {d.recentPayments.map((p) => (
                <div key={`${p.hotelId}-${p.id}`} className="hm-q cp-q cp-q-info">
                  <span className="pf-kind" aria-hidden="true">
                    <Bi name={p.kind === 'advance' ? 'piggy-bank' : 'wallet2'} />
                  </span>
                  <div className="hm-q-text">
                    <b>{formatINR(p.amountPaise)}</b>
                    <small>{[formatDate(p.date), p.mode, showHotel ? p.hotelName : ''].filter(Boolean).join(' · ')}</small>
                  </div>
                  <StatusChip tone={p.kind === 'advance' ? 'neutral' : 'ok'}>{p.kind === 'advance' ? 'Advance' : 'Payment'}</StatusChip>
                </div>
              ))}
            </div>
          ) : (
            <div className="hm-empty card">
              <EmptyState icon="wallet2" title={W.recentNone} />
            </div>
          )}
        </div>
        {byHotel ? (
          <div className="hm-col">
            <CpSec title={W.byHotel} />
            <div className="hm-queue cp-list">
              {d.byHotel.map((h) => (
                <div key={h.hotelId} className="hm-q cp-q cp-q-info">
                  <span className="pf-kind" aria-hidden="true">
                    <Bi name="building" />
                  </span>
                  <div className="hm-q-text">
                    <b title={h.hotelName}>{h.hotelName}</b>
                  </div>
                  <span className={`cp-q-fig${h.totalDuePaise > 0 ? '' : ' none'}`}>
                    {h.totalDuePaise > 0 ? formatINR(h.totalDuePaise) : tr(W.nothingAtHotel)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <PayAllDialog amountPaise={paying} onClose={() => setPaying(null)} onPaid={reload} />
    </div>
  );
}
