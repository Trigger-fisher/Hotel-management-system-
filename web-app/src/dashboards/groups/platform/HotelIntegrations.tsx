'use client';

// The Integrations tab of a hotel's page (Super Admin only; MJ, 5 Nov 2026: "all the setup 3rd party will be done from there"): every outside service of this hotel with
// its plain state and one next-step button that opens its step-by-step wizard here: online payments (rooms and food), its mail, its WhatsApp number and rules, the website's
// Google keys, API keys that reach it and its nightly backup. A saved secret is only a mask; the server never sends it back.
import { useEffect, useState } from 'react';

import { formatDate, formatDateTime } from '@shared/dashboards/format';
import { setupCopy as T } from '@shared/dashboards/platform';

import { useAction } from '@/components/ui';
import { Bi, Button, Field, FieldHint, PickGroup, SecretField } from '@/dashboards/pallav/ui';
import type { ScreenProps } from '../../types';
import { WhatsAppConnections, lineWord } from '../conversations/WhatsAppConnections';
import { WhatsAppHotelRules } from '../conversations/WhatsAppRules';
import { whatsappAdminApi } from '../conversations/whatsappAdminApi';
import { useLoaded } from '../payrollCore/load';
import { platformApi } from './api';
import { asActor } from './enter';
import { MailOwnerEditor } from './HotelMail';
import { ApiKeysWizard, apiAccessApi } from './PlatformApiAccess';
import { setupApi, type PayBusiness, type PayMode, type PaySetup } from './setupApi';
import { CopyLine, SetupChecklist, SetupTest, SetupWizard, type SetupRow, type SetupState, type WizardStep } from './setupParts';

type Hotel = { id: string; name: string };
export type HotelService = 'payments' | 'mail' | 'whatsapp' | 'website' | 'api' | 'backup' | 'idPhotos';
const SERVICES: readonly HotelService[] = ['payments', 'mail', 'whatsapp', 'website', 'api', 'backup', 'idPhotos'];
export const isHotelService = (x: string | undefined): x is HotelService => SERVICES.includes(x as HotelService);

const KEY_ID = (mode: PayMode) => new RegExp(`^rzp_${mode}_[A-Za-z0-9]{8,32}$`);
const GOOGLE_CLIENT = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/;
const MAPS_KEY = /^AIza[0-9A-Za-z_-]{20,}$/;

function payState(p: PaySetup | undefined, when: (iso: string) => string): { state: SetupState; reason: string | null } {
  if (!p || !p.keyId || !p.keySecretSet) return { state: 'not_set_up', reason: T.reasons.keysMissing };
  if (!p.webhookSecretSet || !p.lastWebhookAt) return { state: 'attention', reason: T.reasons.webhookMissing };
  if (p.lastTest && !p.lastTest.ok) return { state: 'attention', reason: p.lastTest.message };
  if (!p.enabled) return { state: 'attention', reason: T.reasons.payOff };
  return { state: 'working', reason: p.lastPaymentAt ? T.reasons.lastPayment(when(p.lastPaymentAt)) : null };
}

/** The states of one hotel's services. */
function usePerHotel(hotelId: string, version: number) {
  const pay = useLoaded(() => setupApi.payments(hotelId), [hotelId, version]);
  const backup = useLoaded(() => setupApi.backup(hotelId), [hotelId, version]);
  const site = useLoaded(() => setupApi.website(hotelId), [hotelId, version]);
  const wa = useLoaded(() => whatsappAdminApi.hotelRules(hotelId), [hotelId, version]);
  const mail = useLoaded(() => platformApi.listHotelMail(), [version]);
  const keys = useLoaded(() => apiAccessApi.view(), [version]);
  const ids = useLoaded(() => setupApi.idPhotos(hotelId), [hotelId, version]);

  const rows = (go: { open: (s: HotelService) => void; when: (iso: string) => string }): SetupRow[] => {
    const failed = (e: unknown) => (e ? { state: 'attention' as const, reason: T.reasons.readFailed } : null);
    const ph = failed(pay.error) ?? payState(pay.data?.items.find((p) => p.business === 'hotel'), go.when);
    const pf = failed(pay.error) ?? payState(pay.data?.items.find((p) => p.business === 'food'), go.when);
    const b = backup.data;
    const bs = failed(backup.error) ?? (!b || !b.connected ? { state: 'not_set_up' as const, reason: null } : b.lastRunOk === false ? { state: 'attention' as const, reason: T.reasons.backupFailed } : !b.lastRunAt ? { state: 'attention' as const, reason: T.reasons.backupNever } : { state: 'working' as const, reason: T.reasons.backupLast(go.when(b.lastRunAt)) });
    const s = site.data;
    const ss = failed(site.error) ?? (s && (s.mapsKeySet || s.gbpClientSecretSet) ? { state: 'working' as const, reason: null } : { state: 'not_set_up' as const, reason: T.reasons.websiteNone });
    const line = wa.data?.line ?? null;
    const ws = failed(wa.error) ?? (!line ? { state: 'not_set_up' as const, reason: T.reasons.hotelWaNone } : lineWord(line).tone === 'danger' ? { state: 'attention' as const, reason: lineWord(line).text } : { state: 'working' as const, reason: T.reasons.hotelWaOn(line.displayName ?? line.label) });
    const m = mail.data?.find((x) => x.hotelId === hotelId);
    const ms = failed(mail.error) ?? (m?.pause ? { state: 'attention' as const, reason: m.pause.reason } : { state: 'working' as const, reason: m && (m.ses || m.gmail) && m.address ? T.reasons.mailOwn(m.address) : T.reasons.mailPlatform });
    const live = (keys.data?.keys ?? []).filter((k) => k.scope === 'hotel' && k.hotelId === hotelId && k.expiresInHours > 0).length;
    const as = failed(keys.error) ?? (live > 0 ? { state: 'working' as const, reason: T.reasons.apiKeys(live) } : { state: 'not_set_up' as const, reason: T.reasons.apiNone });
    const is = failed(ids.error) ?? { state: 'working' as const, reason: ids.data?.exactCopy ? T.reasons.idExact : T.reasons.idSharp };
    const label = (st: SetupState) => (st === 'not_set_up' ? T.setUp : st === 'attention' ? T.fix : T.open);
    const row = (id: string, s: HotelService, icon: string, title: string, text: string, st: { state: SetupState; reason: string | null }): SetupRow => ({ id, icon, title, text, ...st, action: { label: label(st.state), onClick: () => go.open(s) } });
    return [
      row('pay-hotel', 'payments', 'credit-card', `${T.services.payments.title}: ${T.payments.business.hotel}`, T.services.payments.text, ph),
      row('pay-food', 'payments', 'cup-hot', `${T.services.payments.title}: ${T.payments.business.food}`, T.services.payments.text, pf),
      row('hotel-mail', 'mail', 'envelope', T.services.hotelMail.title, T.services.hotelMail.text, ms),
      row('hotel-wa', 'whatsapp', 'whatsapp', T.services.hotelWhatsapp.title, T.services.hotelWhatsapp.text, ws),
      row('website', 'website', 'globe2', T.services.website.title, T.services.website.text, ss),
      row('api', 'api', 'key', T.services.hotelApi.title, T.services.hotelApi.text, as),
      row('backup', 'backup', 'cloud-arrow-up', T.services.hotelBackup.title, T.services.hotelBackup.text, bs),
      row('id-photos', 'idPhotos', 'person-vcard', T.services.idPhotos.title, T.services.idPhotos.text, is),
    ];
  };
  return { rows };
}

/** The Integrations tab. `first` opens a service's wizard straight away (an old Set-up centre link). */
export function HotelIntegrations({ hotel, user, first }: { hotel: Hotel; user: ScreenProps['user']; first?: { service?: string; step?: string } }) {
  const [service, setService] = useState<HotelService | null>(() => (isHotelService(first?.service) ? first.service : null));
  const [step, setStep] = useState(first?.step ?? '');
  const [version, setVersion] = useState(0);
  const per = usePerHotel(hotel.id, version);
  useEffect(() => {
    if (service) window.scrollTo?.({ top: 0 });
  }, [service]);
  const open = (s: HotelService) => {
    setService(s);
    setStep('');
  };
  const close = () => {
    setService(null);
    setStep('');
    setVersion((n) => n + 1);
  };
  const wizard = { hotel, step, onStep: setStep, onClose: close };
  if (service === 'payments') return <PaymentsWizard {...wizard} />;
  if (service === 'backup') return <BackupWizard {...wizard} />;
  if (service === 'website') return <WebsiteWizard {...wizard} />;
  if (service === 'idPhotos') return <IdPhotosWizard {...wizard} />;
  if (service === 'mail') {
    const steps: WizardStep[] = [{ id: 'account', title: T.hotelMail.steps.account.title, hints: T.hotelMail.steps.account.hints, content: <MailOwnerEditor kind="hotel" id={hotel.id} user={user} onChanged={() => undefined} /> }];
    return <SetupWizard title={T.hotelMail.title(hotel.name)} steps={steps} step="account" onStep={setStep} onClose={close} />;
  }
  if (service === 'whatsapp') {
    const S = T.hotelWhatsapp.steps;
    const steps: WizardStep[] = [
      { id: 'number', title: S.number.title, hints: S.number.hints, content: <WhatsAppConnections /> },
      { id: 'rules', title: S.rules.title, hints: S.rules.hints, content: <WhatsAppHotelRules hotelId={hotel.id} /> },
    ];
    return <SetupWizard title={T.hotelWhatsapp.title(hotel.name)} steps={steps} step={step || 'number'} onStep={setStep} onClose={close} />;
  }
  if (service === 'api') return <ApiKeysWizard step={step} onStep={setStep} onClose={close} hotelId={hotel.id} />;
  const rows = per.rows({ open, when: formatDateTime });
  const needs = rows.filter((r) => r.state === 'attention').length;
  return (
    <>
      <div className="pf-sec">
        <h3>{T.hotelTab.tab}</h3>
        <span className="pf-sec-note">{needs ? T.needWork(needs) : T.hotelTab.intro}</span>
      </div>
      <SetupChecklist label={T.hotelTab.label(hotel.name)} rows={rows} className="reveal" />
    </>
  );
}

/** A group's own outside services on its page (Super Admin only): today its mail account. */
export function GroupIntegrations({ group, user }: { group: { id: string; name: string }; user: ScreenProps['user'] }) {
  const [opened, setOpened] = useState(false);
  const [version, setVersion] = useState(0);
  const mail = useLoaded(() => {
    asActor(user);
    return platformApi.listGroupMail();
  }, [version]);
  if (opened) {
    const steps: WizardStep[] = [{ id: 'account', title: T.hotelMail.steps.account.title, hints: T.hotelMail.steps.account.hints, content: <MailOwnerEditor kind="group" id={group.id} user={user} onChanged={() => undefined} /> }];
    return (
      <SetupWizard
        title={T.groupMail.title(group.name)}
        steps={steps}
        step="account"
        onStep={() => undefined}
        onClose={() => {
          setOpened(false);
          setVersion((n) => n + 1);
        }}
      />
    );
  }
  const m = mail.data?.find((x) => x.groupId === group.id);
  const st: { state: SetupState; reason: string | null } = mail.error
    ? { state: 'attention', reason: T.reasons.readFailed }
    : m?.pause
      ? { state: 'attention', reason: m.pause.reason }
      : { state: 'working', reason: m && (m.ses || m.gmail) && m.address ? T.reasons.mailOwn(m.address) : T.reasons.mailPlatform };
  const rows: SetupRow[] = [{ id: 'group-mail', icon: 'envelope', title: T.groupMail.row, text: T.groupMail.note, ...st, action: { label: st.state === 'attention' ? T.fix : T.open, onClick: () => setOpened(true) } }];
  return (
    <>
      <div className="pf-sec">
        <h3>{T.groupMail.section}</h3>
        <span className="pf-sec-note">{T.groupMail.note}</span>
      </div>
      <SetupChecklist label={T.groupMail.title(group.name)} rows={rows} className="reveal mb-3" />
    </>
  );
}

type WizardProps = { hotel: Hotel; step: string; onStep: (s: string) => void; onClose: () => void };

function PaymentsWizard({ hotel, step, onStep, onClose }: WizardProps) {
  const [business, setBusiness] = useState<PayBusiness>('hotel');
  const [version, setVersion] = useState(0);
  const { data } = useLoaded(() => setupApi.payments(hotel.id), [hotel.id, version]);
  const cur = data?.items.find((p) => p.business === business);
  const P = T.payments;
  const S = P.steps;
  const reload = () => setVersion((n) => n + 1);
  const steps: WizardStep[] = [
    {
      id: 'business',
      title: S.business.title,
      done: Boolean(cur?.keyId),
      content: (
        <>
          <PickGroup<PayBusiness>
            label={S.business.title}
            value={business}
            onChange={setBusiness}
            choices={(['hotel', 'food'] as const).map((b) => ({ value: b, icon: b === 'hotel' ? 'building' : 'cup-hot', title: P.business[b], text: data?.items.find((p) => p.business === b)?.keySecretSet ? T.state.working : T.state.not_set_up }))}
          />
          <FieldHint>{P.businessHint}</FieldHint>
        </>
      ),
    },
    { id: 'mode', title: S.mode.title, hints: S.mode.hints, done: Boolean(cur?.keyId), content: cur ? <ModeStep key={`${business}:${version}`} hotelId={hotel.id} cur={cur} onSaved={reload} /> : null },
    { id: 'keys', title: S.keys.title, hints: S.keys.hints, done: Boolean(cur?.keyId && cur.keySecretSet), content: cur ? <KeysStep key={`${business}:${version}`} hotelId={hotel.id} cur={cur} onSaved={reload} /> : null },
    { id: 'webhook', title: S.webhook.title, hints: S.webhook.hints, done: Boolean(cur?.webhookSecretSet), content: cur ? <WebhookStep key={business} hotelId={hotel.id} cur={cur} onSaved={reload} /> : null },
    {
      id: 'test',
      title: S.test.title,
      done: Boolean(cur?.lastTest?.ok),
      content: (
        <>
          <p className="pf-sec-note">{P.testHint}</p>
          <SetupTest
            label={P.test}
            last={cur?.lastTest}
            run={async () => {
              const r = await setupApi.testPayments(hotel.id, business);
              reload();
              return r.ok ? { ok: r.data.ok, text: r.data.message, fix: r.data.hint } : { ok: false, text: r.error.message };
            }}
          />
        </>
      ),
    },
    { id: 'on', title: S.on.title, done: Boolean(cur?.enabled), content: cur ? <OnStep key={`${business}:${version}`} hotelId={hotel.id} cur={cur} onSaved={reload} /> : null },
  ];
  return <SetupWizard title={`${P.title(hotel.name)}: ${P.business[business]}`} steps={steps} step={step || 'business'} onStep={onStep} onClose={onClose} />;
}

function ModeStep({ hotelId, cur, onSaved }: { hotelId: string; cur: PaySetup; onSaved: () => void }) {
  const { busy, run } = useAction();
  const P = T.payments;
  return (
    <PickGroup<PayMode>
      label={P.steps.mode.title}
      value={cur.mode}
      disabled={busy}
      onChange={(mode) => void run(() => setupApi.savePayments(hotelId, { business: cur.business, mode }), { success: P.saved, onOk: onSaved })}
      choices={(['test', 'live'] as const).map((m) => ({ value: m, icon: m === 'test' ? 'cone-striped' : 'lightning-charge', title: P.mode[m], text: P.modeHint[m] }))}
    />
  );
}

function KeysStep({ hotelId, cur, onSaved }: { hotelId: string; cur: PaySetup; onSaved: () => void }) {
  const P = T.payments;
  const [keyId, setKeyId] = useState(cur.keyId);
  const [secret, setSecret] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  const idBad = keyId.trim() !== '' && !KEY_ID(cur.mode).test(keyId.trim());
  const save = () => {
    const f: Record<string, string> = {};
    if (!KEY_ID(cur.mode).test(keyId.trim())) f.keyId = P.keyIdWrong(cur.mode);
    if (!secret && !cur.keySecretSet) f.keySecret = P.secretRequired;
    setErrors(f);
    if (Object.keys(f).length) return;
    void run(() => setupApi.savePayments(hotelId, { business: cur.business, keyId: keyId.trim(), ...(secret ? { keySecret: secret } : {}) }), {
      success: P.saved,
      onFields: setErrors,
      onOk: () => {
        setSecret('');
        onSaved();
      },
    });
  };
  return (
    <form
      className="row g-3"
      autoComplete="off"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Field label={P.keyId} col="col-12 col-md-6" error={errors.keyId ?? (idBad ? P.keyIdWrong(cur.mode) : undefined)}>
        <input className={`form-control pf-mono${errors.keyId || idBad ? ' is-invalid' : ''}`} value={keyId} placeholder={`rzp_${cur.mode}_`} spellCheck={false} autoCapitalize="off" onChange={(e) => setKeyId(e.target.value.trim())} />
      </Field>
      <Field label={P.keySecret} col="col-12 col-md-6" error={errors.keySecret}>
        <SecretField id="pf-pay-secret" value={secret} onChange={setSecret} isSet={cur.keySecretSet} savedOn={null} disabled={busy} invalid={Boolean(errors.keySecret)} noun="key" />
      </Field>
      <div className="col-12">
        <Button type="submit" icon="check2" busy={busy}>
          {P.save}
        </Button>
      </div>
    </form>
  );
}

function WebhookStep({ hotelId, cur, onSaved }: { hotelId: string; cur: PaySetup; onSaved: () => void }) {
  const P = T.payments;
  const [secret, setSecret] = useState<string | null>(null);
  const { busy, run } = useAction();
  return (
    <div className="pf-setup-stack">
      <Field label={P.webhookUrl} col="">
        <CopyLine id="pf-webhook-url" label={P.webhookUrl} value={cur.webhookUrl} />
      </Field>
      {secret ? (
        <Field label={P.webhookSecret} col="">
          <CopyLine id="pf-webhook-secret" label={P.webhookSecret} value={secret} />
          <FieldHint>
            <Bi name="exclamation-triangle" /> {P.secretOnce}
          </FieldHint>
        </Field>
      ) : (
        <div>
          {cur.webhookSecretSet && cur.webhookSecretAt ? <p className="pf-sec-note">{P.secretSaved(formatDate(cur.webhookSecretAt))}</p> : null}
          <Button
            variant={cur.webhookSecretSet ? 'outline' : 'primary'}
            icon="key"
            busy={busy}
            onClick={() =>
              void run(() => setupApi.makeWebhookSecret(hotelId, cur.business), {
                onOk: (r) => {
                  setSecret(r.secret);
                  onSaved();
                },
              })
            }
          >
            {P.makeSecret}
          </Button>
        </div>
      )}
    </div>
  );
}

function OnStep({ hotelId, cur, onSaved }: { hotelId: string; cur: PaySetup; onSaved: () => void }) {
  const P = T.payments;
  const { busy, run } = useAction();
  return (
    <label className="st-toggle" htmlFor="pf-pay-on">
      <input
        type="checkbox"
        id="pf-pay-on"
        checked={cur.enabled}
        disabled={busy}
        onChange={(e) => void run(() => setupApi.savePayments(hotelId, { business: cur.business, enabled: e.target.checked }), { success: P.saved, onOk: onSaved })}
      />
      <span className="st-switch" aria-hidden="true" />
      <span className="st-toggle-text">
        <strong>{P.on}</strong>
        <small>{P.onHint}</small>
      </span>
    </label>
  );
}

function BackupWizard({ hotel, step, onStep, onClose }: WizardProps) {
  const B = T.hotelBackup;
  const [version, setVersion] = useState(0);
  const { data } = useLoaded(() => setupApi.backup(hotel.id), [hotel.id, version]);
  const [clientId, setClientId] = useState<string | null>(null);
  const [secret, setSecret] = useState('');
  const [days, setDays] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  const id = clientId ?? data?.clientId ?? '';
  const keep = days ?? String(data?.keepDays ?? 30);
  const reload = () => setVersion((n) => n + 1);
  const saveDrive = () => {
    const f: Record<string, string> = {};
    if (!GOOGLE_CLIENT.test(id.trim())) f.clientId = B.clientIdWrong;
    setErrors(f);
    if (Object.keys(f).length) return;
    void run(() => setupApi.saveBackup(hotel.id, { clientId: id.trim(), ...(secret ? { clientSecret: secret } : {}) }), {
      success: T.payments.saved,
      onFields: setErrors,
      onOk: () => {
        setSecret('');
        reload();
        onStep('keep');
      },
    });
  };
  const saveKeep = () => {
    const n = Number(keep);
    if (!Number.isInteger(n) || n < 1 || n > 365) return setErrors({ keepDays: B.keepWrong });
    setErrors({});
    void run(() => setupApi.saveBackup(hotel.id, { keepDays: n }), { success: T.payments.saved, onFields: setErrors, onOk: () => { reload(); onStep('test'); } });
  };
  const steps: WizardStep[] = [
    {
      id: 'drive',
      title: B.steps.drive.title,
      hints: B.steps.drive.hints,
      done: data?.connected,
      content: (
        <div className="row g-3">
          <Field label={B.clientId} col="col-12 col-md-6" error={errors.clientId ?? (id.trim() !== '' && !GOOGLE_CLIENT.test(id.trim()) ? B.clientIdWrong : undefined)}>
            <input className="form-control pf-mono" value={id} spellCheck={false} autoCapitalize="off" onChange={(e) => setClientId(e.target.value.trim())} />
          </Field>
          <Field label={B.clientSecret} col="col-12 col-md-6" error={errors.clientSecret}>
            <SecretField id="pf-backup-secret" value={secret} onChange={setSecret} isSet={Boolean(data?.clientSecretSet)} savedOn={null} disabled={busy} invalid={Boolean(errors.clientSecret)} />
          </Field>
          <div className="col-12">
            <Button icon="check2" busy={busy} onClick={saveDrive}>
              {B.save}
            </Button>
          </div>
        </div>
      ),
    },
    {
      id: 'keep',
      title: B.steps.keep.title,
      content: (
        <div className="row g-3">
          <Field label={B.keepDays} col="col-12 col-md-4" error={errors.keepDays}>
            <input className="form-control" inputMode="numeric" maxLength={3} value={keep} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} />
            <FieldHint>{B.keepHint}</FieldHint>
          </Field>
          <div className="col-12">
            <Button icon="check2" busy={busy} onClick={saveKeep}>
              {B.save}
            </Button>
          </div>
        </div>
      ),
    },
    {
      id: 'test',
      title: B.steps.test.title,
      hints: B.steps.test.hints,
      done: Boolean(data?.lastRunOk),
      content: (
        <div className="pf-setup-tests">
          {(['test', 'run'] as const).map((s) => (
            <SetupTest
              key={s}
              label={s === 'test' ? B.test : B.run}
              run={async () => {
                const r = await setupApi.backupStep(hotel.id, s);
                reload();
                return r.ok ? { ok: r.data.ok, text: r.data.message, fix: r.data.hint } : { ok: false, text: r.error.message };
              }}
            />
          ))}
        </div>
      ),
    },
  ];
  return <SetupWizard title={B.title(hotel.name)} steps={steps} step={step || 'drive'} onStep={onStep} onClose={onClose} />;
}

/** One switch: how this hotel's guest ID pictures are stored (MJ, 5 Nov 2026). The server saves and audits it; HMS passes it into each ID picture job. */
function IdPhotosWizard({ hotel, onStep, onClose }: WizardProps) {
  const I = T.idPhotos;
  const [version, setVersion] = useState(0);
  const { data } = useLoaded(() => setupApi.idPhotos(hotel.id), [hotel.id, version]);
  const { busy, run } = useAction();
  const steps: WizardStep[] = [
    {
      id: 'copy',
      title: I.steps.copy.title,
      hints: I.steps.copy.hints,
      done: data !== undefined,
      content: (
        <label className="st-toggle" htmlFor="pf-id-exact">
          <input
            type="checkbox"
            id="pf-id-exact"
            checked={Boolean(data?.exactCopy)}
            disabled={busy || data === undefined}
            onChange={(e) => void run(() => setupApi.saveIdPhotos(hotel.id, e.target.checked), { success: T.payments.saved, onOk: () => setVersion((n) => n + 1) })}
          />
          <span className="st-switch" aria-hidden="true" />
          <span className="st-toggle-text">
            <strong>{I.exact}</strong>
            <small>{I.exactHint}</small>
          </span>
        </label>
      ),
    },
  ];
  return <SetupWizard title={I.title(hotel.name)} steps={steps} step="copy" onStep={onStep} onClose={onClose} />;
}

function WebsiteWizard({ hotel, step, onStep, onClose }: WizardProps) {
  const W = T.website;
  const [version, setVersion] = useState(0);
  const { data } = useLoaded(() => setupApi.website(hotel.id), [hotel.id, version]);
  const [maps, setMaps] = useState('');
  const [gid, setGid] = useState<string | null>(null);
  const [gsecret, setGsecret] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  const clientId = gid ?? data?.gbpClientId ?? '';
  const reload = () => setVersion((n) => n + 1);
  const saveMaps = () => {
    if (maps && !MAPS_KEY.test(maps.trim())) return setErrors({ mapsKey: W.mapsWrong });
    setErrors({});
    void run(() => setupApi.saveWebsite(hotel.id, { mapsKey: maps.trim() }), { success: T.payments.saved, onFields: setErrors, onOk: () => { setMaps(''); reload(); onStep('reviews'); } });
  };
  const saveReviews = () => {
    if (clientId && !GOOGLE_CLIENT.test(clientId.trim())) return setErrors({ gbpClientId: T.hotelBackup.clientIdWrong });
    setErrors({});
    void run(() => setupApi.saveWebsite(hotel.id, { gbpClientId: clientId.trim(), ...(gsecret ? { gbpClientSecret: gsecret } : {}) }), { success: T.payments.saved, onFields: setErrors, onOk: () => { setGsecret(''); reload(); } });
  };
  const steps: WizardStep[] = [
    {
      id: 'maps',
      title: W.steps.maps.title,
      hints: W.steps.maps.hints,
      done: data?.mapsKeySet,
      content: (
        <div className="row g-3">
          <Field label={W.mapsKey} col="col-12 col-md-6" error={errors.mapsKey}>
            <SecretField id="pf-maps-key" value={maps} onChange={setMaps} isSet={Boolean(data?.mapsKeySet)} savedOn={null} disabled={busy} invalid={Boolean(errors.mapsKey)} noun="key" />
            <FieldHint>{W.mapsHint}</FieldHint>
          </Field>
          <div className="col-12">
            <Button icon="check2" busy={busy} disabled={!maps} onClick={saveMaps}>
              {W.save}
            </Button>
          </div>
        </div>
      ),
    },
    {
      id: 'reviews',
      title: W.steps.reviews.title,
      hints: W.steps.reviews.hints,
      done: data?.gbpClientSecretSet,
      content: (
        <div className="row g-3">
          <Field label={W.gbpClientId} col="col-12 col-md-6" error={errors.gbpClientId}>
            <input className="form-control pf-mono" value={clientId} spellCheck={false} autoCapitalize="off" onChange={(e) => setGid(e.target.value.trim())} />
          </Field>
          <Field label={W.gbpClientSecret} col="col-12 col-md-6" error={errors.gbpClientSecret}>
            <SecretField id="pf-gbp-secret" value={gsecret} onChange={setGsecret} isSet={Boolean(data?.gbpClientSecretSet)} savedOn={null} disabled={busy} invalid={Boolean(errors.gbpClientSecret)} />
          </Field>
          <div className="col-12">
            <Button icon="check2" busy={busy} onClick={saveReviews}>
              {W.save}
            </Button>
          </div>
        </div>
      ),
    },
  ];
  return <SetupWizard title={W.title(hotel.name)} steps={steps} step={step || 'maps'} onStep={onStep} onClose={onClose} />;
}
