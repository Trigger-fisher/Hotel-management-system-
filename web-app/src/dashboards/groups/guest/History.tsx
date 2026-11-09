'use client';
// Payments (guest.history): two tabs, Payments and Charges. Payments: one row of figures, then each payment as an expandable card by day (time, what it paid,
// the bill, the amount; opened: the details and Download receipt). Charges: rows with their status by day. The statement for a period is one line beside the
// list (above it on a phone) that opens its sheet (Home's "Get a statement" opens it straight away with ?statement=1).
import { useState } from 'react';

import { formatDate, formatTime } from '@shared/dashboards';
import { groupHistoryByDay, historyIcon, type HistoryItem, type HistoryList } from '@shared/dashboards/guest';
import { paymentsCopyByLanguage } from '@shared/dashboards/guestCopy/payments.lang';
import { guestReceiptPdfPath, guestStatementPdfPath, STATEMENT_MAX_DAYS } from '@shared/dashboards/guestDocuments';
import { PORTAL_ALL_HOTELS } from '@shared/dashboards/portalHotel';

import { useDebounced, useToast } from '@/components/ui';
import { Bi, DetailCard, DetailList, EmptyState, ListSearch, openPdf, PortalButton, SegTabs } from '@/dashboards/pallav/ui';
import { HomeStats, type HomeStat } from '../overview/HomeJobs';
import type { ScreenProps } from '../../types';
import { guestApi, guestToday } from './api';
import { ActivityRow, CallReception, GgPage, GgSheet, GgSkeleton, useGuestHotels, useGuestRefresh, useHotelChoice, useReceptionPhone } from './kit';
import { CURSOR_LIMIT, LoadMore, useCursorList } from '../portal/AppKit';
import { UnavailableNote } from '../portal/HotelParts';
import { biOf, inr, PtLoad } from '../portal/parts';
import { tr, useCopy } from '@/lib/i18n/language';
import { gpWordsByLanguage } from './kit/words';

type Kind = 'payments' | 'charges';

const monthStart = (ymd: string): string => `${ymd.slice(0, 7)}-01`;
const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Why a statement period cannot be asked for (said before the server is asked), or null. The server's own rule is the same: at most 366 days. */
function periodProblem(from: string, to: string, c: typeof paymentsCopyByLanguage.en): string | null {
  if (!from || !to) return c.statement.missing;
  if (to < from) return c.statement.backwards;
  if (daysBetween(from, to) > STATEMENT_MAX_DAYS) return c.statement.tooLong;
  return null;
}

/**
 * One payment as a drop-down (MJ, 26 Oct 2026): the row opens smoothly to show when it was paid, what it paid towards, the bill, the hotel, its status and
 * reference, and a "Download receipt" button (the receipt PDF). A cancelled payment shows its details with a muted chip and has no receipt.
 */
function PaymentCard({ item, showHotel }: { item: HistoryItem; showHotel: boolean }) {
  const c = useCopy(paymentsCopyByLanguage);
  const toast = useToast();
  const cancelled = item.status === 'cancelled';
  const amount = inr(item.amountPaise);
  const d = c.details;
  return (
    <DetailCard
      className={`gp-pay${cancelled ? ' gp-pay-cancelled' : ''}`}
      label={d.show(item.title, amount)}
      lead={{ big: <Bi name={biOf(historyIcon[item.category])} />, tag: d.statusText[item.status] }}
      facts={[
        { label: d.paidOn, value: formatTime(item.at) },
        { label: d.towards, value: item.title, sub: d.business[item.business] },
        { label: d.bill, value: item.billNumber ?? '', empty: '—' },
        ...(showHotel ? [{ label: d.hotel, value: item.hotelName ?? '' }] : []),
      ]}
      amount={{ label: d.amount, value: amount, tone: cancelled ? 'muted' : 'default' }}
      sections={[
        {
          icon: 'receipt',
          title: d.status,
          content: (
            <DetailList
              items={[
                { label: d.paidOn, value: `${formatDate(item.at.slice(0, 10))}, ${formatTime(item.at)}` },
                { label: d.amount, value: amount },
                { label: d.towards, value: d.business[item.business] },
                item.billNumber ? { label: d.bill, value: item.billNumber } : null,
                item.hotelName ? { label: d.hotel, value: item.hotelName } : null,
                { label: d.status, value: d.statusText[item.status] },
              ]}
            />
          ),
        },
      ]}
      meta={cancelled ? d.noReceipt : undefined}
      actions={
        cancelled ? undefined : (
          <PortalButton
            icon="download"
            onClick={() => void openPdf(guestReceiptPdfPath(item.id, item.hotelId), (text) => toast.show({ tone: 'error', text }), (text) => toast.show({ tone: 'info', text }))}
          >
            {d.download}
          </PortalButton>
        )
      }
    />
  );
}

/** One quiet row of figures over the payments on screen: paid in all, how many, the latest. */
function PaySummary({ items }: { items: HistoryItem[] }) {
  const c = useCopy(paymentsCopyByLanguage);
  const s = c.summary;
  const paid = items.filter((i) => i.kind === 'payment' && i.status !== 'cancelled');
  const total = paid.reduce((n, i) => n + i.amountPaise, 0);
  const newest = paid[0];
  const stats: HomeStat[] = [
    { id: 'paid', label: s.title, value: total, format: (n) => inr(Math.round(n)) },
    { id: 'count', label: c.kinds.payments, value: paid.length, format: (n) => String(Math.round(n)) },
    { id: 'latest', label: s.latest, value: newest ? newest.amountPaise : 0, format: (n: number) => (newest ? inr(Math.round(n)) : '-'), note: newest ? formatDate(newest.at.slice(0, 10)) : undefined },
{ id: 'other', label: tr('Other entries'), value: items.length - paid.length, format: (n) => String(Math.round(n)), note: tr('Charges and refunds') },
  ];
  return (
    <section className="gg-card gp-money gp-pay-sum" aria-label={s.title}>
      <HomeStats stats={stats} />
    </section>
  );
}

/** From and To, then the statement PDF. A period that is backwards or longer than a year is said here, under the fields, before the server is asked. */
function StatementSheet({ open, onClose, hotel, hotelName }: { open: boolean; onClose: () => void; hotel: string; hotelName: string | null }) {
  const paymentsCopy = useCopy(paymentsCopyByLanguage);
  const c = paymentsCopy;
  const toast = useToast();
  const today = guestToday();
  const [from, setFrom] = useState(() => monthStart(today));
  const [to, setTo] = useState(today);
  const bad = periodProblem(from, to, c);
  const scope = hotel === PORTAL_ALL_HOTELS ? undefined : hotel;

  const download = () => {
    if (bad) return;
    void openPdf(guestStatementPdfPath(from, to, scope), (text) => toast.show({ tone: 'error', text }), (text) => toast.show({ tone: 'info', text }));
    onClose();
  };

  return (
    <GgSheet
      open={open}
      title={c.statement.title}
      onClose={onClose}
      onSubmit={download}
      className="gg-stmt-sheet"
      footer={
        <>
          <PortalButton variant="line" onClick={onClose}>
            {c.statement.cancel}
          </PortalButton>
          <PortalButton type="submit" icon="file-earmark-pdf" disabled={Boolean(bad)}>
            {c.statement.download}
          </PortalButton>
        </>
      }
    >
      <p className="gg-stmt-intro">{c.statement.intro}</p>
      <div className="gg-stmt-fields">
        <div className="gg-stmt-field">
          <label htmlFor="gg-stmt-from">{c.statement.from}</label>
          <input id="gg-stmt-from" type="date" className="pt-input" required max={to || today} value={from} onChange={(e) => setFrom(e.target.value)} aria-invalid={bad ? true : undefined} aria-describedby="gg-stmt-say" />
        </div>
        <div className="gg-stmt-field">
          <label htmlFor="gg-stmt-to">{c.statement.to}</label>
          <input id="gg-stmt-to" type="date" className="pt-input" required min={from || undefined} max={today} value={to} onChange={(e) => setTo(e.target.value)} aria-invalid={bad ? true : undefined} aria-describedby="gg-stmt-say" />
        </div>
      </div>
      <div id="gg-stmt-say" aria-live="polite">
        {bad ? (
          <p className="gg-stmt-bad" role="alert">
            {bad}
          </p>
        ) : (
          <p className="gg-stmt-covers">
            {c.statement.covers(formatDate(from), formatDate(to))} {hotelName ? c.statement.oneHotel(hotelName) : scope ? null : c.statement.allHotels}
          </p>
        )}
      </div>
    </GgSheet>
  );
}

export function GuestHistory({ params, navigate }: ScreenProps) {
  const paymentsCopy = useCopy(paymentsCopyByLanguage);
  const c = paymentsCopy;
  const today = guestToday();
  const [kind, setKind] = useState<Kind>('payments');
  // the side menu's hotel (MJ: hotels are chosen there only)
  const [hotel] = useHotelChoice();
  // Home's "Get a statement" after a stay lands here with the sheet open
  const [statement, setStatement] = useState(params.statement === '1');
  const { hotels } = useGuestHotels();
  // the search box, on every screen size (MJ, 26 Oct 2026)
  const [typed, setTyped] = useState('');
  const search = useDebounced(typed.trim(), 250);
  const list = useCursorList<HistoryItem, HistoryList>((cursor) => guestApi.listHistory({ tab: kind, limit: CURSOR_LIMIT, cursor, hotel, search: search || undefined }), [kind, hotel, search]);
  useGuestRefresh(list.reload);
  const head = list.head;
  const showHotel = hotels.length > 1 && hotel === PORTAL_ALL_HOTELS;
  const hotelName = hotel !== PORTAL_ALL_HOTELS ? (hotels.find((h) => h.hotelId === hotel)?.name ?? null) : null;
  // the chosen hotel's reception, else (all hotels) the hotel of the newest row, so the help card shows for a guest of several hotels too
  const phone = useReceptionPhone(hotel !== PORTAL_ALL_HOTELS ? hotel : list.items[0]?.hotelId);
  const empty = c.empty[kind];
  const hw = useCopy(gpWordsByLanguage).history;

  return (
    <GgPage title={c.title} className="gg-payments gp-payments" status={head ? c.status(head.counts.payments, head.counts.charges) : undefined}>
      <SegTabs
        className="gp-order-tabs"
        label={c.kinds.label}
        active={kind}
        onChange={(id) => setKind(id === 'charges' ? 'charges' : 'payments')}
        tabs={[
          { id: 'payments', label: head ? `${c.kinds.payments} · ${head.counts.payments}` : c.kinds.payments, icon: 'wallet2' },
          { id: 'charges', label: head ? `${c.kinds.charges} · ${head.counts.charges}` : c.kinds.charges, icon: 'receipt' },
        ]}
      />
      <div className="gg-pay-grid has-side">
        <div className="gg-pay-main" aria-busy={list.state.status === 'loading' || undefined}>
          <div className="gg-pay-search">
            <ListSearch theme="portal" value={typed} onChange={setTyped} onClear={() => setTyped('')} placeholder={c.search} />
          </div>
          <PtLoad state={list.state} onRetry={list.reload} skeleton={<GgSkeleton variant="list" />}>
            {(data) => (
              <>
                <UnavailableNote hotels={data.unavailable} />
                {kind === 'payments' && list.items.length > 0 ? <PaySummary items={list.items} /> : null}
                {list.items.length === 0 ? (
                  <div className="gg-card gg-pay-empty">
                    <EmptyState look="portal" icon={kind === 'payments' ? 'wallet2' : 'receipt'} title={empty.title} text={empty.body}>
                      <PortalButton variant="line" icon="receipt" className="gp-empty-go" onClick={() => navigate('guest.bills')}>
                        {hw.seeBills}
                      </PortalButton>
                    </EmptyState>
                  </div>
                ) : (
                  <>
                    {groupHistoryByDay(list.items, today).map((day) => (
                      <section key={day.date} className="gp-pay-day" aria-labelledby={`gg-day-${day.date}`}>
                        <h2 id={`gg-day-${day.date}`} className="gp-sec-h">
                          {day.label} <span className="gp-count">{day.items.length}</span>
                        </h2>
                        {kind === 'payments' ? (
                          day.items.map((item) => (item.kind === 'payment' ? <PaymentCard key={item.id} item={item} showHotel={showHotel} /> : null))
                        ) : (
                          <div className="gg-card gg-pay-card">
                            <div className="gg-list">
                              {day.items.map((item) => (
                                <ActivityRow key={item.id} item={item} withStatus />
                              ))}
                            </div>
                          </div>
                        )}
                      </section>
                    ))}
                    <LoadMore list={list} total={data.total} />
                  </>
                )}
              </>
            )}
          </PtLoad>
        </div>

        {/* the statement line heads the side column on a desktop and the page on a phone */}
        <div className="gg-pay-side">
          <div className="hm-q gp-stmt">
            <span className="gp-stmt-ico" aria-hidden="true">
              <Bi name="file-earmark-text" />
            </span>
            <span className="hm-q-text">
              <b>{c.statement.title}</b>
              <span>{c.statement.intro}</span>
            </span>
            <PortalButton variant="line" icon="file-earmark-pdf" onClick={() => setStatement(true)}>
              {c.getStatement}
            </PortalButton>
          </div>
          <aside className="gg-card gg-pay-help" aria-labelledby="gg-pay-help-title">
            <h2 id="gg-pay-help-title">{c.help.title}</h2>
            <p>{c.help.body}</p>
            {phone ? <CallReception phone={phone} /> : null}
            <PortalButton variant="ghost" icon="chat-left-text" className="gp-help-go" onClick={() => navigate('guest.support')}>
              {hw.paymentHelp}
            </PortalButton>
          </aside>
        </div>
      </div>

      <StatementSheet open={statement} onClose={() => setStatement(false)} hotel={hotel} hotelName={hotelName} />
    </GgPage>
  );
}
