'use client';

// platform.setup (Super Admin only; MJ, 5 Nov 2026): the platform's own outside services (mail, WhatsApp, API access, backups and photo storage) with a plain state
// (Not set up / Working / Needs attention and why) and one next-step button that opens its wizard; then every hotel with its overall state. A hotel is set up only on its
// own page (Integrations tab): a row opens it there, and an old per-hotel link (params service payments / hotelBackup / website with a hotel) goes there too.
import { useEffect, useMemo, useState } from 'react';

import { platformCopy, setupCopy as T, type PlatformSettings } from '@shared/dashboards/platform';

import type { ScreenProps } from '../../types';
import { EmptyState, PageHead } from '@/dashboards/pallav/ui';
import { PlatformMailboxSettings } from '../conversations/PlatformMailboxSettings';
import { WhatsAppConnections, lineWord } from '../conversations/WhatsAppConnections';
import { PlatformWhatsApp } from '../conversations/PlatformWhatsApp';
import { WhatsAppRules } from '../conversations/WhatsAppRules';
import { whatsappAdminApi, type WaLineView } from '../conversations/whatsappAdminApi';
import { Wait, useLoaded } from '../payrollCore/load';
import { platformApi } from './api';
import { asActor } from './enter';
import { PlatformHotelMailScreen } from './HotelMail';
import { InboundMailCard } from './InboundMailCard';
import { ApiKeysWizard } from './PlatformApiAccess';
import { PlatformMailFiles } from './PlatformMailFiles';
import { PlatformMailSafety } from './PlatformMailSafety';
import { PlatformMailSenders } from './PlatformMailSenders';
import { useMailServiceSteps } from './PlatformMailService';
import { setupApi } from './setupApi';
import { SetupChecklist, SetupTest, SetupWizard, type SetupRow, type SetupState, type WizardStep } from './setupParts';
import { SuperOnly } from './superParts';

type Service = 'mail' | 'whatsapp' | 'api' | 'backups';
const SERVICES: readonly Service[] = ['mail', 'whatsapp', 'api', 'backups'];
const isService = (x: string | undefined): x is Service => SERVICES.includes(x as Service);
/** The old per-hotel services of this page and the hotel page's service each now opens. */
const HOTEL_SERVICES: Readonly<Record<string, string>> = { payments: 'payments', hotelBackup: 'backup', website: 'website' };

/** An old address whose set-up now lives here (platform.hotelMail): opens the matching wizard step. */
export function setupAlias(service: Service, step: string) {
  return function SetupAlias({ navigate }: ScreenProps) {
    useEffect(() => {
      navigate('platform.setup', { service, step });
    }, [navigate]);
    return <Wait error={null} onRetry={() => undefined} tiles={false} rows={4} />;
  };
}

export function PlatformSetupCentre(props: ScreenProps) {
  const { params, navigate } = props;
  const hotelId = params.hotel || params.hotelId || '';
  const hotelLink = props.user.role === 'super_admin' && hotelId !== '' && (params.service === undefined || params.service in HOTEL_SERVICES);
  useEffect(() => {
    if (hotelLink) navigate('platform.hotel', { id: hotelId, tab: 'integrations', ...(params.service ? { service: HOTEL_SERVICES[params.service] } : {}), ...(params.step ? { step: params.step } : {}) });
  }, [hotelLink, hotelId, params.service, params.step, navigate]);
  if (props.user.role !== 'super_admin') return <SuperOnly />;
  if (hotelLink) return <Wait error={null} onRetry={() => undefined} tiles={false} rows={4} />;
  return <Centre {...props} />;
}

/** The mail row: Amazon SES, its Google backup and the last test. */
function mailRow(s: PlatformSettings | null): { state: SetupState; reason: string | null } {
  if (!s) return { state: 'attention', reason: T.reasons.readFailed };
  const m = s.smtp;
  if (m.passwordUnreadable) return { state: 'attention', reason: T.reasons.mailUnreadable };
  if (m.failover.active === 'backup') return { state: 'attention', reason: T.reasons.mailOnBackup };
  const set = m.provider !== null && m.passwordSet && m.user !== '';
  if (!set) return { state: 'not_set_up', reason: null };
  if (!m.lastTest) return { state: 'attention', reason: T.reasons.mailNotTested };
  if (!m.lastTest.ok) return { state: 'attention', reason: T.reasons.mailFailed };
  if (!m.backup.user || !m.backup.passwordSet) return { state: 'attention', reason: T.reasons.noBackupMail };
  return { state: 'working', reason: null };
}

function waRow(lines: WaLineView[] | null): { state: SetupState; reason: string | null } {
  if (!lines) return { state: 'attention', reason: T.reasons.readFailed };
  if (lines.length === 0) return { state: 'not_set_up', reason: T.reasons.waNone };
  const bad = lines.find((l) => lineWord(l).tone === 'danger');
  if (bad) return { state: 'attention', reason: bad.status === 'banned' ? T.reasons.waBlocked(bad.label) : T.reasons.waToken(bad.label) };
  const paused = lines.find((l) => l.status === 'paused');
  return paused ? { state: 'attention', reason: T.reasons.waPaused(paused.label) } : { state: 'working', reason: null };
}

/** The mail wizard, one question per step: the service's own steps first, then the domain, files, replies, reading, bounces and each hotel, and the Test last. */
function MailWizard(props: ScreenProps & { data: PlatformSettings; step: string; onStep: (s: string) => void; onClose: () => void; onSaved: () => void }) {
  const { user, data, step, onStep, onClose, onSaved } = props;
  const S = T.mail.steps;
  const service = useMailServiceSteps({ data, user, onSaved, go: onStep });
  const test = service.filter((s) => s.id === 'test');
  const steps: WizardStep[] = [
    ...service.filter((s) => s.id !== 'test'),
    { id: 'senders', title: S.senders.title, hints: S.senders.hints, done: data.mailSendingDomain !== '', content: <PlatformMailSenders user={user} part="dkim" /> },
    { id: 'verified', title: S.verified.title, hints: S.verified.hints, content: <PlatformMailSenders user={user} part="verified" /> },
    { id: 'files', title: S.files.title, hints: S.files.hints, content: <PlatformMailFiles key={data.updatedAt ?? ''} data={data} user={user} onSaved={onSaved} onNext={() => onStep('replies')} /> },
    { id: 'replies', title: S.replies.title, hints: S.replies.hints, content: <InboundMailCard user={user} /> },
    { id: 'reading', title: S.reading.title, hints: S.reading.hints, done: data.mailboxReading?.reading === true, content: <PlatformMailboxSettings superAdmin onOpenMailSettings={() => onStep('service')} /> },
    { id: 'safety', title: S.safety.title, hints: S.safety.hints, content: <PlatformMailSafety part="webhooks" /> },
    { id: 'holds', title: S.holds.title, hints: S.holds.hints, content: <PlatformMailSafety part="holds" /> },
    { id: 'blocked', title: S.blocked.title, hints: S.blocked.hints, content: <PlatformMailSafety part="blocked" /> },
    { id: 'hotels', title: S.hotels.title, hints: S.hotels.hints, content: <PlatformHotelMailScreen {...props} /> },
    ...test,
  ];
  return <SetupWizard title={T.mail.title} steps={steps} step={step || 'service'} onStep={onStep} onClose={onClose} />;
}

function Centre(props: ScreenProps) {
  const { user, params } = props;
  const [service, setService] = useState<Service | null>(() => (isService(params.service) ? params.service : isService(params.step) ? params.step : null));
  const [step, setStep] = useState(params.service ? (params.step ?? '') : '');
  const [version, setVersion] = useState(0);
  const settings = useLoaded(() => {
    asActor(user);
    return platformApi.getPlatformSettings();
  }, [version]);
  const lines = useLoaded(() => whatsappAdminApi.lines(), [version]);
  const hotels = useLoaded(() => {
    asActor(user);
    return platformApi.listHotels({ pageSize: 500 });
  }, []);
  const list = useMemo(() => [...(hotels.data?.items ?? [])].filter((h) => h.status !== 'archived').sort((a, b) => a.name.localeCompare(b.name)), [hotels.data]);
  const ids = list.map((h) => h.id).join(',');
  const states = useLoaded(() => setupApi.hotelStates(ids ? ids.split(',') : []), [ids, version]);

  useEffect(() => {
    if (service) window.scrollTo?.({ top: 0 });
  }, [service]);

  const open = (s: Service, first = '') => {
    setService(s);
    setStep(first);
  };
  const close = () => {
    setService(null);
    setStep('');
    setVersion((n) => n + 1);
  };

  if (!settings.data && !settings.error) return <Wait error={null} onRetry={settings.reload} tiles={false} rows={6} />;
  const data = settings.data ?? null;
  const saved = () => settings.reload();

  if (service === 'mail' && data) return <MailWizard {...props} data={data} step={step} onStep={setStep} onClose={close} onSaved={saved} />;
  if (service === 'whatsapp') {
    const S = T.whatsapp.steps;
    const steps: WizardStep[] = [
      { id: 'numbers', title: S.numbers.title, hints: S.numbers.hints, done: waRow(lines.data?.lines ?? null).state === 'working', content: <WhatsAppConnections /> },
      { id: 'templates', title: S.templates.title, hints: S.templates.hints, content: <PlatformWhatsApp /> },
      { id: 'rules', title: S.rules.title, hints: S.rules.hints, content: <WhatsAppRules /> },
    ];
    return <SetupWizard title={T.whatsapp.title} steps={steps} step={step || 'numbers'} onStep={setStep} onClose={close} />;
  }
  if (service === 'api') return <ApiKeysWizard step={step} onStep={setStep} onClose={close} />;
  if (service === 'backups') {
    const S = T.backups.steps;
    const plain = async (r: Awaited<ReturnType<typeof whatsappAdminApi.storageCheck>>) => (r.ok ? { ok: r.data.ok, text: r.data.message } : { ok: false, text: r.error.message });
    const steps: WizardStep[] = [
      { id: 'storage', title: S.storage.title, hints: S.storage.hints, content: <SetupTest label={T.backups.storageTest} run={async () => plain(await whatsappAdminApi.storageCheck())} /> },
      {
        id: 'whatsapp',
        title: S.whatsapp.title,
        hints: S.whatsapp.hints,
        content: (
          <div className="pf-setup-tests">
            <SetupTest label={T.backups.verify} run={async () => plain(await whatsappAdminApi.backupStep('verify'))} />
            <SetupTest label={T.backups.run} run={async () => plain(await whatsappAdminApi.backupStep('run'))} />
          </div>
        ),
      },
    ];
    return <SetupWizard title={T.backups.title} steps={steps} step={step || 'storage'} onStep={setStep} onClose={close} />;
  }
  const mail = mailRow(data);
  const wa = waRow(lines.data?.lines ?? (lines.error ? null : []));
  const next = (state: SetupState) => (state === 'not_set_up' ? T.setUp : state === 'attention' ? T.fix : T.open);
  const platformRows: SetupRow[] = [
    { id: 'mail', icon: 'envelope-at', title: T.services.mail.title, text: T.services.mail.text, state: mail.state, reason: mail.reason, action: { label: next(mail.state), onClick: () => open('mail') } },
    { id: 'whatsapp', icon: 'whatsapp', title: T.services.whatsapp.title, text: T.services.whatsapp.text, state: wa.state, reason: wa.reason, action: { label: next(wa.state), onClick: () => open('whatsapp') } },
    { id: 'api', icon: 'key', title: T.services.api.title, text: T.services.api.text, state: 'working', action: { label: T.open, onClick: () => open('api') } },
    { id: 'backups', icon: 'cloud-check', title: T.services.backups.title, text: T.services.backups.text, state: 'working', action: { label: T.open, onClick: () => open('backups') } },
  ];
  const needs = platformRows.filter((r) => r.state === 'attention' || r.state === 'not_set_up').length;
  const hotelRows: SetupRow[] = list.map((h) => {
    const s = states.data?.[h.id];
    const state: SetupState = s?.state ?? (states.error ? 'attention' : 'checking');
    return {
      id: h.id, icon: 'building', title: h.name, text: s?.reason ?? (states.error ? T.reasons.readFailed : T.state.checking), state, reason: s?.reason ?? null,
      action: { label: state === 'not_set_up' ? T.setUp : state === 'attention' ? T.fix : T.open, onClick: () => props.navigate('platform.hotel', { id: h.id, tab: 'integrations' }) },
    };
  });

  return (
    <>
      <PageHead className="reveal" sub={T.sub} />
      <div className="pf-sec">
        <h3>{T.platformWide}</h3>
        <span className="pf-sec-note">{needs ? T.needWork(needs) : T.allWorking(platformRows.length)}</span>
      </div>
      <SetupChecklist label={T.platformWide} rows={platformRows} className="reveal" />

      <div className="pf-sec">
        <h3>{T.perHotel}</h3>
        <span className="pf-sec-note">{T.perHotelNote}</span>
      </div>
      {!hotels.data ? (
        <Wait error={hotels.error} onRetry={hotels.reload} tiles={false} rows={3} />
      ) : list.length === 0 ? (
        <div className="card reveal">
          <EmptyState icon="buildings" title={platformCopy.hotels.empty.title} text={T.noHotels} />
        </div>
      ) : (
        <SetupChecklist label={T.perHotel} className="reveal" rows={hotelRows} />
      )}
    </>
  );
}
