'use client';

// Platform settings > Mail senders (Super Admin): every sender identity, the platform's own sending domain and each hotel's own domain ("My own domain"). For each one the
// DNS records card (MailIdentityCard) and the two things only the Super Admin does in Amazon SES: paste the three DKIM names SES shows for the domain, and confirm the domain
// exists in SES. Contract: platformApi.listMailIdentities / saveMailIdentity / checkMailIdentity (mailProviders.ts).
import { useState } from 'react';

import type { MailSenderIdentity } from '@shared/dashboards/mailProviders';
import { setupCopy } from '@shared/dashboards/platform';

import type { ScreenProps } from '../../types';
import { useAction } from '@/components/ui';
import { Bi, Button, EmptyState, FieldError, FieldHint, LoadError, PageSkeleton } from '@/dashboards/pallav/ui';
import { MailIdentityCard } from '../admin/MailIdentityCard';
import { useLoaded } from '../payrollCore/load';
import { platformApi } from './api';
import { actAs } from './PlatformStaff';

import { tr, trf } from '@/lib/i18n/language';
/** The mail wizard shows one question per step: the DKIM names (dkim), then whether SES shows the domain as verified (verified). */
export type MailSendersPart = 'dkim' | 'verified';
const dkimBad = (v: string) => v.trim() !== '' && !/^[a-z0-9]{32}$/.test(v.trim());

export function PlatformMailSenders({ user, part }: { user: ScreenProps['user']; part?: MailSendersPart }) {
  const [version, setVersion] = useState(0);
  // the preview's mock decides "Super Admin" from the person the screen declares (as Platform health does); without it the list answered "no access"
  const list = useLoaded(() => {
    actAs(user);
    return platformApi.listMailIdentities();
  }, [version]);
  return (
    <div className="st-card">
      <div className="st-head">
        <div className="st-icon">
          <Bi name="patch-check" />
        </div>
        <div>
          <h2 className="st-title">{tr("Mail senders")}</h2>
          <p className="st-about">The domains mail is sent from: the platform&apos;s sending domain and every hotel that chose &ldquo;My own domain&rdquo;. A domain sends once its DNS records are found and Amazon SES shows it as verified.</p>
        </div>
      </div>
      <div className="st-grid">
        <div className="st-field wide">
          {!list.data ? (
            list.error ? <LoadError error={list.error} onRetry={list.reload} /> : <PageSkeleton tiles={false} rows={3} />
          ) : list.data.length === 0 ? (
            <EmptyState icon="envelope-at" title={tr("No sender domain yet")} text="Set the platform's sending domain under Mail sender. A hotel that chooses My own domain appears here too." />
          ) : (
            list.data.map((i) => <Sender key={`${i.scope}:${i.checkedAt ?? ''}:${i.dkimReady}:${i.sesConfirmed}`} identity={i} user={user} part={part} onChanged={() => setVersion((n) => n + 1)} />)
          )}
        </div>
      </div>
    </div>
  );
}

function Sender({ identity, user, part, onChanged }: { identity: MailSenderIdentity; user: ScreenProps['user']; part?: MailSendersPart; onChanged: () => void }) {
  const [current, setCurrent] = useState(identity);
  const [tokens, setTokens] = useState<string[]>(['', '', '']);
  const [error, setError] = useState<string | null>(null);
  const saver = useAction();
  const checker = useAction();
  const save = (input: { dkimTokens?: string[]; sesConfirmed?: boolean }) =>
    void saver.run(() => {
      actAs(user);
      return platformApi.saveMailIdentity(current.scope, input);
    }, {
      success: input.dkimTokens ? 'DKIM names saved. Add the records, then check DNS.' : input.sesConfirmed ? 'Marked as verified in Amazon SES.' : 'Marked as not verified in Amazon SES.',
      onFields: (f) => setError(f.dkimTokens ?? null),
      onOk: (i) => {
        setCurrent(i);
        setTokens(['', '', '']);
        onChanged();
      },
    });
  const check = () =>
    void checker.run(() => {
      actAs(user);
      return platformApi.checkMailIdentity(current.scope);
    }, { onOk: (i) => setCurrent(i) });

  return (
    <MailIdentityCard identity={current} onCheck={check} checking={checker.busy}>
      {part !== 'verified' ? (
      <details className="mb-3" open={!current.dkimReady || part === 'dkim'}>
        <summary className="small fw-semibold">{current.dkimReady ? tr("Change the DKIM names") : tr("Paste the three DKIM names from Amazon SES")}</summary>
        <form
          className="mt-2"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            save({ dkimTokens: tokens.map((x) => x.trim()) });
          }}
        >
          <FieldHint>{tr("In Amazon SES, open the domain under Identities: the three CNAME names start with a long code before ._domainkey. Paste only those codes.")}</FieldHint>
          <div className="mi-tokens">
            {tokens.map((v, n) => (
              <input
                key={n}
                className={`form-control font-monospace${error || dkimBad(v) ? ' is-invalid' : ''}`}
                aria-label={trf("DKIM name {0}", [n + 1])}
                placeholder={trf("DKIM name {0}", [n + 1])}
                autoCapitalize="off"
                autoComplete="off"
                spellCheck={false}
                maxLength={64}
                value={v}
                onChange={(e) => setTokens((t) => t.map((x, k) => (k === n ? e.target.value : x)))}
              />
            ))}
          </div>
          <FieldError>{error ?? (tokens.some(dkimBad) ? setupCopy.check.dkim : null)}</FieldError>
          <Button type="submit" size="sm" icon="check2" disabled={saver.busy || tokens.some((x) => !x.trim() || dkimBad(x))} className="mt-2">
            {tr("Save DKIM names")}
          </Button>
        </form>
      </details>
      ) : null}
      {part !== 'dkim' ? (
      <label className="st-toggle mb-3" htmlFor={`ses-${current.scope}`}>
        <input type="checkbox" id={`ses-${current.scope}`} checked={current.sesConfirmed} disabled={saver.busy} onChange={(e) => save({ sesConfirmed: e.target.checked })} />
        <span className="st-switch" aria-hidden="true" />
        <span className="st-toggle-text">
          <strong>{tr("Amazon SES shows this domain as verified")}</strong>
          <small>{tr("Switch on once SES lists the domain as Verified. Mail is sent from it only when this is on and the DNS records are found.")}</small>
        </span>
      </label>
      ) : null}
    </MailIdentityCard>
  );
}