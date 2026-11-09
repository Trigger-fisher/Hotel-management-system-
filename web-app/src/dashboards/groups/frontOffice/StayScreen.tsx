'use client';
// One guest's stay: who and which room, the bill so far with tax, the advance and what is left to pay, the guest, and the pop-ups
// (add charge, change check-out, move room, check out into a bill). One main action for the state; the rare ones sit in More.
import { useState, type ReactNode } from 'react';

import { billingCopy, currentYear, payLinkNotes, splitAfterAdvance } from '@shared/dashboards/billing';
import { userMayEdit } from '@shared/dashboards/features';
import { formatDate, formatDateTime, formatINR } from '@shared/dashboards/format';
import {
  chargeCategories, chargeSideLabel, folioTotals, frontOfficeCopy as copy, maskedId, plural, todayIst,
  type Charge, type ChargeCategory, type CheckoutDefaults, type Room, type Stay, type StayIdNumbers,
} from '@shared/dashboards/frontOffice';

import type { ScreenProps } from '../../types';
import { errorText, toNum, useAsync, useSubmit, useToast } from '@/components/ui';
import { Bi, Button, ConflictNote, DetailList, Dialog, Dropdown, Field, IconButton, LoadError, Modal, PageHead, PageSkeleton, PmsDate, PmsSelect, StatusChip } from '../../pallav/ui';
import { HomeStats, type HomeStat } from '../overview/HomeJobs';
import { foApi } from './api';
import { FoNav, GoLink } from './foKit';
import { usePaymentModes } from './options';
import { RecordHistory } from '../admin/RecordHistory';
import { QuickPay } from '../billing/QuickPay';
import { StickyActions } from '../portal/AppKit';

import { tr, trf } from '@/lib/i18n/language';
const c = copy.stay;
const qp = billingCopy.bills.quickPay;
type Pop = 'charge' | 'extend' | 'move' | 'checkout' | null;
const money = (p: number) => formatINR(p);
const short = (iso: string) => formatDate(iso).slice(0, 6);
const moneyStat = (n: number) => formatINR(Math.round(n));

export function StayScreen({ params, navigate, user }: ScreenProps) {
  const id = params.id ?? '';
  const { state, reload } = useAsync(() => foApi.getStay(id), [id]);
  const defaults = useAsync(() => foApi.getCheckoutDefaults(id), [id]);
  const error = state.status === 'error' ? state.error : defaults.state.status === 'error' ? defaults.state.error : null;
  if (error) return <LoadError error={error} onRetry={() => { reload(); defaults.reload(); }} />;
  if (state.status !== 'ready' || defaults.state.status !== 'ready') return <PageSkeleton tiles={false} />;
  return <Body stay={state.data} defaults={defaults.state.data} user={user} navigate={navigate} reload={reload} />;
}

function Body({ stay, defaults, user, navigate, reload }: { stay: Stay; defaults: CheckoutDefaults; user: ScreenProps['user']; navigate: ScreenProps['navigate']; reload: () => void }) {
  const toast = useToast();
  const [pop, setPop] = useState<Pop>(null);
  const [removing, setRemoving] = useState<Charge | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  // decision 74: the server sends the last 4 of each ID number; Show asks for the whole ones (an audited call) and Hide forgets them again
  const [whole, setWhole] = useState<StayIdNumbers | null>(null);
  const [showBusy, setShowBusy] = useState(false);
  async function toggleIds() {
    if (whole) { setWhole(null); return; }
    setShowBusy(true);
    const res = await foApi.revealStayIdNumbers(stay.id);
    setShowBusy(false);
    if (res.ok) setWhole(res.data);
    else toast.show({ tone: 'error', text: errorText(res.error) });
  }
  const inHouse = stay.status === 'inHouse';
  const free = useAsync(() => foApi.roomsToMove(stay.id), [stay.id]);
  const freeRooms: Room[] = free.state.status === 'ready' ? free.state.data : [];
  const canMove = inHouse && freeRooms.length > 0;
  const done = () => { setPop(null); reload(); };
  const totals = folioTotals(stay, defaults.hotelGstPercent, defaults.foodGstPercent);
  const owed = splitAfterAdvance(totals.hotelPaise + totals.hotelGstPaise, totals.foodPaise + totals.foodGstPaise, totals.advancePaise);
  const payable = owed.hotelPaise + owed.foodPaise;
  const showPay = inHouse && payable > 0 && (userMayEdit('bills') || (stay.reservationId !== null && userMayEdit('pms')));
  const quickPay = (layout: 'row' | 'stack') => (
    <QuickPay target={{ kind: 'stay', stay, hotelPaise: owed.hotelPaise, foodPaise: owed.foodPaise }} user={user} navigate={navigate} onPaid={reload} layout={layout} />
  );
  const due = inHouse && stay.expectedCheckOut <= todayIst();
  const checkOutLabel = payable > 0 ? trf("Check out and take {0}", [money(payable)]) : c.checkOut;
  const sameRate = defaults.hotelGstPercent === defaults.foodGstPercent;

  const more: { id: string; icon: string; label: string; run: () => void }[] = inHouse
    ? [
        { id: 'extend', icon: 'calendar-event', label: c.changeCheckOut, run: () => setPop('extend') },
        ...(canMove ? [{ id: 'move', icon: 'arrow-left-right', label: c.moveRoom, run: () => setPop('move') }] : []),
        ...(stay.reservationId ? [{ id: 'res', icon: 'calendar-check', label: tr("Open the reservation"), run: () => navigate('hotel.fo.reservation', { id: stay.reservationId ?? '' }) }] : []),
      ]
    : stay.reservationId
      ? [{ id: 'res', icon: 'calendar-check', label: tr("Open the reservation"), run: () => navigate('hotel.fo.reservation', { id: stay.reservationId ?? '' }) }]
      : [];

  const stats: HomeStat[] = [
    { id: 'nights', label: inHouse ? 'Nights so far' : 'Nights', value: stay.nights, format: (n) => String(Math.round(n)), note: inHouse ? trf("Leaves {0}", [formatDate(stay.expectedCheckOut)]) : stay.checkOutAt ? trf("Left {0}", [formatDate(stay.checkOutAt)]) : undefined },
    { id: 'total', label: 'Total with tax', value: totals.grandTotalPaise, format: moneyStat, note: inHouse ? (sameRate ? trf("GST {0}% so far", [defaults.hotelGstPercent]) : trf("GST {0}% rooms, {1}% food so far", [defaults.hotelGstPercent, defaults.foodGstPercent])) : tr("As billed") },
    { id: 'paid', label: 'Advance paid', value: totals.advancePaise, format: moneyStat, note: stay.reservationRef ? trf("On {0}", [stay.reservationRef]) : tr("Walk-in, no booking") },
    { id: 'owed', label: inHouse ? 'Balance to pay' : 'Bill', value: inHouse ? payable : 0, format: inHouse ? moneyStat : () => (stay.bill ? stay.bill.billNumber : tr("None")), note: inHouse ? (payable > 0 ? tr("Settle at check-out or now") : tr("Nothing to pay")) : stay.bill ? tr("Open it in Bills") : undefined },
  ];

  async function removeCharge() {
    if (!removing) return;
    setRemoveBusy(true);
    const res = await foApi.removeCharge(stay.id, removing.id);
    setRemoveBusy(false);
    setRemoving(null);
    if (res.ok) {
      toast.show({ tone: 'success', text: c.toast.removed });
      reload();
    } else toast.show({ tone: 'error', text: errorText(res.error) });
  }

  const guestItems = [
    { label: 'Mobile', value: <a href={`tel:${stay.mobile}`}>{stay.mobile}</a> },
    stay.email ? { label: 'Email', value: stay.email } : undefined,
    stay.address || stay.city ? { label: 'Address', value: [stay.address, stay.city].filter(Boolean).join(', ') } : undefined,
    stay.idProofType ? { label: 'ID', value: maskedId(stay.idProofType, stay.idProofNumber) } : undefined,
    stay.companyName ? { label: 'Company', value: stay.companyName } : undefined,
    { label: 'Guests', value: `${plural(stay.adults, 'adult')}${stay.children ? `, ${stay.children} ${stay.children === 1 ? tr("child") : tr("children")}` : ''}` },
    stay.grNumber ? { label: 'Register number', value: stay.grNumber } : undefined,
  ];
  const stayItems = [
    { label: 'Room', value: `${stay.roomNumber}${stay.roomTypeName ? ` · ${stay.roomTypeName}` : ''}` },
    stay.plan ? { label: 'Meals included', value: copy.checkIn.planWords[stay.plan] ?? stay.plan } : undefined,
    { label: 'Rate', value: trf("{0} a night", [formatINR(stay.ratePaise, { decimals: false })]) },
    { label: 'Arrived', value: formatDateTime(stay.checkInAt) },
    inHouse ? { label: 'Leaves', value: formatDate(stay.expectedCheckOut) } : { label: 'Left', value: stay.checkOutAt ? formatDateTime(stay.checkOutAt) : '' },
    { label: 'Booking', value: stay.reservationId ? <GoLink to="hotel.fo.reservation" params={{ id: stay.reservationId }} navigate={navigate}>{stay.reservationRef}</GoLink> : c.walkIn },
  ];

  return (
    <>
      <PageHead>
        <FoNav active="inHouse" navigate={navigate} quick={false} />
      </PageHead>

      <div className="page-head hu-stay-head">
        <div className="min-w-0">
          <GoLink to="hotel.fo.inHouse" navigate={navigate} className="hu-back"><Bi name="arrow-left" /> {tr("In-house guests")}</GoLink>
          <h2 className="pms-title hu-title">
            {stay.guestName}
            {inHouse ? <StatusChip tone={due ? 'warn' : 'ok'}>{due ? copy.board.dueOut : tr("In house")}</StatusChip> : <StatusChip tone="neutral">{tr("Checked out")}</StatusChip>}
          </h2>
          <p className="pms-sub">
            {[`${tr("Room")} ${stay.roomNumber}`, stay.roomTypeName, `${short(stay.checkInDate)} – ${short(inHouse ? stay.expectedCheckOut : stay.checkOutAt ?? stay.expectedCheckOut)}`].filter(Boolean).join(' · ')}
            {' · '}<span className="hu-nowrap">{stay.reservationRef ?? c.walkIn}</span>
          </p>
        </div>
        <div className="sh-head-actions">
          {inHouse ? (
            <span className="app-hide-phone"><Button icon="box-arrow-right" onClick={() => setPop('checkout')}>{checkOutLabel}</Button></span>
          ) : stay.bill ? (
            <GoLink to="hotel.billing.bills" navigate={navigate} className="btn btn-p"><Bi name="receipt" className="me-1" /> {c.viewBill(stay.bill.billNumber)}</GoLink>
          ) : null}
          {more.length > 0 && (
            <Dropdown align="end" button={(p) => <Button variant="outline" icon="three-dots" {...p}>{tr("More")}</Button>}>
              {more.map((m) => (
                <a key={m.id} href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); m.run(); }}>
                  <Bi name={m.icon} /> {tr(m.label)}
                </a>
              ))}
            </Dropdown>
          )}
        </div>
      </div>

      {inHouse && (
        <StickyActions label={c.checkOut}>
          <Button icon="box-arrow-right" onClick={() => setPop('checkout')}>{checkOutLabel}</Button>
        </StickyActions>
      )}

      <HomeStats stats={stats} />

      <div className="hu-stay-grid">
        <section className="card hu-bill" aria-labelledby="hu-bill-h">
          <div className="hu-sec-head">
            <h2 id="hu-bill-h" className="hu-h">{inHouse ? tr("Bill so far") : tr("Bill")}</h2>
            {inHouse && <span className="hu-sec-note">{plural(stay.charges.length + 1, 'line')}</span>}
            {inHouse && <Button variant="outline" size="sm" icon="plus-lg" className="hu-push" onClick={() => setPop('charge')}>{c.addCharge}</Button>}
          </div>

          <ul className="hu-lines">
            <li className="hu-line">
              <span className="hu-line-date">{short(stay.checkInDate)}</span>
              <span className="hu-line-what">
                <b>{trf("Room {0}", [stay.roomNumber])}{stay.plan ? ` (${stay.plan})` : ''}</b>
                <small>{plural(stay.nights, 'night')} × {formatINR(stay.ratePaise, { decimals: false })} · {short(stay.checkInDate)} – {stay.checkOutAt ? short(stay.checkOutAt) : short(todayIst())}</small>
              </span>
              <span className="hu-book">{tr("Hotel")}</span>
              <span className="hu-line-amt">{money(stay.roomChargePaise)}</span>
              <span className="hu-line-x" />
            </li>
            {stay.charges.map((x) => (
              <li key={x.id} className="hu-line">
                <span className="hu-line-date">{short(x.chargeDate)}</span>
                <span className="hu-line-what">
                  <b>{x.description}</b>
                  <small>{chargeCategories[x.category].label}{x.quantity !== 1 ? ` · ${x.quantity} × ${money(x.unitPricePaise)}` : ''}</small>
                </span>
                <span className={`hu-book${x.side === 'food' ? ' is-food' : ''}`}>{chargeSideLabel[x.side]}</span>
                <span className="hu-line-amt">{money(x.amountPaise)}</span>
                <span className="hu-line-x">
                  {inHouse && <IconButton icon="trash" tone="danger" label={trf("Remove {0}", [x.description])} onClick={() => setRemoving(x)} />}
                </span>
              </li>
            ))}
          </ul>

          <div className="hu-totals">
            <DetailList
              items={[
                { label: c.totals.hotel, value: money(totals.hotelPaise) },
                { label: c.totals.food, value: money(totals.foodPaise) },
                totals.hotelGstPaise > 0 && { label: c.totals.gstHotel(defaults.hotelGstPercent), value: money(totals.hotelGstPaise) },
                totals.foodGstPaise > 0 && { label: c.totals.gstFood(defaults.foodGstPercent), value: money(totals.foodGstPaise) },
                { label: c.totals.grand, value: <b>{money(totals.grandTotalPaise)}</b>, total: true },
                totals.advancePaise > 0 && { label: tr("Advance paid"), value: <span className="hu-off">− {money(totals.advancePaise)}</span> },
                inHouse && { label: c.totals.payable, value: <b>{money(payable)}</b>, total: true },
              ]}
            />
            {inHouse && <p className="hu-fine">{sameRate ? c.totals.estimate(defaults.hotelGstPercent) : c.totals.estimate(defaults.hotelGstPercent, defaults.foodGstPercent)}</p>}
          </div>

          {showPay && (
            <div className="qp-balance">
              {quickPay('row')}
              <div className="qp-auto"><small>{tr(qp.autoLabel)}</small><span>{tr(payLinkNotes(user.role).auto)}</span></div>
            </div>
          )}
        </section>

        <div className="hu-stay-side">
          <section className="card hu-card" aria-labelledby="hu-guest-h">
            <h2 id="hu-guest-h" className="hu-h hu-card-h">{c.guest}</h2>
            <DetailList items={guestItems} />
            {stay.notes && <p className="hu-notes">{stay.notes}</p>}
          </section>

          <section className="card hu-card" aria-labelledby="hu-stayfacts-h">
            <h2 id="hu-stayfacts-h" className="hu-h hu-card-h">{tr("The stay")}</h2>
            <DetailList items={stayItems} />
          </section>

          {stay.members && stay.members.length > 0 ? (
            <section className="card hu-card" aria-labelledby="hu-members-h">
              <h2 id="hu-members-h" className="hu-h hu-card-h">{tr("Other guests in the room")} <span className="fo-count">{stay.members.length}</span></h2>
              <ul className="hu-people">
                {stay.members.map((m, i) => (
                  <li key={i}>
                    <b>{m.fullName}</b>
                    <small>{[m.mobile, m.idType && m.idNumber ? maskedId(m.idType, m.idNumber) : ''].filter(Boolean).join(' · ') || tr("No details given")}</small>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="card hu-card">
            <RecordHistory id={stay.id} />
          </section>
        </div>
      </div>

      {pop === 'charge' && <ChargeForm stay={stay} onClose={() => setPop(null)} onSaved={() => { toast.show({ tone: 'success', text: c.toast.charge }); done(); }} />}
      {pop === 'extend' && <ExtendForm stay={stay} onClose={() => setPop(null)} onReload={done} onSaved={(d) => { toast.show({ tone: 'success', text: c.toast.extended(formatDate(d)) }); done(); }} />}
      {pop === 'move' && <MoveForm stay={stay} rooms={freeRooms} onClose={() => setPop(null)} onReload={done} onSaved={(room) => { toast.show({ tone: 'success', text: c.toast.moved(room) }); done(); }} />}
      {pop === 'checkout' && (
        <CheckoutForm
          stay={stay} defaults={defaults} onClose={() => setPop(null)} onReload={done}
          onSaved={(bill) => {
            toast.show({ tone: 'success', text: c.toast.checkedOut(bill), action: { label: tr("Open bill"), onClick: () => navigate('hotel.billing.bills', { search: bill }) }, ms: 8000 });
            done();
          }}
        />
      )}
      <Dialog
        open={removing !== null}
        title={tr("Remove this charge?")}
        message={removing ? `${removing.description}, ${money(removing.amountPaise)}` : ''}
        confirmLabel="Remove"
        tone="danger"
        busy={removeBusy}
        onConfirm={() => void removeCharge()}
        onCancel={() => setRemoving(null)}
      />
    </>
  );
}

const modal = (eyebrow: string | undefined, title: string, onClose: () => void, onSubmit: () => void, footer: ReactNode, children: ReactNode, size: 'sm' | 'md' = 'md') => (
  <Modal open scrollable={false} size={size} className="pay-form-modal" staticBackdrop eyebrow={eyebrow} title={title} onClose={onClose} onSubmit={onSubmit} footer={footer}>{children}</Modal>
);

function ChargeForm({ stay, onClose, onSaved }: { stay: Stay; onClose: () => void; onSaved: () => void }) {
  const [category, setCategory] = useState<ChargeCategory>('food');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayIst());
  const [quantity, setQuantity] = useState('1');
  const [price, setPrice] = useState('');
  const { busy, errors, submit } = useSubmit(['category', 'description', 'chargeDate', 'quantity', 'unitPricePaise']);
  const qty = quantity.trim() === '' ? 1 : toNum(quantity);
  const unit = Number.parseFloat(price);
  const save = () => void submit(() => foApi.addCharge(stay.id, { category, description, chargeDate: date, quantity: qty, unitPricePaise: Number.isFinite(unit) ? Math.round(unit * 100) : null }), onSaved);
  return modal(`Room ${stay.roomNumber}`, 'Add a charge', onClose, save,
    <>
      <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel")}</Button>
      <Button type="submit" disabled={busy}>{busy ? tr("Adding…") : tr("Add charge")}</Button>
    </>,
    <div className="row g-3">
      <Field label={tr("Kind")} required col="col-6" error={errors.category}>
        <PmsSelect value={category} onChange={(e) => setCategory(e.target.value as ChargeCategory)}>
          {(Object.keys(chargeCategories) as ChargeCategory[]).map((k) => <option key={k} value={k}>{chargeCategories[k].label} ({chargeSideLabel[chargeCategories[k].side]})</option>)}
        </PmsSelect>
      </Field>
      <Field label={tr("Date")} required col="col-6" error={errors.chargeDate}><PmsDate type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label={tr("Description")} required error={errors.description}>
        <input className="form-control" maxLength={255} placeholder={tr("e.g. Dinner, 2 shirts pressed")} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label={tr("Quantity")} required col="col-4" error={errors.quantity}><input type="number" className="form-control" min={0.01} step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></Field>
      <Field label={tr("Price each (₹)")} required col="col-8" error={errors.unitPricePaise}><input type="number" className="form-control" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
    </div>,
  );
}

function ExtendForm({ stay, onClose, onReload, onSaved }: { stay: Stay; onClose: () => void; onReload: () => void; onSaved: (date: string) => void }) {
  const [date, setDate] = useState(stay.expectedCheckOut);
  const { busy, errors, conflict, submit } = useSubmit(['expectedCheckOut']);
  const save = () => void submit(() => foApi.extendStay(stay.id, date, stay.version), (x) => onSaved(x.expectedCheckOut));
  return modal(undefined, 'Change check-out', onClose, save,
    <Button type="submit" disabled={busy}>{tr("Save")}</Button>,
    <>
      {conflict && <ConflictNote onReload={onReload} />}
      <label className="form-label">{tr("Leaves on")}</label>
      <PmsDate type="date" min={stay.checkInDate} value={date} onChange={(e) => setDate(e.target.value)} />
      {errors.expectedCheckOut && <div className="field-error">{errors.expectedCheckOut}</div>}
    </>, 'sm');
}

function MoveForm({ stay, rooms: list, onClose, onReload, onSaved }: { stay: Stay; rooms: Room[]; onClose: () => void; onReload: () => void; onSaved: (room: string) => void }) {
  const [roomId, setRoomId] = useState('');
  const [rate, setRate] = useState('');
  const { busy, errors, conflict, submit } = useSubmit(['roomId', 'ratePaise']);
  const chosen = roomId || list[0]?.id || '';
  const n = Number.parseFloat(rate);
  const save = () => void submit(() => foApi.moveRoom(stay.id, { roomId: chosen, ratePaise: Number.isFinite(n) ? Math.round(n * 100) : null, version: stay.version }), (x) => onSaved(x.roomNumber));
  return modal(undefined, 'Move to another room', onClose, save,
    <>
      <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel")}</Button>
      <Button type="submit" disabled={busy || list.length === 0}>{tr("Move")}</Button>
    </>,
    <div className="row g-3">
      {conflict && <div className="col-12"><ConflictNote onReload={onReload} /></div>}
      <Field label={tr("New room")} required col="col-7" error={errors.roomId}>
        <PmsSelect value={chosen} onChange={(e) => setRoomId(e.target.value)}>
          {list.map((r) => <option key={r.id} value={r.id}>{r.number} · {r.roomTypeName ?? tr("No category")}{r.hkStatus === 'dirty' ? tr(" (needs cleaning)") : ''}</option>)}
        </PmsSelect>
      </Field>
      <Field label={tr("New rate (₹)")} col="col-5" error={errors.ratePaise}>
        <input type="number" className="form-control" min={0} step="0.01" placeholder={String(stay.ratePaise / 100)} value={rate} onChange={(e) => setRate(e.target.value)} />
      </Field>
      <div className="col-12 form-text">{tr("Leave the rate empty to keep it. Room")} {stay.roomNumber} {tr("is left to be cleaned.")}</div>
    </div>);
}

const MODE_KEY = 'hms.checkout.mode';
const lastMode = (): string | null => {
  try {
    return localStorage.getItem(MODE_KEY);
  } catch {
    return null;
  }
};
const keepMode = (mode: string): void => {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // blocked storage: next time starts on the first mode
  }
};
const isDebit = (mode: string) => mode.trim().toLowerCase() === 'debit';

function CheckoutForm({ stay, defaults, onClose, onReload, onSaved }: { stay: Stay; defaults: CheckoutDefaults; onClose: () => void; onReload: () => void; onSaved: (bill: string) => void }) {
  const modes = usePaymentModes();
  const [billNumber, setBillNumber] = useState<string | null>(null);
  const [billDate, setBillDate] = useState(todayIst());
  const [hotelGst, setHotelGst] = useState(String(defaults.hotelGstPercent));
  const [foodGst, setFoodGst] = useState(String(defaults.foodGstPercent));
  const [pickedHotelMode, setHotelMode] = useState<string | null>(null);
  const [pickedFoodMode, setFoodMode] = useState<string | null>(null);
  const [split, setSplit] = useState(false);
  const [details, setDetails] = useState(false);
  const [remembered] = useState(lastMode);
  const [instruction, setInstruction] = useState('');
  const { busy, errors, conflict, submit } = useSubmit(['billNumber', 'billDate', 'hotelGstPercent', 'foodGstPercent', 'hotelMode', 'foodMode', 'instruction']);
  const shown = billNumber ?? defaults.suggestedBillNumber;
  const first = (remembered && modes.some((m) => m.value === remembered) ? remembered : modes[0]?.value) ?? '';
  const hotelMode = pickedHotelMode ?? first;
  const foodMode = split ? (pickedFoodMode ?? first) : hotelMode;
  const pct = (s: string) => Math.max(0, Math.min(28, Number.parseFloat(s) || 0));
  const totals = folioTotals(stay, pct(hotelGst), pct(foodGst));
  const hasFood = totals.foodPaise > 0;
  const detailsOpen = details || Boolean(errors.billNumber || errors.billDate || errors.hotelGstPercent || errors.foodGstPercent || errors.instruction);
  const toPay = totals.payablePaise;
  const label = toPay <= 0 ? tr("Check out") : isDebit(hotelMode) && isDebit(foodMode) ? trf("Check out and bill the company {0}", [money(toPay)]) : trf("Check out and take {0}", [money(toPay)]);

  const run = () =>
    void submit(
      () => foApi.checkOut(stay.id, { billNumber: shown, billDate, hotelGstPercent: pct(hotelGst), foodGstPercent: pct(foodGst), hotelMode, foodMode, instruction, version: stay.version }),
      (x) => {
        keepMode(hotelMode);
        onSaved(x.bill?.billNumber ?? shown);
      },
    );
  const modeSelect = (value: string, onChange: (v: string) => void) => (
    <PmsSelect value={value} onChange={(e) => onChange(e.target.value)}>{modes.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</PmsSelect>
  );

  return (
    <Modal open scrollable={false} className="pay-form-modal" staticBackdrop eyebrow={trf("Room {0}", [stay.roomNumber])} title={trf("Check out {0}", [stay.guestName])} onClose={onClose} onSubmit={run}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel")}</Button>
          <Button type="submit" icon="box-arrow-right" busy={busy} busyLabel={tr("Checking out…")}>{label}</Button>
        </>
      }>
      {conflict && <ConflictNote onReload={onReload} />}
      <div className="hu-co-sum">
        <DetailList
          items={[
            { label: trf("Room, {0}", [plural(stay.nights, 'night')]), value: money(stay.roomChargePaise) },
            stay.hotelExtrasPaise > 0 && { label: 'Hotel extras', value: money(stay.hotelExtrasPaise) },
            totals.foodPaise > 0 && { label: c.totals.food, value: money(totals.foodPaise) },
            { label: trf("GST {0}% / {1}%", [pct(hotelGst), pct(foodGst)]), value: money(totals.hotelGstPaise + totals.foodGstPaise) },
            { label: c.totals.grand, value: money(totals.grandTotalPaise), total: true },
            totals.advancePaise > 0 && { label: tr("Advance paid"), value: <span className="hu-off">− {money(totals.advancePaise)}</span> },
            { label: c.totals.payable, value: <b>{money(totals.payablePaise)}</b>, total: true },
          ]}
        />
        <p className="hu-fine">{trf("The bill goes to Bills and room {0} is left to be cleaned.", [stay.roomNumber])}</p>
      </div>
      <div className="row g-3">
        {split && hasFood ? (
          <>
            <Field label={tr("Hotel paid by")} col="col-6" error={errors.hotelMode}>{modeSelect(hotelMode, setHotelMode)}</Field>
            <Field label={tr("Food paid by")} col="col-6" error={errors.foodMode}>{modeSelect(foodMode, setFoodMode)}</Field>
          </>
        ) : (
          <Field label={tr("Paid by")} col="col-sm-6" error={errors.hotelMode ?? errors.foodMode}>{modeSelect(hotelMode, setHotelMode)}</Field>
        )}
        <div className="col-12 form-text">
          {tr("Choose \"Debit\" to bill a company later.")}
          {hasFood && !split && <> <Button variant="ghost" size="sm" onClick={() => { setSplit(true); setFoodMode(hotelMode); }}>{tr("Food paid another way")}</Button></>}
        </div>
        {detailsOpen ? (
          <>
            <Field label={tr("Bill number")} required col="col-6" error={errors.billNumber}>
              <div className="input-group"><span className="input-group-text">{currentYear()} /</span><input className="form-control" maxLength={50} value={shown} onChange={(e) => setBillNumber(e.target.value)} /></div>
            </Field>
            <Field label={tr("Bill date")} required col="col-6" error={errors.billDate}><PmsDate type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} /></Field>
            <Field label={tr("GST on hotel (%)")} col="col-6" error={errors.hotelGstPercent}><input type="number" className="form-control" min={0} max={28} step="0.01" value={hotelGst} onChange={(e) => setHotelGst(e.target.value)} /></Field>
            <Field label={tr("GST on food (%)")} col="col-6" error={errors.foodGstPercent}><input type="number" className="form-control" min={0} max={28} step="0.01" value={foodGst} onChange={(e) => setFoodGst(e.target.value)} /></Field>
            <Field label={tr("Note on the bill")} error={errors.instruction}><input className="form-control" maxLength={1000} value={instruction} onChange={(e) => setInstruction(e.target.value)} /></Field>
          </>
        ) : (
          <div className="col-12">
            <p className="hu-co-bill">
              <span>{trf("Bill {0} / {1}, dated {2}", [currentYear(), shown, formatDate(billDate)])}</span>
              <Button variant="ghost" size="sm" onClick={() => setDetails(true)}>{tr("Change bill details")}</Button>
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}