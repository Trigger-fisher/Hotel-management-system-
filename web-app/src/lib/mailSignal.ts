'use client';

// The page side of the "new mail" ping (MJ, 3 Nov 2026; server/mail/signal.ts). ONE socket for the whole dashboard, shared by every part that wants to know when mail landed.
// It speaks the small Phoenix protocol Supabase Realtime uses, so no library is added. It carries no mail, only "ask again". Opened only while the tab is in front (a hidden tab
// lets go after a minute), and any failure leaves the pages on their own timed checks. All the moving parts (socket, timers) are passed in, so the tests drive them.
import { useEffect } from 'react';

type Listener = () => void;
const listeners = new Set<Listener>();

/** A part of the page that wants to ask again when mail lands. Returns the function that stops listening. */
export function onMailSignal(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True while the socket is joined: the timed checks can then be slower. */
let joined = false;
export function mailSignalLive(): boolean {
  return joined;
}

function emit(): void {
  listeners.forEach((l) => l());
}

export interface SignalAnswer {
  enabled: boolean;
  url?: string;
  key?: string;
  channels?: string[];
}

interface Deps {
  WebSocketImpl: typeof WebSocket;
  setTimeoutFn: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn: (id: unknown) => void;
  isVisible: () => boolean;
  onVisibility: (cb: () => void) => () => void;
}

const HEARTBEAT_MS = 25_000;
const HIDDEN_LET_GO_MS = 60_000;

/** The websocket address of the project's Realtime service, from its https address and public key. */
export function socketUrl(url: string, key: string): string {
  return `${url.replace(/^https:/, 'wss:')}/realtime/v1/websocket?apikey=${encodeURIComponent(key)}&vsn=1.0.0`;
}

/**
 * Listen on the channels. Calls `onPing` when a ping arrives, and once when the socket comes back after being closed (mail may have landed meanwhile).
 * Returns the function that closes everything.
 */
export function connectMailSignal(answer: Required<Pick<SignalAnswer, 'url' | 'key' | 'channels'>>, onPing: Listener, deps: Deps): () => void {
  let socket: WebSocket | null = null;
  let stopped = false;
  let attempt = 0;
  let ref = 0;
  let beat: unknown = null;
  let retry: unknown = null;
  let hide: unknown = null;
  let wasClosed = false;

  const clearTimers = () => {
    if (beat !== null) deps.clearTimeoutFn(beat);
    if (retry !== null) deps.clearTimeoutFn(retry);
    beat = null;
    retry = null;
  };

  const close = () => {
    clearTimers();
    joined = false;
    const s = socket;
    socket = null;
    if (s) {
      s.onopen = s.onmessage = s.onclose = s.onerror = null;
      try {
        s.close();
      } catch {
        /* already closed */
      }
    }
    wasClosed = true;
  };

  const heartbeat = () => {
    if (!socket || socket.readyState !== 1) return;
    socket.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++ref) }));
    beat = deps.setTimeoutFn(heartbeat, HEARTBEAT_MS);
  };

  const open = () => {
    if (stopped || socket || !deps.isVisible()) return;
    let s: WebSocket;
    try {
      s = new deps.WebSocketImpl(socketUrl(answer.url, answer.key));
    } catch {
      return;
    }
    socket = s;
    s.onopen = () => {
      attempt = 0;
      for (const ch of answer.channels) {
        s.send(JSON.stringify({ topic: `realtime:${ch}`, event: 'phx_join', payload: { config: { broadcast: { self: false }, presence: { key: '' }, private: false } }, ref: String(++ref) }));
      }
      joined = true;
      beat = deps.setTimeoutFn(heartbeat, HEARTBEAT_MS);
      if (wasClosed) {
        wasClosed = false;
        onPing();
      }
    };
    s.onmessage = (e) => {
      try {
        const m = JSON.parse(String(e.data)) as { event?: string; payload?: { event?: string } };
        if (m.event === 'broadcast' && m.payload?.event === 'ping') onPing();
      } catch {
        /* not ours */
      }
    };
    const lost = () => {
      if (socket !== s) return;
      close();
      if (stopped || !deps.isVisible()) return;
      attempt += 1;
      retry = deps.setTimeoutFn(open, Math.min(60_000, 2000 * 2 ** Math.min(attempt, 5)));
    };
    s.onclose = lost;
    s.onerror = lost;
  };

  const offVisibility = deps.onVisibility(() => {
    if (deps.isVisible()) {
      if (hide !== null) deps.clearTimeoutFn(hide);
      hide = null;
      if (!socket) open();
    } else if (hide === null) {
      hide = deps.setTimeoutFn(() => {
        hide = null;
        if (!deps.isVisible()) close();
      }, HIDDEN_LET_GO_MS);
    }
  });

  open();
  return () => {
    stopped = true;
    offVisibility();
    if (hide !== null) deps.clearTimeoutFn(hide);
    close();
    joined = false;
  };
}

/** Keeps the dashboard's one socket open while `enabled`; every ping goes to the parts that called onMailSignal. Does nothing when the server has no ping set up. */
export function useMailSignalConnection(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || typeof WebSocket === 'undefined') return undefined;
    let stop: (() => void) | null = null;
    let gone = false;
    void fetch('/api/v1/mail-signal', { credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<{ data?: SignalAnswer }>) : null))
      .then((body) => {
        const a = body?.data;
        if (gone || !a?.enabled || !a.url || !a.key || !a.channels?.length) return;
        stop = connectMailSignal({ url: a.url, key: a.key, channels: a.channels }, emit, {
          WebSocketImpl: WebSocket,
          setTimeoutFn: (fn, ms) => window.setTimeout(fn, ms),
          clearTimeoutFn: (id) => window.clearTimeout(id as number),
          isVisible: () => document.visibilityState === 'visible',
          onVisibility: (cb) => {
            document.addEventListener('visibilitychange', cb);
            return () => document.removeEventListener('visibilitychange', cb);
          },
        });
      })
      .catch(() => undefined);
    return () => {
      gone = true;
      if (stop) stop();
    };
  }, [enabled]);
}
