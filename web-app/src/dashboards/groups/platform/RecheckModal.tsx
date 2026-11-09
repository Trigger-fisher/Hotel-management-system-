'use client';

// "Confirm it is you" before a vault shows a secret (MJ, 5 Nov 2026): the password, or a 6-digit code emailed now. Good for 5 minutes.
import { useState } from 'react';
import type { DashError } from '@shared/dashboards/common';

import { errorText } from '@/components/ui';
import { Button, Field, FieldHint, Modal } from '@/dashboards/pallav/ui';
import { tr, trf } from '@/lib/i18n/language';
import { recheckApi, type RecheckCodeSent } from './recheckApi';

/** The sentence for a refusal: a wrong password or code under its box, anything else (a lock, an expired code) above the buttons. */
function problemOf(error: DashError): { field?: 'password' | 'code'; text: string } {
  const code = error.details?.serverCode ?? error.code;
  if (error.details?.fields?.password) return { field: 'password', text: error.details.fields.password };
  if (error.details?.fields?.code) return { field: 'code', text: error.details.fields.code };
  if (code === 'INVALID_CREDENTIALS') return { field: 'password', text: 'That password is not right. Try again.' };
  if (code === 'INVALID_CODE') return { field: 'code', text: 'That code is not right. Check your latest email.' };
  if (code === 'CHALLENGE_EXPIRED' || code === 'CODE_ATTEMPTS_EXCEEDED') return { text: 'That code can no longer be used. Send a new one.' };
  if (code === 'ACCOUNT_LOCKED') return { text: 'Too many wrong tries. Your account is locked for 15 minutes.' };
  return { text: errorText(error) };
}

export function RecheckModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<RecheckCodeSent | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ field?: 'password' | 'code'; text: string } | null>(null);

  async function sendCode() {
    setBusy(true);
    setProblem(null);
    const res = await recheckApi.sendCode();
    setBusy(false);
    if (!res.ok) return setProblem(problemOf(res.error));
    setSent(res.data);
    setCode('');
  }

  async function confirm() {
    if (sent ? code.trim() === '' : password === '') {
      setProblem(sent ? { field: 'code', text: 'Enter the 6-digit code' } : { field: 'password', text: 'Enter your password' });
      return;
    }
    setBusy(true);
    setProblem(null);
    const res = sent ? await recheckApi.code(sent.challengeId, code) : await recheckApi.password(password);
    setBusy(false);
    if (!res.ok) return setProblem(problemOf(res.error));
    setPassword('');
    onDone();
  }

  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title={tr('Confirm it is you')}
      staticBackdrop
      onSubmit={() => void confirm()}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {tr('Cancel')}
          </Button>
          <Button type="submit" icon="shield-check" busy={busy}>
            {tr('Confirm')}
          </Button>
        </>
      }
    >
      <p className="mb-3">
        {sent ? tr('To see this, enter the code we emailed you. You will not be asked again for 5 minutes.') : tr('To see this, enter your password again. You will not be asked again for 5 minutes.')}
      </p>
      <fieldset disabled={busy}>
        <div className="row g-3">
          {sent ? (
            <Field label={tr('6-digit code')} error={problem?.field === 'code' ? problem.text : undefined}>
              <input
                className={`form-control${problem?.field === 'code' ? ' is-invalid' : ''}`}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <FieldHint>{trf('We sent a code to {0}. It works for 10 minutes.', [sent.maskedEmail])}</FieldHint>
            </Field>
          ) : (
            <Field label={tr('Your password')} error={problem?.field === 'password' ? problem.text : undefined}>
              <input
                className={`form-control${problem?.field === 'password' ? ' is-invalid' : ''}`}
                type="password"
                autoComplete="current-password"
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          )}
        </div>
        {problem && !problem.field ? (
          <div className="field-error mt-2" role="alert">
            {tr(problem.text)}
          </div>
        ) : null}
        <div className="mt-3">
          <Button variant="ghost" size="sm" icon={sent ? 'key' : 'envelope'} onClick={() => (sent ? (setSent(null), setProblem(null)) : void sendCode())}>
            {sent ? tr('Use my password instead') : tr('Email me a code instead')}
          </Button>
        </div>
      </fieldset>
    </Modal>
  );
}
