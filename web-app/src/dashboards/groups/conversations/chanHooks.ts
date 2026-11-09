'use client';

// The data behind the Email page and the WhatsApp page (GmailPage.tsx, WhatsAppPage.tsx). What the tab has seen shows at once (convCache.ts) and is read again behind the
// scenes; a live event (live.ts) reads again just the list and the conversation it names; the pages' own checks stay as the safety net, every minute while the bus is
// live (20 s for the list, 10 s for a thread when nothing tells them). A thread opened with unread messages is marked read for the team.
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ConversationList, ConversationListQuery, ConversationThread, ConversationsApi, ConvScope } from '@shared/dashboards/conversations';
import type { DashError } from '@shared/dashboards/common';

import { adjustConversationsUnread, noteConversationsSummary, type BadgeKind } from '../../shell/conversationsUnread';
import { cachedList, cachedThread, onThreadStored, storeList, storeThread } from './convCache';
import { debounce, everyMs, onConvLive, touches } from './live';

/** Asks again on a timer (while the tab is in front), when the tab comes back, and on a live event for this page; `id` narrows the events to one conversation. */
function useAskAgain(kind: 'list' | 'thread', scope: ConvScope, id: string | null, ask: () => void): void {
  const askRef = useRef(ask);
  useEffect(() => {
    askRef.current = ask;
  });
  useEffect(() => {
    if (kind === 'thread' && !id) return undefined;
    let last = Date.now();
    const go = () => {
      last = Date.now();
      askRef.current();
    };
    const soon = debounce(go, 250);
    const t = setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - last >= everyMs(kind)) go();
    }, 5_000);
    const back = () => document.visibilityState === 'visible' && soon.call();
    document.addEventListener('visibilitychange', back);
    const off = onConvLive((e) => {
      if (touches(e, scope, kind === 'thread' ? id : undefined)) soon.call();
    });
    return () => {
      clearInterval(t);
      soon.cancel();
      document.removeEventListener('visibilitychange', back);
      off();
    };
  }, [kind, scope, id]);
}

export function useChannelList(api: ConversationsApi, query: ConversationListQuery, tick: number, badge: BadgeKind = 'main', scope: ConvScope = 'hotel'): { data: ConversationList | null; error: DashError | null; loading: boolean } {
  const key = JSON.stringify(query);
  const [state, setState] = useState<{ key: string; data: ConversationList | null; error: DashError | null }>(() => ({ key, data: cachedList(api, key), error: null }));
  const [poll, setPoll] = useState(0);
  const queryRef = useRef(query);
  useEffect(() => {
    queryRef.current = query;
  });
  useAskAgain('list', scope, null, () => setPoll((n) => n + 1));

  useEffect(() => {
    let live = true;
    const q = queryRef.current;
    void api.list(q).then((r) => {
      if (!live) return;
      if (!r.ok) {
        setState((s) => (s.data ? s : { key, data: null, error: r.error }));
        return;
      }
      storeList(api, key, r.data);
      setState({ key, data: r.data, error: null });
      if (!q.search?.trim() && !q.label) noteConversationsSummary({ unread: r.data.folderCounts?.unread ?? r.data.counts.unread, mailbox: r.data.mailbox }, badge);
    });
    return () => {
      live = false;
    };
  }, [api, key, tick, poll, badge]);

  const seen = state.key === key ? null : cachedList(api, key);
  return { data: state.key === key ? state.data : (seen ?? state.data), error: state.key === key ? state.error : null, loading: state.key !== key && !seen };
}

export function useChannelThread(api: ConversationsApi, id: string | null, onChanged: () => void, badge: BadgeKind = 'main', scope: ConvScope = 'hotel'): { thread: ConversationThread | null; error: DashError | null; setThread: (t: ConversationThread) => void; reload: () => void } {
  const [state, setState] = useState<{ id: string | null; thread: ConversationThread | null; error: DashError | null }>(() => ({ id, thread: id ? cachedThread(api, id) : null, error: null }));
  const [attempt, setAttempt] = useState(0);
  const [poll, setPoll] = useState(0);
  const readFor = useRef<string | null>(null);
  useAskAgain('thread', scope, id, () => setPoll((n) => n + 1));

  // a thread stored anywhere (a send, a read, another view of it) is shown here at once
  useEffect(() => {
    if (!id) return undefined;
    return onThreadStored(api, id, () => {
      const t = cachedThread(api, id);
      if (t) setState({ id, thread: t, error: null });
    });
  }, [api, id]);

  useEffect(() => {
    if (!id) return undefined;
    let live = true;
    void api.getThread(id).then((r) => {
      if (!live) return;
      if (r.ok) storeThread(api, r.data);
      else setState((s) => (s.id === id && s.thread ? s : { id, thread: null, error: r.error }));
    });
    return () => {
      live = false;
    };
  }, [api, id, attempt, poll]);

  const current = state.id === id ? state : { id, thread: id ? cachedThread(api, id) : null, error: null };
  const thread = current.thread;

  // opening a conversation with unread messages marks it read for the team (never during a visit, which only reads)
  useEffect(() => {
    if (!thread || thread.id !== id || thread.unread <= 0 || thread.access.readOnlyReason === 'visit' || readFor.current === `${id}:${thread.unread}`) return;
    readFor.current = `${id}:${thread.unread}`;
    void api.markRead(thread.id).then((r) => {
      if (!r.ok) return;
      adjustConversationsUnread(-1, badge);
      storeThread(api, r.data);
      onChanged();
    });
  }, [api, id, thread, onChanged, badge]);

  const setThread = useCallback((t: ConversationThread) => storeThread(api, t), [api]);
  return { thread, error: current.error, setThread, reload: () => setAttempt((n) => n + 1) };
}
