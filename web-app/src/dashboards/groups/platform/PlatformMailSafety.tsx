'use client';

// Platform settings > Bounces and holds (Super Admin only; platform migration 0130; MAIL-PROVIDERS-50K plan): the webhook addresses to paste into Amazon SNS and Brevo, the hotels
// whose campaign mail is held (release with a reason, or hold one by hand), and the suppressed addresses (search, add by hand, lift). The server checks every action again and
// audits it. Pallav's Settings card layout (settings.css: st-card, st-head, st-field).
import { useState } from 'react';

import { formatDateTime } from '@shared/dashboards/format';
import { MAIL_SAFETY_LIMITS as L, mailSafetyCopy as C, type MailHold, type MailSafetyView, type MailSuppression } from '@shared/dashboards/mailSafety';
import { createMailSafetyMock } from '@shared/dashboards/mailSafety.mock';
import { setupCopy } from '@shared/dashboards/platform';

import { useAction } from '@/components/ui';
import { createHttpMailSafetyApi } from '@/lib/api/adapters/mailSafety';
import { chooseApi } from '@/lib/api/mode';
import { Bi, Button, Dialog, FieldError, FieldHint } from '@/dashboards/pallav/ui';
import { StaleNote, Wait, useLoaded } from '../payrollCore/load';
import d from './desktop.module.css';

import { tr } from '@/lib/i18n/language';
const api = chooseApi(createHttpMailSafetyApi, createMailSafetyMock);

/** The mail wizard shows one part per step: the addresses to paste (webhooks), the held hotels (holds), the blocked addresses (blocked). */
export type MailSafetyPart = 'webhooks' | 'holds' | 'blocked';

export function PlatformMailSafety({ part }: { part?: MailSafetyPart } = {}) {
  const [version, setVersion] = useState(0);
  const [search, setSearch] = useState('');
  const [typed, setTyped] = useState('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const { data, error, reload } = useLoaded(() => api.view({ ...(search ? { search } : {}), ...(cursor ? { cursor } : {}) }), [version, search, cursor]);
  const refresh = () => setVersion((n) => n + 1);
  const shows = (p: MailSafetyPart) => part === undefined || part === p;

  return (
    <div className="st-card">
      {part === undefined ? (
        <div className="st-head">
          <div className="st-icon">
            <Bi name="shield-exclamation" />
          </div>
          <div>
            <h2 className="st-title">{C.title}</h2>
            <p className="st-about">{C.intro}</p>
          </div>
        </div>
      ) : null}
      <div className={d.body}>
      {!data ? (
        <Wait error={error} onRetry={reload} tiles={false} rows={4} />
      ) : (
        <>
          <StaleNote error={error} onRetry={reload} />
          {!data.ready ? (
            <div className="alert alert-warning" role="status">
              <Bi name="exclamation-triangle" /> {C.notReady}
            </div>
          ) : null}
          {shows('holds') ? <p className="small text-muted">{C.limits(data.limits)}</p> : null}
          {shows('webhooks') ? <Webhooks view={data} onChanged={refresh} /> : null}
          {shows('holds') ? <Holds holds={data.holds} onChanged={refresh} /> : null}
          {shows('blocked') ? (
          <section className={`st-field wide${part ? '' : ' mt-4'}`}>
            <h3 className="form-label">{C.suppressionsTitle}</h3>
            <form
              className="d-flex flex-wrap gap-2 mb-2"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                setCursor(undefined);
                setSearch(typed.trim());
              }}
            >
              <input className="form-control" style={{ maxWidth: 320 }} type="search" placeholder={tr("Search an address")} value={typed} maxLength={254} onChange={(e) => setTyped(e.target.value)} aria-label={tr("Search an address")} />
              <Button type="submit" variant="outline" icon="search">
                {tr("Search")}
              </Button>
            </form>
            <SuppressionList rows={data.suppressions} onChanged={refresh} />
            <div className="d-flex gap-2 mt-2">
              {cursor ? (
                <Button variant="outline" size="sm" onClick={() => setCursor(undefined)}>
                  {tr("First page")}
                </Button>
              ) : null}
              {data.nextCursor ? (
                <Button variant="outline" size="sm" onClick={() => setCursor(data.nextCursor ?? undefined)}>
                  {tr("Next page")}
                </Button>
              ) : null}
            </div>
            <AddSuppression disabled={!data.ready} onAdded={refresh} />
          </section>
          ) : null}
        </>
      )}
      </div>
    </div>
  );
}

type Provider = 'ses' | 'brevo';
const SERVICE: Record<Provider, string> = { ses: 'Amazon SES (through SNS)', brevo: 'Brevo' };

function Webhooks({ view, onChanged }: { view: MailSafetyView; onChanged: () => void }) {
  const { webhooks } = view;
  const [asking, setAsking] = useState<Provider | null>(null);
  const { busy, run } = useAction();
  if (!webhooks) return <p className="small text-muted">{C.noWebhooks}</p>;
  const row = (p: Provider, help: string) => {
    const until = view.previousKeyUntil[p];
    return (
      <div className="mb-3">
        <label className="form-label small mb-1" htmlFor={`mail-hook-${p}`}>
          {SERVICE[p]}
        </label>
        <div className="d-flex flex-wrap gap-2 align-items-start">
          <input id={`mail-hook-${p}`} className="form-control font-monospace" style={{ flex: '1 1 260px', minWidth: 0 }} readOnly value={webhooks[p]} onFocus={(e) => e.currentTarget.select()} />
          <Button variant="outline" icon="arrow-repeat" disabled={busy} onClick={() => setAsking(p)}>
            {C.rotate}
          </Button>
        </div>
        <FieldHint>{help}</FieldHint>
        {until ? (
          <p className="small text-muted mb-0">
            <Bi name="clock-history" /> {C.previousUntil(formatDateTime(until))}
          </p>
        ) : null}
      </div>
    );
  };
  return (
    <section className="st-field wide">
      <h3 className="form-label">{C.webhooksTitle}</h3>
      {row('ses', C.webhookSes)}
      <p className="small text-muted text-break">{view.snsTopicArn ? C.snsTopic(view.snsTopicArn) : C.snsTopicNone}</p>
      {row('brevo', C.webhookBrevo)}
      <p className="small text-danger mb-0">
        <Bi name="lock" /> {C.webhookSecret}
      </p>
      <Dialog
        open={asking !== null}
        tone="danger"
        icon="arrow-repeat"
        title={asking ? C.rotateAsk(SERVICE[asking]) : ''}
        message=""
        confirmLabel={C.rotate}
        cancelLabel="Cancel"
        busy={busy}
        onCancel={() => setAsking(null)}
        onConfirm={() => {
          if (!asking) return;
          void run(() => api.rotateKey(asking), { success: (r) => C.rotated(formatDateTime(r.previousUntil)), onOk: () => { setAsking(null); onChanged(); } });
        }}
      />
    </section>
  );
}

function Holds({ holds, onChanged }: { holds: MailHold[]; onChanged: () => void }) {
  return (
    <section className="st-field wide">
      <h3 className="form-label">{C.holdsTitle}</h3>
      {holds.length === 0 ? <p className="small text-muted mb-0">{C.noHolds}</p> : holds.map((h) => <HoldRow key={h.hotelId} hold={h} onChanged={onChanged} />)}
    </section>
  );
}

function HoldRow({ hold, onChanged }: { hold: MailHold; onChanged: () => void }) {
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  const after = {
    onFields: setErrors,
    onOk: () => {
      setReason('');
      onChanged();
    },
  };
  const act = () =>
    void (hold.held ? run(() => api.release(hold.hotelId, reason), { ...after, success: 'Released: campaign mail goes again.' }) : run(() => api.hold(hold.hotelId, reason), { ...after, success: 'Held: campaign mail stops.' }));
  return (
    <div className="border rounded p-2 mb-2">
      <div className="d-flex flex-wrap gap-2 align-items-center">
        <strong className="me-auto">{hold.hotelName}</strong>
        <span className={`badge ${hold.held ? 'text-bg-danger' : 'text-bg-secondary'}`}>{hold.held ? C.held : C.released}</span>
      </div>
      <div className="small">
        {C.holdReason[hold.reason]}: {hold.detail}
      </div>
      <div className="small text-muted">
        {formatDateTime(hold.heldAt)} · {hold.heldByName ?? C.automatic}
        {hold.releasedAt ? ` · released ${formatDateTime(hold.releasedAt)} by ${hold.releasedByName ?? 'someone'}${hold.releaseReason ? `: ${hold.releaseReason}` : ''}` : ''}
      </div>
      <fieldset className="d-flex flex-wrap gap-2 align-items-start mt-2" disabled={busy}>
        <input className="form-control form-control-sm" style={{ maxWidth: 320 }} placeholder={hold.held ? C.releaseAsk : C.holdAsk} value={reason} maxLength={L.reasonMax} onChange={(e) => setReason(e.target.value)} aria-label={hold.held ? C.releaseAsk : C.holdAsk} />
        <Button size="sm" variant={hold.held ? 'outline' : 'danger'} icon={hold.held ? 'play-circle' : 'pause-circle'} onClick={act} disabled={reason.trim().length < L.reasonMin}>
          {hold.held ? tr("Release") : tr("Hold again")}
        </Button>
      </fieldset>
      <FieldError>{errors.reason}</FieldError>
    </div>
  );
}

function SuppressionList({ rows, onChanged }: { rows: MailSuppression[]; onChanged: () => void }) {
  const { busy, run } = useAction();
  if (rows.length === 0) return <p className="small text-muted">{C.noSuppressions}</p>;
  return (
    <div className="table-responsive">
      <table className="table table-sm align-middle" data-cards="">
        <thead>
          <tr>
            <th>{tr("Address")}</th>
            <th>{tr("For")}</th>
            <th>{tr("Why")}</th>
            <th>{tr("When")}</th>
            <th aria-label={tr("Actions")} />
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id}>
              <td data-label="Address" className="text-break">
                {s.email}
              </td>
              <td data-label="For">{s.hotelName ?? C.everyHotel}</td>
              <td data-label="Why">
                {C.reason[s.reason]} <span className="text-muted small">({C.source[s.source]}{s.detail ? `: ${s.detail}` : ''})</span>
              </td>
              <td data-label="When">
                {formatDateTime(s.createdAt)}
                {s.createdByName ? <span className="text-muted small"> · {s.createdByName}</span> : null}
              </td>
              <td className="text-end">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Lift the suppression of ${s.email}? Campaign mail may go to it again.`)) void run(() => api.unsuppress(s.id), { success: 'Suppression lifted.', onOk: onChanged });
                  }}
                >
                  {tr("Lift")}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddSuppression({ disabled, onAdded }: { disabled: boolean; onAdded: () => void }) {
  const [email, setEmail] = useState('');
  const [hotelId, setHotelId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  const badEmail = email.trim() !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const add = () =>
    void run(() => api.suppress({ email: email.trim(), hotelId: hotelId.trim() || null }), {
      success: 'Address suppressed.',
      onFields: setErrors,
      onOk: () => {
        setEmail('');
        setHotelId('');
        onAdded();
      },
    });
  return (
    <fieldset className="mt-3" disabled={busy || disabled}>
      <legend className="form-label">{C.addTitle}</legend>
      <div className="d-flex flex-wrap gap-2 align-items-start">
        <input className="form-control" style={{ maxWidth: 300 }} type="email" inputMode="email" placeholder={tr("name@example.com")} value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} aria-label={tr("Email address")} />
        <input className="form-control" style={{ maxWidth: 300 }} placeholder={tr("Hotel id (optional)")} value={hotelId} maxLength={36} onChange={(e) => setHotelId(e.target.value)} aria-label={tr("Hotel id (optional)")} />
        <Button icon="slash-circle" onClick={add} disabled={email.trim().length < 3 || badEmail}>
          {tr("Suppress")}
        </Button>
      </div>
      <FieldHint>{C.addHint}</FieldHint>
      <FieldError>{errors.email ?? errors.hotelId ?? (badEmail ? setupCopy.check.email : null)}</FieldError>
    </fieldset>
  );
}
