'use client';

// A3 public onboarding page (docs/plans/PLAN-PLATFORM-CONSOLE.md, MJ's model 3; RESEARCH-PLATFORM-CONSOLE MUST 2 and SHOULD
// "onboarding form"). Reached from the invitation link `/?invite=<token>`, no sign-in. It lives OUTSIDE the dashboard, so it is drawn
// in the sign-in world's look (docs/UI.md section 1: Tailwind roles, the graphite auth page, `.hms-auth-card`), not with Pallav's
// dashboard CSS. The sign-in AuthShell / AuthCard need the sign-in flow's context, so the same page, brand row and card are built here
// from the same classes and kit pieces (TextField, PasswordField, Note, Aside, StepPill, StatusIcon, PrimaryButton).
// States: loading; link problems (not found, expired, already used, revoked: each with "Ask your admin for a new link"); the form
// (hotel or group variant, 3 steps: details, your admin account, review); sent = "Waiting for approval".
// Mount: see readInviteToken below. Works on the mock or the real server (platformApi): a password is checked, never kept or shown again.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { copy as authCopy, fill } from '@shared/auth/copy';
import { formatDateTime } from '@shared/dashboards/format';
import {
  PLATFORM_STATES,
  blankGroupOnboarding,
  blankOnboarding,
  gstCodeOfState,
  gstinShapeOk,
  passwordChecks,
  passwordProblem,
  platformCopy,
  stateOfGstin,
  type PlatformInviteProblem,
  type PlatformOnboardingAdminInput,
  type PlatformOnboardingForm,
  type PlatformOnboardingGroupInput,
  type PlatformOnboardingHotelInput,
  type PlatformOnboardingResult,
  type PlatformPublicInvitation,
} from '@shared/dashboards/platform';
import { AuthBanner } from '@/components/auth/AuthBanner';
import { Aside, Icon, LinkButton, Note, OfflineNote, PasswordField, PrimaryButton, SecondaryButton, Spinner, StatusIcon, StepPill, TextField, useAsync, useOnline } from '@/components/ui';
import { platformApi } from './api';

import { tr } from '@/lib/i18n/language';
const O = platformCopy.onboarding;
const G = platformCopy.onboarding.group;
const M = platformCopy.onboardingMore;
const E = platformCopy.errors;

/** The words of the form for a hotel its group invited. True in both cases: the answer of the form says whether it is ready at once (active) or waits for the platform. */
const GROUP_INVITED = { submit: 'Create my hotel', note: 'Your group invited you; the platform confirms your hotel after you send this.' } as const;

const PIN_RE = /^[1-9]\d{5}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const LOGO_RE = /\.(png|jpe?g|svg|webp)$/i;

/**
 * The invitation token of this page load (`?invite=` in the address), or null. Read in the browser only (null on the server).
 * Mount (owned by the app shell, Frontend 1): when this returns a token, render `<PlatformOnboarding token={token} />` in place of the
 * sign-in app (client only, so the server and the first browser render agree).
 */
export function readInviteToken(): string | null {
  if (typeof window === 'undefined') return null;
  const t = new URLSearchParams(window.location.search).get('invite');
  return t && t.trim() ? t.trim() : null;
}

type Problem = PlatformInviteProblem;
const PROBLEM_TEXT: Record<Problem, { title: string; body: string }> = {
  NOT_FOUND: O.notFound,
  EXPIRED: O.expired,
  ALREADY_SUBMITTED: O.used,
  CANCELLED: O.cancelled,
};
const PROBLEMS: readonly string[] = ['NOT_FOUND', 'EXPIRED', 'ALREADY_SUBMITTED', 'CANCELLED'];

/** The link problem in a refusal (details.serverCode, or a plain NOT_FOUND), else null (a network or server failure). */
function problemOf(error: { code: string; details?: { serverCode?: string } }): Problem | null {
  const s = error.details?.serverCode;
  if (s && PROBLEMS.includes(s)) return s as Problem;
  return error.code === 'NOT_FOUND' ? 'NOT_FOUND' : null;
}

// ==================================================================== page frame (the sign-in page's look)

/** `failed`: the link does not work (or the server failed): the banner keeps the neutral sign-in words, not "Welcome aboard". */
function Frame({ wide = false, failed = false, children, onDevClose }: { wide?: boolean; failed?: boolean; children: ReactNode; onDevClose?: () => void }) {
  const [year] = useState(() => new Date().getFullYear());
  return (
    // The sign-in pages' frame (MJ 2026-10-18): the brand banner on the left (a header on phones) carries the logo and name, the form sits in the graphite page.
    <div className="hms-glass hms-auth-layout relative isolate">
      <div aria-hidden="true" className="hms-auth-page pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <span className="hms-ring hms-ring-1" />
        <span className="hms-ring hms-ring-2" />
      </div>
      {failed ? <AuthBanner page="signIn" pills={false} /> : <AuthBanner page="welcome" />}
      <div className="hms-auth-main px-[16px] py-10 min-[481px]:items-center max-[480px]:py-7">
      <main className={`hms-rise w-full ${wide ? 'max-w-[680px]' : 'max-w-[var(--hms-auth-card-max)]'}`}>
        {/* hms-ob-*: ui-kit.css restates these sizes and gaps, so the form looks the same over the console (Bootstrap loaded). */}
        {children}
        <p className="hms-ob-foot mt-[22px] text-center text-[12px] text-copyright">{fill(authCopy.brand.copyright, { year })}</p>
        {onDevClose ? (
          <p className="hms-ob-dev mt-2 text-center">
            <button /* check-shared-ignore: a dev-only link on the brand panel */ type="button" className="text-[12.5px] font-semibold text-on-brand underline" onClick={onDevClose}>
              {M.closeDev}
            </button>
          </p>
        ) : null}
      </main>
      </div>
    </div>
  );
}

/** Pill, status icon, title and lead line (the sign-in StepHeader without the sign-in context). Sets the tab title. */
function Head({ title, lead, pill, icon, focus = false }: { title: string; lead?: ReactNode; pill?: string; icon?: Parameters<typeof StatusIcon>[0]['name']; focus?: boolean }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = `${title} · ${authCopy.brand.name}`;
    if (focus) ref.current?.focus({ preventScroll: true });
  }, [title, focus]);
  return (
    <div className="hms-ob-head mb-[22px]">
      {pill ? <StepPill>{pill}</StepPill> : null}
      {icon ? <StatusIcon name={icon} /> : null}
      <h1
        ref={ref}
        tabIndex={-1}
        className="hms-focus-target hms-ob-title text-[length:var(--hms-auth-title)] leading-[1.2] font-extrabold tracking-[-0.03em] text-balance break-words text-ink outline-hidden max-[480px]:text-[length:var(--hms-auth-title-phone)]"
      >
        {title}
      </h1>
      {lead ? <div className="mt-1.5 text-[13.5px] leading-[1.55] text-pretty break-words text-ink-muted">{lead}</div> : null}
    </div>
  );
}

// ==================================================================== the page

export function PlatformOnboarding({ token, onDevClose }: { token: string; /** Dev only: shown inside the console ("Open form here"). */ onDevClose?: () => void }) {
  const online = useOnline();
  const { state, reload } = useAsync(() => platformApi.getInvitationByToken(token), [token]);
  /** A refusal found later, on submit (the link expired or was revoked while the form was open). */
  const [lateProblem, setLateProblem] = useState<Problem | null>(null);
  const [done, setDone] = useState<PlatformOnboardingResult | null>(null);

  if (done) {
    const isGroup = done.kind === 'group';
    const name = isGroup ? (done.group?.name ?? '') : (done.hotel?.name ?? '');
    // A hotel invited by its group is approved at once: the answer says active, so show it as ready (not "waiting for approval").
    if (!isGroup && done.hotel?.status === 'active') {
      return (
        <Frame onDevClose={onDevClose}>
          <section className="hms-auth-card" aria-label={O.readyTitle}>
            {/* "Your hotel is ready." as the title, "Sign in with the username and password you chose." as its line, then the way in */}
            <Head
              title={`${O.readyTitle.split('. ')[0]}.`}
              icon="check_circle"
              focus
              lead={[O.readyTitle.split('. ').slice(1).join('. '), done.hotel.groupName ? O.joiningGroup(done.hotel.groupName) : ''].filter(Boolean).join(' ')}
            />
            <PrimaryButton type="button" arrow onPress={() => window.location.assign(new URL('/login', window.location.href).toString())}>
              {tr("Go to sign in")}
            </PrimaryButton>
          </section>
        </Frame>
      );
    }
    return (
      <Frame onDevClose={onDevClose}>
        <section className="hms-auth-card" aria-label={O.waitingTitle}>
          {/* No separate "We will email you" note: the lead line already says it (it read twice). */}
          <Head title={O.waitingTitle} pill={M.waitingPill} icon="schedule" focus lead={isGroup ? G.waitingBody(name) : O.waitingBody(name)} />
          <Aside icon="info">
            {O.approvalByNote}
            {isGroup ? ` ${G.nextNote}` : ` ${O.onlyAdminNote}`}
          </Aside>
        </section>
      </Frame>
    );
  }

  if (state.status === 'loading') {
    return (
      <Frame onDevClose={onDevClose}>
        <section className="hms-auth-card" aria-busy="true" aria-label={O.loading}>
          <div className="flex items-center gap-3 py-6 text-[14px] text-ink-muted" role="status">
            <Spinner />
            <span>{O.loading}</span>
          </div>
        </section>
      </Frame>
    );
  }

  const problem = lateProblem ?? (state.status === 'error' ? problemOf(state.error) : null);
  if (problem) {
    const p = PROBLEM_TEXT[problem];
    return (
      <Frame failed onDevClose={onDevClose}>
        <section className="hms-auth-card" aria-label={p.title}>
          <Head title={p.title} pill={M.linkProblemPill} icon={problem === 'ALREADY_SUBMITTED' ? 'check_circle' : 'link_off'} focus lead={p.body} />
          <Aside icon="info">{M.askAdmin}</Aside>
        </section>
      </Frame>
    );
  }

  if (state.status === 'error') {
    return (
      <Frame failed onDevClose={onDevClose}>
        <section className="hms-auth-card" aria-label={O.title}>
          {!online ? <OfflineNote /> : null}
          <Head title={O.title} icon="wifi_off" />
          <Note tone="danger" className="mb-4">
            {state.error.code === 'RATE_LIMITED' ? M.rateLimited : M.loadFailed}
          </Note>
          <PrimaryButton onPress={reload}>{M.tryAgain}</PrimaryButton>
        </section>
      </Frame>
    );
  }

  return (
    <Frame wide onDevClose={onDevClose}>
      <OnboardingForm token={token} inv={state.data} online={online} onDone={setDone} onProblem={setLateProblem} />
    </Frame>
  );
}

// ==================================================================== the form

type Errors = Record<string, string>;

function seedForm(inv: PlatformPublicInvitation): PlatformOnboardingForm {
  const admin = { name: inv.invitation.contactName, email: inv.invitation.email };
  if (inv.type === 'group') {
    const f = blankGroupOnboarding();
    return { ...f, group: { ...f.group, name: inv.invitation.hotelName }, admin: { ...f.admin, ...admin } };
  }
  const f = blankOnboarding();
  return { ...f, hotel: { ...f.hotel, name: inv.invitation.hotelName, legalName: '', tradeName: '', gstType: '', roomCount: null, checkInTime: '', checkOutTime: '' }, admin: { ...f.admin, ...admin } };
}

const draftKey = (token: string) => `hms.onboarding.draft.${token.slice(0, 64)}`;

/** The draft kept in this browser: everything typed except the password, the same kind of form as the invitation. */
function readDraft(token: string, seed: PlatformOnboardingForm): PlatformOnboardingForm | null {
  try {
    const raw = window.localStorage.getItem(draftKey(token));
    if (!raw) return null;
    const d = JSON.parse(raw) as PlatformOnboardingForm;
    if (!d || d.kind !== seed.kind) return null;
    return { ...seed, ...d, admin: { ...seed.admin, ...d.admin, password: '', passwordConfirm: '' } } as PlatformOnboardingForm;
  } catch {
    return null;
  }
}

function keepDraft(token: string, form: PlatformOnboardingForm) {
  try {
    const { password: _p, passwordConfirm: _c, ...admin } = form.admin;
    void _p;
    void _c;
    window.localStorage.setItem(draftKey(token), JSON.stringify({ ...form, admin }));
  } catch {
    /* storage blocked: the form simply is not kept */
  }
}

function dropDraft(token: string) {
  try {
    window.localStorage.removeItem(draftKey(token));
  } catch {
    /* nothing kept */
  }
}

/** The step a field key belongs to: "hotel.*" / "group.*" = 0, "admin.*" = 1. */
const stepOfKey = (k: string) => (k.startsWith('admin.') ? 1 : 0);

function gstinError(gstin: string, state: string): string | null {
  const g = gstin.trim().toUpperCase();
  if (!g) return E.required.gstin;
  if (!gstinShapeOk(g)) return E.gstinFormat;
  const code = state ? gstCodeOfState(state) : null;
  if (code && g.slice(0, 2) !== code) return E.gstinState(code, state);
  return null;
}

function checkHotel(h: PlatformOnboardingHotelInput): Errors {
  const f: Errors = {};
  if (!h.name.trim()) f['hotel.name'] = E.required.hotelName;
  if (!h.address.trim()) f['hotel.address'] = E.required.address;
  if (!h.city.trim()) f['hotel.city'] = E.required.city;
  if (!h.state.trim()) f['hotel.state'] = E.required.state;
  if (!h.pin.trim()) f['hotel.pin'] = E.required.pin;
  else if (!PIN_RE.test(h.pin.trim())) f['hotel.pin'] = E.pinFormat;
  const g = gstinError(h.gstin, h.state);
  if (g) f['hotel.gstin'] = g;
  if (!h.phone.trim()) f['hotel.phone'] = E.required.phone;
  if (!h.email.trim()) f['hotel.email'] = E.required.hotelEmail;
  else if (!EMAIL_RE.test(h.email.trim())) f['hotel.email'] = E.emailFormat;
  if (h.logoName && !LOGO_RE.test(h.logoName)) f['hotel.logoName'] = E.logoType;
  return f;
}

function checkGroup(g: PlatformOnboardingGroupInput): Errors {
  const f: Errors = {};
  if (!g.name.trim()) f['group.name'] = E.required.groupName;
  if (!g.legalName.trim()) f['group.legalName'] = E.legalNameRequired;
  const ge = gstinError(g.gstin, g.state ?? '');
  if (ge) f['group.gstin'] = ge;
  if (!g.address.trim()) f['group.address'] = E.required.address;
  if (!g.phone.trim()) f['group.phone'] = E.required.phone;
  if (!g.email.trim()) f['group.email'] = E.required.email;
  else if (!EMAIL_RE.test(g.email.trim())) f['group.email'] = E.emailFormat;
  return f;
}

function checkAdmin(a: PlatformOnboardingAdminInput): Errors {
  const f: Errors = {};
  if (!a.name.trim()) f['admin.name'] = E.required.adminName;
  if (!a.username.trim()) f['admin.username'] = E.required.username;
  if (!a.email.trim()) f['admin.email'] = E.required.email;
  else if (!EMAIL_RE.test(a.email.trim())) f['admin.email'] = E.emailFormat;
  if (!a.mobile.trim()) f['admin.mobile'] = E.required.mobile;
  const pw = passwordProblem(a.password);
  if (pw) f['admin.password'] = pw;
  if (!a.passwordConfirm) f['admin.passwordConfirm'] = E.required.passwordConfirm;
  else if (a.passwordConfirm !== a.password) f['admin.passwordConfirm'] = E.passwordMismatch;
  return f;
}

function OnboardingForm({
  token,
  inv,
  online,
  onDone,
  onProblem,
}: {
  token: string;
  inv: PlatformPublicInvitation;
  online: boolean;
  onDone: (r: PlatformOnboardingResult) => void;
  onProblem: (p: Problem) => void;
}) {
  const [restored] = useState(() => (typeof window === 'undefined' ? null : readDraft(token, seedForm(inv))));
  const [form, setForm] = useState<PlatformOnboardingForm>(() => restored ?? seedForm(inv));
  useEffect(() => {
    const id = window.setTimeout(() => keepDraft(token, form), 400);
    return () => window.clearTimeout(id);
  }, [token, form]);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const [note, setNote] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  /** The state was filled in from the GSTIN (and follows it until chosen by hand). */
  const [stateAuto, setStateAuto] = useState(false);

  const isGroup = form.kind === 'group';
  const steps = isGroup ? G.steps : O.steps;

  const clear = (k: string) => {
    if (errors[k]) setErrors((p) => Object.fromEntries(Object.entries(p).filter(([x]) => x !== k)));
  };
  const setHotel = <K extends keyof PlatformOnboardingHotelInput>(k: K, v: PlatformOnboardingHotelInput[K]) => {
    clear(`hotel.${k}`);
    setForm((p) => (p.kind === 'hotel' ? { ...p, hotel: { ...p.hotel, [k]: v } } : p));
  };
  const setGroup = <K extends keyof PlatformOnboardingGroupInput>(k: K, v: PlatformOnboardingGroupInput[K]) => {
    clear(`group.${k}`);
    setForm((p) => (p.kind === 'group' ? { ...p, group: { ...p.group, [k]: v } } : p));
  };
  const setAdmin = <K extends keyof PlatformOnboardingAdminInput>(k: K, v: PlatformOnboardingAdminInput[K]) => {
    clear(`admin.${k}`);
    setForm((p) => ({ ...p, admin: { ...p.admin, [k]: v } }) as PlatformOnboardingForm);
  };

  /** GSTIN typed: the state follows its first two digits (unless the state was chosen by hand). */
  const typeGstin = (raw: string) => {
    const g = raw.toUpperCase().replace(/\s+/g, '').slice(0, 15);
    const st = stateOfGstin(g);
    if (form.kind === 'hotel') {
      setHotel('gstin', g);
      if (st && (stateAuto || !form.hotel.state)) {
        clear('hotel.state');
        setForm((p) => (p.kind === 'hotel' ? { ...p, hotel: { ...p.hotel, gstin: g, state: st } } : p));
        setStateAuto(true);
      }
    } else {
      // The group form has no state field: the state always comes from the GSTIN (the server checks they match).
      setForm((p) => (p.kind === 'group' ? { ...p, group: { ...p.group, gstin: g, state: st ?? '' } } : p));
      clear('group.gstin');
    }
  };

  const stepErrors = (n: number): Errors => (n === 0 ? (form.kind === 'hotel' ? checkHotel(form.hotel) : checkGroup(form.group)) : n === 1 ? checkAdmin(form.admin) : {});

  const next = () => {
    const f = stepErrors(step);
    setErrors(f);
    setTried(true);
    if (Object.keys(f).length) {
      setNote(M.fixErrors);
      focusFirstError(f);
      return;
    }
    setNote(null);
    setTried(false);
    setStep((s) => Math.min(s + 1, 2));
  };

  const submit = async () => {
    if (busy) return;
    const local = { ...stepErrors(0), ...stepErrors(1) };
    if (Object.keys(local).length) {
      setErrors(local);
      setNote(M.fixErrors);
      setStep(Math.min(...Object.keys(local).map(stepOfKey)));
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const res = await platformApi.submitOnboarding(token, form);
      if (res.ok) {
        dropDraft(token);
        onDone(res.data);
        return;
      }
      const p = problemOf(res.error);
      if (p) {
        onProblem(p);
        return;
      }
      const fields = res.error.details?.fields;
      if (res.error.code === 'VALIDATION_FAILED' && fields) {
        setErrors(fields);
        setNote(M.fixErrors);
        const keys = Object.keys(fields);
        if (keys.length) setStep(Math.min(...keys.map(stepOfKey)));
        return;
      }
      if (res.error.code === 'NETWORK_OFFLINE') setNote(O.offline);
      else if (res.error.code === 'RATE_LIMITED') setNote(M.rateLimited);
      else if (res.error.code === 'CONFLICT' && res.error.message && res.error.message !== 'CONFLICT') setNote(res.error.message);
      else setNote(M.submitFailed);
    } finally {
      setBusy(false);
    }
  };

  // A hotel invited by its group is approved at once, so the form must not promise an approval.
  const invitedByGroup = !isGroup && !!inv.invitation.groupName;
  const lead =
    step === 0 ? (
      <>
        {isGroup ? G.welcome(inv.invitation.contactName, inv.invitation.hotelName) : O.welcome(inv.invitation.contactName, inv.invitation.hotelName)}
        {inv.invitation.groupName ? ` ${O.joiningGroup(inv.invitation.groupName)}` : ''} {O.linkValidUntil(formatDateTime(inv.expiresAt))}
      </>
    ) : step === 1 ? (
      O.onlyAdminNote
    ) : (
      M.reviewLead
    );

  return (
    <form
      noValidate
      aria-label={isGroup ? G.title : O.title}
      aria-busy={busy || undefined}
      className="hms-auth-card"
      onSubmit={(e) => {
        e.preventDefault();
        if (step < 2) next();
        else void submit();
      }}
    >
      {!online ? <OfflineNote /> : null}
      <Head title={step === 2 ? M.reviewTitle : isGroup ? G.title : O.title} pill={M.stepPill(step + 1, steps.length, steps[step] ?? '')} lead={lead} />
      {note ? (
        <Note tone="danger" className="mb-4">
          {note}
        </Note>
      ) : restored && step === 0 ? (
        <Note tone="info" className="mb-4">{O.draftBack}</Note>
      ) : null}

      {step === 0 && form.kind === 'hotel' ? <HotelStep h={form.hotel} errors={errors} set={setHotel} typeGstin={typeGstin} stateAuto={stateAuto} chooseState={(s) => {
        setStateAuto(false);
        setHotel('state', s);
      }} busy={busy} /> : null}
      {step === 0 && form.kind === 'group' ? <GroupStep g={form.group} errors={errors} set={setGroup} typeGstin={typeGstin} busy={busy} /> : null}
      {step === 1 ? <AdminStep a={form.admin} errors={errors} set={setAdmin} busy={busy} showRuleErrors={tried} /> : null}
      {step === 2 ? <Review form={form} onEdit={(n) => setStep(n)} busy={busy} /> : null}

      <div className={`mt-6 grid gap-[12px] ${step > 0 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {step > 0 ? (
          <SecondaryButton disabled={busy} onPress={() => {
            setNote(null);
            setStep((s) => Math.max(s - 1, 0));
          }}>
            {O.back}
          </SecondaryButton>
        ) : null}
        {step < 2 ? (
          <PrimaryButton key="next" type="submit" arrow>
            {O.next}
          </PrimaryButton>
        ) : (
          <PrimaryButton key="send" type="submit" busy={busy} busyLabel={O.submitting} disabled={!online}>
            {isGroup ? G.submit : invitedByGroup ? GROUP_INVITED.submit : O.submit}
          </PrimaryButton>
        )}
      </div>
      <p className="hms-ob-note text-center text-[12px] leading-[1.5] text-ink-muted">{invitedByGroup ? GROUP_INVITED.note : O.approvalByNote}</p>
      <p className="hms-ob-note text-center text-[12px] leading-[1.5] text-ink-muted">{O.draftKept}</p>
    </form>
  );
}

function focusFirstError(f: Errors) {
  const first = Object.keys(f)[0];
  if (!first) return;
  requestAnimationFrame(() => document.getElementById(fid(first))?.focus());
}

/** Field id from its error key ("hotel.name" -> "ob-hotel-name"), so a refused field can be focused. */
const fid = (k: string) => `ob-${k.replace('.', '-')}`;

// -------------------------------------------------------------------- small pieces in the sign-in look

const FIELD = 'hms-field block w-full rounded-field border border-input bg-inset text-ink h-[42px] text-[14px] leading-5 max-[480px]:text-[16px] px-3.5';
const LABEL = 'mb-1.5 block text-[13px] font-semibold leading-[18px] tracking-[-0.004em] text-ink-2';

function ErrorLine({ id, text }: { id: string; text?: string }) {
  if (!text) return null;
  return (
    <p id={id} className="flex items-start gap-1.5 pt-1.5 text-[12.5px] leading-[18px] text-note-error-fg">
      <Icon name="error" size={14} className="mt-0.5 shrink-0" />
      <span>{text}</span>
    </p>
  );
}

function SelectField({ id, label, value, onChange, error, hint, disabled, children }: { id: string; label: string; value: string; onChange: (v: string) => void; error?: string; hint?: string; disabled?: boolean; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <select
        id={id}
        className={FIELD}
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
      {hint && !error ? (
        <p id={`${id}-hint`} className="pt-1.5 text-[12px] leading-4 text-ink-muted">
          {hint}
        </p>
      ) : null}
      <ErrorLine id={`${id}-err`} text={error} />
    </div>
  );
}

const TWO = 'grid grid-cols-1 gap-4 min-[560px]:grid-cols-2';
const WIDE = 'min-[560px]:col-span-2';

function HotelStep({
  h,
  errors,
  set,
  typeGstin,
  stateAuto,
  chooseState,
  busy,
}: {
  h: PlatformOnboardingHotelInput;
  errors: Errors;
  set: <K extends keyof PlatformOnboardingHotelInput>(k: K, v: PlatformOnboardingHotelInput[K]) => void;
  typeGstin: (v: string) => void;
  stateAuto: boolean;
  chooseState: (s: string) => void;
  busy: boolean;
}) {
  const F = O.fields;
  const MF = M.fields;
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <div className={TWO}>
        <TextField className={WIDE} id={fid('hotel.name')} label={F.name} maxLength={100} autoComplete="organization" value={h.name} onChange={(e) => set('name', e.target.value)} error={errors['hotel.name']} readOnly={busy} />
        <TextField className={WIDE} id={fid('hotel.address')} label={F.address} maxLength={250} autoComplete="street-address" value={h.address} onChange={(e) => set('address', e.target.value)} error={errors['hotel.address']} readOnly={busy} />
        <TextField id={fid('hotel.gstin')} label={F.gstin} hint={O.hints.gstin} maxLength={15} autoComplete="off" spellCheck={false} inputClassName="uppercase" value={h.gstin} onChange={(e) => typeGstin(e.target.value)} error={errors['hotel.gstin']} readOnly={busy} />
        <SelectField id={fid('hotel.state')} label={F.state} value={h.state} onChange={chooseState} error={errors['hotel.state']} hint={stateAuto && h.state ? M.stateFromGstin(h.state) : undefined} disabled={busy}>
          <option value="">{O.chooseState}</option>
          {PLATFORM_STATES.map((s) => (
            <option key={s.gstCode} value={s.name}>
              {s.name}
            </option>
          ))}
        </SelectField>
        <TextField id={fid('hotel.city')} label={F.city} maxLength={100} autoComplete="address-level2" value={h.city} onChange={(e) => set('city', e.target.value)} error={errors['hotel.city']} readOnly={busy} />
        <TextField id={fid('hotel.pin')} label={F.pin} hint={O.hints.pin} maxLength={6} inputMode="numeric" autoComplete="postal-code" value={h.pin} onChange={(e) => set('pin', e.target.value.replace(/\D+/g, ''))} error={errors['hotel.pin']} readOnly={busy} />
        <TextField id={fid('hotel.phone')} label={F.phone} hint={O.hints.phone} type="tel" maxLength={20} inputMode="tel" autoComplete="tel" value={h.phone} onChange={(e) => set('phone', e.target.value)} error={errors['hotel.phone']} readOnly={busy} />
        <TextField id={fid('hotel.email')} label={F.email} type="email" maxLength={254} inputMode="email" autoComplete="email" spellCheck={false} value={h.email} onChange={(e) => set('email', e.target.value.trim())} error={errors['hotel.email']} readOnly={busy} />
        <div className={WIDE}>
          <label htmlFor={fid('hotel.logoName')} className={LABEL}>
            {F.logo}
          </label>
          <p className="pb-1.5 text-[12px] leading-4 text-ink-muted">{O.hints.logo}</p>
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              id={fid('hotel.logoName')}
              type="file"
              accept=".png,.jpg,.jpeg,.svg,.webp,image/png,image/jpeg,image/svg+xml,image/webp"
              disabled={busy}
              aria-invalid={errors['hotel.logoName'] ? true : undefined}
              className="block max-w-full text-[13px] text-ink-2 file:mr-3 file:h-[38px] file:cursor-pointer file:rounded-field file:border file:border-input file:bg-inset file:px-3 file:font-semibold file:text-ink"
              onChange={(e) => set('logoName', e.target.files?.[0]?.name ?? null)}
            />
            {h.logoName ? (
              <LinkButton
                disabled={busy}
                onClick={() => {
                  if (fileRef.current) fileRef.current.value = '';
                  set('logoName', null);
                }}
              >
                {O.removeLogo}
              </LinkButton>
            ) : null}
          </div>
          <ErrorLine id={`${fid('hotel.logoName')}-err`} text={errors['hotel.logoName']} />
        </div>
      </div>

      <details className="mt-5 rounded-field border border-hairline px-3.5 py-2.5">
        <summary className="cursor-pointer text-[13.5px] font-semibold text-ink-2">{M.more}</summary>
        <p className="mt-1 text-[12px] leading-4 text-ink-muted">{M.moreHint}</p>
        <div className={`${TWO} mt-4 pb-1`}>
          <TextField id="ob-hotel-legalName" label={MF.legalName} maxLength={150} autoComplete="off" value={h.legalName ?? ''} onChange={(e) => set('legalName', e.target.value)} readOnly={busy} />
          <TextField id="ob-hotel-tradeName" label={MF.tradeName} maxLength={150} autoComplete="off" value={h.tradeName ?? ''} onChange={(e) => set('tradeName', e.target.value)} readOnly={busy} />
          <SelectField id="ob-hotel-gstType" label={MF.gstType} value={h.gstType ?? ''} onChange={(v) => set('gstType', v === 'regular' || v === 'composition' ? v : '')} disabled={busy}>
            {(['', 'regular', 'composition'] as const).map((k) => (
              <option key={k} value={k}>
                {M.gstTypes[k]}
              </option>
            ))}
          </SelectField>
          <TextField
            id="ob-hotel-roomCount"
            label={MF.roomCount}
            inputMode="numeric"
            maxLength={4}
            autoComplete="off"
            value={h.roomCount ? String(h.roomCount) : ''}
            onChange={(e) => {
              const n = parseInt(e.target.value.replace(/\D+/g, ''), 10);
              set('roomCount', Number.isFinite(n) && n > 0 ? n : null);
            }}
            readOnly={busy}
          />
          <TextField id="ob-hotel-checkInTime" label={MF.checkInTime} type="time" value={h.checkInTime ?? ''} onChange={(e) => set('checkInTime', e.target.value)} readOnly={busy} />
          <TextField id="ob-hotel-checkOutTime" label={MF.checkOutTime} type="time" value={h.checkOutTime ?? ''} onChange={(e) => set('checkOutTime', e.target.value)} readOnly={busy} />
        </div>
      </details>
    </>
  );
}

function GroupStep({
  g,
  errors,
  set,
  typeGstin,
  busy,
}: {
  g: PlatformOnboardingGroupInput;
  errors: Errors;
  set: <K extends keyof PlatformOnboardingGroupInput>(k: K, v: PlatformOnboardingGroupInput[K]) => void;
  typeGstin: (v: string) => void;
  busy: boolean;
}) {
  const F = G.fields;
  return (
    <div className={TWO}>
      <TextField id={fid('group.name')} label={F.name} maxLength={100} autoComplete="organization" value={g.name} onChange={(e) => set('name', e.target.value)} error={errors['group.name']} readOnly={busy} />
      <TextField id={fid('group.legalName')} label={F.legalName} hint={G.hints.legalName} maxLength={150} autoComplete="off" value={g.legalName} onChange={(e) => set('legalName', e.target.value)} error={errors['group.legalName']} readOnly={busy} />
      <TextField
        id={fid('group.gstin')}
        label={F.gstin}
        hint={g.state ? M.stateFromGstin(g.state) : O.hints.gstin}
        maxLength={15}
        autoComplete="off"
        spellCheck={false}
        inputClassName="uppercase"
        value={g.gstin}
        onChange={(e) => typeGstin(e.target.value)}
        error={errors['group.gstin'] ?? errors['group.state']}
        readOnly={busy}
      />
      <TextField id={fid('group.phone')} label={F.phone} hint={O.hints.phone} type="tel" maxLength={20} inputMode="tel" autoComplete="tel" value={g.phone} onChange={(e) => set('phone', e.target.value)} error={errors['group.phone']} readOnly={busy} />
      <TextField className={WIDE} id={fid('group.address')} label={F.address} maxLength={250} autoComplete="street-address" value={g.address} onChange={(e) => set('address', e.target.value)} error={errors['group.address']} readOnly={busy} />
      <TextField className={WIDE} id={fid('group.email')} label={F.email} type="email" maxLength={254} inputMode="email" autoComplete="email" spellCheck={false} value={g.email} onChange={(e) => set('email', e.target.value.trim())} error={errors['group.email']} readOnly={busy} />
    </div>
  );
}

/** The onboarding password rule (passwordProblem = the server rule: 8 to 128 characters, upper, lower, number, special) and the match line, ticked as you type. */
function PwRuleList({ password, confirm, showErrors, id }: { password: string; confirm: string; showErrors: boolean; id: string }) {
  const checks = passwordChecks(password);
  const rules = [
    { key: 'length', ok: checks.length, text: M.pwRules.length },
    { key: 'upper', ok: checks.upper, text: M.pwRules.upper },
    { key: 'lower', ok: checks.lower, text: M.pwRules.lower },
    { key: 'number', ok: checks.number, text: M.pwRules.number },
    { key: 'special', ok: checks.special, text: M.pwRules.special },
  ];
  return (
    <ul id={id} className="mt-2.5 grid grid-cols-2 gap-x-3.5 gap-y-[5px] max-[400px]:grid-cols-1">
      {rules.map((r) => {
        const st = r.ok ? 'met' : showErrors ? 'bad' : 'unmet';
        return (
          <li key={r.key} className={`flex items-start gap-1.5 text-[12.5px] leading-[18px] ${st === 'met' ? 'text-rule-met' : st === 'bad' ? 'text-rule-bad' : 'text-rule-unmet'}`}>
            <Icon name={st === 'met' ? 'check_circle' : st === 'bad' ? 'error' : 'radio_button_unchecked'} size={13} className="mt-[2.5px] shrink-0" />
            <span>
              {r.text}
              <span className="sr-only">: {r.ok ? M.ruleMet : M.ruleNotMet}</span>
            </span>
          </li>
        );
      })}
      {confirm ? (
        <li className={`flex items-start gap-1.5 text-[12.5px] leading-[18px] ${confirm === password ? 'text-rule-met' : 'text-rule-unmet'}`}>
          <Icon name={confirm === password ? 'check_circle' : 'radio_button_unchecked'} size={13} className="mt-[2.5px] shrink-0" />
          <span>
            {M.pwMatch}
            <span className="sr-only">: {confirm === password ? M.ruleMet : M.ruleNotMet}</span>
          </span>
        </li>
      ) : null}
    </ul>
  );
}

function AdminStep({
  a,
  errors,
  set,
  busy,
  showRuleErrors,
}: {
  a: PlatformOnboardingAdminInput;
  errors: Errors;
  set: <K extends keyof PlatformOnboardingAdminInput>(k: K, v: PlatformOnboardingAdminInput[K]) => void;
  busy: boolean;
  showRuleErrors: boolean;
}) {
  const F = O.fields;
  return (
    <div className={TWO}>
      <TextField id={fid('admin.name')} label={F.adminName} maxLength={100} autoComplete="name" leadingIcon="person" value={a.name} onChange={(e) => set('name', e.target.value)} error={errors['admin.name']} readOnly={busy} />
      <TextField id={fid('admin.username')} label={F.username} hint={O.hints.username} maxLength={30} autoComplete="username" spellCheck={false} value={a.username} onChange={(e) => set('username', e.target.value.toLowerCase().replace(/\s+/g, ''))} error={errors['admin.username']} readOnly={busy} />
      <TextField id={fid('admin.email')} label={F.adminEmail} type="email" maxLength={254} inputMode="email" autoComplete="email" leadingIcon="mail" spellCheck={false} value={a.email} onChange={(e) => set('email', e.target.value.trim())} error={errors['admin.email']} readOnly={busy} />
      <TextField id={fid('admin.mobile')} label={F.mobile} type="tel" maxLength={16} inputMode="tel" autoComplete="tel" value={a.mobile} onChange={(e) => set('mobile', e.target.value)} error={errors['admin.mobile']} readOnly={busy} />
      <PasswordField
        className={WIDE}
        id={fid('admin.password')}
        label={F.password}
        autoComplete="new-password"
        maxLength={72}
        capsLockHint
        value={a.password}
        onChange={(e) => set('password', e.target.value)}
        error={errors['admin.password']}
        readOnly={busy}
        aria-describedby="ob-pw-rules"
        below={<PwRuleList id="ob-pw-rules" password={a.password} confirm={a.passwordConfirm} showErrors={showRuleErrors} />}
      />
      <PasswordField
        className={WIDE}
        id={fid('admin.passwordConfirm')}
        label={F.passwordConfirm}
        autoComplete="new-password"
        maxLength={72}
        value={a.passwordConfirm}
        onChange={(e) => set('passwordConfirm', e.target.value)}
        error={errors['admin.passwordConfirm']}
        readOnly={busy}
      />
      <p className={`${WIDE} text-[12px] leading-[1.5] text-ink-muted`}>{O.passwordNote}</p>
    </div>
  );
}

function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="hms-ob-rows grid grid-cols-1 gap-x-4 gap-y-2.5 min-[560px]:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[12px] leading-4 text-ink-muted">{k}</dt>
          <dd className="text-[14px] leading-5 font-semibold break-words text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Section({ title, onEdit, busy, children }: { title: string; onEdit: () => void; busy: boolean; children: ReactNode }) {
  return (
    <section className="hms-ob-section rounded-field border border-hairline px-3.5 py-[12px]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="hms-ob-section-title text-[13.5px] font-extrabold text-ink">{title}</h2>
        <LinkButton className="hms-ob-edit" disabled={busy} onClick={onEdit}>
          {M.edit}
        </LinkButton>
      </div>
      {children}
    </section>
  );
}

function Review({ form, onEdit, busy }: { form: PlatformOnboardingForm; onEdit: (step: number) => void; busy: boolean }) {
  const F = O.fields;
  const a = form.admin;
  const or = (v: string | null | undefined) => (v && v.trim() ? v : M.notGiven);
  const adminRows: [string, string][] = [
    [F.adminName, a.name],
    [F.username, a.username],
    [F.adminEmail, a.email],
    [F.mobile, a.mobile],
    [F.password, M.passwordHidden],
  ];
  if (form.kind === 'group') {
    const g = form.group;
    const GF = G.fields;
    return (
      <>
        <Section title={G.groupSection} onEdit={() => onEdit(0)} busy={busy}>
          <Rows rows={[[GF.name, g.name], [GF.legalName, g.legalName], [GF.gstin, g.gstin], [F.state, or(g.state)], [GF.phone, g.phone], [GF.email, g.email], [GF.address, g.address]]} />
        </Section>
        <Section title={O.adminSection} onEdit={() => onEdit(1)} busy={busy}>
          <Rows rows={adminRows} />
        </Section>
      </>
    );
  }
  const h = form.hotel;
  const MF = M.fields;
  const more: [string, string][] = [
    [MF.legalName, or(h.legalName)],
    [MF.tradeName, or(h.tradeName)],
    [MF.gstType, h.gstType ? M.gstTypes[h.gstType] : M.notGiven],
    [MF.roomCount, h.roomCount ? String(h.roomCount) : M.notGiven],
    [MF.checkInTime, or(h.checkInTime)],
    [MF.checkOutTime, or(h.checkOutTime)],
  ];
  return (
    <>
      <Section title={O.hotelSection} onEdit={() => onEdit(0)} busy={busy}>
        <Rows
          rows={[
            [F.name, h.name],
            [F.gstin, h.gstin],
            [F.address, h.address],
            [F.city, h.city],
            [F.state, h.state],
            [F.pin, h.pin],
            [F.phone, h.phone],
            [F.email, h.email],
            [F.logo, h.logoName ?? M.noLogo],
            ...more.filter(([, v]) => v !== M.notGiven),
          ]}
        />
      </Section>
      <Section title={O.adminSection} onEdit={() => onEdit(1)} busy={busy}>
        <Rows rows={adminRows} />
      </Section>
    </>
  );
}
