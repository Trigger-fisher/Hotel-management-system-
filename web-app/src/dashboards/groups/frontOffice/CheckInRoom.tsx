'use client';
// Step 2 of the check-in: the free rooms as tap cards (clean first, the booked category at the top, the guest's last room marked), the stay (check-out,
// adults and children, rate, the register number as a filled line with Change) with the quiet GST slab line; and the summary column both steps share, folded into the phone's action bar.
import { useState, type KeyboardEvent, type ReactNode } from 'react';

import { addDays, daysBetween, frontOfficeCopy as copy, plural, type CheckInPrefill, type Reservation, type Room } from '@shared/dashboards/frontOffice';
import { formatINR } from '@shared/dashboards/format';
import type { FieldErrors } from '@/components/ui';

import { Button, Field, PmsDate } from '../../pallav/ui';
import { StickyActions } from '../portal/AppKit';
import { dateSpan, rateToPaise, stayEstimate, type CheckInForm } from './checkInDraft';

import { tr } from '@/lib/i18n/language';
const c = copy.checkIn;

export function CheckInRoom({ prefill, form, set, errors, lastRoom, today }: {
  prefill: CheckInPrefill; form: CheckInForm; set: <K extends keyof CheckInForm>(k: K, v: CheckInForm[K]) => void; errors: FieldErrors; lastRoom: string | null; today: string;
}) {
  const res = prefill.reservation;
  const [editGr, setEditGr] = useState(false);
  const autoGr = !editGr && !errors.grNumber && !!prefill.suggestedGrNumber && form.grNumber === prefill.suggestedGrNumber;
  const count = (k: 'adults' | 'children', d: number) => {
    const min = k === 'adults' ? 1 : 0;
    set(k, String(Math.min(20, Math.max(min, (Number.parseInt(form[k], 10) || min) + d))));
  };
  const stepper = (k: 'adults' | 'children') => (
    <div className="ci-stp" role="group" aria-label={tr(k === 'adults' ? c.adults : c.children)}>
      <Button variant="ghost" aria-label={tr(k === 'adults' ? "Fewer adults" : "Fewer children")} onClick={() => count(k, -1)}>−</Button>
      <output aria-live="polite">{form[k]}</output>
      <Button variant="ghost" aria-label={tr(k === 'adults' ? "More adults" : "More children")} onClick={() => count(k, 1)}>+</Button>
    </div>
  );
  const gst = stayEstimate(rateToPaise(form.rate), 1, 0).gstPercent;
  // one tab stop for the group (the chosen card, else the first); the arrows, Home and End move the choice as on native radios
  const rooms = prefill.rooms;
  const stopAt = Math.max(0, rooms.findIndex((r) => r.id === form.roomId));
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? rooms.length - 1 : step ? (i + step + rooms.length) % rooms.length : -1;
    const next = rooms[to];
    if (!next) return;
    e.preventDefault();
    set('roomId', next.id);
    e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('.ci-room')[to]?.focus();
  };
  return (
    <>
      <div className="card p-3 p-md-4">
        <div className="ci-head">
          <h6>{tr(c.roomCard)}</h6>
          <span className="ci-quiet">{[res ? tr(c.bookedType(res.roomTypeName)) : '', tr(c.roomCardHint), lastRoom ? `${tr(c.lastStayMark)} ${lastRoom}` : ''].filter(Boolean).join(' · ')}</span>
        </div>
        {errors.roomId && <div id="ci-room-error" className="field-error mb-2" role="alert" tabIndex={-1}>{tr(errors.roomId)}</div>}
        <div className="ci-rooms" role="radiogroup" aria-label={tr(c.roomCard)} aria-required="true" aria-describedby={errors.roomId ? 'ci-room-error' : undefined}>
          {rooms.map((r, i) => (
            // check-shared-ignore: a tappable room card (number, category, state), nothing in the kit draws it
            <button key={r.id} type="button" role="radio" aria-checked={form.roomId === r.id} tabIndex={i === stopAt ? 0 : -1} className={`ci-room ${r.hkStatus === 'dirty' ? 'dirty' : ''}`.trim()}
              onClick={() => set('roomId', r.id)} onKeyDown={(e) => onKey(e, i)}>
              <b>{r.number}</b>
              <small>{r.roomTypeName ?? tr("No category")} · {tr(r.hkStatus === 'dirty' ? c.needsCleaning : c.clean)}{r.number === lastRoom ? ` · ${tr(c.lastStayMark)}` : ''}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="card p-3 p-md-4">
        <div className="ci-head"><h6>{tr(c.stayCard)}</h6><span className="ci-quiet">{tr(res && res.checkOut > today ? c.fromBooking : c.tomorrowDefault)}</span></div>
        <div className="row g-3">
          <Field label={tr(c.expectedCheckOut)} required col="col-md-4" error={errors.expectedCheckOut}>
            <PmsDate type="date" min={addDays(today, 1)} value={form.expectedCheckOut} onChange={(e) => set('expectedCheckOut', e.target.value)} />
          </Field>
          <Field label={tr(c.adults)} required col="col-md-4" error={errors.adults}>{stepper('adults')}</Field>
          <Field label={tr(c.children)} col="col-md-4" error={errors.children}>{stepper('children')}</Field>
          <Field label={tr("Rate per night (₹)")} required col="col-md-4" error={errors.ratePaise}>
            <input type="number" className="form-control" min={0} step="0.01" inputMode="decimal" value={form.rate} onChange={(e) => set('rate', e.target.value)} />
            <div className="form-text">{tr(c.gstLine(gst))}</div>
          </Field>
          {autoGr ? (
            <div className="col-md-4">
              <span className="form-label d-block">{tr(c.gr)}</span>
              <p className="hu-gr">
                <b>{form.grNumber}</b> <span>{tr(c.grAuto)}</span>
                <Button variant="ghost" size="sm" onClick={() => setEditGr(true)} aria-label={`${tr(c.grChange)}: ${tr(c.gr)}`}>{tr(c.grChange)}</Button>
              </p>
            </div>
          ) : (
            <Field label={tr(c.gr)} col="col-md-4" error={errors.grNumber}>
              <input className="form-control" maxLength={50} value={form.grNumber} autoFocus={editGr} onChange={(e) => set('grNumber', e.target.value)} />
              {prefill.suggestedGrNumber && form.grNumber === prefill.suggestedGrNumber && <div className="form-text">{tr(c.grGiven)}</div>}
            </Field>
          )}
        </div>
      </div>
    </>
  );
}

export interface SummaryFacts { reservation: Reservation | null; form: CheckInForm; room: Room | null; today: string; others: number }

/** The lines of the summary (the aside and the phone bar read the same numbers). */
export function summaryLines(p: SummaryFacts) {
  const nights = Math.max(1, daysBetween(p.today, p.form.expectedCheckOut) || 1);
  const advance = p.reservation?.advanceBalancePaise ?? 0;
  const est = stayEstimate(rateToPaise(p.form.rate), nights, advance);
  const adults = Number.parseInt(p.form.adults, 10) || 0;
  const children = Number.parseInt(p.form.children, 10) || 0;
  return { nights, advance, est, guests: copy.reservations.guests(adults, children) + (p.others ? ` · ${plural(p.others + 1, 'name')}` : '') };
}

export function CheckInSummary(p: SummaryFacts & { children: ReactNode }) {
  const { nights, advance, est, guests } = summaryLines(p);
  const res = p.reservation;
  return (
    <aside className="card p-3 p-md-4 ci-sum" aria-label={tr(c.summary)}>
      <span className="t-label">{tr(c.summary)}</span>
      <dl>
        <dt>{tr(c.k.booking)}</dt><dd>{res ? res.reference : tr(c.walkInBooking)}</dd>
        <dt>{tr(c.k.dates)}</dt><dd>{dateSpan(p.today, p.form.expectedCheckOut)}</dd>
        <dt>{tr(c.k.nights)}</dt><dd>{nights}</dd>
        <dt>{tr(c.k.guests)}</dt><dd>{guests}</dd>
        <dt>{tr(c.k.room)}</dt><dd>{p.room ? `${p.room.number}${p.room.roomTypeName ? ` · ${p.room.roomTypeName}` : ''}` : res ? res.roomTypeName : tr(c.chooseRoom)}</dd>
        <dt>{tr(c.k.rate)}</dt><dd>{p.form.rate ? formatINR(rateToPaise(p.form.rate) ?? 0) : '-'}</dd>
        <dt>{tr(c.k.gst(est.gstPercent))}</dt><dd>{formatINR(est.gstPaise)}</dd>
        {advance > 0 && <><dt>{tr(c.k.advance)}</dt><dd>− {formatINR(advance)}</dd></>}
      </dl>
      <div className="ci-total"><span>{tr(c.k.balance)}</span><span>{formatINR(est.balancePaise)}</span></div>
      {p.children}
      <span className="ci-quiet">{tr(c.balanceNote)} {tr(c.draftNote)}</span>
    </aside>
  );
}

/** The phone's bar: one line of the summary and the step's main button (nothing above 768px). */
export function CheckInBar({ label, line, value, children }: { label: string; line: string; value?: string; children: ReactNode }) {
  return (
    <StickyActions label={label}>
      <div className="ci-bar">
        <span className="ci-bar-line"><span>{line}</span>{value && <b>{value}</b>}</span>
        {children}
      </div>
    </StickyActions>
  );
}
