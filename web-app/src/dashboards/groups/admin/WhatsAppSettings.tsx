'use client';

// Settings > WhatsApp: the hotel's number as the inbox uses it (read only) and the hotel's own message templates. Connecting the number is the
// platform team's job in the Set-up centre; automatic messages are set under Settings > Automatic messages; campaigns live on the Campaigns page.
// It reads the same Conversations store as the inbox (groups/conversations/api.ts). No message content is ever on this page.
import { useEffect, useState } from 'react';

import type { DashError } from '@shared/dashboards/common';
import { formatDate, formatDateTime } from '@shared/dashboards/format';
import { whatsappCopy as w, type WaQuality, type WhatsAppSettings as WaSettings } from '@shared/dashboards/whatsapp';

import { Bi, Button, LoadError, Skeleton, StatusChip, type ChipTone } from '@/dashboards/pallav/ui';
import { tr } from '@/lib/i18n/language';

import { conversationsApi } from '../conversations/api';
import { WhatsAppTemplates } from './WhatsAppTemplates';
import { WhatsAppTerms } from './WhatsAppTerms';

const QUALITY_TONE: Record<WaQuality, ChipTone> = { green: 'ok', yellow: 'warn', red: 'danger', unknown: 'neutral' };

function Head({ about }: { about: string }) {
  return (
    <div className="st-head">
      <div className="st-icon">
        <Bi name="whatsapp" />
      </div>
      <div>
        <h2 className="st-title">{w.name}</h2>
        <p className="st-about">{about}</p>
      </div>
    </div>
  );
}

/** The one line that points to Settings > Automatic messages (the only place they are switched on). */
function AutomaticLine({ onOpenMessages }: { onOpenMessages?: () => void }) {
  return (
    <div className="ha-wa-line">
      <Bi name="lightning-charge" />
      <span>{tr('Automatic messages (check-in, check-out, bill ready) are set under Automatic messages.')}</span>
      {onOpenMessages ? (
        <Button variant="outline" size="sm" onClick={onOpenMessages}>
          {tr('Open Automatic messages')}
        </Button>
      ) : null}
    </div>
  );
}

function Templates({ hint }: { hint: string }) {
  return (
    <>
      <h3 className="cv-settings-title mt-3">
        <Bi name="patch-check" /> {w.templates}
      </h3>
      <p className="cv-note-hint m-0">{hint}</p>
      <WhatsAppTemplates />
    </>
  );
}

/** No number yet: what is true and who acts, then the templates the hotel can already write. */
function NotConnectedCard({ onOpenMessages }: { onOpenMessages?: () => void }) {
  return (
    <div className="st-card" data-testid="wa-not-connected">
      <Head about={w.notConnectedAbout} />
      <div className="cv-settings cv-settings-body">
        <div className="ha-wa-status">
          <StatusChip tone="neutral">{tr('Not set up')}</StatusChip>
          <span>{tr('WhatsApp is not set up for this hotel yet. The platform team connects your number.')}</span>
        </div>
        <AutomaticLine onOpenMessages={onOpenMessages} />
        <Templates hint={tr('Write your messages now. They go to WhatsApp for approval once your number is connected.')} />
      </div>
    </div>
  );
}

export function WhatsAppSettings({ onOpenMessages }: { onOpenMessages?: () => void } = {}) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ attempt: number; settings: WaSettings | null; error: DashError | null } | null>(null);

  useEffect(() => {
    let live = true;
    void conversationsApi.getWhatsAppSettings().then((r) => {
      if (live) setLoaded({ attempt, settings: r.ok ? r.data : null, error: r.ok ? null : r.error });
    });
    return () => {
      live = false;
    };
  }, [attempt]);

  if (!loaded || loaded.attempt !== attempt) {
    return (
      <div className="st-card cv-settings-body">
        <Skeleton rows={3} />
      </div>
    );
  }
  if (loaded.error && (loaded.error.code === 'CONFLICT' || loaded.error.code === 'FORBIDDEN')) return <NotConnectedCard onOpenMessages={onOpenMessages} />;
  if (loaded.error || !loaded.settings) return <LoadError error={loaded.error ?? { code: 'SERVER_ERROR', message: 'SERVER_ERROR', traceId: 'client' }} onRetry={() => setAttempt((n) => n + 1)} />;
  const s = loaded.settings;
  if (!s.connected) return <NotConnectedCard onOpenMessages={onOpenMessages} />;

  return (
    <div className="st-card" data-testid="wa-connected">
      <Head about={s.connectedAt ? w.connectedOn.replace('{date}', formatDate(s.connectedAt)) : w.notConnectedAbout} />
      <div className="cv-settings cv-settings-body">
        <div className="ha-wa-status">
          <StatusChip tone="ok">{tr('Working')}</StatusChip>
          <span>{tr('Your number is connected by the platform team. Ask them to change it.')}</span>
        </div>
        <WhatsAppTerms />
        <div className="cv-wa-facts">
          <div className="cv-wa-fact">
            <div className="cv-wa-fact-label">{w.number}</div>
            <div className="cv-wa-fact-value">{s.number}</div>
          </div>
          <div className="cv-wa-fact">
            <div className="cv-wa-fact-label">{w.displayName}</div>
            <div className="cv-wa-fact-value">{s.displayName}</div>
            {s.displayNameStatus ? <StatusChip tone={s.displayNameStatus === 'approved' ? 'ok' : s.displayNameStatus === 'pending' ? 'warn' : 'danger'}>{w.displayNameStatus[s.displayNameStatus]}</StatusChip> : null}
          </div>
          <div className="cv-wa-fact">
            <div className="cv-wa-fact-label">{w.qualityLabel}</div>
            <div className="cv-wa-fact-value">
              <StatusChip tone={QUALITY_TONE[s.quality ?? 'unknown']}>{w.quality[s.quality ?? 'unknown']}</StatusChip>
            </div>
          </div>
          {s.lastSentAt ? (
            <div className="cv-wa-fact">
              <div className="cv-wa-fact-label">{w.lastSent}</div>
              <div className="cv-wa-fact-value">{formatDateTime(s.lastSentAt)}</div>
            </div>
          ) : null}
          {s.lastReceivedAt ? (
            <div className="cv-wa-fact">
              <div className="cv-wa-fact-label">{w.lastReceived}</div>
              <div className="cv-wa-fact-value">{formatDateTime(s.lastReceivedAt)}</div>
            </div>
          ) : null}
        </div>
        <p className="cv-note-hint m-0">{w.qualityHelp}</p>
        {s.month ? (
          <p className="cv-note-hint m-0">
            <strong>{w.month.title}:</strong> {w.month.templates.replace('{n}', String(s.month.templates))} · {w.month.free.replace('{n}', String(s.month.free))} · {w.month.received.replace('{n}', String(s.month.received))}
          </p>
        ) : null}
        <AutomaticLine onOpenMessages={onOpenMessages} />
        <Templates hint={w.templatesHelp} />
      </div>
    </div>
  );
}
