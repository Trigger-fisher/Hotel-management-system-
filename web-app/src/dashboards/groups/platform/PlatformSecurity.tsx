'use client';

// Platform settings > Sign-in security (MJ, 5 Nov 2026), Super Admin only: how long each user kind stays signed in, how long a temporary password works,
// the fixed lock rule and the fixed 2-step row. One Save for the whole card.
import { useState } from 'react';

import { formatDateTime } from '@shared/dashboards/format';
import { platformCopy } from '@shared/dashboards/platform';
import {
  LOCK_MINUTES, SESSION_KINDS, SESSION_KIND_LABELS, SESSION_MINUTE_CHOICES, TEMP_PASSWORD_MINUTE_CHOICES,
  type SecuritySettings, type SessionKind,
} from '@shared/dashboards/security';

import type { ScreenProps } from '../../types';
import { useAction } from '@/components/ui';
import { Bi, Button, FieldError, FieldHint, PmsSelect } from '@/dashboards/pallav/ui';
import { tr, trf } from '@/lib/i18n/language';
import { StaleNote, Wait, useLoaded } from '../payrollCore/load';
import { actAs } from './PlatformStaff';
import { securityApi } from './securityApi';
import d from './desktop.module.css';

const T = platformCopy.platformSettings;

/** "15 minutes", "1 hour", "12 hours", "1 day", "7 days", in the chosen language. */
export function durationLabel(minutes: number): string {
  if (minutes % 1440 === 0) return minutes === 1440 ? tr('1 day') : trf('{0} days', [minutes / 1440]);
  if (minutes % 60 === 0) return minutes === 60 ? tr('1 hour') : trf('{0} hours', [minutes / 60]);
  return trf('{0} minutes', [minutes]);
}

/** The choices, with the saved value added when it is not one of them. */
const choicesWith = (list: readonly number[], value: number): number[] => (list.includes(value) ? [...list] : [...list, value].sort((a, b) => a - b));

export function SecurityCard({ user }: { user: ScreenProps['user'] }) {
  const [version, setVersion] = useState(0);
  const { data, error, reload } = useLoaded(() => securityApi.get(), [version]);
  if (!data) return <Wait error={error} onRetry={reload} tiles={false} rows={6} />;
  return (
    <div className="d-grid gap-3" style={{ minWidth: 0 }}>
      <StaleNote error={error} onRetry={reload} />
      <SecurityForm key={data.updatedAt ?? 'never'} data={data} user={user} onSaved={() => setVersion((n) => n + 1)} />
    </div>
  );
}

function SecurityForm({ data, user, onSaved }: { data: SecuritySettings; user: ScreenProps['user']; onSaved: () => void }) {
  const [sessions, setSessions] = useState<Record<SessionKind, number>>(data.sessionMinutes);
  const [temp, setTemp] = useState(data.tempPasswordMinutes);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  const label = T.sections.security;

  const save = () => {
    actAs(user);
    void run(() => securityApi.update({ sessionMinutes: sessions, tempPasswordMinutes: temp }), { success: T.saved(label), onFields: (f) => setErrors(f), onOk: onSaved });
  };

  return (
    <form
      className={`st-card ${d.stickySave}`}
      autoComplete="off"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="st-head">
        <div className="st-icon">
          <Bi name="shield-lock" />
        </div>
        <div>
          <h2 className="st-title">{label}</h2>
          <p className="st-about">{tr('How long people stay signed in, and how long a temporary password works.')}</p>
        </div>
      </div>

      <div className="st-grid">
        <div className="st-field wide">
          <h3 className="form-label mb-0">{tr('Stay signed in for')}</h3>
          <FieldHint>{tr('After this time the person signs in again, even if they are busy. A change applies at their next click.')}</FieldHint>
        </div>
        {SESSION_KINDS.map((kind) => {
          const id = `sec-session-${kind}`;
          const err = errors[`sessionMinutes.${kind}`];
          return (
            <div className="st-field" key={kind}>
              <label className="form-label" htmlFor={id}>
                {tr(SESSION_KIND_LABELS[kind])}
              </label>
              <PmsSelect
                id={id}
                value={String(sessions[kind])}
                disabled={busy}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setSessions((p) => ({ ...p, [kind]: v }));
                  if (err) setErrors((p) => ({ ...p, [`sessionMinutes.${kind}`]: '' }));
                }}
              >
                {choicesWith(SESSION_MINUTE_CHOICES, sessions[kind]).map((m) => (
                  <option key={m} value={m}>
                    {durationLabel(m)}
                  </option>
                ))}
              </PmsSelect>
              <FieldError>{err ? tr(err) : undefined}</FieldError>
            </div>
          );
        })}

        <div className="st-field wide">
          <label className="form-label" htmlFor="sec-temp">
            {tr('A temporary password works for')}
          </label>
          <PmsSelect
            id="sec-temp"
            value={String(temp)}
            disabled={busy}
            onChange={(e) => {
              setTemp(Number(e.target.value));
              if (errors.tempPasswordMinutes) setErrors((p) => ({ ...p, tempPasswordMinutes: '' }));
            }}
          >
            {choicesWith(TEMP_PASSWORD_MINUTE_CHOICES, temp).map((m) => (
              <option key={m} value={m}>
                {durationLabel(m)}
              </option>
            ))}
          </PmsSelect>
          <FieldHint>{tr('A new account or a reset password stops working after this. The person then asks for a new one. At the first sign-in they choose their own.')}</FieldHint>
          <FieldError>{errors.tempPasswordMinutes ? tr(errors.tempPasswordMinutes) : undefined}</FieldError>
        </div>

        <div className="st-field wide">
          <label className="st-toggle" htmlFor="sec-lock" title={T.twoStep.locked}>
            <input type="checkbox" id="sec-lock" checked disabled readOnly aria-describedby="sec-lock-hint" />
            <span className="st-switch" aria-hidden="true" />
            <span className="st-toggle-text">
              <strong>
                {tr('Lock after 5 wrong passwords')}{' '}
                <span className="text-muted small">
                  <Bi name="lock-fill" /> {T.twoStep.locked}
                </span>
              </strong>
              <small id="sec-lock-hint">{trf('The account opens again after {0} minutes, or sooner when an admin unlocks it.', [LOCK_MINUTES])}</small>
            </span>
          </label>
        </div>

        <div className="st-field wide">
          <label className="st-toggle" htmlFor="ps-two-step" title={T.twoStep.locked}>
            <input type="checkbox" id="ps-two-step" checked disabled readOnly aria-describedby="ps-two-step-hint" />
            <span className="st-switch" aria-hidden="true" />
            <span className="st-toggle-text">
              <strong>
                {T.twoStep.label}{' '}
                <span className="text-muted small">
                  <Bi name="lock-fill" /> {T.twoStep.locked}
                </span>
              </strong>
              <small id="ps-two-step-hint">{T.twoStep.hint}</small>
            </span>
          </label>
        </div>
      </div>

      <div className="st-foot">
        <span className="text-muted small me-auto">{data.updatedAt && data.updatedBy ? T.lastChanged(data.updatedBy, formatDateTime(data.updatedAt)) : T.neverChanged}</span>
        <Button type="submit" icon="check2" disabled={busy}>
          {busy ? T.saving : T.save(label)}
        </Button>
      </div>
    </form>
  );
}
