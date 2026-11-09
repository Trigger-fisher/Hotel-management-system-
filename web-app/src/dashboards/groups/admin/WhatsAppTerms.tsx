'use client';

// Settings > WhatsApp > Terms (plan part 3, the legal gate): what the hotel agrees to before it messages guests on WhatsApp. Everyone with the Conversations right can read them and see when they were accepted;
// the Hotel Admin accepts. Until then the hotel's replies are refused with a sentence pointing here.
import { useEffect, useState } from 'react';

import type { DashError, DashResult } from '@shared/dashboards/common';
import { formatDateTime } from '@shared/dashboards/format';

import { get, post } from '@/lib/api/client';
import { apiMode } from '@/lib/api/mode';
import { Alert, Button, Skeleton, StatusChip } from '@/dashboards/pallav/ui';

interface TermsView {
  title: string;
  version: string;
  points: string[];
  accepted: { at: string; byName: string } | null;
  canAccept: boolean;
}

const BASE = '/conversations/whatsapp/terms';
const live = (): boolean => apiMode() === 'real';
const DEMO: TermsView = {
  title: 'Using WhatsApp for your guests',
  version: '2026-11',
  points: ['You message only guests who have agreed to hear from the hotel on WhatsApp.', 'A guest who sends STOP is not messaged again by your hotel.', "Your guests' chats stay in your hotel's own records."],
  accepted: null,
  canAccept: true,
};
let demo = DEMO;
const read = (): Promise<DashResult<TermsView>> => (live() ? get<TermsView>(BASE, undefined, undefined, { fresh: true }) : Promise.resolve({ ok: true, data: demo }));
const accept = (): Promise<DashResult<TermsView>> =>
  live()
    ? post<TermsView>(BASE, {}, { idempotent: false })
    : Promise.resolve({ ok: true, data: (demo = { ...demo, accepted: { at: new Date().toISOString(), byName: 'You' } }) });
const errorOf = (e: DashError): string => e.message;

export function WhatsAppTerms() {
  const [terms, setTerms] = useState<TermsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let on = true;
    void read().then((r) => {
      if (!on) return;
      if (r.ok) setTerms(r.data);
      else setError(errorOf(r.error));
    });
    return () => {
      on = false;
    };
  }, []);

  if (!terms) return error ? <Alert tone="danger">{error}</Alert> : <Skeleton rows={2} />;
  return (
    <div className="mb-3" data-testid="wa-terms">
      <div className="d-flex flex-wrap align-items-center gap-2 mb-1">
        <strong>{terms.title}</strong>
        {terms.accepted ? <StatusChip tone="ok">Accepted by {terms.accepted.byName} on {formatDateTime(terms.accepted.at)}</StatusChip> : <StatusChip tone="warn">Not accepted yet: no guest can be messaged</StatusChip>}
      </div>
      {error ? <Alert tone="danger" className="mb-2">{error}</Alert> : null}
      <ul className="fs-hint mb-2" style={{ paddingLeft: 18 }}>
        {terms.points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      {!terms.accepted ? (
        terms.canAccept ? (
          <Button
            size="sm"
            icon="check2-circle"
            busy={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const r = await accept();
              setBusy(false);
              if (r.ok) setTerms(r.data);
              else setError(errorOf(r.error));
            }}
          >
            I accept for the hotel
          </Button>
        ) : (
          <div className="fs-hint">The hotel admin accepts these terms.</div>
        )
      ) : null}
    </div>
  );
}
