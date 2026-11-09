'use client';

// hotel.admin.payments - online payments, rebuilt (MJ, 2 Nov 2026): the money in (payments, with their filters and the open payment beside the list), money back (refunds), money asked for
// (pay links) and money to the bank (settlements). The keys and webhooks are set up by the platform team in the Set-up centre (MJ, 5 Nov 2026); the hotel sees only
// whether each business is switched on. The server keeps payments from the signed webhook; the mock answers the same shapes.
import { useEffect, useState } from 'react';
import { adminCopy, razorpayBusinessName, type RazorpayBusiness, type RazorpayLinkItem, type RazorpayOverview, type RazorpayPayment, type RazorpayRefundItem, type RazorpaySettlementItem } from '@shared/dashboards/admin';
import { formatDate, formatDateTime, formatINR, formatTime } from '@shared/dashboards/format';
import type { LookupItem } from '@shared/dashboards/common';
import { displayPhone } from '@shared/dashboards/website';
import { errorText, useAsync, useDebounced, useSubmit, useToast } from '@/components/ui';
import { Bi, Button, Dialog, EmptyState, FormSection, ListSearch, LoadError, Modal, Pager, pagerView, RupeeInput, Select, type TableView } from '@/dashboards/pallav/ui';
import type { ScreenProps } from '../../types';
import { payProblemsAdminCopy as dc, type Problem, type ProblemStatus } from '@shared/dashboards/payProblems';
import { disputesApi } from '../portal/payProblemsApi';
import { api as companiesApi } from '../companies/api';
import { HomeStats } from '../overview/HomeJobs';
import { adminApi, useAdminActor } from './api';

import { tr, trf } from '@/lib/i18n/language';
const t = adminCopy.payments;
const money = (paise: number): string => formatINR(paise, { decimals: false });
const dM = (iso: string): string => formatDate(iso).slice(0, 6);
const when = (iso: string): string => `${dM(iso)}, ${formatTime(iso)}`;
const METHOD_ICON: Record<string, string> = { upi: 'phone', card: 'credit-card', netbanking: 'bank', wallet: 'wallet2', emi: 'calendar3', paylater: 'hourglass-split' };
const ucfirst =(s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const methodLabel = (m: string): string => (m === 'upi' ? 'UPI' : m === 'emi' ? 'EMI' : ucfirst(m.replace('_', ' ')));

type Tab = 'pay' | 'refunds' | 'links' | 'settle' | 'disputes';
const TABS: [Tab, string][] = [['pay', 'Money in'], ['refunds', 'Refunds'], ['links', 'Pay links'], ['settle', 'Paid to your bank'], ['disputes', 'Problems raised']];

/** The word a person reads: a part-refunded payment is still "captured" for the payment service. */
const stKey = (p: RazorpayPayment): string => (p.status === 'captured' && p.amountRefundedPaise > 0 ? 'partly' : p.status);
const STATUS_WORD: Record<string, string> = { captured: 'Paid', authorized: 'Not finished yet', failed: 'Failed', refunded: 'Refunded', created: 'Started', partly: 'Partly refunded' };
const STATUS_CHIPS: [string, string][] = [['all', 'Any status'], ['captured', 'Paid'], ['attention', 'Needs a look'], ['failed', 'Failed'], ['refunded', 'Refunded']];
const METHOD_CHIPS: [string, string][] = [['upi', 'UPI'], ['card', 'Card'], ['netbanking', 'Netbanking'], ['wallet', 'Wallet']];
const REASONS = ['Guest cancelled', 'Charged twice', 'Item not available', 'Room changed', 'Service issue', 'Other'];
const LINK_WORD: Record<string, string> = { created: 'Waiting', paid: 'Paid', partially_paid: 'Part paid', expired: 'Expired', cancelled: 'Cancelled' };

/** The whole panel for the hotel's top role and for staff with Bills access (the server decides: Bills view reads, Bills edit refunds and makes links). */
export function Payments({ user }: ScreenProps) {
  const superAdmin = useAdminActor(user);
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('pay');
  const [business, setBusiness] = useState<RazorpayBusiness | 'all'>('all');
  const [status, setStatus] = useState('all');
  const [method, setMethod] = useState('');
  const [typed, setTyped] = useState('');
  const search = useDebounced(typed, 250);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newLink, setNewLink] = useState(false);
  const [tabBiz, setTabBiz] = useState<RazorpayBusiness>('hotel');
  const { state, reload } = useAsync(() => adminApi.listRazorpay({ business, status: status as never, method: method || undefined, search, page, pageSize }), [business, status, method, search, page, pageSize, superAdmin], { keep: true });
  // how many problems wait for an answer, shown on the Disputes tab (read again when the tab changes, so an answer lowers it)
  const waiting = useAsync(() => disputesApi.list({ status: 'open', page: 1 }), [tab, superAdmin]);
  const waitingCount = waiting.state.status === 'ready' ? waiting.state.data.openCount : 0;

  if (state.status === 'error') return <LoadError error={state.error} onRetry={reload} />;
  const data: RazorpayOverview | null = state.status === 'ready' ? state.data : null;
  const narrow = (f: () => void) => { f(); setPage(1); };
  const setup = data?.setup ?? [];
  const nameOf = (b: RazorpayBusiness): string => setup.find((s) => s.business === b)?.name ?? razorpayBusinessName[b];
  const readyOf = (b: RazorpayBusiness): boolean => (setup.length === 0 ? true : setup.find((s) => s.business === b)?.ready === true);
  const notReady = setup.filter((x) => !x.ready);
  const hasFilter = business !== 'all' || status !== 'all' || method !== '' || typed.trim() !== '';
  const clearAll = () => { setBusiness('all'); setStatus('all'); setMethod(''); setTyped(''); setPage(1); };
  const items = data?.page.items ?? [];
  const open = items.find((p) => p.paymentId === openId) ?? items[0] ?? null;
  const goPayment = (paymentId: string) => { setTab('pay'); clearAll(); setTyped(paymentId); setOpenId(paymentId); };

  return (
    <div className="rzp-page">
      <div className="page-head reveal">
        <div>
          <p className="pms-sub">{tr("Money guests and companies paid online, refunds, pay links and what reached your bank.")}</p>
          <div className="rzp-pills">
            {(['hotel', 'food'] as const).map((b) => (
              <span key={b} className={`rzp-pill ${data ? (readyOf(b) ? 'ok' : 'warn') : ''}`}><i />{nameOf(b)}: {data ? (readyOf(b) ? tr("Working") : tr("Not switched on")) : tr("Checking")}</span>
            ))}
          </div>
        </div>
        <div className="co-head-actions">
          {setup.length === 0 || notReady.length < setup.length ? <Button icon="plus-lg" onClick={() => setNewLink(true)}>{tr("Send a pay link")}</Button> : null}
        </div>
      </div>

      {data && notReady.length > 0 ? (
        <div className="rzp-banner reveal" role="status">
          <Bi name="info-circle" />
          <span>{trf("Online payments are not switched on for {0} yet. The platform team sets this up.", [notReady.map((x) => x.name).join(' and ')])}</span>
        </div>
      ) : null}

      {data ? (
        <div className="reveal">
          <HomeStats
            stats={[
              { id: 'today', label: tr('Collected today'), value: data.stats.todayPaise, format: money, note: tr('Hotel and restaurant together') },
              { id: 'month', label: tr('This month'), value: data.stats.monthPaise, format: money, note: `${data.counts.hotel + data.counts.food} ${tr('payments kept')}` },
              { id: 'failed', label: tr('Failed'), value: data.stats.failed, format: (n) => String(Math.round(n)), note: `${money(data.stats.refundedPaise)} ${tr('refunded this month')}` },
              { id: 'rejected', label: tr('Rejected'), value: data.stats.rejected, format: (n) => String(Math.round(n)), note: tr('Bad signature. Never counted as paid.') },
            ]}
          />
        </div>
      ) : null}

      <nav className="rzp-tabs reveal" aria-label={tr("Online payment sections")}>
        {TABS.map(([k, label]) => <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}{k === 'disputes' && waitingCount > 0 ? <b className="ms-1">{waitingCount}</b> : null}</button>)}
      </nav>

      {tab === 'pay' ? (
        data ? (
          <section className="rzp-work reveal">
            <div className="rzp-card rzp-list">
              <div className="rzp-lhead">
                <ListSearch value={typed} onChange={(v) => { setTyped(v); setPage(1); }} onClear={() => { setTyped(''); setPage(1); }} placeholder={tr("Search by name, phone, email, amount or payment number")} />
                <div className="rzp-row">
                  <div className="rzp-seg" role="group" aria-label={tr("Business")}>
                    {(['all', 'hotel', 'food'] as const).map((k) => (
                      <button key={k} type="button" className={business === k ? 'on' : ''} onClick={() => narrow(() => setBusiness(k))}>{k === 'all' ? t.filters.both : nameOf(k)}{k !== 'all' ? <b>{data.counts[k]}</b> : null}</button>
                    ))}
                  </div>
                </div>
                <div className="rzp-chips" role="group" aria-label={tr("Status")}>
                  {STATUS_CHIPS.map(([k, label]) => <button key={k} type="button" className={`rzp-chip ${k === 'failed' || k === 'attention' ? 'bad' : ''} ${status === k ? 'on' : ''}`} onClick={() => narrow(() => setStatus(k))}>{label}</button>)}
                </div>
                <div className="rzp-chips" role="group" aria-label={tr("How they paid")}>
                  {METHOD_CHIPS.map(([k, label]) => <button key={k} type="button" className={`rzp-chip ${method === k ? 'on' : ''}`} onClick={() => narrow(() => setMethod(method === k ? '' : k))}>{label}</button>)}
                </div>
              </div>
              <div className="rzp-meta"><span>{tr("Showing")} {items.length} {tr("of")} {data.page.total} {tr("payments")}</span>{hasFilter ? <button type="button" onClick={clearAll}>{tr("Clear all")}</button> : null}</div>
              {data.page.total === 0 ? (
                <EmptyState icon="credit-card-2-front" title={t.empty.title(typed.trim())} text={hasFilter ? tr('Try clearing a filter.') : tr('Each online payment shows here as soon as it is made.')}>{hasFilter ? <Button variant="outline" onClick={clearAll}>{tr("Clear all")}</Button> : null}</EmptyState>
              ) : (
                <>
                  <div>{items.map((p) => <PayRow key={p.id} p={p} on={open?.id === p.id} onOpen={() => setOpenId(p.paymentId)} />)}</div>
                  <div className="rzp-pager"><Pager server view={view(data, setPage, (n) => { setPageSize(n); setPage(1); })} /></div>
                </>
              )}
            </div>
            <aside className="rzp-card rzp-detail">
              {open ? <Detail key={open.id} p={open} onChanged={reload} /> : <EmptyState icon="credit-card" title={tr("Pick a payment")} text="Its details, money breakdown and refund options show here." />}
            </aside>
          </section>
        ) : null
      ) : null}

      {tab !== 'pay' && tab !== 'disputes' ? (
        <div className="rzp-bizbar reveal">
          <div className="rzp-seg" role="group" aria-label={tr("Business")}>
            {(['hotel', 'food'] as const).map((b) => <button key={b} type="button" className={tabBiz === b ? 'on' : ''} onClick={() => setTabBiz(b)}>{nameOf(b)}</button>)}
          </div>
        </div>
      ) : null}
      {tab === 'refunds' ? (readyOf(tabBiz) ? <RefundsTab key={tabBiz} biz={tabBiz} onOpen={goPayment} /> : <NotSetUp name={nameOf(tabBiz)} />) : null}
      {tab === 'links' ? (readyOf(tabBiz) ? <LinksTab key={tabBiz} biz={tabBiz} onNew={() => setNewLink(true)} /> : <NotSetUp name={nameOf(tabBiz)} />) : null}
      {tab === 'settle' ? (readyOf(tabBiz) ? <SettleTab key={tabBiz} biz={tabBiz} /> : <NotSetUp name={nameOf(tabBiz)} />) : null}
      {tab === 'disputes' ? <DisputesTab onOpen={goPayment} /> : null}

      {newLink ? (
        <LinkForm
          names={{ hotel: nameOf('hotel'), food: nameOf('food') }}
          ready={{ hotel: readyOf('hotel'), food: readyOf('food') }}
          first={tab !== 'pay' ? tabBiz : readyOf('hotel') ? 'hotel' : 'food'}
          onClose={() => setNewLink(false)}
          onMade={(m) => { toast.show({ tone: 'success', text: m }); setTab('links'); }}
        />
      ) : null}
    </div>
  );
}

function view(data: RazorpayOverview, setPage: (n: number) => void, setPerPage: (n: number) => void): TableView<RazorpayPayment> {
  return { ...pagerView(data.page, { setPage }), setPerPage };
}

function NotSetUp({ name }: { name: string }) {
  return <div className="rzp-card"><EmptyState icon="credit-card" title={trf("Online payments are not switched on for {0} yet", [name])} text={tr("The platform team sets this up. This part starts working once they have.")} /></div>;
}

function PayRow({ p, on, onOpen }: { p: RazorpayPayment; on: boolean; onOpen: () => void }) {
  const k = stKey(p);
  const at = p.paidAt ?? p.createdAt;
  return (
    <button type="button" className={`rzp-row ${on ? 'on' : ''}`} onClick={onOpen}>
      <span className="ico" aria-hidden="true"><Bi name={METHOD_ICON[p.method ?? ''] ?? 'cash-coin'} /></span>
      <span className="who">
        <span className="t">{p.contact ? displayPhone(p.contact) : p.email || t.none}</span>
        <span className="u"><span className="biz">{p.business === 'hotel' ? tr("Hotel") : tr("Food")}</span>{p.method ? methodLabel(p.method) : t.methodUnknown} · {when(at)}</span>
      </span>
      <span className="amt"><strong className="num">{money(p.amountPaise)}</strong><span className={`rzp-st ${k}`}>{STATUS_WORD[k] ?? k}</span></span>
    </button>
  );
}

function Detail({ p, onChanged }: { p: RazorpayPayment; onChanged: () => void }) {
  const toast = useToast();
  const [refunding, setRefunding] = useState(false);
  const [checking, setChecking] = useState(false);
  const k = stKey(p);
  const left = p.amountPaise - p.amountRefundedPaise;
  const fee = p.feePaise ?? 0;
  const receive = p.amountPaise - fee - p.taxPaise - p.amountRefundedPaise;
  const check = async () => {
    setChecking(true);
    const res = await adminApi.checkRazorpay(p.business, p.paymentId);
    setChecking(false);
    if (res.ok) { toast.show({ tone: 'success', text: res.data.message }); onChanged(); } else toast.show({ tone: 'error', text: errorText(res.error) });
  };
  const steps: { text: string; at: string | null; tone: 'done' | 'bad' | 'wait' }[] = [{ text: 'Guest started the payment', at: p.createdAt, tone: 'done' }];
  if (p.status === 'failed') steps.push({ text: 'Payment failed', at: p.updatedAt, tone: 'bad' });
  else {
    if (p.status !== 'created') steps.push({ text: 'Approved by the bank', at: p.paidAt ?? p.createdAt, tone: 'done' });
    if (p.status === 'captured' || p.status === 'refunded') steps.push({ text: 'Paid, the money is yours', at: p.paidAt ?? p.createdAt, tone: 'done' });
    if (p.status === 'authorized') steps.push({ text: 'Not finished yet', at: null, tone: 'wait' });
    if (p.amountRefundedPaise > 0) steps.push({ text: trf("Refunded {0}{1}", [money(p.amountRefundedPaise), p.status === 'refunded' ? '' : ' (part)']), at: p.updatedAt, tone: 'done' });
    if (p.status === 'captured') steps.push({ text: 'Paid out to your bank', at: null, tone: 'wait' });
  }
  return (
    <div className="rzp-dbody">
      <div className="rzp-dtop">
        <div><div className="big num">{money(p.amountPaise)}</div><div className="id">{p.paymentId}</div></div>
        <span className={`rzp-st ${k}`}>{STATUS_WORD[k] ?? k}</span>
      </div>
      {p.errorDescription ? <div className="rzp-reason"><b>{p.status === 'failed' ? tr("Why it failed") : tr("Note from the payment service")}</b>{p.errorDescription}</div> : null}
      <div className="rzp-acts">
        {p.status === 'captured' && left > 0 ? <Button icon="arrow-counterclockwise" onClick={() => setRefunding(true)}>{p.amountRefundedPaise > 0 ? tr("Refund more") : tr("Refund")}</Button> : null}
        <Button variant="outline" icon="arrow-repeat" disabled={checking} onClick={() => void check()}>{checking ? tr("Checking") : tr("Check again")}</Button>
      </div>
      {refunding ? <RefundPanel p={p} left={left} onClose={() => setRefunding(false)} onDone={(m) => { toast.show({ tone: 'success', text: m }); setRefunding(false); onChanged(); }} /> : null}
      <div><p className="rzp-sec">{tr("What happened")}</p>
        <ul className="rzp-tl">{steps.map((s, i) => <li key={i}><span className={`d ${s.tone}`} /><span>{s.text}</span><small>{s.at ? when(s.at) : ''}</small></li>)}</ul>
      </div>
      <div><p className="rzp-sec">{tr("Money")}</p>
        <div className="rzp-money">
          <div><span>{tr("Guest paid")}</span><span className="num">{money(p.amountPaise)}</span></div>
          {p.feePaise !== null ? <><div><span>{tr("Payment fee")}</span><span className="num">- {money(fee)}</span></div><div><span>{tr("GST on fee")}</span><span className="num">- {money(p.taxPaise)}</span></div></> : <div><span>{t.detail.fee}</span><span>{t.detail.notReported}</span></div>}
          {p.amountRefundedPaise > 0 ? <div><span>{tr("Refunded")}</span><span className="num">- {money(p.amountRefundedPaise)}</span></div> : null}
          {p.feePaise !== null && (p.status === 'captured' || p.status === 'refunded') ? <div className="tot"><span>{tr("You receive")}</span><span className="num">{money(receive)}</span></div> : null}
        </div>
      </div>
      <div><p className="rzp-sec">{tr("Payer")}</p>
        <dl className="rzp-kv"><dt>{tr("Phone")}</dt><dd>{p.contact ? displayPhone(p.contact) : t.none}</dd><dt>{tr("Email")}</dt><dd>{p.email || t.none}</dd><dt>{tr("Method")}</dt><dd>{p.method ? methodLabel(p.method) : t.methodUnknown}</dd></dl>
      </div>
      <div><p className="rzp-sec">{tr("Order")}</p>
        <dl className="rzp-kv"><dt>{t.detail.order}</dt><dd className="mono">{p.orderId || t.none}</dd><dt>{t.detail.description}</dt><dd>{p.description || t.none}</dd><dt>{tr("Last update")}</dt><dd>{formatDateTime(p.updatedAt)}</dd>
          {Object.entries(p.notes).map(([key, v]) => <Note key={key} k={key} v={v} />)}
        </dl>
      </div>
      <details className="rzp-raw"><summary>{tr("Full record")}</summary><pre>{JSON.stringify(p.payload, null, 2)}</pre></details>
    </div>
  );
}

function Note({ k, v }: { k: string; v: string }) {
  return <><dt>{k.split(/[_\s-]+/).filter(Boolean).map(ucfirst).join(' ')}</dt><dd>{v}</dd></>;
}

function RefundPanel({ p, left, onClose, onDone }: { p: RazorpayPayment; left: number; onClose: () => void; onDone: (message: string) => void }) {
  const [part, setPart] = useState(false);
  const [paise, setPaise] = useState(left);
  const [reason, setReason] = useState(REASONS[0] ?? 'Other');
  const [note, setNote] = useState('');
  const [instant, setInstant] = useState(false);
  const [asking, setAsking] = useState(false);
  const { busy, errors, submit } = useSubmit(['amountPaise', 'reason', 'note']);
  const amount = part ? paise : left;
  const invalid = amount < 100 || amount > left;
  const how = p.method === 'upi' ? "the guest's UPI" : p.method === 'card' ? "the guest's card" : "the guest's bank account";
  return (
    <div className="rzp-refund">
      <p className="rzp-sec">{tr("Refund this payment")} <button type="button" className="rzp-link" onClick={onClose}>{tr("Close")}</button></p>
      <div className="rzp-seg" role="group" aria-label={tr("How much")}>
        <button type="button" className={!part ? 'on' : ''} onClick={() => setPart(false)}>{tr("Full")} {money(left)}</button>
        <button type="button" className={part ? 'on' : ''} onClick={() => { setPart(true); setPaise(left); }}>{tr("Part of it")}</button>
      </div>
      {part ? (
        <div><label className="form-label">{tr("Amount in rupees")}</label><RupeeInput paise={paise} onChange={setPaise} placeholder="0.00" ariaLabel="Refund amount" />
          {errors.amountPaise ? <div className="field-error">{errors.amountPaise}</div> : amount > left ? <div className="field-error">{tr("At most")} {money(left)} {tr("can still be refunded.")}</div> : null}
        </div>
      ) : null}
      <div className="rzp-g2">
        <div><label className="form-label">{tr("Reason")}</label><Select value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map((r) => <option key={r}>{r}</option>)}</Select></div>
        <div><label className="form-label">{tr("How fast")}</label><Select value={instant ? 'i' : 'n'} onChange={(e) => setInstant(e.target.value === 'i')}><option value="n">{tr("Normal, 5 to 7 working days")}</option><option value="i">{tr("Instant, in minutes")}</option></Select></div>
      </div>
      <div><label className="form-label">{tr("Note for the record")}</label><input className="form-control" maxLength={200} placeholder={tr("Kept in the log. The guest does not see it.")} value={note} onChange={(e) => setNote(e.target.value)} />
        {errors.note ? <div className="field-error">{errors.note}</div> : null}
      </div>
      <p className="rzp-hint">{money(amount)} {tr("goes back to")} {how}{tr(". The payment fee is not returned. An instant refund costs an extra fee.")}</p>
      <div className="rzp-acts"><Button variant="danger" disabled={invalid || busy} onClick={() => setAsking(true)}>{tr("Refund")} {money(invalid ? left : amount)}</Button><Button variant="ghost" onClick={onClose}>{tr("Cancel")}</Button></div>
      <Dialog
        open={asking} tone="danger" title={trf("Refund {0}?", [money(amount)])} message={`This sends ${money(amount)} back to ${how}. It cannot be undone.`} confirmLabel="Refund" busy={busy}
        onCancel={() => setAsking(false)}
        onConfirm={() => void submit(() => adminApi.refundRazorpay(p.business, p.paymentId, { amountPaise: amount, reason, note, instant }), (d) => { setAsking(false); onDone(d.message); }).then(() => setAsking(false))}
      />
    </div>
  );
}

function RefundsTab({ biz, onOpen }: { biz: RazorpayBusiness; onOpen: (paymentId: string) => void }) {
  const { state, reload } = useAsync(() => adminApi.listRazorpayRefunds(biz), [biz]);
  if (state.status === 'error') return <LoadError error={state.error} onRetry={reload} />;
  const items: RazorpayRefundItem[] = state.status === 'ready' ? state.data.items : [];
  return (
    <section className="rzp-card rzp-wide reveal">
      <div className="rzp-vhead"><div><h2>{tr("Refunds")}</h2><p>{tr("Every refund sent to a guest, with who gave it and why. Start one from any paid payment.")}</p></div></div>
      {state.status !== 'ready' ? <div className="rzp-empty">{tr("Loading refunds")}</div> : items.length === 0 ? <EmptyState icon="arrow-counterclockwise" title={tr("No refunds yet")} text="A refund you make shows here with its reason." /> : items.map((r) => (
        <div key={r.id} className="rzp-xrow">
          <div className="x1"><div className="t">{r.payer || r.paymentId}</div><div className="u">{r.reason || tr("No reason given")}{r.by ? ` · by ${r.by}` : ''}</div></div>
          <div className="x2 u"><span className="mono">{r.paymentId}</span><br />{when(r.createdAt)} · {r.speed === 'optimum' || r.speed === 'instant' ? tr("Instant") : tr("Normal")}</div>
          <strong className="num">{money(r.amountPaise)}</strong>
          <span className="x4"><span className={`rzp-st ${r.status === 'processed' ? 'captured' : 'authorized'}`}>{ucfirst(r.status)}</span><button type="button" className="rzp-btn sm" onClick={() => onOpen(r.paymentId)}>{tr("Open payment")}</button></span>
        </div>
      ))}
    </section>
  );
}

function LinksTab({ biz, onNew }: { biz: RazorpayBusiness; onNew: () => void }) {
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const [pick, setPick] = useState('all');
  const [cancelling, setCancelling] = useState<RazorpayLinkItem | null>(null);
  const [busy, setBusy] = useState(false);
  const { state, reload } = useAsync(() => adminApi.listRazorpayLinks(biz), [biz, version]);
  if (state.status === 'error') return <LoadError error={state.error} onRetry={reload} />;
  const all: RazorpayLinkItem[] = state.status === 'ready' ? state.data.items : [];
  const items = all.filter((l) => pick === 'all' || l.status === pick);
  const act = async (run: () => Promise<{ ok: true; data: { message: string } } | { ok: false; error: Parameters<typeof errorText>[0] }>) => {
    setBusy(true);
    const res = await run();
    setBusy(false);
    if (res.ok) { toast.show({ tone: 'success', text: res.data.message }); setVersion((v) => v + 1); } else toast.show({ tone: 'error', text: errorText(res.error) });
  };
  const copy = (url: string) => { void navigator.clipboard?.writeText(url); toast.show({ tone: 'success', text: 'Link copied.' }); };
  return (
    <section className="rzp-card rzp-wide reveal">
      <div className="rzp-vhead"><div><h2>{tr("Pay links")}</h2><p>{tr("Ask a guest to pay. The money shows here as Paid. Send the link by SMS or email, or copy it and share it on WhatsApp.")}</p></div><Button icon="plus-lg" onClick={onNew}>{tr("Send a pay link")}</Button></div>
      <div className="rzp-chips pad">{['all', 'created', 'paid', 'expired', 'cancelled'].map((k) => <button key={k} type="button" className={`rzp-chip ${pick === k ? 'on' : ''}`} onClick={() => setPick(k)}>{k === 'all' ? tr("All") : LINK_WORD[k]}</button>)}</div>
      {state.status !== 'ready' ? <div className="rzp-empty">{tr("Loading pay links")}</div> : items.length === 0 ? <EmptyState icon="link-45deg" title={tr("No pay links here")} text={tr("Send one to ask a guest for money.")}><Button icon="plus-lg" onClick={onNew}>{tr("Send a pay link")}</Button></EmptyState> : items.map((l) => (
        <div key={l.id} className="rzp-xrow">
          <div className="x1"><div className="t">{l.name || tr("Guest")}</div><div className="u">{l.description || tr("Payment")}</div></div>
          <div className="x2 u">{l.contact ? displayPhone(l.contact) : l.email || t.none}<br />{tr("Made")} {when(l.createdAt)}{l.status === 'paid' && l.paidAt ? ` · Paid ${when(l.paidAt)}` : l.expiresAt && l.status === 'created' ? ` · Ends ${when(l.expiresAt)}` : ''}</div>
          <strong className="num">{money(l.amountPaise)}</strong>
          <span className="x4">
            <span className={`rzp-st ${l.status === 'paid' ? 'captured' : l.status === 'created' ? 'authorized' : 'created'}`}>{LINK_WORD[l.status] ?? l.status}</span>
            {l.status === 'created' ? (
              <>
                <button type="button" className="rzp-btn sm" onClick={() => copy(l.url)}>{tr("Copy link")}</button>
                {l.contact ? <button type="button" className="rzp-btn sm" disabled={busy} onClick={() => void act(() => adminApi.resendRazorpayLink(biz, l.id, 'sms'))}>{tr("Resend SMS")}</button> : null}
                {l.email ? <button type="button" className="rzp-btn sm" disabled={busy} onClick={() => void act(() => adminApi.resendRazorpayLink(biz, l.id, 'email'))}>{tr("Resend email")}</button> : null}
                {l.contact ? <a className="rzp-btn sm" target="_blank" rel="noreferrer" href={shareUrl(l.contact, `Hello ${l.name ?? ''}, please pay ${money(l.amountPaise)} here: ${l.url}`)}>{tr("WhatsApp")}</a> : null}
                <button type="button" className="rzp-btn sm" onClick={() => setCancelling(l)}>{tr("Cancel")}</button>
              </>
            ) : <button type="button" className="rzp-btn sm" onClick={() => copy(l.url)}>{tr("Copy link")}</button>}
          </span>
        </div>
      ))}
      <Dialog open={cancelling !== null} tone="danger" title={tr("Cancel this link?")} message="The guest can no longer pay with it. A payment already made is not affected." confirmLabel="Cancel the link" busy={busy} onCancel={() => setCancelling(null)} onConfirm={() => { const l = cancelling; setCancelling(null); if (l) void act(() => adminApi.cancelRazorpayLink(biz, l.id)); }} />
    </section>
  );
}

const shareUrl = (phone: string, text: string): string => `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;

function SettleTab({ biz }: { biz: RazorpayBusiness }) {
  const { state, reload } = useAsync(() => adminApi.listRazorpaySettlements(biz), [biz]);
  if (state.status === 'error') return <LoadError error={state.error} onRetry={reload} />;
  const items: RazorpaySettlementItem[] = state.status === 'ready' ? state.data.items : [];
  const next = items.find((s) => s.status !== 'processed');
  const paid = items.filter((s) => s.status === 'processed');
  return (
    <>
      <div className="reveal">
        <HomeStats
          stats={[
            { id: 'next', label: tr('Next payout'), value: next ? next.amountPaise : 0, format: money, note: next ? trf('Being prepared since {0}', [dM(next.createdAt)]) : tr('Nothing waiting') },
            { id: 'paid', label: tr('Paid out (shown)'), value: paid.reduce((n, s) => n + s.amountPaise, 0), format: money, note: `${paid.length} ${tr('payouts')}` },
            { id: 'fees', label: tr('Fees and GST kept'), value: items.reduce((n, s) => n + s.feePaise + s.taxPaise, 0), format: money, note: tr('In the payouts shown') },
          ]}
        />
      </div>
      <section className="rzp-card rzp-wide reveal">
        <div className="rzp-vhead"><div><h2>{tr("Paid to your bank")}</h2><p>{tr("Online payments reach your bank in batches. Open one to see what it holds.")}</p></div></div>
        {state.status !== 'ready' ? <div className="rzp-empty">{tr("Loading payouts")}</div> : items.length === 0 ? <EmptyState icon="bank" title={tr("Nothing paid to your bank yet")} text={tr("The first payout shows here a few working days after the first payment.")} /> : items.map((s) => (
          <details key={s.id} className="rzp-set">
            <summary><span><b>{dM(s.createdAt)}</b><small>{s.utr ? `${tr("Bank reference")} ${s.utr}` : tr("Not sent yet")}</small></span><strong className="num">{money(s.amountPaise)}</strong><span className={`rzp-st ${s.status === 'processed' ? 'captured' : 'authorized'}`}>{s.status === 'processed' ? tr("Paid out") : ucfirst(s.status)}</span></summary>
            <div className="rzp-money in">
              <div><span>{tr("Guests paid")}</span><span className="num">{money(s.amountPaise + s.feePaise + s.taxPaise)}</span></div>
              <div><span>{tr("Payment fee")}</span><span className="num">- {money(s.feePaise)}</span></div>
              <div><span>{tr("GST on fee")}</span><span className="num">- {money(s.taxPaise)}</span></div>
              <div className="tot"><span>{tr("Paid to your bank")}</span><span className="num">{money(s.amountPaise)}</span></div>
            </div>
          </details>
        ))}
      </section>
    </>
  );
}

function LinkForm({ names, ready, first, onClose, onMade }: { names: Record<RazorpayBusiness, string>; ready: Record<RazorpayBusiness, boolean>; first: RazorpayBusiness; onClose: () => void; onMade: (message: string) => void }) {
  const [biz, setBiz] = useState<RazorpayBusiness>(first);
  const [paise, setPaise] = useState(0);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [email, setEmail] = useState('');
  const [desc, setDesc] = useState('');
  const [days, setDays] = useState<1 | 3 | 7 | 30>(1);
  const [sms, setSms] = useState(false);
  const [mail, setMail] = useState(false);
  const [company, setCompany] = useState<LookupItem | null>(null);
  const [billRef, setBillRef] = useState('');
  const [made, setMade] = useState<RazorpayLinkItem | null>(null);
  const { busy, errors, submit } = useSubmit(['business', 'amountPaise', 'name', 'contact', 'email', 'description', 'validDays', 'companyId', 'customerId', 'billRef']);
  const toast = useToast();
  return (
    <Modal
      open size="lg" className="pay-form-modal sh-modal bm-modal" staticBackdrop onClose={onClose}
      eyebrow="Pay link" title={made ? 'Link ready' : 'Send a pay link'}
      onSubmit={() => {
        if (made) { onClose(); return; }
        void submit(
          () => adminApi.createRazorpayLink({ business: biz, amountPaise: paise, description: desc, name: name.trim(), ...(contact.trim() ? { contact: contact.trim() } : {}), ...(email.trim() ? { email: email.trim() } : {}), validDays: days, sms, mail, ...(company ? { companyId: company.id } : {}), ...(billRef.trim() ? { billRef: billRef.trim() } : {}) }),
          (d) => { setMade(d.link); onMade(d.message); },
        );
      }}
      footerClass="sh-modal-foot"
      footer={made ? <Button type="submit" icon="check2">{tr("Done")}</Button> : <><Button variant="ghost" onClick={onClose}>{adminCopy.common.cancel}</Button><Button type="submit" icon="send" disabled={busy || !ready[biz]}>{tr("Make pay link")}</Button></>}
    >
      {made ? (
        <FormSection icon="link-45deg" title={tr("Send it to the guest")} hint={`${made.name ?? 'The guest'} can pay ${money(made.amountPaise)} with this link. You will see it turn Paid here.`}>
          <div className="input-group"><input className="form-control" readOnly value={made.url} onFocus={(e) => e.currentTarget.select()} aria-label={tr("Pay link")} /><Button variant="outline" icon="clipboard" onClick={() => { void navigator.clipboard?.writeText(made.url); toast.show({ tone: 'success', text: 'Link copied.' }); }}>{tr("Copy")}</Button></div>
          {made.contact ? <p className="rzp-hint"><a target="_blank" rel="noreferrer" href={shareUrl(made.contact, `Hello ${made.name ?? ''}, please pay ${money(made.amountPaise)} here: ${made.url}`)}>{tr("Share on WhatsApp")}</a></p> : null}
        </FormSection>
      ) : (
        <FormSection icon="link-45deg" title={tr("Who pays and how much")} hint={tr("The guest pays online. The money goes to the account you pick.")}>
          <div className="row g-3">
            <div className="col-sm-6"><label className="form-label">{tr("Account")}<span className="req">*</span></label>
              <Select value={biz} onChange={(e) => setBiz(e.target.value as RazorpayBusiness)}>{(['hotel', 'food'] as const).map((b) => <option key={b} value={b} disabled={!ready[b]}>{names[b]}{ready[b] ? '' : tr(" (not switched on)")}</option>)}</Select>
              {errors.business ? <div className="field-error">{errors.business}</div> : null}</div>
            <div className="col-sm-6"><label className="form-label">{tr("Amount in rupees")}<span className="req">*</span></label><RupeeInput paise={paise} onChange={setPaise} placeholder="0.00" ariaLabel="Amount" />
              {errors.amountPaise ? <div className="field-error">{errors.amountPaise}</div> : null}</div>
            <div className="col-sm-6"><label className="form-label">{tr("Guest name")}<span className="req">*</span></label><input className="form-control" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
              {errors.name ? <div className="field-error">{errors.name}</div> : null}</div>
            <div className="col-sm-6"><label className="form-label">{tr("What it is for")}</label><input className="form-control" maxLength={255} placeholder={tr("Advance for booking")} value={desc} onChange={(e) => setDesc(e.target.value)} />
              {errors.description ? <div className="field-error">{errors.description}</div> : null}</div>
            <div className="col-sm-6"><label className="form-label">{tr("Phone")}</label><input className="form-control" inputMode="tel" maxLength={20} value={contact} onChange={(e) => setContact(e.target.value)} />
              {errors.contact ? <div className="field-error">{errors.contact}</div> : null}</div>
            <div className="col-sm-6"><label className="form-label">{tr("Email")}</label><input className="form-control" inputMode="email" maxLength={255} value={email} onChange={(e) => setEmail(e.target.value)} />
              {errors.email ? <div className="field-error">{errors.email}</div> : null}</div>
            <div className="col-sm-6"><label className="form-label">{tr("For a company (optional)")}</label><CompanyField value={company} onChange={setCompany} />
              {errors.companyId ? <div className="field-error">{errors.companyId}</div> : <div className="form-text">{tr("The payment then shows on that company's own Support page.")}</div>}</div>
            <div className="col-sm-6"><label className="form-label">{tr("Bill number (optional)")}</label><input className="form-control" maxLength={60} placeholder={tr("The bill this settles")} value={billRef} onChange={(e) => setBillRef(e.target.value)} />
              {errors.billRef ? <div className="field-error">{errors.billRef}</div> : null}</div>
            <div className="col-sm-6"><label className="form-label">{tr("Link works for")}</label>
              <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value) as 1 | 3 | 7 | 30)}><option value="1">{tr("1 day")}</option><option value="3">{tr("3 days")}</option><option value="7">{tr("7 days")}</option><option value="30">{tr("30 days")}</option></Select></div>
            <div className="col-sm-6"><label className="form-label">{tr("Send it by")}</label>
              <div className="rzp-checks"><label><input type="checkbox" checked={sms} onChange={(e) => setSms(e.target.checked)} /> {tr("SMS")}</label><label><input type="checkbox" checked={mail} onChange={(e) => setMail(e.target.checked)} /> {tr("Email")}</label></div>
              <div className="form-text">{tr("You can also copy the link and share it on WhatsApp.")}</div></div>
          </div>
        </FormSection>
      )}
    </Modal>
  );
}

/** Problems guests and companies raised about their online payments at this hotel: the hotel answers here (any staff member with Bills access; the server decides). */
function DisputesTab({ onOpen }: { onOpen: (paymentId: string) => void }) {
  const toast = useToast();
  const [status, setStatus] = useState<ProblemStatus | 'all'>('open');
  const [version, setVersion] = useState(0);
  const [answering, setAnswering] = useState<Problem | null>(null);
  const { state, reload } = useAsync(() => disputesApi.list({ status }), [status, version]);
  if (state.status === 'error') return <LoadError error={state.error} onRetry={reload} />;
  const items: Problem[] = state.status === 'ready' ? state.data.items : [];
  const kind = (p: Problem): string => ({ dispute: 'Dispute', refund_request: 'Refund request', question: 'Question' })[p.kind];
  return (
    <section className="rzp-card rzp-wide reveal">
      <div className="rzp-vhead"><div><h2>{dc.title}</h2><p>{dc.sub}</p></div></div>
      <div className="rzp-chips pad">{dc.filters.map(([k, label]) => <button key={k} type="button" className={`rzp-chip ${status === k ? 'on' : ''}`} onClick={() => setStatus(k)}>{label}{k === 'open' && state.status === 'ready' ? ` (${state.data.openCount})` : ''}</button>)}</div>
      {state.status !== 'ready' ? <div className="rzp-empty">{tr("Loading disputes")}</div> : items.length === 0 ? <EmptyState icon="chat-left-text" title={dc.empty.title} text={dc.empty.text} /> : items.map((p) => (
        <div key={p.id} className="rzp-xrow">
          <div className="x1">
            <div className="t">{p.title}</div>
            <div className="u">{kind(p)} · {p.number} · {when(p.createdAt)}{p.amountPaise ? ` · ${money(p.amountPaise)}` : ''}</div>
            <p className="pp-msg">{p.message}</p>
            {p.reply ? <div className="rzp-reason"><b>{tr("Answered")}{p.repliedByName ? ` by ${p.repliedByName}` : ''}</b>{p.reply}</div> : null}
          </div>
          <div className="x2 u"><span className="mono">{p.paymentId}</span></div>
          <span />
          <span className="x4">
            <span className={`rzp-st ${p.status === 'open' ? 'authorized' : p.status === 'answered' || p.status === 'closed' ? 'captured' : 'created'}`}>{ucfirst(p.status)}</span>
            <button type="button" className="rzp-btn sm" onClick={() => onOpen(p.paymentId)}>{tr("Open payment")}</button>
            {p.status === 'open' || p.status === 'answered' ? <button type="button" className="rzp-btn sm" onClick={() => setAnswering(p)}>{dc.answer}</button> : null}
          </span>
        </div>
      ))}
      {answering ? <AnswerForm problem={answering} onClose={() => setAnswering(null)} onDone={(m) => { toast.show({ tone: 'success', text: m }); setAnswering(null); setVersion((v) => v + 1); }} /> : null}
    </section>
  );
}

function AnswerForm({ problem, onClose, onDone }: { problem: Problem; onClose: () => void; onDone: (message: string) => void }) {
  const [reply, setReply] = useState(problem.reply ?? '');
  const { busy, errors, submit } = useSubmit(['reply', 'status']);
  const send = (status: 'answered' | 'closed') => void submit(() => disputesApi.respond(problem.id, { status, reply }), () => onDone(status === 'answered' ? dc.sentOk : dc.closedOk));
  return (
    <Modal
      open size="lg" className="pay-form-modal sh-modal bm-modal" staticBackdrop onClose={onClose}
      eyebrow={`${problem.number} · ${problem.paymentId}`} title={problem.title}
      onSubmit={() => send('answered')}
      footerClass="sh-modal-foot"
      footer={<><Button variant="ghost" onClick={onClose}>{tr("Cancel")}</Button><Button variant="outline" disabled={busy} onClick={() => send('closed')}>{dc.closeOnly}</Button><Button type="submit" icon="send" disabled={busy}>{dc.send}</Button></>}
    >
      <FormSection icon="chat-left-text" title={tr("What they wrote")} hint={problem.message}>
        <label className="form-label">{dc.answer}<span className="req">*</span></label>
        <textarea className="form-control" rows={5} maxLength={2000} placeholder={dc.answerPlaceholder} value={reply} onChange={(e) => setReply(e.target.value)} />
        {errors.reply ? <div className="field-error">{errors.reply}</div> : null}
      </FormSection>
    </Modal>
  );
}

/** Search the hotel's companies and pick one (the lookup answers up to 50); the picked company shows as a chip that can be taken off. */
function CompanyField({ value, onChange }: { value: LookupItem | null; onChange: (c: LookupItem | null) => void }) {
  const [typed, setTyped] = useState('');
  const q = useDebounced(typed.trim(), 250);
  const [answer, setAnswer] = useState<{ q: string; items: LookupItem[] }>({ q: '', items: [] });
  useEffect(() => {
    if (q.length < 2) return undefined;
    let live = true;
    void companiesApi.lookupCompanies({ q, limit: 6 }).then((res) => { if (live) setAnswer({ q, items: res.ok ? res.data : [] }); });
    return () => { live = false; };
  }, [q]);
  // what the last lookup found, shown only while it still matches what is typed (a short or changed text shows nothing)
  const found = q.length >= 2 && answer.q === q ? answer.items : [];
  if (value) return <button type="button" className="btn btn-sm btn-outline-p text-start" onClick={() => onChange(null)} aria-label={trf("Remove {0}", [value.label])}>{value.label} <Bi name="x-lg" /></button>;
  return (
    <div>
      <input className="form-control" type="search" autoComplete="off" placeholder={tr("Type a company name")} value={typed} onChange={(e) => setTyped(e.target.value)} />
      {found.length > 0 ? <div className="border rounded-3 mt-1" role="listbox" aria-label={tr("Companies")}>{found.map((c) => <button key={c.id} type="button" role="option" aria-selected="false" className="d-block w-100 text-start btn btn-link px-3 py-2" onClick={() => { onChange(c); setTyped(''); }}>{c.label}{c.hint ? <small className="d-block text-muted">{c.hint}</small> : null}</button>)}</div> : null}
    </div>
  );
}