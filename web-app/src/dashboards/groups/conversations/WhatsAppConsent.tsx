'use client';

// The guest's agreement to automatic WhatsApp messages (MJ, 4 Nov 2026), in the contact panel of a hotel's WhatsApp chat once the chat is linked to a guest. A tick staff record when the guest says yes
// (at booking or check-in); the sender needs it for automatic messages and for an approved message after the 24 hours. In the demo it is kept on the page only.
import { useEffect, useState } from 'react';

import type { DashResult } from '@shared/dashboards/common';
import { formatDateTime } from '@shared/dashboards/format';

import { errorText } from '@/components/ui';
import { get, put } from '@/lib/api/client';
import { apiMode } from '@/lib/api/mode';
import { Alert, StatusChip } from '@/dashboards/pallav/ui';

interface Consent {
  on: boolean;
  at: string | null;
  hasMobile: boolean;
}

const BASE = '/conversations/whatsapp/consent';
const live = (): boolean => apiMode() === 'real';
const read = (id: string): Promise<DashResult<Consent>> => (live() ? get<Consent>(`${BASE}/${encodeURIComponent(id)}`, undefined, undefined, { fresh: true }) : Promise.resolve({ ok: true, data: { on: false, at: null, hasMobile: true } }));
const write = (id: string, on: boolean): Promise<DashResult<Consent>> =>
  live() ? put<Consent>(`${BASE}/${encodeURIComponent(id)}`, { on }, { idempotent: false }) : Promise.resolve({ ok: true, data: { on, at: on ? new Date().toISOString() : null, hasMobile: true } });

export function WhatsAppConsent({ customerId, canEdit, hint }: { customerId: string; canEdit: boolean; hint: string | null }) {
  const [state, setState] = useState<Consent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let on = true;
    void read(customerId).then((r) => {
      if (!on) return;
      if (r.ok) setState(r.data);
      else setError(errorText(r.error));
    });
    return () => {
      on = false;
    };
  }, [customerId]);

  const toggle = async (next: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    const r = await write(customerId, next);
    setBusy(false);
    if (r.ok) setState(r.data);
    else setError(errorText(r.error));
  };

  return (
    <section className="cv-panel-sec" aria-label="WhatsApp agreement">
      <h3>WhatsApp agreement</h3>
      {error ? <Alert tone="danger" className="mb-2">{error}</Alert> : null}
      {state ? (
        <>
          <label className="d-flex align-items-start gap-2" title={hint ?? undefined}>
            <input type="checkbox" className="form-check-input mt-1" checked={state.on} disabled={!canEdit || busy} onChange={(e) => void toggle(e.target.checked)} />
            <span>
              The guest agreed to receive WhatsApp messages from the hotel
              <small className="d-block cv-note-hint">{state.on && state.at ? `Recorded ${formatDateTime(state.at)}.` : 'Tick it only when the guest has said yes. Without it, automatic messages and approved messages after 24 hours are not sent.'}</small>
            </span>
          </label>
          {!state.hasMobile ? <StatusChip tone="warn">No mobile number on the guest record</StatusChip> : null}
        </>
      ) : error ? null : (
        <p className="cv-note-hint mb-0">Loading…</p>
      )}
    </section>
  );
}
