'use client';
// Step 1 of the check-in, the guest card: the lead guest (filled from the booking and past stays, every value editable), one row per other person in the
// room (with an ID, or by name only), and the rare fields behind "More" (plan, company, GSTIN, notes, the 12 register fields).
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { frontOfficeCopy as copy, planRate, type FrontOfficeOptions, type GuestLookupMatch, type GuestRegisterFields, type RoomType } from '@shared/dashboards/frontOffice';
import { formatDate } from '@shared/dashboards/format';
import type { FieldErrors } from '@/components/ui';

import { Button, Field, PmsDate, PmsSelect, RemoveButton, Select, StatusChip, Textarea } from '../../pallav/ui';
import { newMember, paiseToRate, type CheckInForm, type MemberRow } from './checkInDraft';

import { tr } from '@/lib/i18n/language';
const c = copy.checkIn;

/** `failed`: the lookup did not answer (offline, a timeout, a refusal); never shown as a new guest. */
export type Lookup = { status: 'idle' | 'busy' | 'done' | 'failed'; match: GuestLookupMatch | null };
export type Photos = Record<string, File | undefined>;

export interface GuestsProps {
  options: FrontOfficeOptions;
  form: CheckInForm;
  register: GuestRegisterFields;
  members: MemberRow[];
  photos: Photos;
  lookup: Lookup;
  /** Runs the lookup again after a failure. */
  onRetryLookup: () => void;
  walkIn: boolean;
  /** The chosen room's category, for the plan prices. */
  roomType: RoomType | null;
  errors: FieldErrors;
  /** Fields the ID reader did not fill: each says "Not read, please fill" until it has a value. */
  unread?: string[];
  /** Back to the ID step to add another ID photo. */
  onAnotherId?: () => void;
  set: <K extends keyof CheckInForm>(k: K, v: CheckInForm[K]) => void;
  setRegister: <K extends keyof GuestRegisterFields>(k: K, v: string) => void;
  setMembers: (f: (m: MemberRow[]) => MemberRow[]) => void;
  setPhoto: (key: string, file: File | null) => void;
}

const ACCEPT = 'image/jpeg,image/png';

/** The chosen picture as a small preview; the object URL is made, set on the image and let go inside one effect, so a re-run (StrictMode) never shows a revoked one. */
function Thumb({ file }: { file: File | undefined }) {
  const img = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (!file || !img.current) return undefined;
    const u = URL.createObjectURL(file);
    img.current.src = u;
    return () => URL.revokeObjectURL(u);
  }, [file]);
  // eslint-disable-next-line @next/next/no-img-element -- a local object URL, not an asset
  return file ? <img ref={img} className="ci-thumb" alt="" /> : <div className="ci-thumb-empty">{tr(c.idPhoto)}</div>;
}

function PhotoField({ id, file, onPick, col = 'col-md-4' }: { id: string; file: File | undefined; onPick: (f: File | null) => void; col?: string }) {
  return (
    <Field label={file ? tr(c.changePhoto) : tr(c.idPhoto)} col={col}>
      <input id={id} type="file" className="form-control" accept={ACCEPT} capture="environment" onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
    </Field>
  );
}

export function CheckInGuests(p: GuestsProps) {
  const { form, register, members, photos, lookup, errors, set } = p;
  const [more, setMore] = useState(false);
  const gaps = new Set(p.unread ?? []);
  const gap = (name: string, value: string): ReactNode => (gaps.has(name) && !value.trim() ? <div className="form-text ci-unread">{tr("Not read from the ID. Please fill it in.")}</div> : null);
  const text = (name: keyof CheckInForm, extra: Record<string, unknown> = {}) => (
    <>
      <input className={`form-control${gaps.has(name) && !form[name].trim() ? ' is-unread' : ''}`} value={form[name]} onChange={(e) => set(name, e.target.value)} {...extra} />
      {gap(name, form[name])}
    </>
  );
  const m = lookup.match;
  const digits = form.mobile.replace(/\D/g, '').length;
  return (
    <div className="card p-3 p-md-4">
      <div className="ci-head">
        <h6>{form.guestName.trim() || tr(p.walkIn ? c.walkInGuest : c.leadGuest)}</h6>
        <div className="ci-chips" role="status" aria-live="polite">
          {lookup.status === 'busy' ? <span className="ci-quiet">{tr(c.checkingPast)}</span> : m ? (
            <>
              <StatusChip tone="ok">{tr(c.returning)}</StatusChip>
              <span className="ci-quiet">{tr(c.nthStay(m.stays))}{m.lastRoomNumber || m.lastCheckOut ? ` · ${tr(c.lastStay(m.lastRoomNumber, m.lastCheckOut ? formatDate(m.lastCheckOut) : null))}` : ''}</span>
            </>
          ) : lookup.status === 'done' ? <StatusChip tone="neutral">{tr(c.newGuest)}</StatusChip> : lookup.status === 'failed' ? (
            <>
              <span className="ci-quiet">{tr(c.lookupFailed)}</span>
              <Button variant="ghost" size="sm" icon="arrow-clockwise" onClick={p.onRetryLookup}>{tr(c.retryLookup)}</Button>
            </>
          ) : null}
        </div>
      </div>
      <div className="ci-guest">
        <Thumb file={photos.lead} />
        <div className="row g-3">
          <Field label={tr(c.mobile)} required col="col-md-4" error={errors.mobile}>
            {text('mobile', { maxLength: 20, inputMode: 'tel', autoFocus: p.walkIn && !form.mobile })}
            {p.walkIn && !m && lookup.status !== 'done' && <div className="form-text">{tr(c.mobileHint)}{digits > 0 && digits < 10 ? ` (${digits}/10)` : ''}</div>}
          </Field>
          <Field label={tr(c.name)} required col="col-md-8" error={errors.guestName}>{text('guestName', { maxLength: 150 })}</Field>
          <Field label={tr(c.idType)} col="col-md-4" error={errors.idProofType}>
            <PmsSelect value={form.idProofType} onChange={(e) => set('idProofType', e.target.value)}>
              <option value="">{tr("Choose")}</option>
              {p.options.idTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </PmsSelect>
            {gap('idProofType', form.idProofType)}
          </Field>
          <Field label={tr(c.idNumber)} col="col-md-4" error={errors.idProofNumber}>{text('idProofNumber', { maxLength: 60, autoComplete: 'off' })}</Field>
          <PhotoField id="ci-photo-lead" file={photos.lead} onPick={(f) => p.setPhoto('lead', f)} />
          <Field label={tr(c.email)} col="col-md-4" error={errors.email}>{text('email', { type: 'email', maxLength: 150 })}</Field>
          <Field label={tr(c.address)} col="col-md-8" error={errors.address}>{text('address', { maxLength: 255 })}</Field>
          <Field label={tr(c.city)} col="col-md-4" error={errors.city}>{text('city', { maxLength: 100 })}</Field>
          <Field label={tr(c.nationality)} col="col-md-4" error={errors.nationality}>{text('nationality', { maxLength: 60 })}</Field>
          <Field label={tr(c.dateOfBirth)} col="col-md-4" error={errors.dateOfBirth}>
            <PmsDate type="date" value={register.dateOfBirth} onChange={(e) => p.setRegister('dateOfBirth', e.target.value)} />
            {gap('dateOfBirth', register.dateOfBirth)}
          </Field>
        </div>
      </div>
      {p.onAnotherId && (
        <div className="ci-chips mt-3" role="status" aria-live="polite">
          {p.unread ? (
            <>
              <StatusChip tone="ok">{tr("Filled from the ID")}</StatusChip>
              <span className="ci-quiet">{p.unread.length > 0 ? tr("Check it, and fill what is marked.") : tr("Check it and fix anything that is wrong.")}</span>
            </>
          ) : null}
          <Button variant="ghost" size="sm" icon="person-vcard" onClick={p.onAnotherId}>{p.unread ? tr("Use another ID") : tr("Add the ID instead")}</Button>
        </div>
      )}
      {m && <p className="ci-quiet mt-3 mb-0" role="status" aria-live="polite">{tr(c.filledFrom)}</p>}

      <Members members={members} photos={photos} idTypes={p.options.idTypes} setMembers={p.setMembers} setPhoto={p.setPhoto} error={errors.members} />

      <div className="ci-chips mt-3">
        <Button variant="ghost" size="sm" icon={more ? 'chevron-up' : 'chevron-down'} aria-expanded={more} onClick={() => setMore((x) => !x)}>{tr(more ? c.less : c.more)}</Button>
        {!more && <span className="ci-quiet">{tr(c.moreHint)}</span>}
      </div>
      {more && <MoreFields {...p} text={text} />}
    </div>
  );
}

function Members({ members, photos, idTypes, setMembers, setPhoto, error }: { members: MemberRow[]; photos: Photos; idTypes: string[]; setMembers: GuestsProps['setMembers']; setPhoto: GuestsProps['setPhoto']; error?: string }) {
  const edit = (key: string, patch: Partial<MemberRow>) => setMembers((list) => list.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const remove = (key: string) => { setMembers((list) => list.filter((x) => x.key !== key)); setPhoto(key, null); };
  return (
    <div className="mt-4">
      <div className="ci-head"><span className="t-label">{tr(c.otherGuests)}</span></div>
      {error && <div className="field-error" role="alert" tabIndex={-1}>{tr(error)}</div>}
      <div className="ci-members">
        {members.map((x, i) => (
          <div key={x.key} className="ci-member">
            <div className="ci-head mb-0">
              <div className="ci-chips">
                <strong>{x.fullName.trim() || `${tr("Guest")} ${i + 2}`}</strong>
                {x.nameOnly && <StatusChip tone="warn" title={tr(c.nameOnlyHint)}>{tr(c.nameOnly)}</StatusChip>}
              </div>
              <RemoveButton look="person" aria-label={tr(c.removeGuest)} onClick={() => remove(x.key)}>{tr("Remove")}</RemoveButton>
            </div>
            <div className="row g-3">
              <Field label={tr(c.name)} required col={x.nameOnly ? 'col-md-8' : 'col-md-4'}>
                <input className="form-control" maxLength={150} value={x.fullName} onChange={(e) => edit(x.key, { fullName: e.target.value })} />
              </Field>
              <Field label={tr(c.mobile)} col="col-md-4">
                <input className="form-control" maxLength={20} inputMode="tel" value={x.mobile} onChange={(e) => edit(x.key, { mobile: e.target.value })} />
              </Field>
              {x.nameOnly ? (
                <div className="col-12"><div className="form-text mt-0">{tr(c.nameOnlyHint)}</div></div>
              ) : (
                <>
                  <Field label={tr(c.idType)} col="col-md-4">
                    <Select value={x.idType} onChange={(e) => edit(x.key, { idType: e.target.value })}>
                      <option value="">{tr("Choose")}</option>
                      {idTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                    </Select>
                  </Field>
                  <Field label={tr(c.idNumber)} col="col-md-4">
                    <input className="form-control" maxLength={60} autoComplete="off" value={x.idNumber} onChange={(e) => edit(x.key, { idNumber: e.target.value })} />
                  </Field>
                  <PhotoField id={`ci-photo-${x.key}`} file={photos[x.key]} onPick={(f) => setPhoto(x.key, f)} col="col-md-8" />
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="d-flex gap-2 flex-wrap mt-2">
        <Button variant="outline" size="sm" icon="person-vcard" onClick={() => setMembers((l) => [...l, newMember(false)])}>{tr(c.addWithId)}</Button>
        <Button variant="outline" size="sm" icon="person" onClick={() => setMembers((l) => [...l, newMember(true)])}>{tr(c.addByName)}</Button>
      </div>
    </div>
  );
}

const REGISTER: { k: keyof GuestRegisterFields; label: string; col?: string }[] = [
  { k: 'houseNo', label: c.houseNo }, { k: 'locality', label: c.locality }, { k: 'district', label: c.district }, { k: 'zipCode', label: c.zipCode },
  { k: 'state', label: c.state }, { k: 'country', label: c.country }, { k: 'phone', label: c.phone }, { k: 'comingFrom', label: c.comingFrom }, { k: 'goingTo', label: c.goingTo },
  { k: 'vehicleRegistration', label: c.vehicleRegistration },
];

function MoreFields(p: GuestsProps & { text: (name: keyof CheckInForm, extra?: Record<string, unknown>) => ReactNode }) {
  const { form, register, errors, set } = p;
  const plans = p.roomType?.plans ?? [];
  // picking a plan fills its price while the rate box is empty (as the reservation form does)
  const onPlan = (code: string) => {
    const plan = plans.find((x) => x.code === code);
    set('plan', code);
    if (plan && (!form.rate || Number(form.rate) === 0)) set('rate', paiseToRate(planRate(plan, Number.parseInt(form.adults, 10) || 2)));
  };
  return (
    <div className="row g-3 mt-0">
      <Field label={tr(c.plan)} col="col-md-3" error={errors.plan}>
        <PmsSelect value={form.plan} onChange={(e) => onPlan(e.target.value)}>
          <option value="">{tr(c.planNone)}</option>
          {form.plan && !plans.some((x) => x.code === form.plan) && <option value={form.plan}>{tr(c.planWords[form.plan] ?? form.plan)}</option>}
          {plans.map((x) => <option key={x.code} value={x.code}>{tr(c.planWords[x.code] ?? x.name)}</option>)}
        </PmsSelect>
      </Field>
      <Field label={tr(c.company)} col="col-md-5" error={errors.companyId}>
        <PmsSelect value={form.companyId} onChange={(e) => set('companyId', e.target.value)}>
          <option value="">{tr(c.none)}</option>
          {p.options.companies.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </PmsSelect>
      </Field>
      <Field label={tr(c.gstin)} col="col-md-4" error={errors.guestGstin}>{p.text('guestGstin', { className: 'form-control text-uppercase', maxLength: 20, placeholder: c.gstinPh })}</Field>
      <Field label={tr(c.notes)} error={errors.notes}>
        <Textarea rows={2} maxLength={2000} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>
      <div className="col-12"><span className="t-label">{tr(c.register)}</span></div>
      {REGISTER.map((f) => (
        <Field key={f.k} label={tr(f.label)} col={f.col ?? 'col-md-4'} error={errors[f.k]}>
          <input className="form-control" maxLength={120} value={register[f.k]} onChange={(e) => p.setRegister(f.k, e.target.value)} />
        </Field>
      ))}
      <Field label={tr(c.vehicleType)} col="col-md-4" error={errors.vehicleType}>
        <Select value={register.vehicleType} onChange={(e) => p.setRegister('vehicleType', e.target.value)}>
          <option value="">{tr("None")}</option>
          {c.vehicleTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
      </Field>
    </div>
  );
}
