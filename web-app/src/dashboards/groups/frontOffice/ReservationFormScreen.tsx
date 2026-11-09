'use client';
// Make or change a booking in two steps (MJ's preview, common/docs/design/preview/system-preview.html section 4): the guest (mobile first, a past guest
// found by it), then the dates and the room, with a running summary. A draft is kept in this browser per booking (or for the new one) on every change
// once the desk has typed something, until it saves; the new booking's draft goes when the desk leaves the screen, and the notes never enter a draft.
import { useEffect, useRef, useState } from 'react';

import { frontOfficeCopy as copy, todayIst, type FrontOfficeOptions, type Reservation, type ReservationInput } from '@shared/dashboards/frontOffice';
import { formatINR } from '@shared/dashboards/format';

import type { ScreenProps } from '../../types';
import { toInt, useAsync, useSubmit, useToast } from '@/components/ui';
import { Button, ConflictNote, LoadError, PageHead, PageSkeleton, WizardSteps } from '../../pallav/ui';
import { foApi } from './api';
import { FoNav } from './foKit';
import { CheckInBar } from './CheckInRoom';
import { BookingGuestStep, type Lookup } from './BookingGuestStep';
import { BookingStayStep, BookingSummary, summaryLines } from './BookingStayStep';
import { mobileDigits } from './checkInDraft';
import {
  applyDraft, draftKey, dropDraft, fillFromMatch, initialForm, pickDay, rateFromPlan, rateToPaise, readDraft, toDraft, writeDraft, STEP1_FIELDS,
  type BookingForm, type Phase,
} from './bookingDraft';

import { tr } from '@/lib/i18n/language';
const c = copy.reservationForm;
const FIELDS = ['guestName', 'mobile', 'email', 'companyId', 'source', 'checkIn', 'checkOut', 'adults', 'children', 'roomTypeId', 'rooms', 'plan', 'ratePaise', 'notes'];
const LOOKUP_TIMEOUT_MS = 8000;
const store = () => { try { return localStorage; } catch { return null; } };

export function ReservationFormScreen({ params, navigate, back }: ScreenProps) {
  const id = params.id;
  const opts = useAsync(() => foApi.getOptions(), []);
  const existing = useAsync(() => (id ? foApi.getReservation(id) : Promise.resolve({ ok: true as const, data: null })), [id]);
  const options = opts.state.status === 'ready' ? opts.state.data : null;
  const res = existing.state.status === 'ready' ? existing.state.data : undefined;
  const error = opts.state.status === 'error' ? opts.state.error : existing.state.status === 'error' ? existing.state.error : null;
  const name = id ? (res ? c.editPage(res.reference) : null) : c.newPage;

  return (
    <>
      <PageHead sub={name ? <>{tr(name)} · {tr(c.pageSub)}</> : c.pageSub}>
        <span className="app-hide-phone"><Button variant="outline" icon="arrow-left" onClick={back}>{tr("Back")}</Button></span>
        <FoNav active="reservations" navigate={navigate} quick={false} />
      </PageHead>
      {error ? (
        <LoadError error={error} onRetry={() => { opts.reload(); existing.reload(); }} />
      ) : options && res !== undefined ? (
        <Form key={res?.id ?? 'new'} options={options} reservation={res} navigate={navigate} back={back} onReload={existing.reload} />
      ) : <PageSkeleton tiles={false} />}
    </>
  );
}

type Found = { digits: string; match: Lookup['match']; failed: boolean };
const NOTHING: Found = { digits: '', match: null, failed: false };

function Form({ options, reservation, navigate, back, onReload }: { options: FrontOfficeOptions; reservation: Reservation | null; navigate: ScreenProps['navigate']; back: () => void; onReload: () => void }) {
  const toast = useToast();
  const today = todayIst();
  const key = draftKey(reservation?.id ?? '');
  const [s, setS] = useState<{ form: BookingForm; dirty: boolean; restored: boolean; mobileTyped: boolean }>(() => {
    const base = initialForm(reservation, today);
    const draft = readDraft(store(), key, base);
    return { form: draft ? applyDraft(base, draft) : base, dirty: false, restored: Boolean(draft), mobileTyped: false };
  });
  const [step, setStep] = useState<1 | 2>(1);
  const [phase, setPhase] = useState<Phase>('in');
  const [found, setFound] = useState<Found>(NOTHING);
  const { busy, errors, conflict, submit } = useSubmit(FIELDS);
  const formRef = useRef<HTMLFormElement>(null);
  const form = s.form;
  const patch = (p: Partial<BookingForm>) => setS((x) => {
    const next = { ...x.form, ...p };
    // a new category, plan or head count moves the rate along with the plan, unless the desk typed one
    const priced = 'roomTypeId' in p || 'plan' in p || 'adults' in p ? rateFromPlan(next, options.roomTypes) : next;
    return { ...x, form: priced, dirty: true, mobileTyped: x.mobileTyped || 'mobile' in p };
  });
  const set = <K extends keyof BookingForm>(k: K, v: BookingForm[K]) => patch({ [k]: v } as Partial<BookingForm>);
  const onDay = (day: string) => { const r = pickDay(form, day, phase); patch({ checkIn: r.checkIn, checkOut: r.checkOut }); setPhase(r.phase); };
  // the restored draft dropped: the form starts again from the booking (or the desk's defaults)
  const startFresh = () => { dropDraft(store(), key); setFound(NOTHING); setPhase('in'); setStep(1); setS({ form: initialForm(reservation, today), dirty: false, restored: false, mobileTyped: false }); };

  // the past guest, once the mobile has ten digits: what is found fills only the empty fields, and on a saved booking only once the desk changed the mobile
  const digits = mobileDigits(form.mobile);
  const wanted = digits.length === 10 && found.digits !== digits;
  const fills = !reservation || s.mobileTyped;
  const lookup: Lookup = {
    status: wanted ? 'busy' : found.digits === digits && digits ? (found.failed ? 'failed' : 'done') : 'idle',
    match: found.digits === digits ? found.match : null,
    filled: fills,
  };
  useEffect(() => {
    if (!wanted) return undefined;
    let live = true;
    void foApi.lookupGuest(digits, AbortSignal.timeout(LOOKUP_TIMEOUT_MS)).then((r) => {
      if (!live) return;
      const match = r.ok ? r.data.matches[0] ?? null : null;
      setFound({ digits, match, failed: !r.ok });
      if (match && fills) setS((x) => ({ ...x, form: fillFromMatch(x.form, match) }));
    });
    return () => { live = false; };
  }, [digits, wanted, fills]);

  // the draft, on every change the desk makes, under this booking's key
  useEffect(() => {
    if (s.dirty) writeDraft(store(), key, toDraft(s.form));
  }, [s.form, s.dirty, key]);
  // a new booking's draft does not outlive the screen (the next guest at the desk never sees the last one's details); a saved booking's waits for the desk to come back
  useEffect(() => () => { if (!reservation) dropDraft(store(), draftKey('')); }, [reservation]);

  // a refused field of step 1 brings that step back (once per answer of the server), and the first refused box takes focus once it is on screen
  const [seen, setSeen] = useState({ errors, say: false });
  if (seen.errors !== errors) {
    const say = step === 2 && Object.keys(errors).some((k) => STEP1_FIELDS.has(k));
    setSeen({ errors, say });
    if (say) setStep(1);
  }
  const said = useRef(seen);
  useEffect(() => {
    if (!Object.keys(errors).length) return undefined;
    if (seen.say && said.current !== seen) toast.show({ tone: 'error', text: tr(c.checkStep1) });
    said.current = seen;
    const id = requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]')?.focus());
    return () => cancelAnimationFrame(id);
  }, [errors, step, seen, toast]);

  const canContinue = form.guestName.trim() !== '';
  const lines = summaryLines(form, options);
  const canSave = form.roomTypeId !== '' && lines.nights > 0;

  function save() {
    const input: ReservationInput = {
      guestName: form.guestName, mobile: form.mobile, email: form.email, companyId: form.companyId, source: form.source, checkIn: form.checkIn, checkOut: form.checkOut,
      adults: toInt(form.adults, 1), children: toInt(form.children), roomTypeId: form.roomTypeId, rooms: toInt(form.rooms, 1), plan: form.plan,
      ratePaise: rateToPaise(form.rate), notes: form.notes, version: reservation?.version,
    };
    const done = (x: Reservation, text: string) => {
      dropDraft(store(), key);
      toast.show({ tone: 'success', text });
      navigate('hotel.fo.reservation', { id: x.id });
    };
    if (reservation) void submit(() => foApi.updateReservation(reservation.id, input), (x) => done(x, c.toast.updated));
    else void submit(() => foApi.createReservation(input), (x) => done(x, c.toast.created(x.reference)));
  }

  const saveLabel = reservation ? tr(c.save) : tr(c.create);
  const primary = step === 1
    ? <Button icon="chevron-right" disabled={!canContinue} onClick={() => setStep(2)}>{tr(c.continueToDates)}</Button>
    : <Button icon="check2" disabled={!canSave} busy={busy} busyLabel={tr("Saving…")} onClick={save}>{saveLabel}</Button>;
  const phoneLine = step === 1
    ? (canContinue ? form.guestName : tr(c.nameFirst))
    : lines.type ? `${lines.type.name} · ${tr(c.nights(lines.nights))}` : tr(c.pickCategory);

  return (
    <form ref={formRef} className="bk-grid" noValidate onSubmit={(e) => { e.preventDefault(); if (step === 2 && canSave) save(); }}>
      <div className="bk-main">
        <WizardSteps names={c.steps.map((n) => tr(n))} index={step - 1} onGo={(i) => { if (!busy) setStep(i === 0 ? 1 : 2); }} />
        {s.restored && (
          <div className="bk-restored" role="status">
            <span className="bk-quiet">{tr(c.draftRestored)}</span>
            <Button variant="ghost" size="sm" icon="arrow-counterclockwise" onClick={startFresh} disabled={busy}>{tr(c.startFresh)}</Button>
          </div>
        )}
        {conflict && <ConflictNote onReload={onReload} />}
        {step === 1 ? (
          <BookingGuestStep options={options} form={form} lookup={lookup} onRetryLookup={() => setFound(NOTHING)} errors={errors} set={set} isNew={!reservation} />
        ) : (
          <>
            <BookingStayStep options={options} form={form} errors={errors} today={today} phase={phase} set={set} patch={patch} onDay={onDay} />
            <div className="bk-phone-only"><Button variant="ghost" icon="chevron-left" onClick={() => setStep(1)} disabled={busy}>{tr(c.steps[0])}</Button></div>
          </>
        )}
      </div>
      <BookingSummary form={form} options={options} step={step}>
        <div className="d-grid gap-2">
          {primary}
          {step === 2 ? <Button variant="ghost" icon="chevron-left" onClick={() => setStep(1)} disabled={busy}>{tr(c.steps[0])}</Button> : <Button variant="ghost" onClick={back} disabled={busy}>{tr(c.cancel)}</Button>}
        </div>
      </BookingSummary>
      <CheckInBar label={saveLabel} line={phoneLine} value={step === 2 && lines.type ? `${tr(c.k.estimate)} ${formatINR(lines.est.totalPaise, { decimals: false })}` : undefined}>{primary}</CheckInBar>
    </form>
  );
}
