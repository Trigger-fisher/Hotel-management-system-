'use client';

// Set-up centre > WhatsApp > Numbers (Super Admin only, MJ 5 Nov 2026): every number with one plain state word and its technical facts in a Details fold, and "Connect a number":
// whose number, the two ids and the token, then the app checks the token, starts receiving and registers the number by itself (each a tick; a retry only when one fails), then a test.
// A token is typed once into a write-only box, sealed by the server and never shown again. In the demo mode there is no server behind it and the page says so.
import { useCallback, useEffect, useState } from 'react';

import type { DashError } from '@shared/dashboards/common';
import { formatDateTime } from '@shared/dashboards/format';

import { setupCopy } from '@shared/dashboards/platform';

import { Alert, Button, EmptyState, Field, FormSection, LoadError, Skeleton, StatusChip, type ChipTone } from '@/dashboards/pallav/ui';

import { SetupAsk } from '../platform/setupParts';

import { WhatsAppLineHotels } from './WhatsAppLineHotels';
import { whatsappAdminApi, whatsappAdminAvailable, type WaAppStatus, type WaCreateLine, type WaLineKind, type WaLineView } from './whatsappAdminApi';

const KIND_LABEL: Record<WaLineKind, string> = { platform: 'Platform number', shared: 'Shared guest number', hotel: "Hotel's own number", group: "Group's number", person: "Person's number" };
const STATUS_TONE: Record<WaLineView['status'], ChipTone> = { test: 'warn', active: 'ok', paused: 'neutral', needs_reconnect: 'danger', banned: 'danger' };
const STATUS_TEXT: Record<WaLineView['status'], string> = { test: 'Test', active: 'Live', paused: 'Paused', needs_reconnect: 'Needs reconnect', banned: 'Banned' };
const TOKEN_TONE: Record<WaLineView['tokenState'], ChipTone> = { valid: 'ok', unchecked: 'warn', failing: 'warn', needs_reconnect: 'danger', disconnected: 'neutral' };
const TOKEN_TEXT: Record<WaLineView['tokenState'], string> = { valid: 'Token works', unchecked: 'Token not checked yet', failing: 'Token failed once', needs_reconnect: 'Token needs replacing', disconnected: 'Disconnected' };
const QUALITY_TONE = { green: 'ok', yellow: 'warn', red: 'danger', unknown: 'neutral' } as const;

/** The one plain state word of a number: Working / Needs a new token / Paused / Blocked by WhatsApp. */
export function lineWord(l: Pick<WaLineView, 'status' | 'tokenState'>): { tone: ChipTone; text: string } {
  if (l.status === 'banned') return { tone: 'danger', text: 'Blocked by WhatsApp' };
  if (l.status === 'needs_reconnect' || l.tokenState === 'needs_reconnect' || l.tokenState === 'failing' || l.tokenState === 'disconnected') return { tone: 'danger', text: 'Needs a new token' };
  if (l.status === 'paused') return { tone: 'neutral', text: 'Paused' };
  return { tone: 'ok', text: l.status === 'test' ? 'Working (test number)' : 'Working' };
}

const errorOf = (e: DashError): string => e.details?.fields ? Object.values(e.details.fields).join(' ') || e.message : e.message;
const when = (iso: string | null): string => (iso ? formatDateTime(iso) : 'never');

/** One number: its health and its actions. */
function LineCard({ line, onChange, onNote }: { line: WaLineView; onChange: (l: WaLineView) => void; onNote: (n: { tone: 'ok' | 'danger'; text: string }) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [panel, setPanel] = useState<'test' | 'token' | 'disconnect' | 'hotels' | null>(null);
  const [phone, setPhone] = useState('');
  const [token, setToken] = useState('');
  const [confirmText, setConfirmText] = useState('');

  const run = useCallback(
    async (name: string, work: () => Promise<{ ok: true; line: WaLineView; text: string; okFlag?: boolean } | { ok: false; text: string }>) => {
      setBusy(name);
      const r = await work();
      setBusy(null);
      if (r.ok) {
        onChange(r.line);
        onNote({ tone: r.okFlag === false ? 'danger' : 'ok', text: r.text });
      } else onNote({ tone: 'danger', text: r.text });
    },
    [onChange, onNote],
  );

  const step = (name: 'verify' | 'subscribe' | 'register', done: string) =>
    run(name, async () => {
      const r = await whatsappAdminApi.step(line.id, name);
      if (!r.ok) return { ok: false, text: errorOf(r.error) };
      return { ok: true, line: r.data.line, okFlag: r.data.ok, text: r.data.ok ? done : (r.data.message ?? 'That did not work.') };
    });

  const needsTypedConfirm = line.status === 'active';
  const word = lineWord(line);
  return (
    <div className="pf-wa-line">
      <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
        <strong>{line.label}</strong>
        <StatusChip>{KIND_LABEL[line.kind]}</StatusChip>
        <StatusChip tone={word.tone}>{word.text}</StatusChip>
        {line.managed ? <StatusChip tone="warn">Managed by EasyHotelSolutions</StatusChip> : null}
      </div>
      <div className="cv-wa-facts mb-2">
        <div className="cv-wa-fact">
          <div className="cv-wa-fact-label">Number</div>
          <div className="cv-wa-fact-value">{line.displayPhone ?? 'Not read from WhatsApp yet'}</div>
        </div>
        <div className="cv-wa-fact">
          <div className="cv-wa-fact-label">Name shown to guests</div>
          <div className="cv-wa-fact-value">{line.displayName ?? 'Not read from WhatsApp yet'}</div>
          {line.nameStatus ? <div className="fs-hint">{line.nameStatus === 'named' ? 'Approved name' : 'No approved name yet'}</div> : null}
        </div>
        <div className="cv-wa-fact">
          <div className="cv-wa-fact-label">Hotels using it</div>
          <div className="cv-wa-fact-value">{line.hotelsAttached}</div>
        </div>
        <div className="cv-wa-fact">
          <div className="cv-wa-fact-label">Last message or tick received</div>
          <div className="cv-wa-fact-value">{when(line.lastEventAt)}</div>
        </div>
      </div>
      {line.lastErrorText ? (
        <Alert tone="warning" className="mb-2">
          Last problem ({when(line.lastErrorAt)}): {line.lastErrorText}
        </Alert>
      ) : null}
      <details className="pf-details mb-2">
        <summary>Details</summary>
        <div className="d-flex flex-wrap gap-2 my-2">
          <StatusChip tone={STATUS_TONE[line.status]}>{STATUS_TEXT[line.status]}</StatusChip>
          <StatusChip tone={TOKEN_TONE[line.tokenState]}>{TOKEN_TEXT[line.tokenState]}</StatusChip>
          <StatusChip tone={QUALITY_TONE[line.quality]}>{line.quality === 'unknown' ? 'Quality not known' : `Quality ${line.quality}`}</StatusChip>
          <StatusChip tone={line.webhookSubscribed ? 'ok' : 'warn'}>{line.webhookSubscribed ? 'Receives messages' : 'Not receiving messages'}</StatusChip>
          <StatusChip tone={line.registered ? 'ok' : 'warn'}>{line.registered ? 'Registered' : 'Not registered'}</StatusChip>
          <StatusChip>Messages per day: {line.messagingTier ?? 'not read yet'}</StatusChip>
        </div>
        <div className="fs-hint mb-2">
          Token saved {when(line.tokenSavedAt)}
          {line.tokenSavedBy ? ` by ${line.tokenSavedBy}` : ''}. Last checked with WhatsApp: {when(line.lastVerifiedAt)}.
        </div>
        <div className="d-flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" icon="patch-check" busy={busy === 'verify'} onClick={() => void step('verify', 'Checked: the number and the token are fine.')}>
            Check again
          </Button>
          {!line.webhookSubscribed ? (
            <Button size="sm" variant="ghost" icon="link-45deg" busy={busy === 'subscribe'} onClick={() => void step('subscribe', 'The number now receives messages.')}>
              Try receiving again
            </Button>
          ) : null}
          {!line.registered ? (
            <Button size="sm" variant="ghost" icon="shield-check" busy={busy === 'register'} onClick={() => void step('register', 'The number is registered.')}>
              Try registering again
            </Button>
          ) : null}
        </div>
      </details>
      <div className="d-flex flex-wrap gap-2">
        <Button size="sm" variant="outline" icon="send" onClick={() => setPanel(panel === 'test' ? null : 'test')}>
          Send a test
        </Button>
        {line.status === 'paused' ? (
          <Button
            size="sm"
            variant="outline"
            icon="play-circle"
            busy={busy === 'resume'}
            onClick={() =>
              void run('resume', async () => {
                const r = await whatsappAdminApi.setPaused(line.id, false);
                return r.ok ? { ok: true, line: r.data.line, text: 'The number is live again.' } : { ok: false, text: errorOf(r.error) };
              })
            }
          >
            Resume
          </Button>
        ) : line.status === 'test' || line.status === 'active' ? (
          <Button
            size="sm"
            variant="outline"
            icon="pause-circle"
            busy={busy === 'pause'}
            onClick={() =>
              void run('pause', async () => {
                const r = await whatsappAdminApi.setPaused(line.id, true);
                return r.ok ? { ok: true, line: r.data.line, text: 'The number is paused: nothing is sent on it until you resume.' } : { ok: false, text: errorOf(r.error) };
              })
            }
          >
            Pause
          </Button>
        ) : null}
        <Button size="sm" variant="outline" icon="key" onClick={() => setPanel(panel === 'token' ? null : 'token')}>
          Replace token
        </Button>
        {line.kind === 'shared' ? (
          <Button size="sm" variant="outline" icon="buildings" onClick={() => setPanel(panel === 'hotels' ? null : 'hotels')}>
            Hotels on this number ({line.hotelsAttached})
          </Button>
        ) : null}
        <Button size="sm" variant="danger" icon="plug" onClick={() => setPanel(panel === 'disconnect' ? null : 'disconnect')}>
          Disconnect
        </Button>
      </div>
      {panel === 'hotels' && line.kind === 'shared' ? <WhatsAppLineHotels lineId={line.id} phone={line.displayPhone} /> : null}
      {panel === 'test' ? (
        <div className="row g-2 mt-2 align-items-end">
          <Field label="Your own phone, with country code (for example 919825012345)" col="col-md-6">
            <input className="form-control" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" />
          </Field>
          <div className="col-md-3">
            <Button
              size="sm"
              icon="send"
              busy={busy === 'test'}
              disabled={phone.replace(/\D/g, '').length < 8}
              onClick={() =>
                void run('test', async () => {
                  const r = await whatsappAdminApi.test(line.id, phone.replace(/\D/g, ''));
                  if (!r.ok) return { ok: false, text: errorOf(r.error) };
                  return { ok: true, line: r.data.line, okFlag: r.data.ok, text: r.data.ok ? 'Meta accepted the test message. It should arrive on that phone in a moment.' : (r.data.message ?? 'The test message was not sent.') };
                })
              }
            >
              Send test
            </Button>
          </div>
        </div>
      ) : null}
      {panel === 'token' ? (
        <div className="row g-2 mt-2 align-items-end">
          <Field label="New access token (it is saved sealed and never shown again)" col="col-md-6">
            <input className="form-control" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
          </Field>
          {needsTypedConfirm ? (
            <Field label={`Type "${line.label}" to confirm`} col="col-md-4">
              <input className="form-control" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
            </Field>
          ) : null}
          <div className="col-md-2">
            <Button
              size="sm"
              icon="key"
              busy={busy === 'token'}
              disabled={token.trim().length < 20 || (needsTypedConfirm && confirmText.trim() === '')}
              onClick={() => {
                const sent = token;
                setToken('');
                void run('token', async () => {
                  const r = await whatsappAdminApi.replaceToken(line.id, sent.trim(), needsTypedConfirm ? confirmText.trim() : undefined);
                  setConfirmText('');
                  return r.ok ? { ok: true, line: r.data.line, text: 'The new token is saved. Check the number with Meta to be sure it works.' } : { ok: false, text: errorOf(r.error) };
                });
              }}
            >
              Save token
            </Button>
          </div>
        </div>
      ) : null}
      {panel === 'disconnect' ? (
        <div className="row g-2 mt-2 align-items-end">
          <Field label={`Type "${line.label}" to disconnect it`} col="col-md-6">
            <input className="form-control" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
          </Field>
          <div className="col-md-3">
            <Button
              size="sm"
              variant="dangerSolid"
              icon="plug"
              busy={busy === 'disconnect'}
              disabled={confirmText.trim() === ''}
              onClick={() =>
                void run('disconnect', async () => {
                  const r = await whatsappAdminApi.disconnect(line.id, confirmText.trim());
                  setConfirmText('');
                  setPanel(null);
                  return r.ok ? { ok: true, line: r.data.line, text: 'The number is disconnected. A new token reconnects it.' } : { ok: false, text: errorOf(r.error) };
                })
              }
            >
              Disconnect
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type WizardStep = 'kind' | 'waba' | 'pnid' | 'token' | 'checks' | 'test' | 'live' | 'done';
const QUESTIONS: WizardStep[] = ['kind', 'waba', 'pnid', 'token'];
const STEPS: { id: WizardStep; label: string }[] = [
  { id: 'kind', label: 'Whose number' },
  { id: 'waba', label: 'Account ID' },
  { id: 'pnid', label: 'Phone number ID' },
  { id: 'token', label: 'Token' },
  { id: 'checks', label: 'The app connects it' },
  { id: 'test', label: 'Test message' },
  { id: 'live', label: 'Go live' },
];
type Check = 'verify' | 'subscribe' | 'register';
const CHECKS: { id: Check; label: string }[] = [
  { id: 'verify', label: 'The token works and can see the number' },
  { id: 'subscribe', label: 'Messages and ticks come to this app' },
  { id: 'register', label: 'The number is registered' },
];
const HINTS = {
  waba: 'In Meta’s WhatsApp Manager open Account tools > Phone numbers: the WhatsApp Business Account ID is shown under the number.',
  pnid: 'In the same place, the Phone number ID is shown under the number.',
  token: 'Business settings > Users > System users > Generate new token, with whatsapp_business_messaging and whatsapp_business_management ticked.',
};
const C = setupCopy.check;

/** "Connect a number", one question per step: whose number, the account ID, the phone number ID, the token; the app then runs the three checks by itself, then a test message. */
function ConnectWizard({ onDone, onNote }: { onDone: (l: WaLineView) => void; onNote: (n: { tone: 'ok' | 'danger'; text: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<WizardStep>('kind');
  const [line, setLine] = useState<WaLineView | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [kind, setKind] = useState<WaLineKind>('shared');
  const [waba, setWaba] = useState('');
  const [pnid, setPnid] = useState('');
  const [token, setToken] = useState('');
  const [phone, setPhone] = useState('');
  const [checks, setChecks] = useState<Record<Check, 'wait' | 'ok' | 'bad'>>({ verify: 'wait', subscribe: 'wait', register: 'wait' });

  const reset = (): void => {
    setOpen(false);
    setStep('kind');
    setLine(null);
    setProblem(null);
    setToken('');
    setWaba('');
    setPnid('');
    setPhone('');
    setChecks({ verify: 'wait', subscribe: 'wait', register: 'wait' });
  };

  const call = async (work: () => Promise<{ ok: true; line: WaLineView; next: WizardStep; passed: boolean; message: string | null } | { ok: false; text: string }>): Promise<void> => {
    setBusy(true);
    setProblem(null);
    const r = await work();
    setBusy(false);
    if (!r.ok) return setProblem(r.text);
    setLine(r.line);
    if (!r.passed) return setProblem(r.message ?? 'That step did not work.');
    setStep(r.next);
  };

  /** The three checks one after the other, from the first one not yet done; stops at the first that fails. */
  const runChecks = async (l: WaLineView, done: Record<Check, 'wait' | 'ok' | 'bad'>): Promise<void> => {
    setBusy(true);
    setProblem(null);
    let cur = l;
    const state = { ...done };
    for (const c of CHECKS) {
      if (state[c.id] === 'ok') continue;
      const r = await whatsappAdminApi.step(cur.id, c.id);
      if (r.ok) cur = r.data.line;
      const passed = r.ok && r.data.ok;
      state[c.id] = passed ? 'ok' : 'bad';
      setChecks({ ...state });
      if (!passed) {
        setLine(cur);
        setBusy(false);
        setProblem(r.ok ? (r.data.message ?? 'That check did not work.') : errorOf(r.error));
        return;
      }
    }
    setLine(cur);
    setBusy(false);
    setStep('test');
  };

  if (!open) {
    return (
      <Button icon="plus-circle" onClick={() => setOpen(true)}>
        Connect a number
      </Button>
    );
  }
  const at = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="pf-wa-wizard">
      <div className="d-flex flex-wrap gap-2 mb-3">
        {STEPS.map((s, i) => (
          <StatusChip key={s.id} tone={i < at || step === 'done' ? 'ok' : i === at ? 'warn' : 'neutral'}>
            {i + 1}. {s.label}
          </StatusChip>
        ))}
      </div>
      {problem ? (
        <Alert tone="danger" className="mb-3">
          {problem}
        </Alert>
      ) : null}
      {step === 'kind' ? (
        <SetupAsk id="wa-kind" label="Whose number" hint={C.savedWithNext} go={{ label: setupCopy.continue, icon: 'arrow-right', onClick: () => setStep('waba') }}>
          <select id="wa-kind" className="form-select" value={kind} onChange={(e) => setKind(e.target.value as WaLineKind)}>
            <option value="shared">Shared guest number (all hotels)</option>
            <option value="platform">Platform number (Super Admin and Platform Admin)</option>
          </select>
        </SetupAsk>
      ) : null}
      {step === 'waba' ? (
        <SetupAsk id="wa-waba" label="WhatsApp Business Account ID" hint={HINTS.waba} check={waba !== '' && waba.length < 5 ? C.longNumber : null} go={{ label: setupCopy.continue, icon: 'arrow-right', disabled: waba.length < 5, onClick: () => setStep('pnid') }}>
          <input id="wa-waba" className="form-control pf-mono" inputMode="numeric" value={waba} onChange={(e) => setWaba(e.target.value.replace(/\D/g, ''))} autoComplete="off" />
        </SetupAsk>
      ) : null}
      {step === 'pnid' ? (
        <SetupAsk id="wa-pnid" label="Phone number ID" hint={HINTS.pnid} check={pnid !== '' && pnid.length < 5 ? C.longNumber : null} go={{ label: setupCopy.continue, icon: 'arrow-right', disabled: pnid.length < 5, onClick: () => setStep('token') }}>
          <input id="wa-pnid" className="form-control pf-mono" inputMode="numeric" value={pnid} onChange={(e) => setPnid(e.target.value.replace(/\D/g, ''))} autoComplete="off" />
        </SetupAsk>
      ) : null}
      {step === 'token' ? (
        <SetupAsk
          id="wa-token"
          label="Access token (saved sealed, never shown again)"
          hint={HINTS.token}
          check={token !== '' && token.trim().length < 20 ? C.token : null}
          go={{
            label: 'Save and connect',
            icon: 'arrow-right-circle',
            busy,
            disabled: waba.length < 5 || pnid.length < 5 || token.trim().length < 20,
            onClick: () => {
              const sent = token;
              setToken('');
              setBusy(true);
              setProblem(null);
              const input: WaCreateLine = { kind, phoneNumberId: pnid, wabaId: waba, token: sent.trim() };
              void whatsappAdminApi.createLine(input).then((r) => {
                setBusy(false);
                if (!r.ok) return setProblem(errorOf(r.error));
                setLine(r.data.line);
                setStep('checks');
                void runChecks(r.data.line, { verify: 'wait', subscribe: 'wait', register: 'wait' });
              });
            },
          }}
        >
          <input id="wa-token" className="form-control" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
        </SetupAsk>
      ) : null}
      {QUESTIONS.includes(step) && step !== 'kind' ? (
        <div className="mt-2">
          <Button size="sm" variant="ghost" icon="arrow-left" onClick={() => setStep(QUESTIONS[QUESTIONS.indexOf(step) - 1])}>
            {setupCopy.back}
          </Button>
        </div>
      ) : null}
      {step === 'checks' ? (
        <>
          <ul className="pf-wa-checks">
            {CHECKS.map((c) => (
              <li key={c.id} className={checks[c.id]}>
                <span aria-hidden="true">{checks[c.id] === 'ok' ? '✓' : checks[c.id] === 'bad' ? '!' : '·'}</span> {c.label}
              </li>
            ))}
          </ul>
          {line && Object.values(checks).includes('bad') ? (
            <Button icon="arrow-repeat" busy={busy} onClick={() => void runChecks(line, checks)}>
              Try again
            </Button>
          ) : null}
        </>
      ) : null}      {step === 'test' ? (
        <div className="row g-2 align-items-end">
          <Field label="Your own phone, with country code" col="col-md-6">
            <input className="form-control" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" />
          </Field>
          <div className="col-md-3">
            <Button
              icon="send"
              busy={busy}
              disabled={phone.replace(/\D/g, '').length < 8}
              onClick={() =>
                void call(async () => {
                  if (!line) return { ok: false, text: 'Save the number first.' };
                  const r = await whatsappAdminApi.test(line.id, phone.replace(/\D/g, ''));
                  return r.ok ? { ok: true, line: r.data.line, next: 'live', passed: r.data.ok, message: r.data.message } : { ok: false, text: errorOf(r.error) };
                })
              }
            >
              Send test message
            </Button>
          </div>
          <div className="col-md-3">
            <Button variant="ghost" onClick={() => setStep('live')}>
              Skip the test
            </Button>
          </div>
        </div>
      ) : null}
      {step === 'live' ? (
        <>
          <p>
            Go live makes the number <strong>Live</strong>. WhatsApp as a whole still stays off until you switch it on under Rules (the kill switch).
          </p>
          <Button
            icon="rocket-takeoff"
            busy={busy}
            onClick={() =>
              void call(async () => {
                if (!line) return { ok: false, text: 'Save the number first.' };
                const r = await whatsappAdminApi.setPaused(line.id, false);
                return r.ok ? { ok: true, line: r.data.line, next: 'done', passed: true, message: null } : { ok: false, text: errorOf(r.error) };
              })
            }
          >
            Go live
          </Button>
        </>
      ) : null}
      {step === 'done' && line ? (
        <>
          <Alert tone="success" className="mb-2">
            {line.label} is connected and live.
          </Alert>
          <Button
            onClick={() => {
              onDone(line);
              onNote({ tone: 'ok', text: `${line.label} is connected.` });
              reset();
            }}
          >
            Done
          </Button>
        </>
      ) : null}
      {step !== 'done' ? (
        <div className="mt-3">
          <Button size="sm" variant="ghost" onClick={() => (line ? (onDone(line), reset()) : reset())}>
            Close the wizard
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function WhatsAppConnections() {
  const [state, setState] = useState<{ status: WaAppStatus | null; lines: WaLineView[]; error: DashError | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [note, setNote] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const live = whatsappAdminAvailable();

  useEffect(() => {
    let on = true;
    void Promise.all([whatsappAdminApi.appStatus(), whatsappAdminApi.lines()]).then(([s, l]) => {
      if (on) setState({ status: s.ok ? s.data : null, lines: l.ok ? l.data.lines : [], error: !s.ok ? s.error : !l.ok ? l.error : null });
    });
    return () => {
      on = false;
    };
  }, [attempt]);

  const put = useCallback((line: WaLineView) => setState((s) => (s ? { ...s, lines: s.lines.some((x) => x.id === line.id) ? s.lines.map((x) => (x.id === line.id ? line : x)) : [...s.lines, line] } : s)), []);

  if (!state) return <Skeleton rows={2} />;
  if (state.error) return <LoadError error={state.error} onRetry={() => setAttempt((n) => n + 1)} />;
  const s = state.status;
  const copy = (text: string): void => void navigator.clipboard?.writeText(text).then(() => setNote({ tone: 'ok', text: 'Copied.' }));

  return (
    <>
      {!live ? (
        <Alert tone="info" className="mb-2">
          Sample data for the preview: no number is really connected and nothing here is saved.
        </Alert>
      ) : null}
      <FormSection icon="phone" title="WhatsApp numbers" hint="One row per connected number. Nothing here shows a token.">
        {note ? (
          <Alert tone={note.tone === 'ok' ? 'success' : 'danger'} className="mb-2" action={<Button size="sm" variant="ghost" onClick={() => setNote(null)}>Dismiss</Button>}>
            {note.text}
          </Alert>
        ) : null}
        {state.lines.length === 0 ? <EmptyState icon="phone" title="No number connected yet" text="Use Connect a number to add the test number or the shared guest number." /> : state.lines.map((l) => <LineCard key={l.id} line={l} onChange={put} onNote={setNote} />)}
        <div className="mt-3">
          <ConnectWizard onDone={put} onNote={setNote} />
        </div>
      </FormSection>
      <details className="pf-details mt-3">
        <summary>Details: the app&apos;s own WhatsApp settings</summary>
        <p className="fs-hint mt-2">What the server has for Meta&apos;s app. Secrets are never shown: only whether they are present.</p>
        {s ? (
          <>
            <div className="d-flex flex-wrap gap-2 mb-2">
              <StatusChip tone={s.appSecret ? 'ok' : 'danger'}>App secret {s.appSecret ? 'present' : 'missing'}</StatusChip>
              <StatusChip tone={s.verifyToken ? 'ok' : 'danger'}>Verify token {s.verifyToken ? 'present' : 'missing'}</StatusChip>
              <StatusChip tone={s.sealKey ? 'ok' : 'danger'}>Sealing key {s.sealKey ? 'ready' : 'not ready'}</StatusChip>
              <StatusChip>Graph version {s.graphVersion}</StatusChip>
            </div>
            {!s.appSecret || !s.verifyToken ? <Alert tone="warning">WhatsApp stays off until both are set in the hosting settings (WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN).</Alert> : null}
            <div className="mt-2">
              <div className="cv-wa-fact-label">Callback address to give Meta (one address for every number)</div>
              {s.callbackUrl ? (
                <div className="d-flex flex-wrap align-items-center gap-2">
                  <code>{s.callbackUrl}</code>
                  <Button size="sm" variant="outline" icon="clipboard" onClick={() => copy(s.callbackUrl as string)}>
                    Copy
                  </Button>
                </div>
              ) : (
                <div className="fs-hint">The site address (HMS_PUBLIC_URL) is not set on the server.</div>
              )}
              <div className="fs-hint mt-1">In Meta&apos;s webhook settings subscribe to: {s.fields.join(', ')}. Last number checked with Meta: {when(s.lastVerifiedAt)}.</div>
            </div>
          </>
        ) : null}
      </details>
    </>
  );
}
