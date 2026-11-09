'use client';

// The one "Help with a payment" page of the guest portal and the company portal (MJ, 5 Nov 2026: no duplicates): the login's own online payments and the problems
// it raised about them with the hotel's answer. Two tabs; the problems open first when there are any. A payment, and a problem about it, belong to ONE hotel:
// a login linked to several picks the hotel in the top bar, or above the tabs while the top bar shows all hotels. Only the login's own payments are listed (the server decides that).
import { useState, type ReactNode } from 'react';
import { formatDateTime, formatINR } from '@shared/dashboards/format';
import { type MyPayment, type PayProblemsApi, type Problem, type ProblemKind } from '@shared/dashboards/payProblems';
import { payProblemsCopyByLanguage } from '@shared/dashboards/payProblems.lang';
import { errorText, useAsync, useSubmit, useToast } from '@/components/ui';
import { Bi, Button, DetailCard, DetailList, EmptyState, Field, FormSection, LoadError, Modal, PortalButton, RupeeInput, SegTabs, Select, Skeleton, Textarea } from '@/dashboards/pallav/ui';
import { useLinkedHotels } from './HotelParts';
import { usePortalHotel } from './HotelSwitch';
import { gpWordsByLanguage } from '../guest/kit/words';
import { useCopy, tr } from '@/lib/i18n/language';

type Kind = 'guest' | 'corporate';
type Tab = 'payments' | 'problems';

const methodLabel = (m: string | null): string => (m === null ? 'Online' : m === 'upi' ? 'UPI' : m === 'emi' ? 'EMI' : m.charAt(0).toUpperCase() + m.slice(1).replace('_', ' '));
/** A part-refunded payment is still Razorpay's "captured"; a person reads "Partly refunded". */
const stKey = (p: MyPayment): string => (p.status === 'captured' && p.amountRefundedPaise > 0 ? 'partly' : p.status);
const stWord = (k: string, c: typeof payProblemsCopyByLanguage.en): string => (k === 'partly' ? c.partlyRefunded : (c.payStatus[k] ?? k));
/** Only a payment that was actually taken can have a problem raised about it. */
const raisable = (p: MyPayment): boolean => p.status !== 'created';

/** The guest portal's own pill buttons, the company portal's kit buttons: the only look that differs between the two. */
function Act({ kind, icon, disabled, onClick, children }: { kind: Kind; icon: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return kind === 'guest' ? (
    <PortalButton variant="line" icon={icon} disabled={disabled} onClick={onClick}>{children}</PortalButton>
  ) : (
    <Button variant="outline" size="sm" icon={icon} disabled={disabled} onClick={onClick}>{children}</Button>
  );
}

/** onBills: opens the portal's bills, the next step when nothing was paid online yet. */
export function PayProblems({ api, kind, onBills }: { api: PayProblemsApi; kind: Kind; onBills?: () => void }) {
  const c = useCopy(payProblemsCopyByLanguage);
  const w = useCopy(gpWordsByLanguage).support;
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const [raising, setRaising] = useState<MyPayment | null>(null);
  const [tab, setTab] = useState<Tab | null>(null);
  const hotels = useLinkedHotels(kind);
  const sidebar = usePortalHotel();
  const [picked, setPicked] = useState<string | null>(null);
  const chosenAbove = hotels.some((h) => h.hotelId === sidebar);
  const hotel = chosenAbove ? sidebar : (picked ?? hotels[0]?.hotelId ?? undefined);
  const pays = useAsync(() => api.listPayments({ hotel }), [version, hotel]);
  const probs = useAsync(() => api.listProblems({ hotel, status: 'all' }), [version, hotel]);
  const [busy, setBusy] = useState(false);
  if (pays.state.status === 'error') return <LoadError error={pays.state.error} onRetry={pays.reload} />;
  if (probs.state.status === 'error') return <LoadError error={probs.state.error} onRetry={probs.reload} />;
  const payments = pays.state.status === 'ready' ? pays.state.data.items : [];
  const problems = probs.state.status === 'ready' ? probs.state.data.items : [];
  const openOn = (id: string): number => problems.filter((p) => p.paymentId === id && p.status === 'open').length;
  const waiting = problems.filter((p) => p.status === 'open').length;
  const shown: Tab = tab ?? (problems.length > 0 ? 'problems' : 'payments');

  const withdraw = async (p: Problem) => {
    setBusy(true);
    const res = await api.withdraw(p.id, hotel);
    setBusy(false);
    if (res.ok) { toast.show({ tone: 'success', text: c.withdrawn }); setVersion((v) => v + 1); } else toast.show({ tone: 'error', text: errorText(res.error) });
  };

  const payList = pays.state.status !== 'ready' ? <Skeleton look="portal" rows={3} /> : payments.length === 0 ? (
    <section className="gg-card pp-empty">
      <EmptyState icon="credit-card-2-front" title={c.noPayments.title} text={c.noPayments.text}>
        {onBills ? <div className="gp-empty-act"><Act kind={kind} icon="receipt" onClick={onBills}>{w.seeBills}</Act></div> : null}
      </EmptyState>
    </section>
  ) : payments.map((p) => {
    const k = stKey(p);
    const open = openOn(p.paymentId);
    const at = formatDateTime(p.paidAt ?? p.createdAt);
    return (
      <DetailCard
        key={`${p.business}-${p.paymentId}`}
        className={`pp-pay pp-st-${k}`}
        label={p.description || tr("Online payment")}
        warn={open > 0}
        lead={{ big: <Bi name="credit-card-2-front" />, tag: stWord(k, c) }}
        facts={[
          { label: w.paidFor, value: p.description || tr("Online payment") },
          { label: w.method, value: methodLabel(p.method) },
          { label: w.when, value: at },
          ...(open > 0 ? [{ label: w.openProblems, value: String(open), tone: 'warn' as const }] : []),
        ]}
        amount={{ label: w.amount, value: formatINR(p.amountPaise), sub: p.amountRefundedPaise > 0 ? `${formatINR(p.amountRefundedPaise)} ${tr("refunded")}` : undefined }}
        sections={[{ icon: 'receipt', title: w.details, content: <DetailList items={[{ label: w.business, value: p.business === 'food' ? w.food : w.stay }, { label: w.method, value: methodLabel(p.method) }, { label: w.when, value: at }, p.amountRefundedPaise > 0 ? { label: w.refunded, value: formatINR(p.amountRefundedPaise) } : null, { label: w.paymentId, value: <span className="mono">{p.paymentId}</span> }]} /> }]}
        actions={raisable(p) ? <Act kind={kind} icon="chat-left-text" onClick={() => setRaising(p)}>{c.raise}</Act> : undefined}
      />
    );
  });

  const probList = probs.state.status !== 'ready' ? <Skeleton look="portal" rows={3} /> : problems.length === 0 ? (
    <section className="gg-card pp-empty">
      <EmptyState icon="chat-left-text" title={c.noProblems.title} text={c.noProblems.text}>
        {payments.length > 0 ? <div className="gp-empty-act"><Act kind={kind} icon="credit-card-2-front" onClick={() => setTab('payments')}>{w.seePayments}</Act></div> : null}
      </EmptyState>
    </section>
  ) : problems.map((p) => (
    <DetailCard
      key={p.id}
      className={`pp-prob pp-pst-${p.status}`}
      label={p.title}
      warn={p.status === 'open'}
      defaultOpen={p.status === 'answered'}
      lead={{ big: <Bi name={p.status === 'answered' ? 'chat-left-quote' : 'chat-left-text'} />, tag: c.status[p.status] }}
      facts={[
        { label: w.problem, value: p.title, sub: c.kindShort[p.kind] },
        { label: w.number, value: p.number },
        { label: w.raised, value: formatDateTime(p.createdAt) },
        ...(p.amountPaise ? [{ label: w.amount, value: formatINR(p.amountPaise) }] : []),
      ]}
      sections={[
        {
          icon: 'chat-left-text',
          title: w.conversation,
          wide: true,
          content: (
            <ol className="pf-timeline">
              <li><span className="pf-tl-dot" aria-hidden="true" /><span className="pf-tl-body"><b>{p.message}</b><small>{`${w.you} · ${formatDateTime(p.createdAt)}`}</small></span></li>
              {p.reply ? (
                <li><span className="pf-tl-dot" aria-hidden="true" /><span className="pf-tl-body"><b>{p.reply}</b><small>{`${c.reply(p.repliedByName)}${p.repliedAt ? ` · ${formatDateTime(p.repliedAt)}` : ''}`}</small></span></li>
              ) : p.status === 'open' ? (
                <li className="gp-tl-wait"><span className="pf-tl-dot" aria-hidden="true" /><span className="pf-tl-body"><b>{w.noAnswer}</b></span></li>
              ) : null}
            </ol>
          ),
        },
      ]}
      actions={p.status === 'open' ? <Act kind={kind} icon="arrow-counterclockwise" disabled={busy} onClick={() => void withdraw(p)}>{c.withdraw}</Act> : undefined}
    />
  ));

  return (
    <div className={`pp-page gp-support${kind === 'corporate' ? ' cp-page' : ''}`}>
      <p className="pp-sub">{c.sub}</p>
      {/* the hotel is picked here only while the top bar shows all hotels: a hotel chosen there is not offered twice */}
      {hotels.length > 1 && !chosenAbove ? (
        <SegTabs className="gp-order-tabs pp-hotels" label={tr("Hotel")} active={hotel ?? ''} onChange={setPicked} tabs={hotels.map((h) => ({ id: h.hotelId, label: h.name, icon: 'building' }))} />
      ) : null}
      <SegTabs
        className="gp-order-tabs"
        label={w.tabsLabel}
        active={shown}
        onChange={(id) => setTab(id === 'problems' ? 'problems' : 'payments')}
        tabs={[
          { id: 'problems', label: waiting > 0 ? `${c.problemsTitle} · ${waiting} ${w.waiting}` : `${c.problemsTitle} · ${problems.length}`, icon: 'chat-left-text' },
          { id: 'payments', label: `${c.paymentsTitle} · ${payments.length}`, icon: 'credit-card-2-front' },
        ]}
      />
      <div className="pp-list">{shown === 'payments' ? payList : probList}</div>

      {raising ? <RaiseForm api={api} hotel={hotel} payment={raising} onClose={() => setRaising(null)} onDone={() => { toast.show({ tone: 'success', text: c.sent }); setRaising(null); setTab('problems'); setVersion((v) => v + 1); }} /> : null}
    </div>
  );
}

function RaiseForm({ api, hotel, payment, onClose, onDone }: { api: PayProblemsApi; hotel: string | undefined; payment: MyPayment; onClose: () => void; onDone: () => void }) {
  const c = useCopy(payProblemsCopyByLanguage);
  const [kind, setKind] = useState<ProblemKind>('dispute');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [paise, setPaise] = useState(0);
  const { busy, errors, submit } = useSubmit(['kind', 'title', 'message', 'amountPaise', 'paymentId']);
  const left = payment.amountPaise - payment.amountRefundedPaise;
  return (
    <Modal
      open size="lg" className="pay-form-modal sh-modal bm-modal" staticBackdrop onClose={onClose}
      eyebrow={payment.description || tr("Online payment")} title={c.raise}
      onSubmit={() => void submit(() => api.raise({ ...(hotel ? { hotel } : {}), business: payment.business, paymentId: payment.paymentId, kind, title: title.trim(), message: message.trim(), ...(kind !== 'question' && paise > 0 ? { amountPaise: paise } : {}) }), () => onDone())}
      footerClass="sh-modal-foot"
      footer={<><Button variant="ghost" onClick={onClose}>{c.form.cancel}</Button><Button type="submit" icon="send" busy={busy}>{c.form.send}</Button></>}
    >
      <FormSection icon="chat-left-text" title={`${formatINR(payment.amountPaise)} · ${methodLabel(payment.method)}`} hint={formatDateTime(payment.paidAt ?? payment.createdAt)}>
        <div className="row g-3">
          <Field label={c.form.kind} error={errors.kind}>
            <Select value={kind} onChange={(e) => setKind(e.target.value as ProblemKind)}>{(Object.keys(c.kinds) as ProblemKind[]).map((k) => <option key={k} value={k}>{c.kinds[k]}</option>)}</Select>
          </Field>
          <Field label={c.form.title} required error={errors.title}>
            <input className={`form-control${errors.title ? ' is-invalid' : ''}`} maxLength={120} placeholder={c.form.titleHint} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label={c.form.message} required error={errors.message}>
            <Textarea rows={4} maxLength={2000} invalid={Boolean(errors.message)} value={message} onChange={(e) => setMessage(e.target.value)} />
          </Field>
          {kind !== 'question' && left > 0 ? (
            <Field label={c.form.amount} col="col-sm-6" error={errors.amountPaise}>
              <RupeeInput paise={paise} onChange={setPaise} placeholder="0.00" ariaLabel={c.form.amount} />
              {errors.amountPaise ? null : <div className="form-text">{tr("Up to")} {formatINR(left)}.</div>}
            </Field>
          ) : null}
          {errors.paymentId ? <div className="col-12"><div className="field-error">{errors.paymentId}</div></div> : null}
        </div>
      </FormSection>
    </Modal>
  );
}
