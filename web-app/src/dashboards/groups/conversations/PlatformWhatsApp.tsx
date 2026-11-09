'use client';

// Set-up centre > WhatsApp > Approved messages (Super Admin only): the platform number's name, quality, this month's counts and its approved message
// templates. Which hotels use which number is shown on the number itself (Numbers step), so there is no second hotels table here.
import { useEffect, useState } from 'react';

import type { DashError } from '@shared/dashboards/common';
import { formatDate, formatDateTime } from '@shared/dashboards/format';
import { setupCopy } from '@shared/dashboards/platform';
import { whatsappCopy as w, type WaQuality, type WhatsAppSettings } from '@shared/dashboards/whatsapp';

import { Bi, EmptyState, FormSection, LoadError, Skeleton, StatusChip, type ChipTone } from '@/dashboards/pallav/ui';

import { platformConversationsApi } from './api';

const QUALITY_TONE: Record<WaQuality, ChipTone> = { green: 'ok', yellow: 'warn', red: 'danger', unknown: 'neutral' };
const TEMPLATE_TONE = { approved: 'ok', pending: 'warn', rejected: 'danger', paused: 'neutral' } as const;

export function PlatformWhatsApp() {
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<{ attempt: number; settings: WhatsAppSettings | null; error: DashError | null } | null>(null);

  useEffect(() => {
    let live = true;
    void platformConversationsApi.getWhatsAppSettings().then((s) => {
      if (!live) return;
      setData({ attempt, settings: s.ok ? s.data : null, error: s.ok ? null : s.error });
    });
    return () => {
      live = false;
    };
  }, [attempt]);

  if (!data || data.attempt !== attempt) return <Skeleton rows={2} />;
  if (data.error || !data.settings) return <LoadError error={data.error ?? { code: 'SERVER_ERROR', message: 'SERVER_ERROR', traceId: 'client' }} onRetry={() => setAttempt((n) => n + 1)} />;
  const s = data.settings;

  if (!s.connected) {
    return (
      <FormSection icon="whatsapp" title={w.platformTitle}>
        <p className="pf-sec-note mb-0">
          <Bi name="info-circle" /> {setupCopy.whatsapp.notConnected}
        </p>
      </FormSection>
    );
  }

  return (
    <>
      <FormSection icon="whatsapp" title={w.platformTitle} hint={s.connectedAt ? w.connectedOn.replace('{date}', formatDate(s.connectedAt)) : undefined}>
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
        <p className="cv-note-hint mt-2 mb-0">{w.qualityHelp}</p>
        {s.month ? (
          <p className="cv-note-hint mt-2 mb-0">
            <strong>{w.month.title}:</strong> {w.month.templates.replace('{n}', String(s.month.templates))} · {w.month.free.replace('{n}', String(s.month.free))} · {w.month.received.replace('{n}', String(s.month.received))}
          </p>
        ) : null}
      </FormSection>

      <FormSection icon="patch-check" title={w.templates} hint={w.templatesHelp}>
        {s.templates.length === 0 ? (
          <EmptyState icon="patch-check" title={w.template.none} />
        ) : (
          s.templates.map((t) => (
            <div key={t.id} className="cv-tpl-row">
              <div className="cv-tpl-row-main">
                <div className="cv-tpl-row-name">
                  {t.name.replace(/_/g, ' ')} <span className="cv-note-hint">· {w.template.category[t.category]} · {t.language}</span>
                </div>
                <div className="cv-tpl-row-text">{t.text}</div>
              </div>
              <StatusChip tone={TEMPLATE_TONE[t.status]}>{w.template.status[t.status]}</StatusChip>
            </div>
          ))
        )}
      </FormSection>

    </>
  );
}
