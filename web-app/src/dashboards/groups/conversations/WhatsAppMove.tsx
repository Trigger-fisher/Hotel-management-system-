'use client';

// A hotel's move from the shared guest number to its own number (plan part 14), on the hotel's page of the Rules screen: where it stands, and the one step that can be taken now (cut over, finish early, undo).
// Nothing is copied: conversations keep one thread. Shown only for a hotel that has connected its own number. Sample state in the demo.
import { useEffect, useState } from 'react';

import type { DashError } from '@shared/dashboards/common';
import { formatDate } from '@shared/dashboards/format';

import { Alert, Button, StatusChip, type ChipTone } from '@/dashboards/pallav/ui';

import { whatsappAdminApi, type WaMoveStatus } from './whatsappAdminApi';

const errorOf = (e: DashError): string => (e.details?.fields ? Object.values(e.details.fields).join(' ') || e.message : e.message);
const WORDS: Record<WaMoveStatus['state'], { chip: string; tone: ChipTone; about: string }> = {
  none: { chip: 'Own number not connected', tone: 'neutral', about: 'This hotel uses the shared number. To move it, connect its own number first (Connect a number, kind: hotel).' },
  pending: { chip: 'Own number connected', tone: 'warn', about: 'The hotel still chats on the shared number. When its own number has an approved message, start the cut-over: the hotel then writes from its own number.' },
  transition: { chip: 'Cut over: in transition', tone: 'ok', about: 'The hotel writes from its own number. The shared number still reaches it by a swipe-reply, a live choice or its code until the days are over.' },
  active: { chip: 'Moved', tone: 'ok', about: "The move is final. A guest who writes to the shared number is told the hotel's own number. The conversations stayed where they were." },
};

export function WhatsAppMove({ hotelId }: { hotelId: string }) {
  const [status, setStatus] = useState<WaMoveStatus | null>(null);
  const [note, setNote] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let on = true;
    void whatsappAdminApi.moveStatus(hotelId).then((r) => {
      if (!on) return;
      if (r.ok) setStatus(r.data);
      else setNote({ tone: 'danger', text: errorOf(r.error) });
    });
    return () => {
      on = false;
    };
  }, [hotelId, attempt]);

  const go = async (step: 'cut_over' | 'finish' | 'undo', done: string): Promise<void> => {
    setBusy(step);
    const r = await whatsappAdminApi.moveStep(hotelId, step);
    setBusy(null);
    if (r.ok) {
      setStatus(r.data);
      setNote({ tone: 'success', text: done });
    } else {
      setNote({ tone: 'danger', text: errorOf(r.error) });
      setAttempt((n) => n + 1);
    }
  };

  if (!status) return note ? <Alert tone="danger">{note.text}</Alert> : null;
  const w = WORDS[status.state];
  return (
    <div className="mb-3" data-testid="wa-move">
      <div className="d-flex flex-wrap align-items-center gap-2 mb-1">
        <strong>Move to its own number</strong>
        <StatusChip tone={w.tone}>{w.chip}</StatusChip>
        {status.ownPhone ? <StatusChip>{status.ownPhone}</StatusChip> : null}
        {status.state === 'transition' && status.transitionEndsAt ? <StatusChip>Final on {formatDate(status.transitionEndsAt)}</StatusChip> : null}
      </div>
      <div className="fs-hint mb-2">{w.about}</div>
      {note ? (
        <Alert tone={note.tone} className="mb-2" action={<Button size="sm" variant="ghost" onClick={() => setNote(null)}>Dismiss</Button>}>
          {note.text}
        </Alert>
      ) : null}
      {status.cutOverBlockedBy ? <div className="fs-hint mb-2">{status.cutOverBlockedBy}</div> : null}
      <div className="d-flex flex-wrap gap-2">
        {status.state === 'pending' ? (
          <Button size="sm" icon="arrow-right-circle" disabled={!status.can.cutOver} busy={busy === 'cut_over'} onClick={() => void go('cut_over', 'The cut-over is done. The hotel now writes from its own number.')}>
            Start the cut-over
          </Button>
        ) : null}
        {status.can.finish ? (
          <Button size="sm" icon="check-circle" busy={busy === 'finish'} onClick={() => void go('finish', 'The move is final.')}>
            Finish now
          </Button>
        ) : null}
        {status.can.undo ? (
          <Button size="sm" variant="outline" icon="arrow-counterclockwise" busy={busy === 'undo'} onClick={() => void go('undo', 'The hotel is back on the shared number.')}>
            Undo the cut-over
          </Button>
        ) : null}
      </div>
    </div>
  );
}
