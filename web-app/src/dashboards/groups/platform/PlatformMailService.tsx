'use client';

// The platform's Email service in the Set-up centre's mail wizard, one question per step (MJ, 5 Nov 2026): the SES region, the SMTP user name, the SMTP password, the From
// address, the Google backup address and its app password, and a Test at the end. Amazon SES is the MAIN service and the Google address the BACKUP (server: mail/failover.ts).
// A login is saved with its password (the server asks for both), so the region and the user name are kept for the password step unless a password is already saved.
import { useState } from 'react';

import { formatDate, formatDateTime } from '@shared/dashboards/format';
import { MAIL_SES_REGIONS, mailProviderCopy } from '@shared/dashboards/mailProviders';
import { platformCopy, setupCopy, type PlatformMailRoute, type PlatformSettings, type PlatformSettingsInput } from '@shared/dashboards/platform';

import type { ScreenProps } from '../../types';
import { useAction } from '@/components/ui';
import { Alert, FieldHint, PmsSelect, SecretField } from '@/dashboards/pallav/ui';
import { platformApi } from './api';
import { actAs } from './PlatformStaff';
import { SetupAsk, SetupTest, type WizardStep } from './setupParts';

import { tr } from '@/lib/i18n/language';
const T = platformCopy.platformSettings;
const S = setupCopy.mail.steps;
const C = setupCopy.check;
const minutesWord = (m: number): string => (m === 1440 ? '24 hours' : m >= 60 && m % 60 === 0 ? `${m / 60} ${m === 60 ? 'hour' : 'hours'}` : `${m} minutes`);
const EMAIL = /^[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}$/i;
const sesUserBad = (v: string) => (v !== '' && !/^A[KS]IA[A-Z0-9]{16}$/.test(v) ? C.sesUser : null);
const sesPasswordBad = (v: string) => (v !== '' && v.replace(/\s+/g, '').length < 20 ? C.sesPassword : null);
const emailBad = (v: string) => (v.trim() !== '' && !EMAIL.test(v.trim()) ? C.email : null);
const appPasswordBad = (v: string) => (v !== '' && !/^[a-z]{16}$/i.test(v.replace(/\s+/g, '')) ? C.appPassword : null);

/** The mail service's steps for the mail wizard. `go` opens the next step after a step is saved. */
export function useMailServiceSteps({ data, user, onSaved, go }: { data: PlatformSettings; user: ScreenProps['user']; onSaved: () => void; go: (step: string) => void }): WizardStep[] {
  const s = data.smtp;
  const sesSaved = s.provider === 'ses' && s.passwordSet && s.user !== '';
  const backupSaved = s.backup.user !== '' && s.backup.passwordSet;
  const [region, setRegion] = useState(s.server?.region || 'ap-south-1');
  const [sesUser, setSesUser] = useState(s.provider === 'ses' ? s.user : '');
  const [sesPassword, setSesPassword] = useState('');
  const [clearSes, setClearSes] = useState(false);
  const [fromAddress, setFromAddress] = useState(data.mailFromEmail);
  const [backupUser, setBackupUser] = useState(s.backup.user);
  const [backupPassword, setBackupPassword] = useState('');
  const [clearBackup, setClearBackup] = useState(false);
  const [testTo, setTestTo] = useState(user.email ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useAction();

  const save = (input: PlatformSettingsInput, what: string, next: string, after?: () => void) => {
    actAs(user);
    void run(() => platformApi.updatePlatformSettings(input), {
      success: `${T.saved(what)} ${setupCopy.later}`,
      onFields: (f) => setErrors(f),
      onOk: () => {
        after?.();
        setErrors({});
        onSaved();
        go(next);
      },
    });
  };
  const ses = (next: string) =>
    save({ smtp: { provider: 'ses', region, user: sesUser.trim(), ...(clearSes && s.provider === 'ses' ? { clearPassword: true } : sesPassword !== '' ? { password: sesPassword } : {}) } }, 'Amazon SES', next, () => {
      setSesPassword('');
      setClearSes(false);
    });
  const backup = (next: string) =>
    save({ smtp: { backup: { user: backupUser.trim().toLowerCase(), ...(clearBackup && backupSaved ? { clearPassword: true } : backupPassword !== '' ? { password: backupPassword } : {}) } } }, 'Google backup', next, () => {
      setBackupPassword('');
      setClearBackup(false);
    });
  const step = (next: string, saveNow: (() => void) | null) => ({ label: saveNow ? setupCopy.saveContinue : setupCopy.continue, icon: saveNow ? 'check2' : 'arrow-right', busy, onClick: saveNow ?? (() => go(next)) });
  const typedDomain = /^[^@\s]+@([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24})$/i.exec(fromAddress.trim())?.[1]?.toLowerCase() ?? null;
  const sendingDomain = typedDomain && typedDomain !== 'gmail.com' && typedDomain !== 'googlemail.com' ? typedDomain : null;
  const sesPasswordReady = sesPassword !== '' || (sesSaved && !clearSes);
  const plain = async (which: PlatformMailRoute) => {
    actAs(user);
    const r = await platformApi.sendPlatformTestEmail(testTo.trim(), which);
    return r.ok ? { ok: r.data.ok, text: r.data.message, fix: r.data.hint ?? null } : { ok: false, text: r.error.message };
  };

  return [
    {
      id: 'service',
      title: S.service.title,
      hints: S.service.hints,
      done: sesSaved,
      content: (
        <>
          {s.failover.active === 'backup' ? (
            <Alert tone="warning" icon="arrow-left-right" className="mb-3">
              {tr('Mail is going out through the Google backup because Amazon SES failed')}
              {s.failover.since ? ` (since ${formatDateTime(s.failover.since)})` : ''}
              {tr('. SES is tried again after')} {minutesWord(s.failover.returnMinutes)}.
            </Alert>
          ) : null}
          {s.provider !== null && s.provider !== 'ses' ? (
            <Alert tone="info" icon="info-circle" className="mb-3">
              {tr('A different mail service (')}
              {s.provider}
              {tr(') is saved today and keeps sending until the Amazon SES login is saved.')}
            </Alert>
          ) : null}
          <SetupAsk id="ms-region" label={mailProviderCopy.region} hint={sesSaved ? undefined : C.savedWithNext} check={errors.smtpRegion} go={step('sesUser', sesSaved ? () => ses('sesUser') : null)}>
            <PmsSelect id="ms-region" value={region} disabled={busy} onChange={(e) => setRegion(e.target.value)}>
              {MAIL_SES_REGIONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </PmsSelect>
          </SetupAsk>
        </>
      ),
    },
    {
      id: 'sesUser',
      title: S.sesUser.title,
      hints: S.sesUser.hints,
      done: sesSaved,
      content: (
        <SetupAsk id="ms-ses-user" label={tr('SES SMTP user name')} hint={sesSaved ? undefined : C.savedWithNext} check={errors.smtpUser ?? sesUserBad(sesUser.trim())} go={{ ...step('sesPassword', sesSaved ? () => ses('sesPassword') : null), disabled: sesUser.trim() === '' }}>
          <input id="ms-ses-user" className={`form-control pf-mono${errors.smtpUser || sesUserBad(sesUser.trim()) ? ' is-invalid' : ''}`} maxLength={254} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="AKIA…" value={sesUser} disabled={busy} onChange={(e) => setSesUser(e.target.value.trim())} />
        </SetupAsk>
      ),
    },
    {
      id: 'sesPassword',
      title: S.sesPassword.title,
      hints: S.sesPassword.hints,
      done: sesSaved,
      content: (
        <SetupAsk id="ms-ses-password" label={tr('SES SMTP password')} hint={!s.canStorePassword ? T.smtp.hints.passwordKeyMissing : s.passwordUnreadable ? T.smtp.hints.passwordUnreadable : undefined} check={errors.smtpPassword ?? sesPasswordBad(sesPassword)} go={{ ...step('from', () => ses('from')), disabled: sesUser.trim() === '' || sesUserBad(sesUser.trim()) !== null || (!sesPasswordReady && !clearSes) }}>
          <SecretField
            key={`ses:${sesSaved}`}
            id="ms-ses-password"
            value={sesPassword}
            onChange={setSesPassword}
            isSet={s.passwordSet && s.provider === 'ses'}
            savedOn={s.lastChangedAt ? formatDate(s.lastChangedAt) : null}
            removed={clearSes && s.provider === 'ses'}
            onRemoveChange={(r) => {
              setClearSes(r);
              if (r) setSesPassword('');
            }}
            disabled={busy || !s.canStorePassword}
            invalid={Boolean(errors.smtpPassword || sesPasswordBad(sesPassword))}
            noun="key"
          />
        </SetupAsk>
      ),
    },
    {
      id: 'from',
      title: S.from.title,
      hints: S.from.hints,
      done: data.mailFromEmail !== '',
      content: (
        <SetupAsk
          id="ms-from"
          label={mailProviderCopy.fromAddress.label}
          hint={sendingDomain ? `${mailProviderCopy.fromAddress.hint} ${tr('Each hotel sends as')} hotelname@${sendingDomain}.` : tr('Use an address on your own domain, not Gmail, and every hotel and group gets its own name@yourdomain address by itself.')}
          check={errors.mailFromEmail ?? emailBad(fromAddress)}
          go={{ ...step('backupUser', () => save({ mailFromEmail: fromAddress.trim() }, 'From address', 'backupUser')), disabled: fromAddress.trim() === '' }}
        >
          <input id="ms-from" type="email" inputMode="email" className={`form-control${errors.mailFromEmail || emailBad(fromAddress) ? ' is-invalid' : ''}`} maxLength={254} autoComplete="off" placeholder="mail@yourdomain.in" value={fromAddress} disabled={busy} onChange={(e) => setFromAddress(e.target.value)} />
        </SetupAsk>
      ),
    },
    {
      id: 'backupUser',
      title: S.backupUser.title,
      hints: S.backupUser.hints,
      done: backupSaved,
      content: (
        <SetupAsk id="ms-backup-user" label={tr('Google address')} hint={backupSaved ? undefined : C.savedWithNext} check={errors.backupUser ?? emailBad(backupUser)} go={{ ...step('backupPassword', backupSaved && backupUser.trim().toLowerCase() === s.backup.user ? () => backup('backupPassword') : null), disabled: backupUser.trim() === '' }}>
          <input id="ms-backup-user" type="email" inputMode="email" className={`form-control${errors.backupUser || emailBad(backupUser) ? ' is-invalid' : ''}`} maxLength={254} autoComplete="off" autoCapitalize="off" placeholder="name@gmail.com" value={backupUser} disabled={busy} onChange={(e) => setBackupUser(e.target.value)} />
        </SetupAsk>
      ),
    },
    {
      id: 'backupPassword',
      title: S.backupPassword.title,
      hints: S.backupPassword.hints,
      done: backupSaved,
      content: (
        <SetupAsk
          id="ms-backup-password"
          label={tr('App password')}
          hint={s.backup.passwordUnreadable ? tr('The saved app password cannot be opened on this server. Type it again and save.') : undefined}
          check={errors.backupPassword ?? appPasswordBad(backupPassword)}
          go={{ ...step('test', () => backup('test')), disabled: emailBad(backupUser) !== null || backupUser.trim() === '' || (backupPassword === '' && !clearBackup && !(backupSaved && backupUser.trim().toLowerCase() === s.backup.user)) }}
        >
          <SecretField
            key={`backup:${s.backup.passwordSet}`}
            id="ms-backup-password"
            value={backupPassword}
            onChange={setBackupPassword}
            isSet={s.backup.passwordSet && backupUser.trim().toLowerCase() === s.backup.user}
            savedOn={s.backup.lastChangedAt ? formatDate(s.backup.lastChangedAt) : null}
            removed={clearBackup}
            onRemoveChange={(r) => {
              setClearBackup(r);
              if (r) setBackupPassword('');
            }}
            disabled={busy || !s.canStorePassword}
            invalid={Boolean(errors.backupPassword || appPasswordBad(backupPassword))}
            noun="app password"
            placeholder={tr('16 letters')}
          />
        </SetupAsk>
      ),
    },
    {
      id: 'test',
      title: S.test.title,
      hints: S.test.hints,
      done: Boolean(s.lastTest?.ok),
      content: (
        <div className="pf-setup-stack">
          <div className="pf-setup-ask">
            <label className="form-label" htmlFor="ms-test-to">
              {T.smtp.test.to}
            </label>
            <input id="ms-test-to" type="email" inputMode="email" className={`form-control${emailBad(testTo) ? ' is-invalid' : ''}`} maxLength={254} placeholder="you@example.com" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
            <FieldHint>{emailBad(testTo) ?? tr('A test uses the saved settings.')}</FieldHint>
          </div>
          <SetupTest label={tr('Test Amazon SES')} disabled={!sesSaved || testTo.trim() === '' || emailBad(testTo) !== null} run={() => plain('primary')} />
          <SetupTest label={tr('Test Google backup')} disabled={!backupSaved || testTo.trim() === '' || emailBad(testTo) !== null} run={() => plain('backup')} />
        </div>
      ),
    },
  ];
}
