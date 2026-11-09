'use client';

// hotel.dashboard: the Today page (preview section 2, MJ 5 Nov 2026): greeting, four job tiles, the attention queue, the day's figures, who arrives
// and who leaves, then Pallav's cash, handover and payroll rows (dashboard.css, pms-dash.css, pms-payroll.css). Data comes from the APIs; nothing here styles anything.
import { useState } from 'react';

import { formatDate, formatINR, formatMonth, formatMonthLong, formatTime, formatWeekdayDate, istWallClock } from '@shared/dashboards/format';
import { attentionForRole, bookNames, dashboardForRole, dashboardFromCash, overviewCopy as c, pctChange, plural, trendWindow, type AttentionItem, type CashEntry, type HotelDashboard } from '@shared/dashboards/overview';
import type { Board } from '@shared/dashboards/frontOffice';
import { folioTotals, reservationSourceLabel } from '@shared/dashboards/frontOffice';
import { splitAfterAdvance, type BillList } from '@shared/dashboards/billing';
import type { DashResult } from '@shared/dashboards/common';

import { userMayEdit, userMayOpen } from '@shared/dashboards/features';
import type { ScreenProps } from '../../types';
import { Bi, Button, DetailCard, DetailList, EmptyState, Kpi, KpiGrid, Loaded, PageHead, Skeleton } from '@/dashboards/pallav/ui';
import { errorText, useAsync } from '@/components/ui';
import { apiMode } from '@/lib/api/mode';
import { billingApi } from '../billing/api';
import { cashApi } from '../cash/api';
import { foApi } from '../frontOffice/api';
import { FlowChart } from './FlowChart';
import { HomeAttention } from './HomeAttention';
import { HomeJobs, HomeStats, type HomeJob, type HomeStat } from './HomeJobs';
import { overviewApi } from './api';
import { HotelSetupCard } from '../admin/HotelSetup';
import { useAdminActor } from '../admin/api';

import { tr, trf } from '@/lib/i18n/language';
const d = c.dashboard;
const home = d.home;
const ALL = { page: 1, pageSize: 100_000 };
const NONE: DashResult<null> = { ok: true, data: null };

/**
 * Real mode: the server's dashboard. Mock mode: the cash and handover figures come from the same in-memory cash book as the Revenue,
 * Expenses and Shift Handover screens, so what is saved there shows here too (payroll stays from the overview mock).
 */
async function loadDashboard(role: string): Promise<DashResult<HotelDashboard>> {
  const r = await loadAll();
  return r.ok ? { ok: true, data: dashboardForRole(r.data, role) } : r;
}

async function loadAll(): Promise<DashResult<HotelDashboard>> {
  if (apiMode() !== 'mock') return overviewApi.getDashboard();
  const [base, deposits, expenses, handovers] = await Promise.all([
    overviewApi.getDashboard(),
    cashApi.listDeposits({ ...ALL, book: 'all' }),
    cashApi.listExpenses({ ...ALL, book: 'all', kind: 'all' }),
    cashApi.listHandovers(ALL),
  ]);
  if (!base.ok) return base;
  if (!deposits.ok) return deposits;
  if (!expenses.ok) return expenses;
  if (!handovers.ok) return handovers;
  return { ok: true, data: dashboardFromCash(base.data, { deposits: deposits.data.items, expenses: expenses.data.items, handovers: handovers.data.items }) };
}

interface BoardRead {
  board: Board;
  /** What each departure still owes, GST in, worked out as In house and Stay do; null where that stay's defaults could not be read. */
  owedPaise: (number | null)[];
}

async function loadBoard(): Promise<DashResult<BoardRead>> {
  const r = await foApi.getBoard();
  if (!r.ok) return r;
  const defaults = await Promise.all(r.data.departures.map((s) => foApi.getCheckoutDefaults(s.id)));
  const owedPaise = r.data.departures.map((s, i) => {
    const gst = defaults[i];
    if (!gst || !gst.ok) return null;
    const t = folioTotals(s, gst.data.hotelGstPercent, gst.data.foodGstPercent);
    const o = splitAfterAdvance(t.hotelPaise + t.hotelGstPaise, t.foodPaise + t.foodGstPaise, t.advancePaise);
    return o.hotelPaise + o.foodPaise;
  });
  return { ok: true, data: { board: r.data, owedPaise } };
}

export function DashboardScreen({ user, navigate }: ScreenProps) {
  const { state, reload } = useAsync(() => loadDashboard(user.role), [user.role]);
  const top = useAdminActor(user);
  const go = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    navigate(id);
  };
  return (
    <>
      <PageHead sub={d.subtitle} actionsClass="hd-head-actions">
        {userMayEdit('revenue') && (
          <a className="btn btn-ghost" href="#" onClick={go('hotel.cash.revenue')}>
          <Bi name="arrow-down-left" /> {d.actions.deposit}
        </a>
        )}
        {userMayEdit('expense') && (
          <a className="btn btn-ghost" href="#" onClick={go('hotel.cash.expenses')}>
          <Bi name="arrow-up-right" /> {d.actions.expense}
        </a>
        )}
        {userMayEdit('handover') && (
          <a className="btn btn-p" href="#" onClick={go('hotel.cash.handover')}>
          <Bi name="arrow-left-right" /> {d.actions.handover}
        </a>
        )}
      </PageHead>
      {user.role === 'hotel_admin' && top ? <HotelSetupCard navigate={navigate} place="home" /> : null}
      <Loaded state={state} onRetry={reload}>
        {(data: HotelDashboard) => <Body data={data} user={user} navigate={navigate} />}
      </Loaded>
    </>
  );
}

function SecHead({ title, link, onLink, note }: { title: string; link?: string; onLink?: () => void; note?: string }) {
  return (
    <div className="hd-sec">
      <h3>{title}</h3>
      {note && <span className="hm-sec-note">{note}</span>}
      {link && onLink && (
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            onLink();
          }}
        >
          {link} <Bi name="arrow-right-short" />
        </a>
      )}
    </div>
  );
}

/** "October" from "2026-10". */
function monthLong(ym: string): string {
  return formatMonthLong(ym).split(' ')[0] ?? '';
}

/** "Today" / "Yesterday" / "05 Oct 2026". */
function dayLabel(iso: string, today: string): string {
  const day = iso.slice(0, 10);
  if (day === today) return 'Today';
  const y = new Date(`${today}T00:00:00Z`);
  y.setUTCDate(y.getUTCDate() - 1);
  if (day === y.toISOString().slice(0, 10)) return 'Yesterday';
  return formatDate(iso);
}

function greetingWord(hh: number): string {
  if (hh < 12) return home.greeting.morning;
  if (hh < 17) return home.greeting.afternoon;
  return home.greeting.evening;
}

/** "05 Nov" from a plain date. */
const short = (date: string) => formatDate(date).slice(0, 6);

function Empty({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="dp-empty">
      <Bi name={icon} />
      <div>
        <strong>{title}</strong>
        <span>{body}</span>
      </div>
    </div>
  );
}

function Body({ data, user, navigate }: { data: HotelDashboard; user: ScreenProps['user']; navigate: ScreenProps['navigate'] }) {
  const [range, setRange] = useState('14');
  const win = trendWindow(data.trend, Number(range));
  const hasFlow = data.trend.some((t) => t.inPaise || t.outPaise);
  const m = formatMonth(data.month);
  const h = data.handovers;
  const k = d.handover;
  const ck = d.cash;
  const pk = d.payroll;
  const p = data.payroll;
  const net = data.day.inPaise - data.day.outPaise;
  const monthNet = data.monthToDate.inPaise - data.monthToDate.outPaise;
  const dayPct = pctChange(data.day.inPaise, data.day.yesterdayInPaise);
  const monthPct = pctChange(data.monthToDate.inPaise, data.monthToDate.lastInPaise);
  const signed = (paise: number) => `${paise < 0 ? '-' : ''}${formatINR(Math.abs(paise))}`;
  const hotel = data.books.find((b) => b.unit === 'hotel');
  const food = data.books.find((b) => b.unit === 'food');
  const toHandover = () => navigate('hotel.cash.handover');
  const toRevenue = () => navigate('hotel.cash.revenue');
  const toExpenses = () => navigate('hotel.cash.expenses');
  const toPayroll = () => navigate('hotel.payroll.home');
  const link = (fn: () => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    fn();
  };

  const fd = data.frontDesk ?? null;
  const today = data.today;
  const seesDesk = fd !== null && userMayOpen('hotel.fo.board');
  const seesBills = userMayOpen('hotel.billing.bills');
  // the three cheap extra reads of the Today page; each one missing only leaves its figure out
  const board = useAsync<BoardRead | null>(() => (seesDesk ? loadBoard() : Promise.resolve(NONE)), [seesDesk]);
  const bills = useAsync<BillList | null>(() => (seesBills ? billingApi.listBills({ tab: 'due', page: 1, pageSize: 1 }) : Promise.resolve(NONE)), [seesBills]);
  const feed = useAsync(() => overviewApi.getAttention(), []);
  const bd = board.state.status === 'ready' ? board.state.data?.board ?? null : null;
  const owed = board.state.status === 'ready' ? board.state.data?.owedPaise ?? [] : [];
  const bl = bills.state.status === 'ready' ? bills.state.data : null;
  const boardLoading = seesDesk && board.state.status === 'loading';
  const boardFailed = seesDesk && board.state.status === 'error';

  const attention: AttentionItem[] = [...data.attention];
  if (feed.state.status === 'ready') for (const a of attentionForRole(feed.state.data.items, user.role)) if (!attention.some((x) => x.id === a.id)) attention.push(a);
  const checked = feed.state.status === 'ready' ? home.attention.checked(formatTime(feed.state.data.at)) : undefined;

  const overdueOut = bd ? bd.departures.filter((s) => s.expectedCheckOut < today).length : 0;
  const staysOwing = owed.filter((p): p is number => p !== null && p > 0);
  const staysCounted = bd !== null && owed.every((p) => p !== null);
  const staysDue = staysOwing.reduce((s, p) => s + p, 0);
  const billsDue = bl ? bl.kpis.find((x) => x.id === 'due')?.value ?? null : null;
  const jobs: HomeJob[] = [];
  if (fd && userMayEdit('pms')) {
    jobs.push({ id: 'checkIn', label: home.jobs.checkIn, note: home.jobs.checkInNote(fd.arrivals), count: fd.arrivals, hot: fd.arrivals > 0, onOpen: () => navigate('hotel.fo.checkIn') });
  }
  if (fd && userMayOpen('hotel.fo.inHouse')) {
    jobs.push({ id: 'checkOut', label: home.jobs.checkOut, note: home.jobs.checkOutNote(fd.departures, overdueOut), count: fd.departures, onOpen: () => navigate('hotel.fo.inHouse') });
  }
  if (fd && userMayEdit('pms')) {
    jobs.push({
      id: 'newBooking',
      label: home.jobs.newBooking,
      note: bd ? home.jobs.newBookingNote : boardFailed ? home.jobs.noCount : home.jobs.counting,
      count: bd ? bd.stats.vacant : null,
      onOpen: () => navigate('hotel.fo.reservationForm'),
      retry: boardFailed ? board.reload : undefined,
    });
  }
  if (seesBills && userMayEdit('bills')) {
    const billsFailed = bills.state.status === 'error';
    const ready = bl !== null && !boardLoading;
    jobs.push({
      id: 'takePayment',
      label: home.jobs.takePayment,
      note: billsFailed ? home.jobs.noBills
        : !ready ? home.jobs.counting
        : !seesDesk ? home.jobs.takePaymentNote(null, bl.counts.due)
        : boardFailed || !staysCounted ? home.jobs.staysNotCounted(bl.counts.due)
        : home.jobs.takePaymentNote(staysOwing.length, bl.counts.due),
      count: ready && billsDue !== null ? formatINR(billsDue + staysDue, { decimals: false }) : null,
      money: true,
      onOpen: () => navigate('hotel.billing.bills', { tab: 'due' }),
      retry: billsFailed ? bills.reload : undefined,
    });
  }

  // check-ins, check-outs and the money taken each have their own tile or row on this page; the figures row says only what nothing else does
  const stats: HomeStat[] = [];
  if (bd) {
    stats.push({ id: 'occupancy', label: home.stats.occupancy, value: bd.stats.occupancy, format: (n) => `${Math.round(n)}%`, note: home.stats.occupancyNote(bd.stats.occupied, bd.stats.rooms - bd.stats.outOfOrder) });
    stats.push({ id: 'house', label: 'Guests in the house', value: bd.inHouse, format: (n) => String(Math.round(n)), note: trf("{0} rooms in all", [bd.stats.rooms]) });
    stats.push({ id: 'in', label: 'Arriving today', value: bd.arrivals.length, format: (n) => String(Math.round(n)), note: tr("Booked to arrive") });
    stats.push({ id: 'out', label: 'Leaving today', value: bd.departures.length, format: (n) => String(Math.round(n)), note: tr("Due to check out") });
  }

  const firstName = user.displayName.split(' ')[0] ?? user.displayName;
  const hotelName = user.hotel?.name ?? '';
  const mayCheckIn = userMayEdit('pms');
  const mayOpenRes = userMayOpen('hotel.fo.reservation');
  const ar = home.arriving;
  const lv = home.leaving;

  return (
    <div className="hd">
      <div className="hm-greet">
        <div>
          <h2>{greetingWord(istWallClock().hh)}, {firstName}</h2>
          <p>{home.line(hotelName, formatWeekdayDate(today, { long: true }))}</p>
        </div>
      </div>

      <HomeJobs jobs={jobs} label={home.jobs.label} />

      <SecHead title={attention.length ? `${home.attention.title} · ${attention.length}` : home.attention.title} note={checked} />
      <HomeAttention items={attention} navigate={navigate} onRetryFeed={feed.state.status === 'error' ? feed.reload : undefined} />

      <HomeStats stats={stats} />

      {seesDesk && (
        <div className="hm-cols">
          <div className="hm-col">
            <SecHead title={ar.title} link={d.frontDesk.link} onLink={() => navigate('hotel.fo.board')} />
            {board.state.status === 'loading' ? (
              <Skeleton rows={2} />
            ) : board.state.status === 'error' ? (
              <div className="card"><EmptyState icon="exclamation-triangle" title={ar.loadError} text={errorText(board.state.error)}>
                <Button variant="outline" className="mt-3" onClick={board.reload}>{tr("Try again")}</Button>
              </EmptyState></div>
            ) : !bd || bd.arrivals.length === 0 ? (
              <div className="hm-empty"><EmptyState icon="box-arrow-in-right" title={ar.empty} /></div>
            ) : (
              bd.arrivals.map((r) => {
                const late = r.checkIn < today;
                const advance = r.advancePaidPaise > 0 ? formatINR(r.advancePaidPaise, { decimals: false }) : null;
                const people = `${plural(r.adults, 'adult')}${r.children ? `, ${plural(r.children, 'child', 'children')}` : ''}`;
                return (
                  <DetailCard
                    key={r.id}
                    label={`${ar.title}: ${r.guestName}`}
                    warn={late}
                    className="hu-dc"
                    lead={{ big: r.rooms, small: ar.roomUnit(r.rooms), title: r.roomTypeName }}
                    facts={[
                      { label: ar.guest, value: r.guestName, sub: `${r.mobile}${r.companyName ? ` · ${r.companyName}` : ''}` },
                      { label: ar.stay, value: `${short(r.checkIn)} → ${short(r.checkOut)}`, sub: [plural(r.nights, 'night'), r.roomTypeName].filter(Boolean).join(' · ') },
                      { label: ar.status, value: late ? ar.dueSince(short(r.checkIn)) : ar.confirmed, tone: late ? 'danger' : undefined },
                    ]}
                    amount={{ label: ar.advance, value: advance ?? '-', tone: advance ? undefined : 'muted' }}
                    sections={[
                      {
                        icon: 'calendar-check', title: ar.booking,
                        content: <DetailList items={[
                          { label: ar.reference, value: r.reference },
                          { label: ar.source, value: reservationSourceLabel[r.source] ?? r.source },
                          { label: ar.rooms, value: `${r.rooms} × ${r.roomTypeName || '-'}` },
                          { label: ar.people, value: people },
                          { label: ar.rate, value: `${formatINR(r.ratePaise, { decimals: false })} ${ar.perNight}` },
                        ]} />,
                      },
                    ]}
                    meta={ar.booked(formatDate(r.createdAt))}
                    actions={
                      <>
                        {mayOpenRes && <Button variant="outline" size="sm" onClick={() => navigate('hotel.fo.reservation', { id: r.id })}>{ar.open}</Button>}
                        {mayCheckIn && <Button size="sm" icon="box-arrow-in-right" onClick={() => navigate('hotel.fo.checkIn', { reservationId: r.id })}>{ar.checkIn}</Button>}
                      </>
                    }
                  />
                );
              })
            )}
          </div>

          <div className="hm-col">
            <SecHead title={lv.title} link={d.frontDesk.inHouse} onLink={() => navigate('hotel.fo.inHouse')} />
            {board.state.status === 'loading' ? (
              <Skeleton rows={2} />
            ) : board.state.status === 'error' ? (
              <div className="card"><EmptyState icon="exclamation-triangle" title={lv.loadError} text={errorText(board.state.error)}>
                <Button variant="outline" className="mt-3" onClick={board.reload}>{tr("Try again")}</Button>
              </EmptyState></div>
            ) : !bd || bd.departures.length === 0 ? (
              <div className="hm-empty"><EmptyState icon="box-arrow-right" title={lv.empty} /></div>
            ) : (
              bd.departures.map((s) => {
                const late = s.expectedCheckOut < today;
                const soFar = formatINR(s.totalSoFarPaise, { decimals: false });
                return (
                  <DetailCard
                    key={s.id}
                    label={`${tr("Room")} ${s.roomNumber} ${s.guestName}`}
                    warn={late}
                    className="hu-dc"
                    lead={{ big: s.roomNumber, title: s.roomTypeName ?? undefined }}
                    facts={[
                      { label: lv.guest, value: s.guestName, sub: `${s.mobile}${s.grNumber ? ` · ${tr("Register")} ${s.grNumber}` : ''}` },
                      { label: lv.nights, value: plural(s.nights, 'night'), sub: s.roomTypeName ?? undefined },
                      { label: late ? lv.wasDue : lv.leaves, value: short(s.expectedCheckOut), tone: late ? 'danger' : undefined },
                    ]}
                    amount={{ label: lv.soFar, value: soFar, sub: s.advancePaise > 0 ? lv.advance(formatINR(s.advancePaise, { decimals: false })) : undefined }}
                    sections={[
                      {
                        icon: 'door-closed', title: lv.stayHead,
                        content: <DetailList items={[
                          { label: lv.room, value: `${s.roomNumber}${s.roomTypeName ? ` · ${s.roomTypeName}` : ''}` },
                          { label: lv.arrived, value: formatDate(s.checkInDate) },
                          { label: lv.leaves, value: formatDate(s.expectedCheckOut) },
                          { label: lv.soFar, value: soFar, total: true },
                        ]} />,
                      },
                    ]}
                    actions={
                      userMayOpen('hotel.fo.stay') && (
                        mayCheckIn
                          ? <Button size="sm" icon="box-arrow-right" onClick={() => navigate('hotel.fo.stay', { id: s.id })}>{lv.checkOut}</Button>
                          : <Button variant="outline" size="sm" onClick={() => navigate('hotel.fo.stay', { id: s.id })}>{lv.account}</Button>
                      )
                    }
                  />
                );
              })
            )}
          </div>
        </div>
      )}

      <SecHead title={ck.section} link={ck.link} onLink={toRevenue} />
      <KpiGrid>
        <Kpi
          icon="in"
          glyph="arrow-down-left"
          label={ck.inToday}
          value={formatINR(data.day.inPaise)}
          chips={[dayPct === null ? { text: ck.noYesterday } : { text: ck.vsYesterday(dayPct), tone: dayPct >= 0 ? 'up' : 'down' }]}
          onPress={toRevenue}
        />
        <Kpi icon="out" glyph="arrow-up-right" label={ck.outToday} value={formatINR(data.day.outPaise)} chips={[{ text: d.book.today(data.day.count) }]} onPress={toExpenses} />
        <Kpi
          icon="month"
          glyph="wallet2"
          label={ck.netToday}
          value={signed(net)}
          negative={net < 0}
          chips={[{ text: trf("Hotel {0} · Food {1}", [signed((hotel?.todayInPaise ?? 0) - (hotel?.todayOutPaise ?? 0)), signed((food?.todayInPaise ?? 0) - (food?.todayOutPaise ?? 0))]) }]}
        />
        <Kpi
          icon="due"
          glyph="calendar3"
          label={ck.monthSoFar(monthLong(data.month))}
          value={signed(monthNet)}
          negative={monthNet < 0}
          chips={[
            monthPct === null
              ? { text: ck.monthIn(formatINR(data.monthToDate.inPaise)) }
              : { text: ck.vsLastMonth(formatINR(data.monthToDate.inPaise), monthPct, formatMonth(data.lastMonth)), tone: monthPct >= 0 ? 'up' : 'down' },
          ]}
        />
      </KpiGrid>

      <SecHead title={k.section} link={k.link} onLink={toHandover} />
      <KpiGrid>
        <Kpi icon="month" glyph="arrow-left-right" label={k.today} value={h.today} warn={!h.today} chips={[{ text: h.today ? k.recorded : k.noneToday }]} onPress={toHandover} />
        <Kpi icon="in" glyph="cash-stack" label={k.cash} value={formatINR(h.todayCashPaise)} chips={[{ text: k.cashNote }]} onPress={toHandover} />
        <Kpi icon="due" glyph="calendar3" label={k.month} value={h.month} chips={[{ text: m }]} onPress={toHandover} />
        <Kpi
          icon="out"
          glyph="clock-history"
          label={k.last}
          small
          value={h.latest ? `${h.latest.shift} · ${formatTime(h.latest.at)}` : k.lastNone}
          chips={[{ text: h.latest ? `By ${h.latest.by} · ${dayLabel(h.latest.at, data.today)}` : k.lastNoneNote }]}
          onPress={toHandover}
        />
      </KpiGrid>

      <section className="card dash-panel hm-flow">
        <header className="dp-head hd-flow-head">
          <div>
            <h3>{d.flow.title}</h3>
            <p className="hd-range-sum">
              <span>
                <i className="hd-key in" /> {tr("In")} <strong>{formatINR(win.inPaise)}</strong>
              </span>
              <span>
                <i className="hd-key out" /> {tr("Out")} <strong>{formatINR(win.outPaise)}</strong>
              </span>
            </p>
          </div>
          <div className="hd-seg" role="group" aria-label={tr("Days shown")}>
            {d.flow.ranges.map((r) => (
              <button /* check-shared-ignore: a range switch in the dashboard head, styled by its parent */ key={r.id} type="button" className={r.id === range ? 'active' : ''} aria-pressed={r.id === range} onClick={() => setRange(r.id)}>
                {r.label}
              </button>
            ))}
          </div>
        </header>
        {hasFlow ? (
          <div className="hd-chart">
            <FlowChart days={win.days} inLabel={d.flow.in} outLabel={d.flow.out} />
          </div>
        ) : (
          <Empty icon="bar-chart" title={d.flow.emptyTitle} body={d.flow.emptyBody} />
        )}
      </section>

      <div className="dash-columns">
        {data.books.map((b) => {
          const bookNet = b.todayInPaise - b.todayOutPaise;
          const flow = Math.max(b.monthInPaise + b.monthOutPaise, 1);
          return (
            <section key={b.unit} className="card dash-panel hd-book">
              <header className="dp-head">
                <span className="dp-icon">
                  <Bi name={b.unit === 'food' ? 'cup-hot' : 'building'} />
                </span>
                <h3>{b.name}</h3>
                <span className="dp-note">{d.book.today(b.todayCount)}</span>
              </header>
              <div className="hd-book-figs">
                <div>
                  <span>{d.book.inToday}</span>
                  <strong>{formatINR(b.todayInPaise)}</strong>
                </div>
                <div>
                  <span>{d.book.outToday}</span>
                  <strong>{formatINR(b.todayOutPaise)}</strong>
                </div>
                <div>
                  <span>{d.book.net}</span>
                  <strong className={`accent ${bookNet < 0 ? 'hd-neg' : ''}`}>{signed(bookNet)}</strong>
                </div>
              </div>
              <div className="hd-book-month">
                <div className="hd-book-month-head">
                  <span>{monthLong(data.month)}</span>
                  <span>
                    <strong>{formatINR(b.monthInPaise)}</strong> {tr("in ·")} <strong>{formatINR(b.monthOutPaise)}</strong> {tr("out")}
                  </span>
                </div>
                <div className="hd-split" aria-hidden="true">
                  <span className="in" style={{ ['--w' as string]: `${Math.round((b.monthInPaise / flow) * 1000) / 10}%` }} />
                  <span className="out" style={{ ['--w' as string]: `${Math.round((b.monthOutPaise / flow) * 1000) / 10}%` }} />
                </div>
              </div>
              <footer className="hd-links">
                <a href="#" onClick={link(toRevenue)}>
                  {d.book.revenue} <Bi name="arrow-right-short" />
                </a>
                <a href="#" onClick={link(toExpenses)}>
                  {d.book.expenses} <Bi name="arrow-right-short" />
                </a>
              </footer>
            </section>
          );
        })}
      </div>

      <div className="dash-columns hd-wide-left">
        <section className="card dash-panel">
          <header className="dp-head">
            <h3>{d.recent.title}</h3>
            <span className="dp-note">{d.recent.note}</span>
          </header>
          {data.recent.length ? (
            data.recent.map((e: CashEntry) => (
              <div key={e.id} className="dp-row">
                <span className="dp-icon">
                  <Bi name={e.direction === 'in' ? 'arrow-down-left' : 'arrow-up-right'} />
                </span>
                <span className="dp-text">
                  <span className="dp-title">{e.who}</span>
                  <span className="dp-detail hd-ellipsis">
                    #{e.entryNo} {tr("·")} {e.kind}, {bookNames[e.unit]} {tr("·")} {e.by}
                  </span>
                </span>
                <span className="hd-amount">
                  <strong className={e.direction}>
                    {e.direction === 'in' ? '+' : '-'}
                    {formatINR(e.amountPaise)}
                  </strong>
                  <span className="dp-when">
                    {dayLabel(e.at, data.today)} {formatTime(e.at)}
                  </span>
                </span>
              </div>
            ))
          ) : (
            <Empty icon="journal-text" title={d.recent.emptyTitle} body={d.recent.emptyBody} />
          )}
        </section>

        <section className="card dash-panel">
          <header className="dp-head">
            <h3>{d.spending.title(m)}</h3>
            <span className="dp-note">{formatINR(data.spending.totalPaise)}</span>
          </header>
          {data.spending.heads.length ? (
            <div className="hd-bars">
              {data.spending.heads.map((hd) => {
                const top = Math.max(...data.spending.heads.map((x) => x.totalPaise), 1);
                const pct = data.spending.totalPaise ? Math.round((hd.totalPaise / data.spending.totalPaise) * 100) : 0;
                return (
                  <div key={hd.head} className="hd-bar">
                    <div className="hd-bar-head">
                      <span>{hd.head}</span>
                      <strong>{formatINR(hd.totalPaise)}</strong>
                    </div>
                    <div className="hd-bar-track">
                      <span style={{ ['--w' as string]: `${Math.round((hd.totalPaise / top) * 1000) / 10}%` }} />
                    </div>
                    <span className="hd-bar-note">{d.spending.share(pct, hd.count)}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty icon="pie-chart" title={d.spending.emptyTitle} body={d.spending.emptyBody} />
          )}
        </section>
      </div>

      {p && (
        <>
          <SecHead title={pk.section} link={pk.link} onLink={toPayroll} />
          <KpiGrid>
            <Kpi icon="month" glyph="people" label={pk.staff} value={p.activeStaff} chips={[{ text: pk.joined(p.joinedThisMonth, m) }]} onPress={() => navigate('hotel.payroll.staff')} />
            <Kpi
              icon="due"
              glyph="credit-card-2-back"
              label={pk.toPay}
              value={formatINR(p.openAmountPaise)}
              warn={p.openCount > 0}
              chips={[{ text: p.openSince ? pk.openSince(p.openCount, formatMonth(p.openSince)) : pk.settled }]}
              onPress={() => navigate('hotel.payroll.salaryPayments')}
            />
            <Kpi icon="in" glyph="check2-circle" label={pk.paid(m)} value={formatINR(p.paidPaise)} chips={[{ text: pk.paidNote(p.paidCount) }]} onPress={() => navigate('hotel.payroll.salaryPayments')} />
            <Kpi icon="out" glyph="wallet2" label={pk.advances} value={formatINR(p.advancesPaise)} chips={[{ text: pk.advancesNote(p.advanceCount, m) }]} onPress={() => navigate('hotel.payroll.advances')} />
          </KpiGrid>
        </>
      )}
    </div>
  );
}
