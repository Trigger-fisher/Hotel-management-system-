'use client';
// Step 2 of the booking: the dates (a 14-day strip of day chips and the two pickers, nights computed), the adults / children steppers, the room category
// as chips priced by the plan, plan, rooms and rate with the quiet GST slab line, notes behind "More"; and the summary column both steps share.
import { useState, type KeyboardEvent, type ReactNode } from 'react';

import { addDays, frontOfficeCopy as copy, planRate, type FrontOfficeOptions } from '@shared/dashboards/frontOffice';
import { formatDate, formatINR } from '@shared/dashboards/format';
import type { FieldErrors } from '@/components/ui';

import { Button, Field, PmsDate, Select, Textarea } from '../../pallav/ui';
import { dateSpan } from './checkInDraft';
import { bookingEstimate, nightsOf, planOf, rateToPaise, stripDays, stripStart, type BookingForm, type Phase } from './bookingDraft';

import { tr } from '@/lib/i18n/language';
const c = copy.reservationForm;
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const weekday = (d: string) => DAY_LETTERS[new Date(`${d}T00:00:00Z`).getUTCDay()] ?? '';

export interface StayProps {
  options: FrontOfficeOptions; form: BookingForm; errors: FieldErrors; today: string; phase: Phase;
  set: <K extends keyof BookingForm>(k: K, v: BookingForm[K]) => void;
  /** Several fields at once (a category, a plan or the adults also move the rate). */
  patch: (p: Partial<BookingForm>) => void;
  onDay: (day: string) => void;
}

export function BookingStayStep({ options, form, errors, today, phase, set, patch, onDay }: StayProps) {
  const [more, setMore] = useState(form.notes.trim() !== '');
  const days = stripDays(stripStart(today, form.checkIn));
  const nights = nightsOf(form);
  const type = options.roomTypes.find((t) => t.id === form.roomTypeId);
  const plan = planOf(type, form.plan);
  const adults = Number.parseInt(form.adults, 10) || 2;
  const gst = bookingEstimate(rateToPaise(form.rate), 1, 1).gstPercent;
  const count = (k: 'adults' | 'children', d: number) => {
    const min = k === 'adults' ? 1 : 0;
    patch({ [k]: String(Math.min(99, Math.max(min, (Number.parseInt(form[k], 10) || min) + d))) });
  };
  const stepper = (k: 'adults' | 'children') => (
    <div className="bk-stp" role="group" aria-label={tr(k === 'adults' ? c.adults : c.children)}>
      <Button variant="ghost" aria-label={tr(k === 'adults' ? "Fewer adults" : "Fewer children")} onClick={() => count(k, -1)}>−</Button>
      <output aria-live="polite">{form[k]}</output>
      <Button variant="ghost" aria-label={tr(k === 'adults' ? "More adults" : "More children")} onClick={() => count(k, 1)}>+</Button>
    </div>
  );
  // one tab stop for the category group (the chosen chip, else the first); arrows, Home and End move the choice as on native radios
  const types = options.roomTypes;
  const stopAt = Math.max(0, types.findIndex((t) => t.id === form.roomTypeId));
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? types.length - 1 : step ? (i + step + types.length) % types.length : -1;
    const next = types[to];
    if (!next) return;
    e.preventDefault();
    patch({ roomTypeId: next.id });
    e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('.bk-type')[to]?.focus();
  };
  const dayState = (d: string) => (d === form.checkIn ? 'in' : d === form.checkOut ? 'out' : d > form.checkIn && d < form.checkOut ? 'between' : '');
  return (
    <div className="card p-3 p-md-4">
      <div className="bk-head">
        <h6>{tr(c.whenAndWhich)}</h6>
        <span className="bk-quiet" aria-live="polite">{phase === 'out' ? tr(c.pickCheckOut) : nights > 0 ? `${dateSpan(form.checkIn, form.checkOut)} · ${tr(c.nights(nights))}` : tr(c.sameDay(formatDate(addDays(form.checkIn, 1))))}</span>
      </div>
      <div className="bk-days" role="group" aria-label={tr(c.stripHint)}>
        {days.map((d) => (
          // check-shared-ignore: a day chip of the date strip (weekday letter and day number), nothing in the kit draws it
          <button key={d} type="button" className={`bk-day ${dayState(d)} ${d === today ? 'today' : ''}`.replace(/\s+/g, ' ').trim()} aria-pressed={d === form.checkIn || d === form.checkOut} aria-label={formatDate(d)} onClick={() => onDay(d)}>
            <small aria-hidden="true">{weekday(d)}</small>
            <b aria-hidden="true">{Number(d.slice(8))}</b>
          </button>
        ))}
      </div>
      <div className="form-text mb-3">{tr(c.stripHint)}</div>
      <div className="row g-3">
        <Field label={tr(c.checkIn)} required col="col-md-3" error={errors.checkIn}>
          <PmsDate type="date" value={form.checkIn} onChange={(e) => patch({ checkIn: e.target.value, checkOut: form.checkOut > e.target.value ? form.checkOut : addDays(e.target.value, 1) })} />
        </Field>
        <Field label={tr(c.checkOut)} required col="col-md-3" error={errors.checkOut}>
          <PmsDate type="date" min={addDays(form.checkIn, 1)} value={form.checkOut} onChange={(e) => set('checkOut', e.target.value)} />
        </Field>
        <Field label={tr(c.adults)} required col="col-md-3" error={errors.adults}>{stepper('adults')}</Field>
        <Field label={tr(c.children)} col="col-md-3" error={errors.children}>{stepper('children')}</Field>
        <div className="col-12">
          <label className="form-label">{tr(c.roomType)}<span className="req">*</span></label>
          {errors.roomTypeId && <div id="bk-type-error" className="field-error mb-2" role="alert" tabIndex={-1}>{tr(errors.roomTypeId)}</div>}
          {types.length === 0 ? <div className="form-text">{tr(c.noTypes)}</div> : (
            <div className="bk-types" role="radiogroup" aria-label={tr(c.roomType)} aria-required="true" aria-describedby={errors.roomTypeId ? 'bk-type-error' : undefined}>
              {types.map((t, i) => {
                const p = planOf(t, form.plan);
                return (
                  // check-shared-ignore: a tappable category chip (name and plan rate), nothing in the kit draws it
                  <button key={t.id} type="button" role="radio" aria-checked={form.roomTypeId === t.id} tabIndex={i === stopAt ? 0 : -1} className="bk-type" onClick={() => patch({ roomTypeId: t.id })} onKeyDown={(e) => onKey(e, i)}>
                    <b>{t.name}</b>
                    <small>{p ? formatINR(planRate(p, adults)) : tr(c.noPlan)}</small>
                  </button>
                );
              })}
            </div>
          )}
          <div className="form-text">{tr(c.roomTypeHint)}</div>
        </div>
        <Field label={tr(c.plan)} col="col-md-4" error={errors.plan}>
          <Select value={form.plan} onChange={(e) => patch({ plan: e.target.value })} disabled={!type}>
            {!type?.plans.length && <option value="">{tr(c.noPlan)}</option>}
            {type?.plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label={tr(c.rooms)} required col="col-md-3" error={errors.rooms}>
          <input type="number" className="form-control" min={1} max={50} inputMode="numeric" value={form.rooms} onChange={(e) => set('rooms', e.target.value)} />
        </Field>
        <Field label={`${tr(c.rate)} (₹)`} col="col-md-5" error={errors.ratePaise}>
          <input type="number" className="form-control" min={0} step="0.01" inputMode="decimal" value={form.rate} onChange={(e) => patch({ rate: e.target.value, rateEdited: true })} />
          <div className="form-text">{tr(c.gstLine(gst))}{plan && !form.rateEdited ? ` · ${tr(c.rateFrom(plan.name))}` : ''}</div>
        </Field>
      </div>
      <div className="bk-chips mt-3">
        <Button variant="ghost" size="sm" icon={more ? 'chevron-up' : 'chevron-down'} aria-expanded={more} onClick={() => setMore((x) => !x)}>{tr(more ? c.less : c.more)}</Button>
        {!more && <span className="bk-quiet">{tr(c.moreHint)}</span>}
      </div>
      {more && (
        <div className="row g-3 mt-0">
          <Field label={tr(c.notes)} error={errors.notes}>
            <Textarea rows={2} maxLength={2000} placeholder={tr(c.notesPh)} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </div>
      )}
    </div>
  );
}

/** The lines of the summary (the aside and the phone bar read the same numbers). */
export function summaryLines(form: BookingForm, options: FrontOfficeOptions) {
  const nights = nightsOf(form);
  const rooms = Number.parseInt(form.rooms, 10) || 1;
  const est = bookingEstimate(rateToPaise(form.rate), nights, rooms);
  const type = options.roomTypes.find((t) => t.id === form.roomTypeId) ?? null;
  return { nights, rooms, est, type };
}

export function BookingSummary({ form, options, step, children }: { form: BookingForm; options: FrontOfficeOptions; step: 1 | 2; children: ReactNode }) {
  const { nights, rooms, est, type } = summaryLines(form, options);
  const later = <dd className="quiet">{tr(c.nextStep)}</dd>;
  return (
    <aside className="card p-3 p-md-4 bk-sum" aria-label={tr(c.summary)}>
      <span className="t-label">{tr(c.summary)}</span>
      <dl>
        <dt>{tr(c.k.guest)}</dt><dd className={form.guestName.trim() ? '' : 'quiet'}>{form.guestName.trim() || tr(c.notChosen)}</dd>
        <dt>{tr(c.k.mobile)}</dt><dd className={form.mobile.trim() ? '' : 'quiet'}>{form.mobile.trim() || '-'}</dd>
        <dt>{tr(c.k.dates)}</dt>{step === 1 ? later : <dd>{dateSpan(form.checkIn, form.checkOut)}</dd>}
        {step === 2 && (
          <>
            <dt>{tr(c.k.nights)}</dt><dd>{nights}</dd>
            <dt>{tr(c.k.category)}</dt><dd className={type ? '' : 'quiet'}>{type ? type.name : tr(c.notChosen)}</dd>
            <dt>{tr(c.k.rooms)}</dt><dd>{rooms}</dd>
            <dt>{tr(c.k.rate)}</dt><dd>{form.rate ? formatINR(rateToPaise(form.rate) ?? 0) : '-'}</dd>
            <dt>{tr(c.k.gst(est.gstPercent))}</dt><dd>{formatINR(est.gstPaise)}</dd>
          </>
        )}
      </dl>
      {step === 2 && <div className="bk-total"><span>{tr(c.k.estimate)}</span><span>{formatINR(est.totalPaise)}</span></div>}
      {children}
      <span className="bk-quiet">{step === 2 ? `${tr(c.estimateNote)} ` : ''}{tr(c.draftNote)}</span>
    </aside>
  );
}
