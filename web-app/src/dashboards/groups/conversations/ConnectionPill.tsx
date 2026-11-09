'use client';

// The small "Connected / Not connected" pill of the Email and WhatsApp pages, and the one-line note that says what it means (connection.ts).
import type { Connection } from './connection';

export function ConnectionPill({ c }: { c: Connection }) {
  return (
    <span className={`cvc cvc-${c.tone}`} title={c.message}>
      <i aria-hidden="true" /> {c.label}
    </span>
  );
}

export function ConnectionNote({ c }: { c: Connection }) {
  return (
    <p className={`cvc-note cvc-note-${c.tone}`} role="status">
      <ConnectionPill c={c} />
      <span>{c.message}</span>
    </p>
  );
}
