'use client';

// The Conversations menu badge (decision 66): the team's unread conversations, in the sidebar and the phone bar. One small store for the whole tab, like the company
// portal's unread notifications (groups/notifications/unread.ts). Every 90 seconds while the tab is visible the shell asks for a BACKGROUND mail check
// (`syncMail({ background: true })`): its answer carries the summary, so one request keeps both the mailbox and the badge fresh (the server checks the mailbox at
// most about every 1.5 minutes for it, 15 minutes after the mail server said "too many connections"). While the Conversations page is open it runs its own checks and feeds this store, so the shell skips its turn. The poll stops for
// the session after an answer that says the database update is missing, or a refusal (403: no Conversations right, or a visit).
import { useEffect, useSyncExternalStore } from 'react';
import { onMailSignal } from '@/lib/mailSignal';

import type { ConvScope, ConvSummary } from '@shared/dashboards/conversations';

import { convApiFor } from '../groups/conversations/api';
import { debounce, onConvLive, touches } from '../groups/conversations/live';

/** Which badge: the team's Email (hotel or console) or My mailbox (platform 0178: one person's own mailbox, never mixed with the shared inbox). */
export type BadgeKind = 'main' | 'personal';

interface Store {
  unread: number;
  subs: Set<() => void>;
  stopped: boolean;
  pagePolling: number;
  lastPoll: number;
}
const stores: Record<BadgeKind, Store> = {
  main: { unread: 0, subs: new Set(), stopped: false, pagePolling: 0, lastPoll: 0 },
  personal: { unread: 0, subs: new Set(), stopped: false, pagePolling: 0, lastPoll: 0 },
};
const set = (kind: BadgeKind, unread: number) => {
  const s = stores[kind];
  if (unread === s.unread) return;
  s.unread = unread;
  for (const l of s.subs) l();
};
const subscribeTo = (kind: BadgeKind) => (l: () => void) => {
  stores[kind].subs.add(l);
  return () => {
    stores[kind].subs.delete(l);
  };
};
const subscribeMain = subscribeTo('main');
const subscribePersonal = subscribeTo('personal');

export const useConversationsUnread = (): number => useSyncExternalStore(subscribeMain, () => stores.main.unread, () => 0);
/** The unread count of My mailbox: only the signed-in person's own mailbox, no text, subject or address. */
export const usePersonalUnread = (): number => useSyncExternalStore(subscribePersonal, () => stores.personal.unread, () => 0);

/** The page (or the poll) has a fresh summary: the badge follows. A `needs_update` mailbox stops the poll for this session. */
export function noteConversationsSummary(s: Pick<ConvSummary, 'unread' | 'mailbox'>, kind: BadgeKind = 'main'): void {
  if (s.mailbox.reason === 'needs_update') stores[kind].stopped = true;
  set(kind, Math.max(0, s.unread));
}

/** A conversation was read or marked unread on the page: the badge moves before the next check. */
export function adjustConversationsUnread(by: number, kind: BadgeKind = 'main'): void {
  set(kind, Math.max(0, stores[kind].unread + by));
}

/** The Conversations page is open and checks the mailbox itself (the shell's poll waits). Returns the "closed again" function. */
export function conversationsPageOpen(kind: BadgeKind = 'main'): () => void {
  stores[kind].pagePolling += 1;
  return () => {
    stores[kind].pagePolling = Math.max(0, stores[kind].pagePolling - 1);
  };
}

const EVERY_MS = 30_000;

async function poll(scope: ConvScope, kind: BadgeKind): Promise<void> {
  const st = stores[kind];
  if (st.stopped || st.pagePolling > 0) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  // coming back to the tab asks at once, but never twice within a minute
  if (Date.now() - st.lastPoll < 60_000) return;
  st.lastPoll = Date.now();
  const res = await convApiFor(scope).syncMail({ background: true });
  if (res.ok) noteConversationsSummary(res.data, kind);
  // no right to Conversations, a visit, or a server without the feature: stop asking for this session
  else if (res.error.code === 'FORBIDDEN' || res.error.code === 'SESSION_EXPIRED' || (res.error.code === 'CONFLICT' && /database update/i.test(res.error.message))) st.stopped = true;
}

/** Keeps the badge fresh while a dashboard with Conversations is open (hotel staff outside a visit, the platform console). */
export function useConversationsPolling(enabled: boolean, scope: ConvScope): void {
  const kind: BadgeKind = scope === 'personal' ? 'personal' : 'main';
  useEffect(() => {
    if (!enabled) return undefined;
    stores[kind].stopped = false;
    // the first read waits a moment, so the opening screen's own requests go first
    const first = setTimeout(() => void poll(scope, kind), 4000);
    const timer = setInterval(() => void poll(scope, kind), EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll(scope, kind);
    };
    document.addEventListener('visibilitychange', onVisible);
    // a "new mail" ping (lib/mailSignal.ts) asks at once, past the one-minute guard
    const off = onMailSignal(() => {
      stores[kind].lastPoll = 0;
      void poll(scope, kind);
    });
    // a live change of this box (groups/conversations/live.ts): the count alone is read again (no mail check), once per burst
    const recount = debounce(() => {
      if (stores[kind].stopped) return;
      void convApiFor(scope).getSummary().then((r) => r.ok && noteConversationsSummary(r.data, kind));
    }, 800);
    const offLive = onConvLive((e) => {
      if (e.what !== 'status' && touches(e, scope)) recount.call();
    });
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      off();
      offLive();
      recount.cancel();
    };
  }, [enabled, scope, kind]);
}