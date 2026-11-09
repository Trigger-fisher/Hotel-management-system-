'use client';

// A sender identity's DNS card (mail sender identities, A's contract in mailProviders.ts): the domain and where it stands, the plain "what to do now" sentence, then one
// row per DNS record (type, name, value with a Copy button, required or recommended, and what the last check found) and a Check button. Used by hotel Settings > Email
// ("My own domain") and by the Super Admin's Platform settings > Mail senders. On a phone the records are cards; long names and values wrap.
import { useState, type ReactNode } from 'react';

import { formatDateTime } from '@shared/dashboards/format';
import type { MailDnsRecord, MailSenderIdentity } from '@shared/dashboards/mailProviders';

import { useToast } from '@/components/ui';
import { Bi, Button, StatusChip } from '@/dashboards/pallav/ui';

import { tr, trf } from '@/lib/i18n/language';
const STATE: Record<MailDnsRecord['state'], { tone: 'ok' | 'warn' | 'danger' | 'neutral'; text: string }> = {
  ok: { tone: 'ok', text: 'Found' },
  missing: { tone: 'warn', text: 'Not found' },
  wrong: { tone: 'danger', text: 'Wrong value' },
  unchecked: { tone: 'neutral', text: 'Not checked' },
};

function CopyButton({ value, what }: { value: string; what: string }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  const copy = () => {
    const ok = () => {
      setDone(true);
      window.setTimeout(() => setDone(false), 1600);
    };
    if (navigator.clipboard) void navigator.clipboard.writeText(value).then(ok, () => toast.show({ tone: 'error', text: 'Could not copy. Select the text and copy it by hand.' }));
    else toast.show({ tone: 'error', text: 'Could not copy. Select the text and copy it by hand.' });
  };
  return (
    <Button size="sm" variant="outline" icon={done ? 'check2' : 'clipboard'} onClick={copy} aria-label={trf("Copy the {0}", [what])}>
      {done ? tr("Copied") : tr("Copy")}
    </Button>
  );
}

export function MailIdentityCard({ identity, onCheck, checking, children }: { identity: MailSenderIdentity; onCheck: () => void; checking: boolean; children?: ReactNode }) {
  const verified = identity.status === 'verified';
  return (
    <div className="mi-card">
      <div className="mi-head">
        <div className="min-w-0 me-auto">
          <strong className="text-break">{identity.domain}</strong>
          <div className="small text-muted">
            {identity.hotelName ?? tr("The platform")}
            {identity.fromAddress ? ` · sends from ${identity.fromAddress}` : ''}
          </div>
        </div>
        <StatusChip tone={verified ? 'ok' : 'warn'}>{verified ? tr("Verified") : tr("Waiting for DNS")}</StatusChip>
      </div>
      <p className="mi-next" role="status">
        <Bi name={verified ? 'check-circle' : 'signpost-2'} /> {identity.nextStep}
      </p>
      {children}
      {identity.records.length === 0 ? (
        <p className="small text-muted mb-2">{tr("The DNS records appear here once the platform has added the domain to its mail service.")}</p>
      ) : (
        <ul className="mi-records">
          {identity.records.map((r) => (
            <li key={r.id} className={`mi-rec ${r.state}`}>
              <div className="mi-rec-top">
                <span className="mi-type">{r.type}</span>
                <span className="small fw-semibold me-auto">{r.purpose}</span>
                {/required|recommended/i.test(r.purpose) ? null : <span className="small text-muted">{r.required ? tr("Required") : tr("Recommended")}</span>}
                <StatusChip tone={STATE[r.state].tone}>{STATE[r.state].text}</StatusChip>
              </div>
              <div className="mi-kv">
                <span className="mi-k">{tr("Name")}</span>
                <code className="mi-v">{r.name}</code>
                <CopyButton value={r.name} what={`${r.type} name`} />
              </div>
              <div className="mi-kv">
                <span className="mi-k">{tr("Value")}</span>
                <code className="mi-v">{r.value}</code>
                <CopyButton value={r.value} what={`${r.type} value`} />
              </div>
              {r.state === 'wrong' && r.found ? <div className="small text-danger mt-1">{tr("Found instead:")} {r.found}</div> : null}
            </li>
          ))}
        </ul>
      )}
      <div className="d-flex align-items-center gap-2 flex-wrap">
        <Button variant="outline" icon="arrow-repeat" disabled={checking} onClick={onCheck}>
          {checking ? tr("Checking…") : tr("Check DNS now")}
        </Button>
        <span className="small text-muted">{identity.checkedAt ? `Last checked ${formatDateTime(identity.checkedAt)}` : tr("Not checked yet.")}</span>
      </div>
    </div>
  );
}