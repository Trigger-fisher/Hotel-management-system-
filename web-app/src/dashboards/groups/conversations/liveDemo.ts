'use client';

// The demo's live arrivals (mock mode only, MJ, 5 Nov 2026): now and then a guest writes by themselves, on WhatsApp in the hotel's and the platform's chats and by email in the
// inboxes, so the live pages can be seen working without a real number. Invented words, invented people (the mock's own sample).
import type { ConvChannel, ConvScope, ConversationsApi } from '@shared/dashboards/conversations';

import { convApiFor } from './api';

const FIRST_MS = 20_000;
const EVERY_MS = 45_000;
const WA_LINES = [
  'Hi, can we check in a little early tomorrow?',
  'Is breakfast included with our room?',
  'We will reach around 9 pm, please keep the room.',
  'Thank you, the room was lovely!',
  'Can you send the bill on this number?',
  'Do you have parking for two cars?',
] as const;
const MAIL_LINES = [
  'Could you please share the invoice for our stay?',
  'Please confirm our booking for the 12th.',
  'We would like an airport pickup at 6 am.',
  'Is a late checkout possible on Sunday?',
] as const;

type DemoApi = ConversationsApi & { simulateInbound?: (id: string, m: { channel: ConvChannel; text: string }) => void };

/** One arrival: a chat or an email of this page gets a new message from the guest. */
export async function demoArrival(scope: ConvScope, channel: ConvChannel, turn: number): Promise<string | null> {
  const api = convApiFor(scope) as DemoApi;
  if (typeof api.simulateInbound !== 'function') return null;
  const r = await api.list({ channel, tab: 'all', page: 1, size: 25 });
  if (!r.ok || r.data.items.length === 0) return null;
  const rows = channel === 'whatsapp' ? r.data.items.filter((x) => x.channels.includes('whatsapp')) : r.data.items.filter((x) => x.channels.includes('email'));
  const row = rows[(turn * 3) % Math.max(1, rows.length)];
  if (!row) return null;
  const lines = channel === 'whatsapp' ? WA_LINES : MAIL_LINES;
  api.simulateInbound(row.id, { channel, text: lines[turn % lines.length] });
  return row.id;
}

/** Starts the arrivals for the pages of this console; returns the function that stops them. Only while the tab is in front. */
export function startDemoArrivals(scopes: readonly ConvScope[]): () => void {
  const plan: { scope: ConvScope; channel: ConvChannel }[] = [];
  for (const s of scopes) {
    if (s === 'hotel' || s === 'platform') plan.push({ scope: s, channel: 'whatsapp' });
    plan.push({ scope: s, channel: 'email' });
  }
  if (plan.length === 0) return () => undefined;
  let turn = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const next = (ms: number) => {
    timer = setTimeout(() => {
      timer = null;
      if (stopped) return;
      if (document.visibilityState === 'visible') {
        const step = plan[turn % plan.length];
        turn += 1;
        void demoArrival(step.scope, step.channel, turn).catch(() => null);
      }
      next(EVERY_MS);
    }, ms);
  };
  next(FIRST_MS);
  // the demo checks call one at once (the same dev switches as the mock's __conv*)
  const g = globalThis as Record<string, unknown>;
  g.__convDemoArrive = (scope: ConvScope, channel: ConvChannel) => demoArrival(scope, channel, ++turn);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    delete g.__convDemoArrive;
  };
}
