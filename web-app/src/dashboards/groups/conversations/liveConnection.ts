'use client';

// Keeps the tab's one live line open while a console with Email or WhatsApp is open (RoleDashboard). The transport is chosen by what the server answers:
//   the stream (GET /api/v1/live, a long-running server): read with fetch, opened again when the server closes it (every few minutes, so the session is checked again),
//     after a lost connection with a growing wait, and let go after a minute in a hidden tab;
//   the server says it has no stream (409 on Vercel, 403 for an account without a box): the mail ping (lib/mailSignal.ts), when the server has one, feeds the same bus;
//   the demo (mock mode): the mock's own changes, and now and then a guest writes by themselves (liveDemo.ts).
import { useEffect } from 'react';

import type { ConvScope } from '@shared/dashboards/conversations';
import { apiMode } from '@/lib/api/mode';
import { mailSignalLive, onMailSignal } from '@/lib/mailSignal';

import { emitConvLive, eventOfWire, liveMode, setLiveMode, splitSse } from './live';

const HIDDEN_LET_GO_MS = 60_000;

export interface StreamDeps {
  fetchFn: typeof fetch;
  setTimeoutFn: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn: (id: unknown) => void;
  isVisible: () => boolean;
  onVisibility: (cb: () => void) => () => void;
}

/**
 * Reads the stream and puts every event on the bus. `onOff` is called once when the server says it has no stream for this tab (the caller then relies on the ping).
 * Returns the function that closes it.
 */
export function connectConvStream(deps: StreamDeps, onOff: () => void): () => void {
  let stopped = false;
  let ctrl: AbortController | null = null;
  let retry: unknown = null;
  let hide: unknown = null;
  let attempt = 0;
  let hadGap = false;

  const close = () => {
    ctrl?.abort();
    ctrl = null;
    setLiveMode('off');
  };
  const open = async () => {
    if (stopped || ctrl || !deps.isVisible()) return;
    const me = new AbortController();
    ctrl = me;
    let r: Response;
    try {
      r = await deps.fetchFn('/api/v1/live', { credentials: 'same-origin', headers: { accept: 'text/event-stream' }, signal: me.signal, cache: 'no-store' });
    } catch {
      return lost(me);
    }
    if (!r.ok || !/text\/event-stream/.test(r.headers.get('content-type') ?? '') || !r.body) {
      // no stream on this server (409), or this account has none (401/403): not tried again in this tab
      if (r.status === 409 || r.status === 403 || r.status === 404) {
        stopped = true;
        if (ctrl === me) ctrl = null;
        onOff();
        return;
      }
      return lost(me);
    }
    attempt = 0;
    setLiveMode('stream');
    // back after a gap: whatever changed meanwhile is read once
    if (hadGap) emitConvLive({ scope: 'all', ids: [] });
    hadGap = true;
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const { events, rest } = splitSse(buf);
        buf = rest;
        for (const ev of events) {
          if (ev.event !== 'message') continue;
          const e = eventOfWire(ev.data);
          if (e) emitConvLive(e);
        }
      }
    } catch {
      // the connection dropped
    }
    if (ctrl !== me) return;
    ctrl = null;
    setLiveMode('off');
    // the server closed it (its few minutes are up, or it restarted): opened again at once, and what changed meanwhile is read once
    if (!stopped) retry = deps.setTimeoutFn(() => void open(), 300);
  };
  const lost = (me: AbortController) => {
    if (ctrl !== me) return;
    ctrl = null;
    setLiveMode('off');
    if (stopped || !deps.isVisible()) return;
    attempt += 1;
    retry = deps.setTimeoutFn(() => void open(), Math.min(60_000, 2000 * 2 ** Math.min(attempt - 1, 5)));
  };
  const offVisibility = deps.onVisibility(() => {
    if (deps.isVisible()) {
      if (hide !== null) deps.clearTimeoutFn(hide);
      hide = null;
      if (!ctrl && !stopped) void open();
    } else if (hide === null) {
      hide = deps.setTimeoutFn(() => {
        hide = null;
        if (!deps.isVisible()) close();
      }, HIDDEN_LET_GO_MS);
    }
  });
  void open();
  return () => {
    stopped = true;
    offVisibility();
    if (retry !== null) deps.clearTimeoutFn(retry);
    if (hide !== null) deps.clearTimeoutFn(hide);
    close();
  };
}

/** The dashboard's live line for these pages (their demo arrivals in mock mode). */
export function useConvLiveConnection(enabled: boolean, scopes: readonly ConvScope[]): void {
  const key = scopes.join(',');
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined;
    if (apiMode() === 'mock') {
      setLiveMode('demo');
      let stop: (() => void) | null = null;
      let gone = false;
      void import('./liveDemo').then((m) => {
        if (!gone) stop = m.startDemoArrivals(key.split(',') as ConvScope[]);
      });
      return () => {
        gone = true;
        stop?.();
        setLiveMode('off');
      };
    }
    // the ping (where the server has it) feeds the same bus: every page asks again
    const offPing = onMailSignal(() => emitConvLive({ scope: 'all', ids: [] }));
    const pingMode = window.setInterval(() => {
      if (liveMode() === 'off' && mailSignalLive()) setLiveMode('ping');
      else if (liveMode() === 'ping' && !mailSignalLive()) setLiveMode('off');
    }, 5_000);
    const stop = connectConvStream(
      {
        fetchFn: (...a) => window.fetch(...a),
        setTimeoutFn: (fn, ms) => window.setTimeout(fn, ms),
        clearTimeoutFn: (id) => window.clearTimeout(id as number),
        isVisible: () => document.visibilityState === 'visible',
        onVisibility: (cb) => {
          document.addEventListener('visibilitychange', cb);
          return () => document.removeEventListener('visibilitychange', cb);
        },
      },
      () => undefined,
    );
    return () => {
      offPing();
      window.clearInterval(pingMode);
      stop();
    };
  }, [enabled, key]);
}
