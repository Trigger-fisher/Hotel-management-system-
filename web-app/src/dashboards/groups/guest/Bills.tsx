'use client';
// Bills (guest.bills): search, filter chips with counts (To pay first when something is due), then one heading per stay with each bill as an expandable card
// (status, who billed, number, stay, due date, amount; opened: totals and payments; Open bill). Paying is the bar's job on a phone and the side card's on a
// desktop; online payment when the hotel's is set up (useCanPayOnline), else "to pay at reception" with Call.
import { useState } from 'react';

import { formatDate } from '@shared/dashboards';
import { billNumberText, billState, billTotals, paymentMethodLabel, stayRange, type BillList, type BillTab, type GuestBill } from '@shared/dashboards/guest';
import { billsCopyByLanguage } from '@shared/dashboards/guestCopy/bills.lang';
import { moneyOf, sellerName, staysFromBills, type GuestMoney } from '@shared/dashboards/guestStage';

import { useAsync, useDebounced, useMedia } from '@/components/ui';
import { Bi, DetailCard, DetailList, DetailNone, EmptyState, ListSearch, PortalButton, type DetailFact } from '@/dashboards/pallav/ui';
import type { ScreenProps } from '../../types';
import { guestApi, guestToday } from './api';
import { GuestPaySheet } from './parts';
import { useCanPayOnline, GgActionBar, GgChips, GgPage, GgRow, GgSkeleton, useGuestRefresh, useHotelChoice, useReceptionPhone, telHref, type GgChipItem } from './kit';
import { gpWordsByLanguage } from './kit/words';
import { inr, PtLoad } from '../portal/parts';
import { UnavailableNote } from '../portal/HotelParts';
import { LoadMore, useCursorList } from '../portal/AppKit';
import { useCopy } from '@/lib/i18n/language';


/** Every bill with something to pay, in one read (the action bar, the pay sheet, the To pay list and the chips' counts). */
const OPEN_LIMIT = 100;
/** One page of the other lists (the server takes 10, 25, 50 or 100). */
const PAGE_LIMIT = 25;

export function GuestBills({ navigate }: ScreenProps) {
  const billsCopy = useCopy(billsCopyByLanguage);
  const b = billsCopy;
  const today = guestToday();
  // the side menu's hotel (MJ: hotels are chosen there only)
  const [hotel] = useHotelChoice();
  // null = the default chip: To pay when something is due, else All
  const [picked, setPicked] = useState<BillTab | null>(null);
  const [paying, setPaying] = useState(false);
  // the search box, on every screen size (MJ, 26 Oct 2026): it narrows the bills to pay and the other lists alike
  const [typed, setTyped] = useState('');
  const search = useDebounced(typed.trim(), 250);
  // a phone: the long hint would be cut mid-word
  const narrow = useMedia('(max-width: 480px)');
  const words = useCopy(gpWordsByLanguage).bills;
  const open =useAsync(() => guestApi.listBills({ tab: 'open', limit: OPEN_LIMIT, hotel, search: search || undefined }), [hotel, search], { keep: true });
  useGuestRefresh(open.reload);

  const head = open.state.status === 'ready' ? open.state.data : null;
  const openBills = head?.items ?? [];
  const money = moneyOf(openBills, today);
  const tab: BillTab = picked ?? (head && head.counts.open === 0 ? 'all' : 'open');
  const online = useCanPayOnline(openBills[0]?.hotelId ?? hotel);

  const status = !head ? undefined : money.duePaise > 0 ? b.status.owing(inr(money.duePaise), money.openCount) : head.counts.all > 0 ? b.status.clear : b.status.none;
  // the bill's own hotel rides along, so it is found whatever the sidebar shows (this page's hotel chips may differ from it)
  const openBill = (bill: GuestBill) => navigate('guest.bill', bill.hotelId ? { id: bill.id, hotel: bill.hotelId } : { id: bill.id });

  return (
    <GgPage title={b.title} status={status} className="gg-bills">
      <div className="gg-bills-search">
        <ListSearch theme="portal" value={typed} onChange={setTyped} onClear={() => setTyped('')} placeholder={narrow ? words.searchShort : b.search} />
      </div>
      <PtLoad state={open.state} onRetry={open.reload} skeleton={<GgSkeleton variant="list" />}>
        {(data) => (
          <>
            <FilterChips counts={data.counts} tab={tab} onTab={setPicked} />
            <UnavailableNote hotels={data.unavailable} />
            <div className="gg-bills-grid">
              <div className="gg-bills-main">
                {tab === 'open' ? (
                  <OpenList bills={data.items} today={today} onOpen={openBill} onAll={() => setPicked('all')} />
                ) : (
                  <PagedList key={`${tab}|${hotel}`} tab={tab} hotel={hotel} search={search} today={today} onOpen={openBill} />
                )}
              </div>
              <aside className="gg-bills-side" aria-label={b.bar.label}>
                <SummaryCard money={money} online={online} hotelId={data.items[0]?.hotelId} onPay={() => setPaying(true)} onStatement={() => navigate('guest.history', { statement: '1' })} />
              </aside>
            </div>
          </>
        )}
      </PtLoad>
      {money.duePaise > 0 ? <PayBar money={money} online={online} hotelId={openBills[0]?.hotelId} onPay={() => setPaying(true)} /> : null}
      {/* after a payment the sheet calls refreshGuest(): this page's reads (useGuestRefresh) and the badges reload */}
      {online ? <GuestPaySheet open={paying} bills={openBills} onClose={() => setPaying(false)} onReceipt={() => navigate('guest.history')} /> : null}
    </GgPage>
  );
}

/** To pay (coral count) · Paid · Cancelled (only when there is one, or it is chosen) · All. */
function FilterChips({ counts, tab, onTab }: { counts: BillList['counts']; tab: BillTab; onTab: (t: BillTab) => void }) {
  const billsCopy = useCopy(billsCopyByLanguage);
  const b = billsCopy;
  const items: GgChipItem[] = [
    { id: 'open', label: b.filters.open, count: counts.open, tone: 'warn' },
    { id: 'paid', label: b.filters.paid, count: counts.paid },
    ...(counts.cancelled > 0 || tab === 'cancelled' ? [{ id: 'cancelled', label: b.filters.cancelled, count: counts.cancelled }] : []),
    { id: 'all', label: b.filters.all, count: counts.all },
  ];
  return <GgChips items={items} value={tab} onChange={(id) => onTab(id as BillTab)} label={b.filters.label} className="gg-bills-filters" />;
}

/** One bill as an expandable card: status at the left; who billed, the number, the stay and when it is due; the amount at the right; opened: the totals and the payments. */
function BillCard({ bill, today, onOpen }: { bill: GuestBill; today: string; onOpen: () => void }) {
  const c = useCopy(billsCopyByLanguage).bill;
  const w = useCopy(gpWordsByLanguage).bills;
  const t = billTotals(bill);
  const st = billState(bill, today);
  const owing = st === 'due' || st === 'overdue';
  const tag = st === 'overdue' ? w.overdue : st === 'due' ? c.toPay : st === 'paid' ? c.paid : c.cancelled;
  const dueFact: DetailFact = owing
    ? { label: w.due, value: bill.dueOn ? formatDate(bill.dueOn) : c.payAtCheckout, tone: st === 'overdue' ? 'danger' : 'warn' }
    : { label: c.issued, value: bill.current ? c.running : formatDate(bill.issuedOn) };
  return (
    <DetailCard
      className={`gp-bill gp-bill-${st}`}
      label={billNumberText(bill.number)}
      warn={owing}
      lead={{ big: <Bi name={bill.business === 'hotel' ? 'building' : 'cup-hot'} />, tag }}
      facts={[
        { label: c.billedBy, value: sellerName(bill) },
        { label: w.billNo, value: billNumberText(bill.number) },
        { label: c.stay, value: stayRange(bill.stayFrom, bill.stayTo) },
        dueFact,
      ]}
      amount={{
        label: owing ? c.toPay : c.total,
        value: inr(owing ? t.duePaise : t.totalPaise),
        tone: st === 'overdue' ? 'danger' : st === 'due' ? 'warn' : st === 'cancelled' ? 'muted' : 'default',
        sub: owing && t.paidPaise > 0 ? c.paidOf(inr(t.paidPaise), inr(t.totalPaise)) : undefined,
      }}
      sections={[
        {
          icon: 'receipt',
          title: c.charges,
          content: (
            <DetailList
              items={[
                { label: c.subtotal, value: inr(t.subtotalPaise) },
                { label: c.gst, value: inr(t.gstPaise) },
                { label: c.total, value: inr(t.totalPaise), total: true },
              ]}
            />
          ),
        },
        {
          icon: 'wallet2',
          title: c.payments,
          count: bill.payments.length,
          content:
            bill.payments.length > 0 ? (
              <DetailList items={bill.payments.map((p) => ({ key: p.id, label: `${paymentMethodLabel[p.method]} · ${formatDate(p.at)}`, value: `− ${inr(p.amountPaise)}` }))} />
            ) : (
              <DetailNone>{c.noPayments}</DetailNone>
            ),
        },
      ]}
      actions={
        <PortalButton icon="arrow-right" onClick={onOpen}>
          {w.openBill}
        </PortalButton>
      }
    />
  );
}

/** The bills under one heading per stay (hotel, dates, room, the bills' count and what is still to pay there). */
function StayGroups({ bills, today, onOpen }: { bills: readonly GuestBill[]; today: string; onOpen: (bill: GuestBill) => void }) {
  const b = useCopy(billsCopyByLanguage);
  const w = useCopy(gpWordsByLanguage).bills;
  const stays = staysFromBills(bills, today);
  return (
    <div className="gp-staylist" aria-label={b.list.groupsLabel}>
      {stays.map((s) => {
        const sub = [s.hotelName ? stayRange(s.from, s.to) : null, s.roomNumber && s.roomNumber !== '—' ? `${b.bill.room} ${s.roomNumber}` : null].filter(Boolean).join(' · ');
        return (
          <section key={s.key} className="gp-staysec" aria-labelledby={`gp-stay-${s.key}`}>
            <div className="gp-staysec-h">
              <div className="gp-staysec-t">
                <h2 id={`gp-stay-${s.key}`} className="gp-sec-h">
                  {s.hotelName ?? stayRange(s.from, s.to)} <span className="gp-count">{s.bills.length}</span>
                </h2>
                {sub ? <span className="gp-staysec-sub">{sub}</span> : null}
              </div>
              {s.current ? <span className="gp-tag gp-tag-gold">{w.thisStay}</span> : null}
            </div>
            {s.bills.map((bill) => (
              <BillCard key={bill.id} bill={bill} today={today} onOpen={() => onOpen(bill)} />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function Empty({ tab, onAll }: { tab: BillTab; onAll?: () => void }) {
  const billsCopy = useCopy(billsCopyByLanguage);
  const b = billsCopy;
  const e = b.empty;
  const [title, body, icon] =
    tab === 'open' ? [e.openTitle, e.openBody, 'check-circle'] : tab === 'paid' ? [e.paidTitle, e.paidBody, 'receipt'] : tab === 'cancelled' ? [e.cancelledTitle, e.cancelledBody, 'slash-circle'] : [e.allTitle, e.allBody, 'receipt'];
  return (
    <div className="gg-card gg-bills-empty">
      <EmptyState look="portal" icon={icon} title={title} text={body}>
        {onAll ? (
          <div className="mt-3">
            <PortalButton variant="line" icon="list-ul" onClick={onAll}>
              {e.seeAll}
            </PortalButton>
          </div>
        ) : null}
      </EmptyState>
    </div>
  );
}

/** To pay: every open bill, from the one read the action bar uses (no second call). Their count is the page's status line. */
function OpenList({ bills, today, onOpen, onAll }: { bills: readonly GuestBill[]; today: string; onOpen: (bill: GuestBill) => void; onAll: () => void }) {
  if (bills.length === 0) return <Empty tab="open" onAll={onAll} />;
  return <StayGroups bills={bills} today={today} onOpen={onOpen} />;
}

/** Paid, Cancelled and All: read by cursor, 25 at a time, page by page. Mounted per chip and hotel, so a chip change starts at the top. */
function PagedList({ tab, hotel, search, today, onOpen }: { tab: BillTab; hotel: string; search: string; today: string; onOpen: (bill: GuestBill) => void }) {
  const billsCopy = useCopy(billsCopyByLanguage);
  const b = billsCopy;
  const list = useCursorList<GuestBill, BillList>((cursor) => guestApi.listBills({ tab, hotel, limit: PAGE_LIMIT, cursor, search: search || undefined }), [tab, hotel, search]);
  useGuestRefresh(list.reload);
  return (
    <PtLoad state={list.state} onRetry={list.reload} skeleton={<GgSkeleton variant="list" />}>
      {(page) =>
        list.items.length === 0 ? (
          <Empty tab={tab} />
        ) : (
          <>
            <p className="gg-bills-count" aria-live="polite">
              {b.list.count(page.total)}
            </p>
            <StayGroups bills={list.items} today={today} onOpen={onOpen} />
            <LoadMore list={list} total={page.total} limit={PAGE_LIMIT} />
          </>
        )
      }
    </PtLoad>
  );
}

/** The reception's Call button for the bar and the card (nothing when the phone is not known: never a made-up number). */
function CallButton({ phone, label, variant }: { phone: string | null; label: string; variant: 'solid' | 'line' }) {
  if (!phone) return null;
  return (
    <PortalButton
      variant={variant}
      icon="telephone"
      onClick={() => {
        window.location.href = telHref(phone);
      }}
    >
      {label}
    </PortalButton>
  );
}

/** Phone (and a narrow desktop): "3 bills · ₹14,689.00 · Pay" over the tab bar; on the real server "₹14,689.00 to pay at reception · Call". */
function PayBar({ money, online, hotelId, onPay }: { money: GuestMoney; online: boolean; hotelId?: string; onPay: () => void }) {
  const billsCopy = useCopy(billsCopyByLanguage);
  const b = billsCopy;
  const phone = useReceptionPhone(hotelId);
  const summary = (
    <>
      <span className="gg-bar-main">{online ? b.bar.summary(money.openCount, inr(money.duePaise)) : b.bar.atReception(inr(money.duePaise))}</span>
      {money.overduePaise > 0 ? <span className="gg-bar-bad">{b.bar.overdue(inr(money.overduePaise))}</span> : null}
    </>
  );
  return (
    <GgActionBar
      label={b.bar.label}
      summary={summary}
      action={
        online ? (
          <PortalButton icon="lock" onClick={onPay}>
            {b.bill.pay(inr(money.duePaise))}
          </PortalButton>
        ) : (
          <CallButton phone={phone} label={b.bar.call} variant="solid" />
        )
      }
    />
  );
}

/** Wide desktop: the money card at the side (sticky): what is still to pay, Pay ₹X or "to pay at reception" with Call, and a statement. */
function SummaryCard({ money, online, hotelId, onPay, onStatement }: { money: GuestMoney; online: boolean; hotelId?: string; onPay: () => void; onStatement: () => void }) {
  const billsCopy = useCopy(billsCopyByLanguage);
  const b = billsCopy;
  const phone = useReceptionPhone(hotelId);
  const owing = money.duePaise > 0;
  return (
    <section className={`gg-card gg-bills-sum${owing ? ' owing' : ''}`}>
      <span className="gg-money-label">{owing ? b.bill.toPay : b.empty.openTitle}</span>
      {owing ? <span className="gg-money-amt warn">{inr(money.duePaise)}</span> : <span className="gg-money-amt">{inr(0)}</span>}
      {owing ? <span className="gg-money-of">{b.list.count(money.openCount)}</span> : null}
      {money.overduePaise > 0 ? <span className="gg-money-bad">{b.bar.overdue(inr(money.overduePaise))}</span> : null}
      {owing ? (
        <div className="gg-bills-sum-act">
          {online ? (
            <PortalButton icon="lock" onClick={onPay}>
              {b.bill.pay(inr(money.duePaise))}
            </PortalButton>
          ) : (
            <>
              <span className="gg-money-note">{b.bar.atReception(inr(money.duePaise))}</span>
              <CallButton phone={phone} label={b.bill.callReception} variant="line" />
            </>
          )}
        </div>
      ) : null}
      <div className="gg-list gg-bills-sum-links">
        <GgRow icon="file-earmark-text" title={b.statement.title} sub={b.statement.sub} onPress={onStatement} />
      </div>
    </section>
  );
}
