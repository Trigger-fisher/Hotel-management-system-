'use client';
// Account (guest.profile): the guest on top (photo, name, mobile, guest since) with how many details are added and one Complete your details action; then two
// cards side by side, Your details (each with Edit or Add, opening its sheet) and Sign-in and security; help and Sign out at the foot. Every save is
// PUT /guest/profile with the whole body (profileInput): the masked ID number sent back with the same type keeps the stored one. Nothing is kept in a draft.
import { useEffect, useId, useState } from 'react';

import { dashErrorText, formatDate, formatDateTime } from '@shared/dashboards';
import { idProofOptions, validatePasswordChange, type GuestProfile, type IdProofType, type ProfileInput } from '@shared/dashboards/guest';
import { guestCopyByLanguage } from '@shared/dashboards/guest.lang';
import type { GuestProfileSaved } from '@shared/dashboards/guestAccount';
import { checkIdProof, idNumberForType, idProofValue, initialsOf, profileInput, signInStatus } from '@shared/dashboards/guestCopy/account';
import { accountCopyByLanguage } from '@shared/dashboards/guestCopy/account.lang';
import { lastChangeLine } from '@shared/dashboards/profileReview';

import { useAsync, useSubmit, useToast } from '@/components/ui';
import { Bi, PortalButton } from '@/dashboards/pallav/ui';

import type { ScreenProps } from '../../types';
import { setMyPhoto, useMyPhoto } from '../../shell/myPhoto';
import { ProfilePhotoEditor } from '../admin/ProfilePhotoEditor';
import { FieldErr, PtLoad, PtPager } from '../portal/parts';
import { guestAccountApi } from './accountApi';
import { guestApi } from './api';
import { GgChip, GgPage, GgRow, GgSheet, GgSkeleton, telHref, useReceptionPhone } from './kit';
import { gpWordsByLanguage } from './kit/words';
import { homeCopyByLanguage } from '@shared/dashboards/guestCopy/home.lang';
import { guestPortalApi } from './portalApi';
import { useCopy, tr } from '@/lib/i18n/language';

type TextField = 'name' | 'email' | 'city' | 'address';
type SheetId = TextField | 'id' | 'password' | 'photo' | 'codeOff';

/** How each text field is asked for (the server's limits: name 80, city 100, address 255). */
const textFields = (a: typeof accountCopyByLanguage.en): Record<TextField, { label: string; icon: string; max: number; type?: 'email'; autoComplete: string; required?: boolean; multiline?: boolean; hint?: string }> => ({
  name: { label: a.name, icon: 'person', max: 80, autoComplete: 'name', required: true },
  email: { label: a.email, icon: 'envelope', max: 254, type: 'email', autoComplete: 'email', required: true, hint: 'We use your email only to send bills and notices.' },
  city: { label: a.city, icon: 'geo-alt', max: 100, autoComplete: 'address-level2' },
  address: { label: a.address, icon: 'house-door', max: 255, autoComplete: 'street-address', multiline: true },
});

export function GuestProfileScreen({ signOut }: ScreenProps) {
  const accountCopy = useCopy(accountCopyByLanguage);
  const a = accountCopy;
  const { state, reload } = useAsync(() => guestApi.getProfile(), []);
  const phone = useReceptionPhone();
  const [sheet, setSheet] = useState<SheetId | null>(null);
  // the photo the server keeps for this login also feeds the avatars (sidebar chip, top-bar menu)
  useEffect(() => {
    if (state.status === 'ready' && state.data.photoUrl !== undefined) setMyPhoto(state.data.photoUrl);
  }, [state]);
  const close = () => setSheet(null);

  return (
    <GgPage title={a.title} className="gg-account">
      <PtLoad state={state} onRetry={reload} skeleton={<GgSkeleton variant="account" />}>
        {(p) => (
          <>
            <AccountHead profile={p} onPhoto={() => setSheet('photo')} onComplete={setSheet} />
            <div className="gp-acct-grid">
              <Details profile={p} open={setSheet} />
              <Security key={String(p.signInCodeOn)} profile={p} open={setSheet} codeSheetOpen={sheet === 'codeOff'} onCodeSheetClose={close} />
            </div>
            <div className="gp-acct-foot">
              {phone ? (
                <div className="hm-q gp-acct-help">
                  <span className="gp-stmt-ico" aria-hidden="true">
                    <Bi name="telephone" />
                  </span>
                  <span className="hm-q-text">
                    <b>{a.helpTitle}</b>
                    <span>{a.callSub(phone)}</span>
                  </span>
                  <a className="pt-btn pt-btn-line" href={telHref(phone)}>
                    <Bi name="telephone" /> {a.callReception}
                  </a>
                </div>
              ) : null}
              <PortalButton variant="line" icon="box-arrow-right" className="gp-signout" onClick={signOut}>
                {a.signOut}
              </PortalButton>
            </div>

            {sheet === 'name' || sheet === 'email' || sheet === 'city' || sheet === 'address' ? <FieldSheet field={sheet} profile={p} onClose={close} onSaved={reload} /> : null}
            {sheet === 'id' ? <IdSheet profile={p} onClose={close} onSaved={reload} /> : null}
            {sheet === 'password' ? <PasswordSheet onClose={close} /> : null}
            <GgSheet
              className="gg-acct-sheet"
              open={sheet === 'photo'}
              title={a.photoTitle}
              onClose={close}
              footer={
                <PortalButton variant="line" onClick={close}>
                  {tr("Done")}
                </PortalButton>
              }
            >
              <ProfilePhotoEditor className="pp-guest gg-photo-editor" name={p.name} initials={initialsOf(p.name)} />
            </GgSheet>
          </>
        )}
      </PtLoad>
    </GgPage>
  );
}

/** The guest on top: the photo (initials when none) in an ink ring, tapping it opens the photo editor; the name, the mobile, "Guest since … · 6 stays". */
function AccountHead({ profile: p, onPhoto, onComplete }: { profile: GuestProfile; onPhoto: () => void; onComplete: (s: SheetId) => void }) {
  const accountCopy = useCopy(accountCopyByLanguage);
  const a = accountCopy;
  const w = useCopy(gpWordsByLanguage).account;
  const home = useCopy(homeCopyByLanguage).actions;
  const photo = useMyPhoto();
  const checks: [boolean, SheetId][] = [
    [Boolean(p.name.trim()), 'name'],
    [Boolean(p.email.trim()), 'email'],
    [p.idProofType !== 'none', 'id'],
    [Boolean(p.city.trim()), 'city'],
    [Boolean(p.address.trim()), 'address'],
  ];
  const done = checks.filter(([ok]) => ok).length;
  const next = checks.find(([ok]) => !ok)?.[1] ?? null;
  return (
    <section className={`gg-card gg-acct-head gp-acct-head${next ? ' gp-acct-todo' : ''}`} aria-label={tr("You")}>
      {/* check-shared-ignore: the round avatar is the photo editor's opener (no kit piece draws a picture button) */}
      <button type="button" className="gg-avatar" onClick={onPhoto} aria-label={a.photoOpen}>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- a signed-in picture from the API (or a data URL in the preview); next/image would fetch it without the session
          <img src={photo} alt="" />
        ) : (
          <span className="gg-avatar-txt" aria-hidden="true">
            {initialsOf(p.name)}
          </span>
        )}
        <span className="gg-avatar-cam" aria-hidden="true">
          <Bi name="camera" />
        </span>
      </button>
      <div className="gg-acct-who">
        <div className="gg-acct-name">{p.name}</div>
        <div className="gg-acct-line">{p.mobile}</div>
        <div className="gg-acct-line">{a.guestSince(formatDate(p.memberSince), p.staysCount)}</div>
      </div>
      <div className="gp-acct-done">
        <span className="gp-acct-done-l">{w.detailsDone(done, checks.length)}</span>
        <div className="gp-bar" role="progressbar" aria-label={w.detailsDone(done, checks.length)} aria-valuemin={0} aria-valuemax={checks.length} aria-valuenow={done}>
          <span style={{ width: `${Math.round((done / checks.length) * 100)}%` }} />
        </div>
        {next ? (
          <PortalButton icon="person-vcard" onClick={() => onComplete(next)}>
            {home.completeDetails}
          </PortalButton>
        ) : null}
      </div>
    </section>
  );
}

/** One detail: the label over the value ("Not added" in amber when missing) and an Edit button that opens its sheet; read-only details carry a hint instead. */
function FieldLine({ label, value, missing, hint, onEdit }: { label: string; value: string; missing?: boolean; hint?: string; onEdit?: () => void }) {
  const a = useCopy(accountCopyByLanguage);
  const w = useCopy(gpWordsByLanguage).account;
  return (
    <div className={`gp-field${missing ? ' missing' : ''}`}>
      <span className="gp-field-txt">
        <span className="gp-field-l">{label}</span>
        <span className="gp-field-v">{missing ? a.notAdded : value}</span>
        {hint ? <span className="gp-field-h">{hint}</span> : null}
      </span>
      {onEdit ? (
        <PortalButton variant={missing ? 'line' : 'ghost'} icon={missing ? 'plus-lg' : 'pencil'} aria-label={a.edit(label)} onClick={onEdit}>
          {missing ? w.add : w.edit}
        </PortalButton>
      ) : (
        <Bi name="lock" className="gp-field-lock" />
      )}
    </div>
  );
}

/** Your details: one line per field with its Edit button; the mobile (and the username) are reception's. */
function Details({ profile: p, open }: { profile: GuestProfile; open: (s: SheetId) => void }) {
  const a = useCopy(accountCopyByLanguage);
  const showUser = Boolean(p.username && p.username !== p.mobile);
  return (
    <section className="gg-card gp-acct-card" aria-labelledby="ga-details">
      <h2 id="ga-details" className="gp-sec-h">
        {a.detailsTitle}
      </h2>
      <div className="gp-fields">
        <FieldLine label={a.name} value={p.name} onEdit={() => open('name')} />
        <FieldLine label={a.email} value={p.email} missing={!p.email} hint={p.email ? a.emailSub : a.emailMissing} onEdit={() => open('email')} />
        <FieldLine label={a.city} value={p.city} missing={!p.city} onEdit={() => open('city')} />
        <FieldLine label={a.address} value={p.address} missing={!p.address} onEdit={() => open('address')} />
        <FieldLine label={a.idProof} value={idProofValue(p)} missing={p.idProofType === 'none'} onEdit={() => open('id')} />
        <FieldLine label={a.mobile} value={p.mobile} hint={a.mobileHint} />
        {showUser ? <FieldLine label={a.username} value={p.username ?? ''} /> : null}
      </div>
      {p.common ? (
        <p className="gg-acct-note">
          {a.sameEverywhere}
          {p.lastChange ? <span className="d-block">{lastChangeLine(p.lastChange)}</span> : null}
        </p>
      ) : null}
    </section>
  );
}

/** One details save: the toast names a hotel that could not be reached (it is updated on the next save). */
function useSavedToast() {
  const accountCopy = useCopy(accountCopyByLanguage);
  const a = accountCopy;
  const toast = useToast();
  return (saved: GuestProfile) => {
    const gone = (saved as GuestProfile & Partial<GuestProfileSaved>).unavailable ?? [];
    toast.show({ tone: 'success', text: gone.length > 0 ? a.savedPartly(gone.map((h) => h.hotelName).join(', ')) : a.saved });
  };
}

function SheetButtons({ busy, onCancel, label: given }: { busy: boolean; onCancel: () => void; label?: string }) {
  const accountCopy = useCopy(accountCopyByLanguage);
  const a = accountCopy;
  const label = given ?? a.save;
  return (
    <>
      <PortalButton variant="line" onClick={onCancel} disabled={busy}>
        {a.cancel}
      </PortalButton>
      <PortalButton type="submit" icon="check2" busy={busy} busyLabel={a.saving}>
        {label}
      </PortalButton>
    </>
  );
}

/** The sheet for one text field (name, email, city or address). */
function FieldSheet({ field, profile, onClose, onSaved }: { field: TextField; profile: GuestProfile; onClose: () => void; onSaved: () => void }) {
  const accountCopy = useCopy(accountCopyByLanguage);
  const a = accountCopy;
  const spec = textFields(accountCopy)[field];
  const id = `ga-${field}`;
  const [value, setValue] = useState(profile[field]);
  const { busy, errors, submit } = useSubmit([field]);
  const saved = useSavedToast();
  const save = () =>
    void submit(
      () => guestApi.updateProfile(profileInput(profile, { [field]: value } as Partial<ProfileInput>)),
      (p) => {
        saved(p);
        onSaved();
        onClose();
      },
    );
  const common = {
    id,
    className: `pt-input${errors[field] ? ' is-invalid' : ''}`,
    maxLength: spec.max,
    autoComplete: spec.autoComplete,
    required: spec.required,
    value,
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': spec.hint ? `${id}-hint` : undefined,
  };
  return (
    <GgSheet open className="gg-acct-sheet" title={a.edit(spec.label)} onClose={onClose} onSubmit={save} footer={<SheetButtons busy={busy} onCancel={onClose} />}>
      <div className="pt-form gg-acct-form">
        <label htmlFor={id}>{spec.label}</label>
        {spec.multiline ? (
          <textarea {...common} rows={3} onChange={(e) => setValue(e.target.value)} />
        ) : (
          <input {...common} type={spec.type ?? 'text'} inputMode={spec.type === 'email' ? 'email' : undefined} autoCapitalize={spec.type === 'email' ? 'none' : 'words'} onChange={(e) => setValue(e.target.value)} />
        )}
        {spec.hint ? (
          <div id={`${id}-hint`} className="pt-row-sub mt-1">
            {spec.hint}
          </div>
        ) : null}
        <FieldErr>{errors[field]}</FieldErr>
      </div>
    </GgSheet>
  );
}

/** The ID proof sheet: the type, then the number (shown masked; a new type needs the full number, idNumberForType). */
function IdSheet({ profile, onClose, onSaved }: { profile: GuestProfile; onClose: () => void; onSaved: () => void }) {
  const accountCopy = useCopy(accountCopyByLanguage);
  const a = accountCopy;
  const [type, setType] = useState<IdProofType>(profile.idProofType);
  const [number, setNumber] = useState(profile.idProofNumber);
  const [localErr, setLocalErr] = useState<string | undefined>();
  const { busy, errors, submit } = useSubmit(['idProofType', 'idProofNumber']);
  const saved = useSavedToast();
  const err = localErr ?? errors.idProofNumber;
  const save = () => {
    const problem = checkIdProof(type, number, profile);
    setLocalErr(problem);
    if (problem) return;
    void submit(
      () => guestApi.updateProfile(profileInput(profile, { idProofType: type, idProofNumber: type === 'none' ? '' : number.trim() })),
      (p) => {
        saved(p);
        onSaved();
        onClose();
      },
    );
  };
  return (
    <GgSheet open className="gg-acct-sheet" title={a.edit(a.idProof)} onClose={onClose} onSubmit={save} footer={<SheetButtons busy={busy} onCancel={onClose} />}>
      <div className="pt-form gg-acct-form">
        <label htmlFor="ga-idtype">{a.idType}</label>
        <select
          id="ga-idtype"
          className="pt-input form-select"
          value={type}
          onChange={(e) => {
            const next = e.target.value as IdProofType;
            setType(next);
            setNumber((n) => idNumberForType(next, n, profile));
            setLocalErr(undefined);
          }}
        >
          {idProofOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <FieldErr>{errors.idProofType}</FieldErr>
        {type !== 'none' ? (
          <div className="mt-3">
            <label htmlFor="ga-idno">{a.idNumber}</label>
            <input
              id="ga-idno"
              className={`pt-input${err ? ' is-invalid' : ''}`}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={50}
              value={number}
              aria-invalid={err ? true : undefined}
              aria-describedby="ga-idno-hint"
              onChange={(e) => {
                setNumber(e.target.value);
                setLocalErr(undefined);
              }}
            />
            <div id="ga-idno-hint" className="pt-row-sub mt-1">
              {a.idHint}
            </div>
            <FieldErr>{err}</FieldErr>
          </div>
        ) : null}
      </div>
    </GgSheet>
  );
}

/** The password sheet (the same rules on the device and on the server: validatePasswordChange). */
function PasswordSheet({ onClose }: { onClose: () => void }) {
  const guestCopy = useCopy(guestCopyByLanguage);
  const accountCopy = useCopy(accountCopyByLanguage);
  const a = accountCopy;
  const c = guestCopy.profile;
  const toast = useToast();
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const found = validatePasswordChange(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    const res = await guestApi.changePassword(form);
    setBusy(false);
    if (!res.ok) {
      setErrors(res.error.details?.fields ?? {});
      toast.show({ tone: 'error', text: dashErrorText[res.error.code] });
      return;
    }
    toast.show({ tone: 'success', text: c.passwordChanged });
    onClose();
  };
  const field = (k: 'current' | 'next' | 'confirm', label: string, auto: string, hint?: string) => (
    <div className="gg-acct-field">
      <label htmlFor={`ga-pw-${k}`}>{label}</label>
      <input
        id={`ga-pw-${k}`}
        type="password"
        className={`pt-input${errors[k] ? ' is-invalid' : ''}`}
        autoComplete={auto}
        value={form[k]}
        aria-invalid={errors[k] ? true : undefined}
        onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
      />
      {hint ? <div className="pt-row-sub mt-1">{hint}</div> : null}
      <FieldErr>{errors[k]}</FieldErr>
    </div>
  );
  return (
    <GgSheet open className="gg-acct-sheet" title={a.password} onClose={onClose} onSubmit={() => void submit()} footer={<SheetButtons busy={busy} onCancel={onClose} label={c.changePassword} />}>
      <div className="pt-form gg-acct-form">
        {field('current', c.current, 'current-password')}
        {field('next', c.next, 'new-password', c.passwordHint)}
        {field('confirm', c.confirm, 'new-password')}
      </div>
    </GgSheet>
  );
}

/**
 * Sign-in and security: Change password (a sheet), the emailed sign-in code as a switch (on saves at once; off asks for the current password in a sheet,
 * decision 46) and the recent sign-ins, folded until opened.
 */
function Security({ profile, open, codeSheetOpen, onCodeSheetClose }: { profile: GuestProfile; open: (s: SheetId) => void; codeSheetOpen: boolean; onCodeSheetClose: () => void }) {
  const accountCopy = useCopy(accountCopyByLanguage);
  const a = accountCopy;
  const toast = useToast();
  const [on, setOn] = useState(profile.signInCodeOn ?? false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [showSignIns, setShowSignIns] = useState(false);
  const signInsId = useId();

  const change = async (enabled: boolean, pw?: string) => {
    setBusy(true);
    setError(undefined);
    const res = await guestPortalApi.setSignInCode(enabled, pw);
    setBusy(false);
    if (!res.ok) {
      const fieldErr = res.error.details?.fields?.password;
      if (enabled || !fieldErr) toast.show({ tone: 'error', text: fieldErr ?? dashErrorText[res.error.code] });
      if (!enabled) setError(fieldErr ?? dashErrorText[res.error.code]);
      return;
    }
    setOn(res.data.signInCodeOn);
    setPassword('');
    onCodeSheetClose();
    toast.show({ tone: 'success', text: res.data.signInCodeOn ? a.signInCodeOn : a.signInCodeOff });
  };
  const closeCode = () => {
    setPassword('');
    setError(undefined);
    onCodeSheetClose();
  };

  return (
    <section className="gg-card gp-acct-card" aria-labelledby="ga-sec">
      <h2 id="ga-sec" className="gp-sec-h">
        {a.securityTitle}
      </h2>
      <div>
        <div className="gg-list">
          <GgRow icon="key" title={a.password} sub={a.passwordSub} onPress={() => open('password')} />
          <GgRow
            icon={on ? 'shield-check' : 'shield'}
            title={<label htmlFor="ga-code">{a.signInCode}</label>}
            sub={a.signInCodeSub(on)}
            right={
              <span className="form-check form-switch gg-switch">
                <input
                  id="ga-code"
                  className="form-check-input"
                  type="checkbox"
                  role="switch"
                  checked={on}
                  disabled={busy}
                  onChange={(e) => (e.target.checked ? void change(true) : open('codeOff'))}
                />
              </span>
            }
            className="gg-switchrow"
          />
          <GgRow
            icon="clock-history"
            title={a.signIns}
            sub={a.signInsSub(formatDateTime(profile.lastSignInAt))}
            onPress={() => setShowSignIns((s) => !s)}
            expanded={showSignIns}
            controls={signInsId}
            className="gg-foldrow"
          />
          <div id={signInsId} className="gg-signins" hidden={!showSignIns}>
            {showSignIns ? <SignIns /> : null}
          </div>
        </div>
      </div>

      <GgSheet
        className="gg-acct-sheet"
        open={codeSheetOpen}
        title={a.signInCodeOffTitle}
        onClose={closeCode}
        onSubmit={() => void change(false, password)}
        footer={
          <>
            <PortalButton variant="line" onClick={closeCode} disabled={busy}>
              {a.keepOn}
            </PortalButton>
            <PortalButton type="submit" icon="shield-x" busy={busy}>
              {a.turnOff}
            </PortalButton>
          </>
        }
      >
        <div className="pt-form gg-acct-form">
          <p className="gg-acct-sheet-lead">{a.signInCodeOffBody}</p>
          <label htmlFor="ga-code-pw">{a.currentPassword}</label>
          <input
            id="ga-code-pw"
            type="password"
            className={`pt-input${error ? ' is-invalid' : ''}`}
            autoComplete="current-password"
            required
            value={password}
            aria-invalid={error ? true : undefined}
            onChange={(e) => setPassword(e.target.value)}
          />
          <FieldErr>{error}</FieldErr>
        </div>
      </GgSheet>
    </section>
  );
}

/** The guest's own sign-ins, newest first: device, time and status (failed attempts in red); never the IP address. Ten a page with Previous / Next. */
function SignIns() {
  const accountCopy = useCopy(accountCopyByLanguage);
  const a = accountCopy;
  const [page, setPage] = useState(1);
  const list = useAsync(() => guestAccountApi.signIns({ page, pageSize: 10 }), [page]);
  return (
    <PtLoad state={list.state} onRetry={list.reload} skeleton={<GgSkeleton variant="rows" />}>
      {(d) =>
        d.items.length === 0 ? (
          <p className="gg-acct-note">{a.signInsEmpty}</p>
        ) : (
          <>
            <p className="gg-signins-totals">{a.signInsTotals(d.totals.success, d.totals.failed)}</p>
            <ul className="gg-signins-list">
              {d.items.map((s) => (
                <li key={s.id}>
                  <GgRow
                    icon={!s.ok ? 'shield-exclamation' : /android|iphone|ipad|mobile/i.test(s.device) ? 'phone' : 'laptop'}
                    title={s.device}
                    sub={`${formatDateTime(s.at)} · ${signInStatus(s)}`}
                    tone={s.ok ? undefined : 'bad'}
                    right={s.ok ? (s.ended ? undefined : <GgChip tone="ok">{tr("Active")}</GgChip>) : <GgChip tone="bad">{tr("Failed")}</GgChip>}
                  />
                </li>
              ))}
            </ul>
            <PtPager page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
          </>
        )
      }
    </PtLoad>
  );
}
