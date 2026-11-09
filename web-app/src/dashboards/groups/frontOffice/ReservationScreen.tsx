'use client';
// One reservation: who, when and what was booked, the advances held for it, and who is checked in. One main action for the state (Check in, or the
// stay once in house); Edit, Take an advance and the red Mark no-show / Cancel reservation sit in More, each opening its own dialog.
import { useState } from 'react';

import { formatDate, formatINR, formatWeekdayDate } from '@shared/dashboards/format';
import { currentYear } from '@shared/dashboards/billing';
import { frontOfficeCopy as copy, plural, reservationSourceLabel, reservationStatusLabel, todayIst, type Reservation, type ReservationStatus } from '@shared/dashboards/frontOffice';

import type { ScreenProps } from '../../types';
import { useAsync, useSubmit, useToast } from '@/components/ui';
import { Bi, Button, ConflictNote, DetailList, Dialog, Dropdown, Field, LoadError, Modal, PageHead, PageSkeleton, PmsDate, PmsSelect, RupeeInput, StatusChip, type ChipTone } from '../../pallav/ui';
import { HomeStats, type HomeStat } from '../overview/HomeJobs';
import { foApi } from './api';
import { FoNav, GoLink } from './foKit';
import { usePaymentModes } from './options';
import { RecordHistory } from '../admin/RecordHistory';
import { StickyActions } from '../portal/AppKit';

import { tr, trf } from '@/lib/i18n/language';
const c = copy.reservation;
const day = (iso: string) => formatWeekdayDate(iso).replace(',', '');
const rupees = (p: number) => formatINR(p, { decimals: false });
const moneyStat = (n: number) => rupees(Math.round(n));
const TONE: Record<ReservationStatus, ChipTone> = { confirmed: 'neutral', checkedIn: 'ok', checkedOut: 'neutral', cancelled: 'danger', noShow: 'danger' };
type Pop = 'advance' | 'cancel' | 'noShow' | null;

export function ReservationScreen({ params, navigate }: ScreenProps) {
  const id = params.id ?? '';
  const { state, reload } = useAsync(() => foApi.getReservation(id), [id]);
  if (state.status === 'error') {
    return <LoadError error={state.error} onRetry={reload} />;
  }
  if (state.status !== 'ready') return <PageSkeleton tiles={false} />;
  return <Body r={state.data} navigate={navigate} reload={reload} />;
}

function Body({ r, navigate, reload }: { r: Reservation; navigate: ScreenProps['navigate']; reload: () => void }) {
  const toast = useToast();
  const [pop, setPop] = useState<Pop>(null);
  const open = r.status === 'confirmed' || r.status === 'checkedIn';
  const canCheckIn = r.status === 'confirmed';
  const inHouse = r.stays.filter((s) => s.status === 'inHouse');
  const late = canCheckIn && r.checkIn < todayIst();

  const more: { id: string; icon: string; label: string; danger?: boolean; run: () => void }[] = [
    ...(open ? [{ id: 'edit', icon: 'pencil-square', label: 'Edit booking', run: () => navigate('hotel.fo.reservationForm', { id: r.id }) }] : []),
    ...(open ? [{ id: 'advance', icon: 'cash-coin', label: 'Take an advance', run: () => setPop('advance') }] : []),
    ...(canCheckIn && r.checkIn <= todayIst() ? [{ id: 'noShow', icon: 'person-x', label: 'Mark no-show', danger: true, run: () => setPop('noShow') }] : []),
    ...(canCheckIn ? [{ id: 'cancel', icon: 'x-circle', label: 'Cancel reservation', danger: true, run: () => setPop('cancel') }] : []),
  ];

  const stats: HomeStat[] = [
    { id: 'nights', label: 'Nights', value: r.nights, format: (n) => String(Math.round(n)), note: `${short(r.checkIn)} – ${short(r.checkOut)}` },
    { id: 'rooms', label: 'Rooms', value: r.rooms, format: (n) => String(Math.round(n)), note: r.roomTypeName || tr("No category") },
    { id: 'total', label: 'Room total', value: r.roomTotalPaise, format: moneyStat, note: tr("Before tax and extras") },
    { id: 'adv', label: 'Paid in advance', value: r.advancePaidPaise, format: moneyStat, note: r.advances.length === 0 ? tr("No advance yet") : plural(r.advances.length, 'receipt') },
  ];

  return (
    <>
      <PageHead>
        <FoNav active="reservations" navigate={navigate} quick={false} />
      </PageHead>

      <div className="page-head hu-stay-head">
        <div className="min-w-0">
          <GoLink to="hotel.fo.reservations" navigate={navigate} className="hu-back"><Bi name="arrow-left" /> {tr("Reservations")}</GoLink>
          <h2 className="pms-title hu-title">
            {r.guestName}
            <StatusChip tone={late ? 'warn' : TONE[r.status]}>{late ? tr("Arrival overdue") : reservationStatusLabel[r.status]}</StatusChip>
          </h2>
          <p className="pms-sub">{[r.reference, `${day(r.checkIn)} – ${day(r.checkOut)}`, `${r.rooms} × ${r.roomTypeName || tr("room")}`, r.companyName].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="sh-head-actions">
          {canCheckIn ? (
            <GoLink to="hotel.fo.checkIn" params={{ reservationId: r.id }} navigate={navigate} className="btn btn-p app-hide-phone"><Bi name="box-arrow-in-right" className="me-1" /> {tr("Check in")}</GoLink>
          ) : inHouse.length === 1 ? (
            <GoLink to="hotel.fo.stay" params={{ id: inHouse[0].id }} navigate={navigate} className="btn btn-p"><Bi name="door-open" className="me-1" /> {trf("Open the stay, room {0}", [inHouse[0].roomNumber])}</GoLink>
          ) : null}
          {more.length > 0 && (
            <Dropdown align="end" button={(p) => <Button variant="outline" icon="three-dots" {...p}>{tr("More")}</Button>}>
              {more.map((m) => (
                <a key={m.id} href="#" className={`dropdown-item${m.danger ? ' text-danger' : ''}`} onClick={(e) => { e.preventDefault(); m.run(); }}>
                  <Bi name={m.icon} /> {tr(m.label)}
                </a>
              ))}
            </Dropdown>
          )}
        </div>
      </div>

      {canCheckIn && (
        <StickyActions label={tr("Check in")}>
          <GoLink to="hotel.fo.checkIn" params={{ reservationId: r.id }} navigate={navigate} className="btn btn-p"><Bi name="box-arrow-in-right" className="me-1" /> {tr("Check in")}</GoLink>
        </StickyActions>
      )}

      {r.cancelReason && (
        <div className="hm-q hu-oneline hu-reason">
          <i className="hm-dot tone-warn" aria-hidden="true" />
          <div className="hm-q-text">
            <b>{r.status === 'noShow' ? tr("Marked as no-show") : tr("Cancelled")}</b>
            <small>{r.cancelReason}</small>
          </div>
        </div>
      )}

      <HomeStats stats={stats} />

      <div className="hu-stay-grid hu-two">
        <div className="hu-stay-side">
          <section className="card hu-card" aria-labelledby="hu-res-h">
            <h2 id="hu-res-h" className="hu-h hu-card-h">{tr("The booking")}</h2>
            <DetailList
              items={[
                { label: 'Stay', value: `${day(r.checkIn)} – ${day(r.checkOut)} (${plural(r.nights, 'night')})` },
                { label: 'Rooms', value: `${r.rooms} × ${r.roomTypeName || '-'}` },
                { label: 'Guests', value: `${plural(r.adults, 'adult')}${r.children ? `, ${r.children} ${r.children === 1 ? tr("child") : tr("children")}` : ''}` },
                { label: 'Plan', value: r.plan || '-' },
                { label: 'Rate', value: trf("{0} per room per night", [rupees(r.ratePaise)]) },
                { label: 'Room total', value: <><b>{rupees(r.roomTotalPaise)}</b> <span className="hu-fine-inline">{tr("before tax and extras")}</span></>, total: true },
                { label: 'Source', value: `${reservationSourceLabel[r.source] ?? r.source}${r.enquiryRef ? ` · ${trf("website enquiry {0}", [r.enquiryRef])}` : ''}` },
                { label: 'Booked', value: formatDate(r.createdAt) },
              ]}
            />
            {r.notes && <p className="hu-notes">{r.notes}</p>}
          </section>

          <section className="card hu-card" aria-labelledby="hu-resguest-h">
            <h2 id="hu-resguest-h" className="hu-h hu-card-h">{tr("Guest")}</h2>
            <DetailList
              items={[
                { label: 'Name', value: r.guestName },
                { label: 'Mobile', value: r.mobile ? <a href={`tel:${r.mobile}`}>{r.mobile}</a> : '-' },
                { label: 'Email', value: r.email || '-' },
                r.companyName ? { label: 'Company', value: r.companyName } : undefined,
              ]}
            />
          </section>
        </div>

        <div className="hu-stay-side">
          <section className="card hu-card" aria-labelledby="hu-adv-h">
            <div className="hu-sec-head hu-card-h">
              <h2 id="hu-adv-h" className="hu-h">{tr("Advances")}</h2>
              <span className="fo-count">{r.advances.length}</span>
              {open && <Button variant="outline" size="sm" icon="cash-coin" className="hu-push" onClick={() => setPop('advance')}>{tr("Take an advance")}</Button>}
            </div>
            {r.advances.length === 0 ? (
              <p className="hu-none">{tr("No advance taken yet. It is kept in Guest Advances and taken off the bill at check-out.")}</p>
            ) : (
              <ul className="hu-people">
                {r.advances.map((a) => (
                  <li key={a.id} className="hu-adv">
                    <span className="hu-adv-main">
                      <b>{a.receiptNumber}</b>
                      <small>{formatDate(a.paymentDate)} · {[a.hotelMode, a.foodMode].filter(Boolean).join(' / ')}</small>
                    </span>
                    <span className="hu-adv-amt">
                      <b>{rupees(a.hotelPaise + a.foodPaise)}</b>
                      <small>{a.refunded ? tr("Refunded") : trf("{0} left", [rupees(a.balancePaise)])}</small>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <DetailList className="hu-adv-total" items={[{ label: 'Paid in advance', value: <b>{rupees(r.advancePaidPaise)}</b>, total: true }, r.advanceBalancePaise !== r.advancePaidPaise && { label: 'Still to use', value: rupees(r.advanceBalancePaise) }]} />
          </section>

          <section className="card hu-card" aria-labelledby="hu-stays-h">
            <div className="hu-sec-head hu-card-h">
              <h2 id="hu-stays-h" className="hu-h">{tr("Checked in")}</h2>
              <span className="fo-count">{r.stays.length}</span>
            </div>
            {r.stays.length === 0 ? (
              <p className="hu-none">{canCheckIn ? trf("Nobody yet. Check in on {0}.", [day(r.checkIn)]) : tr("Nobody was checked in on this booking.")}</p>
            ) : (
              <div className="hm-queue">
                {r.stays.map((s) => (
                  <div key={s.id} className="hm-q">
                    <i className={`hm-dot ${s.status === 'inHouse' ? 'tone-info' : 'tone-muted'}`} aria-hidden="true" />
                    <div className="hm-q-text">
                      <b>{s.guestName}</b>
                      <small>{tr("Room")} {s.roomNumber} · {s.status === 'inHouse' ? tr("In house") : tr("Checked out")}</small>
                    </div>
                    <GoLink to="hotel.fo.stay" params={{ id: s.id }} navigate={navigate} className="btn btn-sm btn-outline-p">{tr("Open")}</GoLink>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="card hu-card">
            <RecordHistory id={r.id} />
          </section>
        </div>
      </div>

      {pop === 'advance' && <AdvanceForm r={r} onClose={() => setPop(null)} onSaved={(receipt) => { setPop(null); toast.show({ tone: 'success', text: c.toast.advance(receipt, r.reference) }); reload(); }} />}
      {pop === 'cancel' && <CancelForm r={r} onClose={() => setPop(null)} onReload={() => { setPop(null); reload(); }} onDone={(notice) => { setPop(null); toast.show({ tone: 'success', text: c.toast.cancelled }); if (notice) toast.show({ tone: 'info', text: notice }); reload(); }} />}
      {pop === 'noShow' && <NoShowConfirm r={r} onClose={() => setPop(null)} onDone={(notice) => { setPop(null); toast.show({ tone: 'success', text: c.toast.noShow }); if (notice) toast.show({ tone: 'info', text: notice }); reload(); }} />}
    </>
  );
}

const short = (iso: string) => formatDate(iso).slice(0, 6);

function CancelForm({ r, onClose, onReload, onDone }: { r: Reservation; onClose: () => void; onReload: () => void; onDone: (notice: string | null) => void }) {
  const [reason, setReason] = useState('');
  const { busy, errors, conflict, submit } = useSubmit(['reason']);
  const send = () => void submit(() => foApi.cancelReservation(r.id, { noShow: false, reason, version: r.version }), (x) => onDone(x.notice));
  return (
    <Modal open size="sm" staticBackdrop eyebrow={r.reference} title={trf("Cancel {0}?", [r.reference])} onClose={onClose} onSubmit={send}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Keep it")}</Button>
          <Button type="submit" variant="dangerSolid" icon="x-circle" busy={busy}>{tr("Cancel reservation")}</Button>
        </>
      }>
      {conflict && <ConflictNote onReload={onReload} />}
      <Field label={tr("Reason")} error={errors.reason}>
        <input className="form-control" maxLength={255} placeholder={tr("Why is it cancelled?")} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <p className="small text-muted mt-2 mb-0">{tr("The rooms are free again for these dates.")}{r.advancePaidPaise > 0 ? ` ${tr("The advance stays in Guest Advances to refund or use.")}` : ''}</p>
    </Modal>
  );
}

function NoShowConfirm({ r, onClose, onDone }: { r: Reservation; onClose: () => void; onDone: (notice: string | null) => void }) {
  const { busy, submit } = useSubmit(['reason']);
  return (
    <Dialog
      open
      title={tr("Mark as no-show?")}
      message={tr("The guest did not arrive; the rooms are free again.")}
      confirmLabel="Mark no-show"
      tone="danger"
      busy={busy}
      onConfirm={() => void submit(() => foApi.cancelReservation(r.id, { noShow: true, reason: '', version: r.version }), (x) => onDone(x.notice))}
      onCancel={onClose}
    />
  );
}

function AdvanceForm({ r, onClose, onSaved }: { r: Reservation; onClose: () => void; onSaved: (receipt: string) => void }) {
  const suggested = useAsync(() => foApi.suggestReceiptNumber(), []);
  const modes = usePaymentModes();
  const [receipt, setReceipt] = useState<string | null>(null);
  const [date, setDate] = useState(todayIst());
  const [hotel, setHotel] = useState(0);
  const [food, setFood] = useState(0);
  const [hotelMode, setHotelMode] = useState<string | null>(null);
  const [foodMode, setFoodMode] = useState<string | null>(null);
  const { busy, errors, submit } = useSubmit(['receiptNumber', 'paymentDate', 'hotelPaise', 'foodPaise', 'instruction']);
  const shown = receipt ?? (suggested.state.status === 'ready' ? suggested.state.data : '');
  const mode = (picked: string | null) => picked ?? modes[0]?.value ?? '';
  const modeSelect = (value: string | null, onChange: (v: string) => void) => (
    <PmsSelect value={mode(value)} onChange={(e) => onChange(e.target.value)}>
      {modes.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
    </PmsSelect>
  );
  const save = () => void submit(() => foApi.addAdvance(r.id, { receiptNumber: shown, paymentDate: date, hotelPaise: hotel || null, foodPaise: food || null, hotelMode: mode(hotelMode), foodMode: mode(foodMode), instruction: '' }), () => onSaved(shown));

  return (
    <Modal open scrollable={false} className="pay-form-modal" staticBackdrop eyebrow={r.reference} title={tr("Take an advance")} onClose={onClose} onSubmit={save}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel")}</Button>
          <Button type="submit" icon="cash-coin" busy={busy} busyLabel={tr("Saving…")}>{tr("Record advance")}</Button>
        </>
      }>
      <div className="row g-3">
        <Field label={tr("Receipt number")} required col="col-6" error={errors.receiptNumber}>
          <div className="input-group"><span className="input-group-text">{currentYear()} /</span><input className="form-control" maxLength={50} value={shown} onChange={(e) => setReceipt(e.target.value)} /></div>
        </Field>
        <Field label={tr("Date")} required col="col-6" error={errors.paymentDate}><PmsDate type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label={tr("Room (hotel) ₹")} col="col-6" error={errors.hotelPaise}><RupeeInput paise={hotel} onChange={setHotel} /></Field>
        <Field label={tr("Paid by")} col="col-6">{modeSelect(hotelMode, setHotelMode)}</Field>
        <Field label={tr("Food ₹")} col="col-6" error={errors.foodPaise}><RupeeInput paise={food} onChange={setFood} /></Field>
        <Field label={tr("Paid by")} col="col-6">{modeSelect(foodMode, setFoodMode)}</Field>
        <div className="col-12 form-text">{tr("Kept in Guest Advances and taken off the bill at check-out.")}</div>
      </div>
    </Modal>
  );
}
