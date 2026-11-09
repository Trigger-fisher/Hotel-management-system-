'use client';
// Guest Home (guest.home): a greeting, the stay first (room, stage, facts, stay bar), the guest's jobs as tiles for the stage, the stay's money as one row of
// figures, then live orders and recent activity; the hotel's card and past stays at the side (under the main column on a phone).
import type { ReactNode } from 'react';

import type { DashResult } from '@shared/dashboards/common';
import { billNumberText, type GuestBill, type GuestOverview, type GuestProfile } from '@shared/dashboards/guest';
import { guestCopyByLanguage } from '@shared/dashboards/guest.lang';
import { homeCopyByLanguage } from '@shared/dashboards/guestCopy/home.lang';
import { guestStage, moneyOf, stageStatusLine, staysFromBills, type GuestMoney, type GuestStage, type StaySummary } from '@shared/dashboards/guestStage';
import { PORTAL_ALL_HOTELS } from '@shared/dashboards/portalHotel';

import { useAsync } from '@/components/ui';
import { Bi, EmptyState, PortalButton } from '@/dashboards/pallav/ui';
import { HomeJobs, HomeStats, type HomeJob, type HomeStat } from '../overview/HomeJobs';
import type { ScreenProps } from '../../types';
import { guestApi, guestToday } from './api';
import { UnavailableNote } from '../portal/HotelParts';
import { inr, PtLoad } from '../portal/parts';
import { useCanPayOnline, GgPage, GgSkeleton, LiveOrders, pickHotel, telHref, useGuestBadges, useGuestHotels, useGuestRefresh, useHotelSite, useReceptionPhone } from './kit';
import { gpWordsByLanguage } from './kit/words';
import { AdvanceCard, ContactCard, KeyNote, PastStays, RecentActivity } from './home/sections';
import { FirstSignInGuide, type GuideStep } from './home/guide';
import { StayCard } from './home/stayCard';
import { tr, useCopy } from '@/lib/i18n/language';

type Go = ScreenProps['navigate'];

interface HomeData {
  ov: GuestOverview;
  bills: GuestBill[] | null;
  /** The hotel's hour (India time) when the page was read: the greeting. */
  hour: number;
}

const hotelHour = (): number => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));

async function loadHome(): Promise<DashResult<HomeData>> {
  const [ov, bills] = await Promise.all([guestApi.getOverview({ hotel: PORTAL_ALL_HOTELS }), guestApi.listBills({ tab: 'all', limit: 25, hotel: PORTAL_ALL_HOTELS })]);
  if (!ov.ok) return ov;
  return { ok: true, data: { ov: ov.data, bills: bills.ok ? bills.data.items : null, hour: hotelHour() } };
}

export function GuestHome({ navigate }: ScreenProps) {
  const { state, reload } = useAsync(loadHome, []);
  useGuestRefresh(reload);
  return (
    <PtLoad state={state} onRetry={reload} skeleton={<GgSkeleton variant="home" />}>
      {(d) => <HomeBody d={d} navigate={navigate} />}
    </PtLoad>
  );
}

interface HomeModel {
  stage: GuestStage;
  lastStay: StaySummary | null;
  past: StaySummary[];
  money: GuestMoney;
  hotelId: string | null;
  hotelName: string | null;
  issued: GuestBill | null;
}

function modelOf({ ov, bills }: HomeData, today: string): HomeModel {
  const stage = guestStage(ov, today, bills);
  const stays = staysFromBills(bills ?? [], today).filter((s) => !s.current && !s.cancelled && s.from <= today);
  const lastStay = stage === 'checkedOut' ? (stays[0] ?? null) : null;
  const past = stays.filter((s) => s !== lastStay);
  const inHouse = stage === 'staying' || stage === 'checkoutDay';
  const scoped: GuestBill[] = inHouse ? (bills ?? []).filter((b) => b.current) : lastStay ? lastStay.bills : [];
  const byId = new Map<string, GuestBill>(scoped.map((b) => [b.id, b]));
  for (const b of ov.openBills) byId.set(b.id, b);
  const money = moneyOf([...byId.values()], today);

  const stayBill = inHouse ? ((bills ?? []).find((b) => b.current) ?? ov.openBills.find((b) => b.current)) : undefined;
  let hotelId: string | null = null;
  let hotelName: string | null = null;
  if (stage === 'arriving' && ov.upcoming) {
    hotelId = ov.upcoming.hotelId;
    hotelName = ov.upcoming.hotelName || null;
  } else if (stayBill) {
    hotelId = stayBill.hotelId ?? null;
    hotelName = stayBill.hotelName?.trim() || null;
  } else if (lastStay) {
    hotelId = lastStay.hotelId;
    hotelName = lastStay.hotelName;
  } else if (past[0]) {
    hotelId = past[0].hotelId;
    hotelName = past[0].hotelName;
  }
  const issued = lastStay?.bills.find((b) => b.number.trim() && b.status !== 'cancelled') ?? null;
  return { stage, lastStay, past, money, hotelId, hotelName, issued };
}

const detailsMissing = (p: GuestProfile): boolean => !p.email.trim() || p.idProofType === 'none';
const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? '';
const billParams = (b: GuestBill): Record<string, string> => (b.hotelId ? { id: b.id, hotel: b.hotelId } : { id: b.id });

function HomeBody({ d, navigate }: { d: HomeData; navigate: Go }) {
  const homeCopy = useCopy(homeCopyByLanguage);
  const nav = useCopy(guestCopyByLanguage).nav;
  const w = useCopy(gpWordsByLanguage).home;
  const a = homeCopy.actions;
  const r = homeCopy.rows;
  const today = guestToday();
  const m = modelOf(d, today);
  const { ov } = d;
  const { hotels } = useGuestHotels();
  const badges = useGuestBadges();
  const site = useHotelSite(m.hotelId);
  const phone = useReceptionPhone(m.hotelId);
  const hotelName = m.hotelName ?? site?.name ?? pickHotel(hotels, m.hotelId)?.name ?? null;
  const { stage, money } = m;
  const due = money.duePaise > 0;
  const inHouse = stage === 'staying' || stage === 'checkoutDay';
  const online = useCanPayOnline(m.hotelId);

  const name = firstName(ov.profile.name);
  const greeting = d.hour < 12 ? w.morning(name) : d.hour < 17 ? w.afternoon(name) : w.evening(name);
  const status = stageStatusLine(stage, { stay: ov.stay, upcoming: ov.upcoming, lastStayTo: m.lastStay?.to, today });

  const toBills = () => navigate('guest.bills');
  const billsJob: HomeJob = { id: 'bills', label: stage === 'checkoutDay' ? a.reviewBill : a.bills, note: due ? w.openBills(money.openCount) : a.billsAllPaid, count: money.openCount > 0 ? money.openCount : null, hot: due, onOpen: toBills };
  const diningJob: HomeJob = {
    id: 'dining',
    label: a.roomService,
    note: badges.liveOrders > 0 ? w.liveNote(badges.liveOrders) : a.roomServiceSub,
    count: badges.liveOrders > 0 ? badges.liveOrders : null,
    hot: badges.liveOrders > 0,
    onOpen: () => navigate('guest.order', badges.liveOrders > 0 ? { view: 'orders' } : {}),
  };
  const paymentsJob: HomeJob = { id: 'payments', label: w.payments, note: w.paymentsNote, count: null, onOpen: () => navigate('guest.history') };
  const callJob = (label: string): HomeJob[] =>
    phone
      ? [
          {
            id: 'call',
            label,
            note: phone,
            count: null,
            onOpen: () => {
              window.location.href = telHref(phone);
            },
          },
        ]
      : [];

  // the first sign-in guide carries Check your details while it shows, so the tile does not say it twice
  const firstSignIn = (ov as GuestOverview & { firstSignIn?: boolean }).firstSignIn;
  const showGuide = typeof firstSignIn === 'boolean' ? firstSignIn : stage === 'arriving' || inHouse;
  let jobs: HomeJob[] = [];
  if (stage === 'staying') jobs = [diningJob, billsJob, paymentsJob, ...callJob(a.call)];
  else if (stage === 'checkoutDay') jobs = [billsJob, diningJob, paymentsJob, ...callJob(a.call)];
  else if (stage === 'arriving')
    jobs = [
      ...(!showGuide && detailsMissing(ov.profile) ? [{ id: 'details', label: a.completeDetails, note: a.completeDetailsSub, count: null, hot: true, onOpen: () => navigate('guest.profile') }] : []),
      { id: 'menu', label: r.menu, note: r.menuSub, count: null, onOpen: () => navigate('guest.order') },
      ...(due ? [billsJob] : []),
      ...callJob(a.callHotel),
    ];
  else if (stage === 'checkedOut') {
    const issued = m.issued;
    const reviewUrl = site?.reviewUrl ?? null;
    jobs = [
      issued ? { id: 'bill', label: r.downloadBill, note: r.downloadBillSub(billNumberText(issued.number)), count: null, hot: due, onOpen: () => navigate('guest.bill', billParams(issued)) } : billsJob,
      { id: 'statement', label: r.statement, note: r.statementSub, count: null, onOpen: () => navigate('guest.history', { statement: '1' }) },
      ...callJob(r.callHotel),
      ...(reviewUrl ? [{ id: 'review', label: r.googleReview, note: r.googleReviewSub, count: null, onOpen: () => void window.open(reviewUrl, '_blank', 'noopener,noreferrer') }] : []),
    ];
  } else jobs = [billsJob, paymentsJob, { id: 'account', label: nav.account, note: a.completeDetailsSub, count: null, onOpen: () => navigate('guest.profile') }, ...callJob(a.callHotel)];

  const guide: GuideStep[] = [
    { id: 'details', done: !detailsMissing(ov.profile), onOpen: () => navigate('guest.profile') },
    { id: 'password', done: ov.profile.signInCodeOn === true, onOpen: () => navigate('guest.profile') },
    { id: 'order', done: badges.liveOrders > 0, onOpen: () => navigate('guest.order') },
    { id: 'pay', done: !due, onOpen: toBills },
  ];

  const hadStays = m.past.length > 0;
  const noStayTitle = hadStays ? homeCopy.hero.noStayNowTitle : homeCopy.hero.noStayTitle;
  const hero: ReactNode =
    stage === 'none' ? (
      <section className="gg-card gp-stay gp-stay-none" aria-label={noStayTitle}>
        <EmptyState look="portal" icon="door-closed" title={noStayTitle} text={hadStays ? homeCopy.hero.noStayNowBody : homeCopy.hero.noStayBody} />
      </section>
    ) : (
      <StayCard stage={stage} stay={ov.stay} upcoming={ov.upcoming ?? null} lastStay={m.lastStay} hotelName={hotelName} checkOutTime={site?.checkOutTime ?? null} today={today} />
    );

  const showMoney = inHouse || stage === 'checkedOut' || due;
  const moneyTitle = stage === 'arriving' || stage === 'none' ? homeCopy.money.openFromBefore : stage === 'checkedOut' ? homeCopy.money.stillToPay : w.stayMoney;
  const stats: HomeStat[] = [
    { id: 'due', label: w.toPay, value: money.duePaise, format: (n) => inr(Math.round(n)), note: money.overduePaise > 0 ? w.overdueNote(inr(money.overduePaise)) : due && !online ? w.atReception : undefined },
    { id: 'paid', label: w.paid, value: money.paidPaise, format: (n) => inr(Math.round(n)) },
    { id: 'charged', label: w.charged, value: money.chargedPaise, format: (n) => inr(Math.round(n)) },
{ id: 'open', label: tr('Open bills'), value: money.openCount, format: (n) => String(Math.round(n)), note: tr('Waiting for payment') },
  ];

  return (
    <GgPage title={homeCopy.title} status={greeting} className="gg-home gp-home">
      <UnavailableNote hotels={ov.unavailable} />
      {status ? <p className="gp-home-line">{status}</p> : null}
      <div className="gp-home-grid">
        <div className="gp-home-main">
          {hero}
          <FirstSignInGuide user={ov.profile.id} steps={guide} show={showGuide} />
          <div className="gp-jobs">
            <HomeJobs jobs={jobs} label={w.jobsLabel} />
          </div>
          {showMoney ? (
            <section className={`gg-card gp-money${due ? ' owing' : ''}${money.overduePaise > 0 ? ' overdue' : ''}`} aria-labelledby="gp-money-h">
              <div className="gp-card-head">
                <h2 id="gp-money-h">{moneyTitle}</h2>
                <PortalButton variant="ghost" onClick={toBills}>
                  {homeCopy.money.review} <Bi name="chevron-right" />
                </PortalButton>
              </div>
              <HomeStats stats={stats} />
            </section>
          ) : null}
          {stage === 'arriving' && ov.upcoming ? <AdvanceCard advancePaise={ov.upcoming.advancePaise} /> : null}
          {stage === 'checkoutDay' ? <KeyNote /> : null}
          {inHouse ? <LiveOrders limit={3} onOpen={() => navigate('guest.order', { view: 'orders' })} /> : null}
          {inHouse ? <RecentActivity items={ov.recent} navigate={navigate} /> : null}
        </div>
        <aside className="gp-home-side">
          <ContactCard hotelId={m.hotelId} site={site} phone={phone} />
          <PastStays stays={m.past} navigate={navigate} />
        </aside>
      </div>
    </GgPage>
  );
}
