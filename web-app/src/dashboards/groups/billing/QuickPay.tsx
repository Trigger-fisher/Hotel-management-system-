'use client';
// Payment in one tap (design preview, section 5): the balance is already on the two buttons. "Send pay link" makes a Razorpay link at once and shows
// it with Copy and the send actions; "Cash received" confirms in a small sheet (a bottom sheet on a phone) and records one instalment. The full
// settle form stays behind "More ways to pay". The link needs the bills right; cash on a stay goes on its booking and needs the PMS right.
import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';

import type { HmsUser } from '@shared/auth-pallav/types';
import type { RazorpayBusiness, RazorpayLinkItem } from '@shared/dashboards/admin';
import { billBalance, billingCopy, payLinkNotes, quickPayInput, splitQuickPay, todayIst, type Bill, type PaymentMode, type QuickPaySplit } from '@shared/dashboards/billing';
import type { DashError } from '@shared/dashboards/common';
import { userMayEdit } from '@shared/dashboards/features';
import { formatINR } from '@shared/dashboards/format';
import type { Stay } from '@shared/dashboards/frontOffice';

import { errorText, useAsync, useSubmit, useToast, type FieldErrors } from '@/components/ui';
import { Button, ConflictNote, Field, Modal, PmsDate, PmsSelect, RupeeInput } from '../../pallav/ui';
import type { ScreenProps } from '../../types';
import { adminApi, useAdminActor } from '../admin/api';
import { foApi } from '../frontOffice/api';
import { usePaymentModes } from '../frontOffice/options';
import { billingApi } from './api';

import { tr, trf } from '@/lib/i18n/language';
const t = billingCopy.bills.quickPay;
const LINK_DAYS = 3;
const money = (p: number) => formatINR(p);

export type QuickPayTarget =
  | { kind: 'bill'; bill: Bill }
  /** An in-house stay: what each side owes once the booking's advance is taken off (splitAfterAdvance). */
  | { kind: 'stay'; stay: Stay; hotelPaise: number; foodPaise: number };

interface QuickPayProps {
  target: QuickPayTarget;
  user: Pick<HmsUser, 'role' | 'abilities' | 'username' | 'displayName' | 'hotel'>;
  navigate: ScreenProps['navigate'];
  /** After money is recorded: reload the list or the record. */
  onPaid: () => void;
  /** Opens the full settle form (bills). */
  onMore?: () => void;
  /** row: the two buttons with their amounts; compact: the list row's small pair; stack: full width, one under the other (the phone bar). */
  layout?: 'row' | 'compact' | 'stack';
}

const balanceOf = (target: QuickPayTarget): QuickPaySplit =>
  target.kind === 'bill' ? { hotelPaise: target.bill.balanceHotelPaise, foodPaise: target.bill.balanceFoodPaise } : { hotelPaise: target.hotelPaise, foodPaise: target.foodPaise };

const whoOf = (target: QuickPayTarget) =>
  target.kind === 'bill'
    ? { name: target.bill.guestName, contact: target.bill.mobile, email: '', description: `Bill ${target.bill.billNo}${target.bill.roomNo ? ` · Room ${target.bill.roomNo}` : ''}`, billRef: target.bill.billNo, label: target.bill.guestName }
    : { name: target.stay.guestName, contact: target.stay.mobile, email: target.stay.email, description: `Room ${target.stay.roomNumber} · ${target.stay.guestName}`, billRef: '', label: `${target.stay.guestName} · Room ${target.stay.roomNumber}` };

/** Who may record cash on this target: a bill needs the bills right; a stay's cash is an advance on its booking (pms.reservations create). */
export const quickPayCashAllowed = (target: QuickPayTarget): boolean =>
  target.kind === 'bill' ? userMayEdit('bills') : target.stay.reservationId !== null && userMayEdit('pms');

export function QuickPay({ target, user, navigate, onPaid, onMore, layout = 'row' }: QuickPayProps) {
  useAdminActor(user);
  const [sheet, setSheet] = useState<'link' | 'cash' | null>(null);
  const [link, setLink] = useState<RazorpayLinkItem | null>(null);
  const [linkError, setLinkError] = useState<DashError | null>(null);
  const [making, setMaking] = useState(false);
  const toast = useToast();
  const split = balanceOf(target);
  const balance = split.hotelPaise + split.foodPaise;
  const canLink = userMayEdit('bills');
  const canCash = quickPayCashAllowed(target);
  if ((!canLink && !canCash) || balance <= 0) return null;
  const who = whoOf(target);
  // One link, one Razorpay account: the hotel's unless only food is owed
  const business: RazorpayBusiness = split.hotelPaise > 0 ? 'hotel' : 'food';
  const compact = layout === 'compact';
  // The buttons sit on a card's summary row too: the tap must not open or close the card
  const tap = (e: MouseEvent, run: () => void) => {
    e.preventDefault();
    e.stopPropagation();
    run();
  };
  const makeLink = async () => {
    setMaking(true);
    const res = await adminApi.createRazorpayLink({
      business, amountPaise: balance, description: who.description, name: who.name, validDays: LINK_DAYS, sms: false, mail: false,
      ...(who.contact ? { contact: who.contact } : {}), ...(who.email ? { email: who.email } : {}), ...(who.billRef ? { billRef: who.billRef } : {}),
    });
    setMaking(false);
    if (res.ok) {
      setLink(res.data.link);
      setLinkError(null);
      toast.show({ tone: 'success', text: t.linkMade(money(balance), who.name) });
    } else {
      setLink(null);
      setLinkError(res.error);
    }
    setSheet('link');
  };

  return (
    <>
      <div className={`qp-btns ${layout}`}>
        {canLink && (
          <Button className="qp-gold" size={compact ? 'sm' : 'md'} icon={compact ? undefined : 'link-45deg'} busy={making} busyLabel={t.making} onClick={(e) => tap(e, () => void makeLink())}>
            {compact ? t.linkShort(money(balance)) : t.link(money(balance))}
          </Button>
        )}
        {canCash && (
          <Button variant={canLink ? 'outline' : 'primary'} size={compact ? 'sm' : 'md'} icon={compact ? undefined : 'cash-coin'} onClick={(e) => tap(e, () => setSheet('cash'))}>
            {compact ? t.cashShort(money(balance)) : t.cash(money(balance))}
          </Button>
        )}
        {onMore && !compact && (
          <Button variant="ghost" size="sm" className="qp-more" onClick={(e) => tap(e, onMore)}>{t.more} <i className="bi bi-chevron-right" /></Button>
        )}
      </div>
      {sheet === 'link' && (
        <LinkSheet link={link} error={linkError} business={business} amount={balance} who={who} hotel={user.hotel?.name ?? ''} notes={payLinkNotes(user.role, trf)} navigate={navigate} onClose={() => setSheet(null)} />
      )}
      {sheet === 'cash' && target.kind === 'bill' && <BillCashSheet bill={target.bill} onClose={() => setSheet(null)} onPaid={onPaid} />}
      {sheet === 'cash' && target.kind === 'stay' && target.stay.reservationId && (
        <StayCashSheet stay={target.stay} reservationId={target.stay.reservationId} split={split} onClose={() => setSheet(null)} onPaid={onPaid} />
      )}
    </>
  );
}

/** wa.me wants the country code: a bare 10-digit Indian mobile (or one with a leading 0) gets 91; anything not 12 to 15 digits is no WhatsApp number. */
export const whatsappNumber = (phone: string): string | null => {
  let d = phone.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = `91${d}`;
  return d.length >= 12 && d.length <= 15 ? d : null;
};
const shareUrl = (digits: string, text: string): string => `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;

function LinkSheet({ link, error, business, amount, who, hotel, notes, navigate, onClose }: {
  link: RazorpayLinkItem | null; error: DashError | null; business: RazorpayBusiness; amount: number;
  who: ReturnType<typeof whoOf>; hotel: string; notes: ReturnType<typeof payLinkNotes>; navigate: ScreenProps['navigate']; onClose: () => void;
}) {
  const toast = useToast();
  const [sending, setSending] = useState<'sms' | 'email' | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const adminBox = useRef<HTMLDivElement>(null);
  // Razorpay not set up (409) or not this person's to open (403): the server's sentence and the way to Admin, never a dead button
  const needsAdmin = error !== null && (error.code === 'CONFLICT' || error.code === 'FORBIDDEN');
  const adminButton = needsAdmin && notes.adminButton;
  // a Hotel User gets the plain words, never the payment provider's name or an admin page
  const plainStop = needsAdmin && !notes.adminButton;
  const canCopy = typeof navigator !== 'undefined' && !!navigator.clipboard;
  const wa = link?.contact ? whatsappNumber(link.contact) : null;
  // The Modal focuses the first field or the close cross on mount; the way out of a failed link is the Admin button
  useEffect(() => {
    if (!adminButton) return;
    const id = requestAnimationFrame(() => adminBox.current?.querySelector('button')?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(id);
  }, [adminButton]);
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      toast.show({ tone: 'success', text: t.copied });
    } catch {
      field.current?.focus();
      field.current?.select();
      toast.show({ tone: 'error', text: t.copyFailed });
    }
  };
  const resend = async (medium: 'sms' | 'email') => {
    if (!link) return;
    setSending(medium);
    const res = await adminApi.resendRazorpayLink(business, link.id, medium);
    setSending(null);
    toast.show(res.ok ? { tone: 'success', text: res.data.message } : { tone: 'error', text: errorText(res.error) });
  };
  return (
    <Modal open size="sm" className="pay-form-modal sh-modal qp-sheet" eyebrow={t.linkEyebrow} title={link ? t.linkTitle(money(amount)) : t.linkFailedTitle} onClose={onClose}
      footer={<Button variant={link ? 'primary' : 'ghost'} onClick={onClose}>{link ? tr("Done") : tr("Close")}</Button>}>
      {link ? (
        <div className="qp-link">
          <div className="input-group">
            <input ref={field} className="form-control" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} aria-label={t.linkField} />
            {canCopy && <Button variant="outline" icon="clipboard" onClick={() => void copy()}>{t.copy}</Button>}
          </div>
          <div className="qp-send">
            {wa && (
              <a className="btn btn-outline-p" target="_blank" rel="noreferrer" href={shareUrl(wa, t.whatsappText(who.name, hotel, who.description, money(link.amountPaise), link.url))}>
                <i className="bi bi-whatsapp me-1" />{t.whatsapp}
              </a>
            )}
            {link.contact && <Button variant="outline" icon="chat-left-text" busy={sending === 'sms'} onClick={() => void resend('sms')}>{t.sms}</Button>}
            {link.email && <Button variant="outline" icon="envelope" busy={sending === 'email'} onClick={() => void resend('email')}>{t.email}</Button>}
          </div>
          <p className="qp-note">{notes.linkReady(who.name, money(link.amountPaise), LINK_DAYS)}</p>
        </div>
      ) : (
        <div className="qp-link" ref={adminBox}>
          <p className="qp-note qp-stop" role="alert">{plainStop ? tr(t.notReady) : error ? errorText(error) : t.notReady}</p>
          {plainStop && <p className="qp-note">{tr(t.askAdmin)}</p>}
          {adminButton && <Button variant="outline" icon="gear" onClick={() => { onClose(); navigate('hotel.admin.payments'); }}>{t.openAdmin}</Button>}
        </div>
      )}
    </Modal>
  );
}

/** The confirm sheet both kinds share: amount (split when both sides owe), paid by, the date, one Confirm. */
function CashSheet({ title, owed, modes, busy, ready = true, wait, problem, errors, conflict, note, onConfirm, onClose, onReload }: {
  title: string; owed: QuickPaySplit; modes: string[]; busy: boolean; errors: FieldErrors; conflict: boolean; note?: string;
  /** False while something the save needs is still being read: Confirm waits, Cancel does not. */
  ready?: boolean;
  /** The line under the fields while not ready. */
  wait?: string;
  /** Something stopped the save before the fields (a read that failed, a receipt number taken): the sentence and the way to try again. */
  problem?: { text: string; retry: () => void };
  onConfirm: (split: QuickPaySplit, mode: PaymentMode, date: string) => void; onClose: () => void; onReload: () => void;
}) {
  const [split, setSplit] = useState<QuickPaySplit>({ hotelPaise: Math.max(0, owed.hotelPaise), foodPaise: Math.max(0, owed.foodPaise) });
  const [mode, setMode] = useState<PaymentMode>('Cash');
  const [date, setDate] = useState(todayIst());
  const afterId = useId();
  const bill = { balanceHotelPaise: owed.hotelPaise, balanceFoodPaise: owed.foodPaise };
  const amount = split.hotelPaise + split.foodPaise;
  const owedAll = Math.max(0, owed.hotelPaise) + Math.max(0, owed.foodPaise);
  const both = owed.hotelPaise > 0 && owed.foodPaise > 0;
  const left = Math.max(0, owedAll - amount);
  const over = Math.max(0, amount - owedAll);
  const list = modes.length ? modes : ['Cash'];
  const fieldError = errors['inst.0'] ?? errors['installments.0.hotelPaise'] ?? errors['installments.0.foodPaise'] ?? errors.hotelPaise ?? errors.foodPaise ?? errors.installments;
  const after = left > 0 ? t.stillOwed(money(left)) : over > 0 ? t.over(money(over)) : '';
  return (
    <Modal open size="sm" scrollable={false} className="pay-form-modal sh-modal qp-sheet" staticBackdrop eyebrow={t.cashEyebrow} title={title} onClose={onClose}
      onSubmit={() => { if (ready && !problem) onConfirm(split, mode, date); }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel")}</Button>
          <Button type="submit" icon="check2" busy={busy} busyLabel={t.saving} disabled={!ready || !!problem}>{t.confirm(money(amount))}</Button>
        </>
      }>
      {conflict && <ConflictNote onReload={onReload} />}
      {problem && (
        <p className="qp-note qp-stop mb-3" role="alert">
          {problem.text} <Button variant="outline" size="sm" className="ms-2" onClick={problem.retry}>{tr("Try again")}</Button>
        </p>
      )}
      <div className="row g-3">
        <Field label={t.amount} required error={fieldError}>
          <RupeeInput paise={amount} ariaLabel={t.amount} ariaDescribedBy={afterId} onChange={(p) => setSplit(splitQuickPay(bill, p))} />
        </Field>
        {both && (
          <>
            <Field label={t.hotelPart} col="col-6"><RupeeInput paise={split.hotelPaise} ariaLabel={t.hotelPart} onChange={(p) => setSplit((s) => ({ ...s, hotelPaise: p }))} /></Field>
            <Field label={t.foodPart} col="col-6"><RupeeInput paise={split.foodPaise} ariaLabel={t.foodPart} onChange={(p) => setSplit((s) => ({ ...s, foodPaise: p }))} /></Field>
          </>
        )}
        <Field label={t.mode} col="col-6">
          <PmsSelect value={mode} onChange={(e) => setMode(e.target.value)}>
            {(list.includes(mode) ? list : [mode, ...list]).map((m) => <option key={m} value={m}>{m}</option>)}
          </PmsSelect>
        </Field>
        <Field label={t.date} col="col-6" error={errors.paymentDate}>
          <PmsDate type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      {/* Always in the tree so a screen reader hears the change as the amount is typed */}
      <p id={afterId} className="qp-note qp-after" aria-live="polite">
        {after}
        {after && note ? ' ' : null}
        {note}
      </p>
      {!ready && !problem && wait && <p className="qp-note qp-after" aria-live="polite">{wait}</p>}
    </Modal>
  );
}

function BillCashSheet({ bill, onClose, onPaid }: { bill: Bill; onClose: () => void; onPaid: () => void }) {
  const toast = useToast();
  const options = useAsync(() => billingApi.getBillingOptions(), []);
  const modes = options.state.status === 'ready' ? options.state.data.paymentModes : [];
  // referenceMobile is not drawn here: its error goes to the toast
  const { busy, errors, conflict, submit } = useSubmit(['inst.0', 'installments', 'installments.0.hotelPaise', 'installments.0.foodPaise']);
  return (
    <CashSheet
      title={t.cashTitle(bill.guestName)} owed={{ hotelPaise: bill.balanceHotelPaise, foodPaise: bill.balanceFoodPaise }} modes={modes}
      busy={busy} errors={errors} conflict={conflict} onClose={onClose} onReload={() => { onClose(); onPaid(); }}
      onConfirm={(split, mode, date) => {
        const amount = split.hotelPaise + split.foodPaise;
        void submit(() => billingApi.settleBill(bill.id, quickPayInput(bill, amount, mode, date, split)), (saved) => {
          const left = billBalance(saved);
          toast.show({ tone: 'success', text: left > 0 ? t.toastBillPart(money(amount), bill.billNo, money(left)) : t.toastBill(money(amount), bill.billNo) });
          onClose();
          onPaid();
        });
      }}
    />
  );
}

function StayCashSheet({ stay, reservationId, split, onClose, onPaid }: { stay: Stay; reservationId: string; split: QuickPaySplit; onClose: () => void; onPaid: () => void }) {
  const toast = useToast();
  const modes = usePaymentModes().map((m) => m.value);
  const receipt = useAsync(() => foApi.suggestReceiptNumber(), []);
  const { busy, errors, setErrors, conflict, submit } = useSubmit(['receiptNumber', 'paymentDate', 'hotelPaise', 'foodPaise']);
  const receiptNumber = receipt.state.status === 'ready' ? receipt.state.data : '';
  // The number could not be read, or another desk used the suggested one first: say so and fetch a fresh one on Try again
  const problem = receipt.state.status === 'error'
    ? { text: errorText(receipt.state.error), retry: receipt.reload }
    : errors.receiptNumber
      ? { text: errors.receiptNumber, retry: () => { setErrors({}); receipt.reload(); } }
      : undefined;
  return (
    <CashSheet
      title={t.cashTitle(`${stay.guestName} · Room ${stay.roomNumber}`)} owed={split} modes={modes} note={t.stayNote}
      busy={busy} ready={receipt.state.status === 'ready'} wait={t.receiptWait} problem={problem}
      errors={errors} conflict={conflict} onClose={onClose} onReload={() => { onClose(); onPaid(); }}
      onConfirm={(part, mode, date) => {
        const amount = part.hotelPaise + part.foodPaise;
        void submit(
          () => foApi.addAdvance(reservationId, { receiptNumber, paymentDate: date, hotelPaise: part.hotelPaise, foodPaise: part.foodPaise, hotelMode: mode, foodMode: mode, instruction: `Room ${stay.roomNumber}, taken at the desk` }),
          () => {
            toast.show({ tone: 'success', text: t.toastStay(money(amount), receiptNumber) });
            onClose();
            onPaid();
          },
        );
      }}
    />
  );
}
