'use client';
// Check a guest in, in two steps (MJ's preview, common/docs/design/preview/checkin-preview.html): who is arriving (a booking of today or a walk-in, the past guest
// found by mobile, every person in the room), then the room and the confirmation. A draft is kept in this browser per booking (never an ID number) once the desk
// has typed something, until it saves; a walk-in's draft lives in this tab only and goes when the desk leaves it.
import { useEffect, useRef, useState } from 'react';

import { EMPTY_REGISTER_FIELDS, frontOfficeCopy as copy, todayIst, type CheckInPrefill, type FrontOfficeOptions, type GuestRegisterFields, type Reservation, type Stay } from '@shared/dashboards/frontOffice';
import { formatINR } from '@shared/dashboards/format';

import type { ScreenProps } from '../../types';
import { errorText, toInt, useAsync, useSubmit, useToast, type AsyncState } from '@/components/ui';
import { Button, EmptyState, LoadError, PageHead, PageSkeleton, Skeleton, WizardSteps } from '../../pallav/ui';
import { foApi } from './api';
import { FoNav } from './foKit';
import { idReadShare, readIdPhoto } from './idPhoto';
import { CheckInArrivals } from './CheckInArrivals';
import { CheckInGuests, type Lookup, type Photos } from './CheckInGuests';
import { addPictures, CheckInIdStep, ID_ASK, type IdState } from './CheckInIdStep';
import { CheckInBar, CheckInRoom, CheckInSummary, summaryLines } from './CheckInRoom';
import {
  applyDraft, draftKey, dropDraft, fillFromLookup, hasUnnamedMember, initialForm, membersInput, mobileDigits, nameOnlyNames, newMember, rateToPaise, readDraft, sweepDrafts, toDraft, writeDraft,
  type CheckInForm, type MemberRow,
} from './checkInDraft';

import { tr } from '@/lib/i18n/language';
const c = copy.checkIn;
const REGISTER_KEYS = Object.keys(EMPTY_REGISTER_FIELDS) as (keyof GuestRegisterFields)[];
const FIELDS = ['reservationId', 'roomId', 'expectedCheckOut', 'grNumber', 'adults', 'children', 'plan', 'ratePaise', 'guestName', 'mobile', 'email', 'address', 'city', 'nationality', 'idProofType', 'idProofNumber', 'companyId', 'guestGstin', 'notes', 'members', ...REGISTER_KEYS];
const STEP2 = new Set(['roomId', 'expectedCheckOut', 'grNumber', 'adults', 'children', 'ratePaise']);
const LOOKUP_TIMEOUT_MS = 8000;
const READ_GIVE_UP_MS = 60_000;
const READER_OFF = 'ID reading is not switched on for this hotel yet. Please type the details in.';
const READER_BUSY = 'The reader is busy. Try again or type it in.';
// a booking's draft waits in this browser for the desk to come back; a walk-in's draft is this tab's only, so the next walk-in never sees the last guest's details
const store = (walkIn: boolean) => {
  try { return walkIn ? sessionStorage : localStorage; } catch { return null; }
};

type Pick = { resId: string; walkIn: boolean };

export function CheckInScreen({ params, navigate, back }: ScreenProps) {
  const [pick, setPick] = useState<Pick>({ resId: params.reservationId ?? '', walkIn: !params.reservationId && params.walkIn === '1' });
  const opts = useAsync(() => foApi.getOptions(), []);
  const arrivals = useAsync(() => foApi.listCheckInReservations(), []);
  // the rooms of a newly picked booking arrive behind the ones on screen (keep), so the list does not blink; Body waits for `refreshing` to end
  const prefill = useAsync(() => foApi.getCheckInPrefill(pick.resId || undefined), [pick.resId], { keep: true });
  const options = opts.state.status === 'ready' ? opts.state.data : null;
  const p = prefill.state.status === 'ready' ? prefill.state.data : null;
  const error = opts.state.status === 'error' ? opts.state.error : prefill.state.status === 'error' ? prefill.state.error : null;
  const r = p && !prefill.refreshing ? p.reservation : null;
  return (
    <>
      <PageHead sub={pick.walkIn ? c.walkIn : r ? c.fromReservation(r.reference, r.rooms, r.roomTypeName || 'room', p?.alreadyIn ?? 0) : tr("Today's bookings, or a guest without one.")}>
        <span className="app-hide-phone"><Button variant="outline" icon="arrow-left" onClick={back}>{tr("Back")}</Button></span>
        <FoNav active="board" navigate={navigate} quick={false} />
      </PageHead>
      {error && /no room is free/i.test(error.message ?? '') ? (
        // The server answers a plain 409 when no room can be given: that is an empty state with a next step, not a failure of the page.
        <div className="card">
          <EmptyState icon="door-open" title={c.noRoomsTitle} text={`${c.noRoomsBody} Free a room or add one on the Rooms page, then come back.`}>
            <Button className="mt-3" icon="door-open" onClick={() => navigate('hotel.fo.rooms')}>{tr("Open rooms")}</Button>
          </EmptyState>
        </div>
      ) : error ? (
        <LoadError error={error} onRetry={() => { opts.reload(); prefill.reload(); }} />
      ) : options && p ? (
        p.rooms.length === 0 ? (
          <div className="card"><EmptyState icon="door-open" title={c.noRoomsTitle} text={c.noRoomsBody} /></div>
        ) : (
          <Body options={options} prefill={p} refreshing={prefill.refreshing} pick={pick} setPick={setPick} roomIdParam={params.roomId} arrivals={arrivals} navigate={navigate} />
        )
      ) : <PageSkeleton tiles={false} />}
    </>
  );
}

type S = { key: string; form: CheckInForm; register: GuestRegisterFields; members: MemberRow[]; photos: Photos; dirty: boolean; id: IdState };
type Found = { digits: string; match: Lookup['match']; failed: boolean };
const NOTHING: Found = { digits: '', match: null, failed: false };

function Body({ options, prefill, refreshing, pick, setPick, roomIdParam, arrivals, navigate }: {
  options: FrontOfficeOptions; prefill: CheckInPrefill; refreshing: boolean; pick: Pick; setPick: (p: Pick) => void; roomIdParam?: string;
  arrivals: { state: AsyncState<Reservation[]>; reload: () => void }; navigate: ScreenProps['navigate'];
}) {
  const toast = useToast();
  const today = todayIst();
  const picked = pick.walkIn || pick.resId !== '';
  const key = `${pick.resId}:${pick.walkIn}`;
  const build = (): S => {
    const form = initialForm(prefill, today, roomIdParam);
    const draft = picked ? readDraft(store(pick.walkIn), draftKey(pick.resId)) : null;
    const d = draft ? applyDraft(form, draft) : { form, register: { ...EMPTY_REGISTER_FIELDS }, members: [] };
    // a draft the desk already typed into counts as the ID step done: the form comes back as it was left
    return { key, ...d, photos: {}, dirty: false, id: draft ? { phase: 'done', unread: [], files: [] } : ID_ASK };
  };
  const [s, setS] = useState<S>(build);
  // a pull to refresh of the same pick keeps the card as it is; only a new pick waits for its own prefill
  const fresh = !refreshing || s.key === key;
  // a new pick (once its prefill is here) starts the form again from the booking and this browser's draft
  if (s.key !== key && fresh) setS(build());
  const [step, setStep] = useState<1 | 2>(1);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Found>(NOTHING);
  const [sending, setSending] = useState(false);
  const [memberError, setMemberError] = useState<string | undefined>();
  const { busy, errors, submit } = useSubmit(FIELDS);
  const formRef = useRef<HTMLFormElement>(null);
  const set = <K extends keyof CheckInForm>(k: K, v: CheckInForm[K]) => setS((x) => ({ ...x, dirty: true, form: { ...x.form, [k]: v } }));
  const setRegister = (k: keyof GuestRegisterFields, v: string) => setS((x) => ({ ...x, dirty: true, register: { ...x.register, [k]: v } }));
  const setMembers = (f: (m: MemberRow[]) => MemberRow[]) => { setMemberError(undefined); setS((x) => ({ ...x, dirty: true, members: f(x.members) })); };
  const setPhoto = (k: string, file: File | null) => { setMemberError(undefined); setS((x) => ({ ...x, photos: { ...x.photos, [k]: file ?? undefined } })); };
  const readToken = useRef(0);
  const readCall = useRef<AbortController | null>(null);
  /** Ends the reading on screen, if any: its answer is ignored and the request is dropped. */
  const stopReading = () => { readToken.current += 1; readCall.current?.abort(); readCall.current = null; };
  /** The chosen pictures go with the stay: the first is the main guest's ID, the rest are kept as further pictures of it. */
  const attach = (photos: Photos, files: File[]): Photos => {
    if (files.length === 0) return photos;
    const kept = Object.fromEntries(Object.entries(photos).filter(([k]) => !/^lead\d*$/.test(k)));
    return { ...kept, ...Object.fromEntries(files.map((f, i) => [i === 0 ? 'lead' : `lead${i + 1}`, f])) };
  };
  const typeItMyself = () => { stopReading(); setS((x) => ({ ...x, photos: attach(x.photos, x.id.files), id: { phase: 'done', unread: [], files: [] } })); };
  const addPics = (list: File[]) => setS((x) => {
    const r = addPictures(x.id.files, list);
    return { ...x, id: { ...x.id, phase: 'ask', files: r.files, message: r.problem ?? undefined, failure: undefined } };
  });
  const removePic = (i: number) => {
    if (s.id.phase === 'reading') stopReading();
    setS((x) => ({ ...x, id: { ...x.id, phase: 'ask', files: x.id.files.filter((_, j) => j !== i), message: undefined, failure: undefined } }));
  };
  const cancelRead = () => { stopReading(); setS((x) => ({ ...x, id: { ...x.id, phase: 'ask', message: undefined } })); };
  /** The ID first: the pictures go to the reader as one request, the form is filled from what it read, and anything it did not read is marked for the desk. */
  async function readFromId() {
    const files = s.id.files;
    if (files.length === 0) return undefined;
    stopReading();
    const token = readToken.current;
    const call = new AbortController();
    readCall.current = call;
    const alive = () => readToken.current === token;
    const into = (id: Partial<IdState>) => { if (alive()) setS((x) => ({ ...x, id: { ...x.id, ...id } })); };
    setS((x) => ({ ...x, id: { ...x.id, phase: 'reading', stage: 'prepare', message: undefined, failure: undefined, unread: [] } }));
    const share = idReadShare(files.length);
    const sending: { fileName: string; dataBase64: string }[] = [];
    for (const f of files) {
      const photo = await readIdPhoto(f, share);
      if (!alive()) return undefined;
      if (!photo.ok) return into({ phase: 'rejected', message: `${f.name}: ${photo.error}` });
      sending.push({ fileName: photo.fileName, dataBase64: photo.dataBase64 });
    }
    into({ stage: 'wait' });
    // a request the network never answers is dropped after a minute and said so; the reader's own wait is shorter
    const giveUp = window.setTimeout(() => call.abort(), READ_GIVE_UP_MS);
    const res = await foApi.readId(sending, call.signal);
    window.clearTimeout(giveUp);
    if (!alive()) return undefined;
    if (!res.ok) {
      const reason = res.error.details?.reason;
      const typed = res.error.details?.fields?.files;
      if (reason === 'reader_not_connected') return into({ phase: 'failed', failure: 'off', message: READER_OFF });
      if (typed) return into({ phase: 'rejected', message: typed });
      if (reason === 'reader_busy' || call.signal.aborted) return into({ phase: 'failed', failure: 'busy', message: READER_BUSY });
      if (res.error.code === 'RATE_LIMITED') return into({ phase: 'failed', failure: 'busy', message: 'Too many readings just now. Wait a minute, or type it in.' });
      return into({ phase: 'failed', failure: 'error', message: 'The ID could not be read just now. Try again, or type it in yourself.' });
    }
    const r = res.data;
    if (r.outcome === 'unclear') return into({ phase: 'rejected', message: r.retake ?? 'Retake the photo of the card.' });
    if (r.retake) toast.show({ tone: 'error', text: `${tr('One picture could not be used.')} ${tr(r.retake)}` });
    const type = options.idTypes.find((t) => t.toLowerCase() === (r.fields.idProofType ?? '').toLowerCase()) ?? '';
    setS((x) => {
      const got = (v: string | undefined, old: string) => (v?.trim() ? v.trim() : old);
      const form = {
        ...x.form, guestName: got(r.fields.guestName, x.form.guestName), idProofType: type || x.form.idProofType, idProofNumber: got(r.fields.idProofNumber, x.form.idProofNumber),
        address: got(r.fields.address, x.form.address), city: got(r.fields.city, x.form.city), nationality: got(r.fields.nationality, x.form.nationality),
      };
      const register = { ...x.register, dateOfBirth: got(r.fields.dateOfBirth, x.register.dateOfBirth) };
      const others = (r.others ?? []).filter((o) => o.fullName.trim()).map((o) => ({ ...newMember(false), fullName: o.fullName.trim(), idType: options.idTypes.find((t) => t.toLowerCase() === o.idType.toLowerCase()) ?? '', idNumber: o.idNumber.trim() }));
      const unread = new Set(r.unread);
      if (!r.fields.idProofType || !type) unread.add('idProofType');
      return { ...x, dirty: true, photos: attach(x.photos, x.id.files), form, register, members: others.length ? [...x.members, ...others] : x.members, id: { phase: 'done', fromId: true, unread: [...unread], files: [] } };
    });
    return undefined;
  }
  const leaveWalkIn = () => { if (pick.walkIn) dropDraft(store(true), draftKey('')); };
  const choose = (next: Pick) => { if (sending) return; stopReading(); leaveWalkIn(); setPick(next); setStep(1); setMemberError(undefined); setFound(NOTHING); };
  // the walk-in's draft does not outlive the screen
  const walkInRef = useRef(pick.walkIn);
  useEffect(() => { walkInRef.current = pick.walkIn; }, [pick.walkIn]);
  useEffect(() => () => { if (walkInRef.current) dropDraft(store(true), draftKey('')); }, []);

  // a room picked in the form may have been given to someone else while the list was refreshed
  if (s.form.roomId && !prefill.rooms.some((r) => r.id === s.form.roomId)) setS((x) => ({ ...x, form: { ...x.form, roomId: '' } }));

  // the drafts of bookings no longer arriving today (cancelled, no-show, checked in elsewhere) leave this browser
  useEffect(() => {
    if (arrivals.state.status === 'ready') sweepDrafts(store(false), [...arrivals.state.data.map((r) => r.id), ...(pick.resId ? [pick.resId] : [])]);
  }, [arrivals.state, pick.resId]);

  // the past guest, once the mobile has ten digits (a booking's mobile at once): what is found fills only the empty fields
  const digits = picked && fresh ? mobileDigits(s.form.mobile) : '';
  const wanted = digits.length === 10 && found.digits !== digits;
  const lookup: Lookup = {
    status: wanted ? 'busy' : found.digits === digits && digits ? (found.failed ? 'failed' : 'done') : 'idle',
    match: found.digits === digits ? found.match : null,
  };
  useEffect(() => {
    if (!wanted) return undefined;
    let live = true;
    void foApi.lookupGuest(digits, AbortSignal.timeout(LOOKUP_TIMEOUT_MS)).then((res) => {
      if (!live) return;
      const match = res.ok ? res.data.matches[0] ?? null : null;
      setFound({ digits, match, failed: !res.ok });
      if (match) setS((x) => ({ ...x, ...fillFromLookup(x.form, x.register, match) }));
    });
    return () => { live = false; };
  }, [digits, wanted]);

  // the draft, on every change the desk makes, under this booking's key (ID numbers, the room, the G.R. number and photos stay out of it)
  useEffect(() => {
    if (!picked || !fresh || !s.dirty || sending) return;
    writeDraft(store(pick.walkIn), draftKey(pick.resId), toDraft(s.form, s.register, s.members));
  }, [s.form, s.register, s.members, s.dirty, picked, fresh, sending, pick.resId, pick.walkIn]);

  // a refused field of step 1 brings that step back (once per answer of the server), and the first refused box takes focus once it is on screen
  const [seen, setSeen] = useState({ errors, say: false });
  if (seen.errors !== errors) {
    const say = step === 2 && Object.keys(errors).some((k) => !STEP2.has(k));
    setSeen({ errors, say });
    if (say) setStep(1);
  }
  const said = useRef(seen);
  useEffect(() => {
    if (!Object.keys(errors).length && !memberError) return undefined;
    if (seen.say && said.current !== seen) toast.show({ tone: 'error', text: tr(c.checkStep1) });
    said.current = seen;
    const id = requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]')?.focus());
    return () => cancelAnimationFrame(id);
  }, [errors, memberError, step, seen, toast]);

  const room = prefill.rooms.find((x) => x.id === s.form.roomId) ?? null;
  const lastRoom = lookup.match?.lastRoomNumber ?? null;
  const roomType = options.roomTypes.find((t) => t.id === (room?.roomTypeId ?? prefill.reservation?.roomTypeId)) ?? null;
  const canContinue = picked && fresh && s.id.phase === 'done' && s.form.guestName.trim() !== '' && s.form.mobile.trim() !== '';
  const lines = summaryLines({ reservation: prefill.reservation, form: s.form, room, today, others: s.members.filter((m) => m.fullName.trim()).length });

  /** False, and the problem shown on step 1, when an added guest has an ID or a photo but no name (the save would drop that person). */
  function membersNamed(): boolean {
    if (!hasUnnamedMember(s.members, Object.keys(s.photos).filter((k) => s.photos[k]))) return true;
    setMemberError(c.memberNeedsName);
    setStep(1);
    return false;
  }
  const goToRoom = () => { if (membersNamed()) setStep(2); };

  function save() {
    if (sending || !membersNamed()) return;
    const names = nameOnlyNames(s.members);
    const notes = names && !s.form.notes.includes(names) ? `${s.form.notes.trim()}\n${c.noIdCarried(names)}`.trim() : s.form.notes;
    const register = Object.fromEntries(REGISTER_KEYS.filter((k) => s.register[k].trim()).map((k) => [k, s.register[k].trim()]));
    void submit(
      () => foApi.checkIn({
        reservationId: pick.resId, roomId: s.form.roomId, expectedCheckOut: s.form.expectedCheckOut, grNumber: s.form.grNumber, adults: toInt(s.form.adults, 1), children: toInt(s.form.children),
        plan: s.form.plan, ratePaise: rateToPaise(s.form.rate), guestName: s.form.guestName, mobile: s.form.mobile, email: s.form.email, address: s.form.address, city: s.form.city,
        nationality: s.form.nationality, idProofType: s.form.idProofType, idProofNumber: s.form.idProofNumber, companyId: s.form.companyId, guestGstin: s.form.guestGstin, notes,
        ...register, members: membersInput(s.members),
      }),
      (stay) => void finish(stay),
    );
  }

  /** After the stay exists: the form stays busy while the photos go up; whatever happens, the stay opens. */
  async function finish(stay: Stay) {
    setSending(true);
    toast.show({ tone: 'success', text: c.toast(stay.guestName, stay.roomNumber) });
    dropDraft(store(pick.walkIn), draftKey(pick.resId));
    try {
      await sendPhotos(stay);
    } catch {
      toast.show({ tone: 'error', text: `${c.photosInterrupted} ${c.fromStay}` });
    } finally {
      setSending(false);
      navigate('hotel.fo.stay', { id: stay.id });
    }
  }

  /** The ID photos go up after the stay exists (their own routes); a failure is said, by name, and never undoes the check-in. */
  async function sendPhotos(stay: Stay) {
    let version = stay.version;
    const failed = (who: string, why: string) => toast.show({ tone: 'error', text: `${c.photoNotSaved(who, why)} ${c.fromStay}` });
    const queue: { who: string; file: File; main: boolean }[] = [
      ...(s.photos.lead ? [{ who: stay.guestName, file: s.photos.lead, main: true }] : []),
      ...Object.keys(s.photos).filter((k) => /^lead\d+$/.test(k) && s.photos[k]).map((k) => ({ who: stay.guestName, file: s.photos[k] as File, main: false })),
      ...s.members.flatMap((m) => (s.photos[m.key] && m.fullName.trim() ? [{ who: m.fullName, file: s.photos[m.key] as File, main: false }] : [])),
    ];
    for (const q of queue) {
      const read = await readIdPhoto(q.file);
      if (!read.ok) { failed(q.who, read.error); continue; }
      const file = { fileName: read.fileName, dataBase64: read.dataBase64 };
      const sent = q.main ? await foApi.putIdPhoto(stay.id, file, version) : await foApi.addIdPhoto(stay.id, file, version);
      if (sent.ok) version = sent.data.version;
      else failed(q.who, errorText(sent.error));
    }
  }

  const held = busy || sending;
  const primary = step === 1
    ? <Button icon="chevron-right" disabled={!canContinue} onClick={goToRoom}>{tr(c.continueToRoom)}</Button>
    : <Button icon="box-arrow-in-right" disabled={!room} busy={held} busyLabel={tr(sending ? c.savingPhotos : "Checking in…")} onClick={save}>{room ? tr(c.checkInTo(room.number)) : tr(c.submit)}</Button>;
  const phoneLine = step === 1 ? (canContinue ? `${s.form.guestName} · ${prefill.reservation?.reference ?? tr(c.walkInBooking)}` : tr(c.pickGuest)) : room ? `${tr(c.k.room)} ${room.number} · ${lines.nights} ${tr(lines.nights === 1 ? 'night' : 'nights')}` : tr(c.pickRoom);
  const guestErrors = memberError ? { ...errors, members: memberError } : errors;

  return (
    <form ref={formRef} className="ci-grid" noValidate onSubmit={(e) => { e.preventDefault(); if (step === 2) save(); }}>
      <div className="ci-main">
        <WizardSteps names={c.steps.map((n) => tr(n))} index={step - 1} onGo={(i) => { if (!held) setStep(i === 0 ? 1 : 2); }} />
        {step === 1 ? (
          <>
            <CheckInArrivals state={arrivals.state} onRetry={arrivals.reload} query={query} onQuery={setQuery} picked={pick.walkIn ? '' : pick.resId} walkIn={pick.walkIn}
              onPick={(res) => choose({ resId: res.id, walkIn: false })} onWalkIn={() => choose({ resId: '', walkIn: true })} onBookings={() => choose({ resId: '', walkIn: false })} />
            {picked && !fresh && <div className="card p-3 p-md-4"><Skeleton lines={4} /></div>}
            {picked && fresh && s.id.phase !== 'done' && <CheckInIdStep state={s.id} walkIn={pick.walkIn} onAdd={addPics} onRemove={removePic} onRead={() => void readFromId()} onCancel={cancelRead} onSkip={typeItMyself} />}
            {picked && fresh && s.id.phase === 'done' && (
              <CheckInGuests options={options} form={s.form} register={s.register} members={s.members} photos={s.photos} lookup={lookup} onRetryLookup={() => setFound(NOTHING)} walkIn={pick.walkIn} roomType={roomType}
                errors={guestErrors} unread={s.id.fromId ? s.id.unread : undefined} onAnotherId={() => setS((x) => ({ ...x, id: ID_ASK }))} set={set} setRegister={setRegister} setMembers={setMembers} setPhoto={setPhoto} />
            )}
          </>
        ) : (
          <>
            <CheckInRoom prefill={prefill} form={s.form} set={set} errors={errors} lastRoom={lastRoom} today={today} />
            <div className="ci-phone-only"><Button variant="ghost" icon="chevron-left" onClick={() => setStep(1)} disabled={held}>{tr(c.steps[0])}</Button></div>
          </>
        )}
      </div>
      <CheckInSummary reservation={prefill.reservation} form={s.form} room={room} today={today} others={s.members.filter((m) => m.fullName.trim()).length}>
        <div className="d-grid gap-2">
          {primary}
          {step === 2 && <Button variant="ghost" icon="chevron-left" onClick={() => setStep(1)} disabled={held}>{tr(c.steps[0])}</Button>}
        </div>
      </CheckInSummary>
      <CheckInBar label={tr(c.title)} line={phoneLine} value={step === 2 && room ? `${tr(c.k.balance)} ${formatINR(lines.est.balancePaise, { decimals: false })}` : undefined}>{primary}</CheckInBar>
    </form>
  );
}
