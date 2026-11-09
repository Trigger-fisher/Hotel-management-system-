'use client';

// The page side of live Email and WhatsApp (MJ, 5 Nov 2026): one bus for the tab. An event says which page (hotel, platform, group or the person's own mailbox) and which
// conversations changed, never what they say; the lists and threads on screen then read just those again. It is fed by the server's stream (liveConnection.ts), the mail ping
// where that is the host's way, or the demo in mock mode. The pages' own checks stay as the safety net, slower while the bus is live.
import type { ConvScope } from '@shared/dashboards/conversations';

export type ChangeWhat = 'message' | 'status' | 'read' | 'meta';
export interface ConvLiveEvent {
  /** 'all' = every page asks again (a ping, or the stream came back after a gap). */
  scope: ConvScope | 'all';
  /** Empty = the whole list (and the open thread). */
  ids: readonly string[];
  what?: ChangeWhat;
}
export type LiveMode = 'off' | 'stream' | 'ping' | 'demo';

type Listener = (e: ConvLiveEvent) => void;
const listeners = new Set<Listener>();
let mode: LiveMode = 'off';

export function onConvLive(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitConvLive(e: ConvLiveEvent): void {
  for (const l of [...listeners]) {
    try {
      l(e);
    } catch {
      // one page's trouble never stops the others
    }
  }
}

export const liveMode = (): LiveMode => mode;
export function setLiveMode(next: LiveMode): void {
  mode = next;
}

/** How often a page still asks by itself: rarely while something tells it of changes, as before when nothing does. */
export const LIST_EVERY_MS = { live: 60_000, alone: 20_000 } as const;
export const THREAD_EVERY_MS = { live: 60_000, alone: 10_000 } as const;
export const everyMs = (kind: 'list' | 'thread', live: boolean = mode !== 'off'): number => (kind === 'list' ? LIST_EVERY_MS : THREAD_EVERY_MS)[live ? 'live' : 'alone'];

/** Does this event concern this page (and, when given, this conversation)? */
export function touches(e: ConvLiveEvent, scope: ConvScope, id?: string | null): boolean {
  if (e.scope !== 'all' && e.scope !== scope) return false;
  if (id === undefined || id === null) return true;
  return e.ids.length === 0 || e.ids.includes(id);
}

const WIRE_SCOPES: readonly ConvScope[] = ['hotel', 'platform', 'group', 'personal'];
const WHATS: readonly ChangeWhat[] = ['message', 'status', 'read', 'meta'];

/** One `data:` line of the stream as an event, or null for anything else. */
export function eventOfWire(data: string): ConvLiveEvent | null {
  try {
    const v = JSON.parse(data) as { s?: unknown; ids?: unknown; w?: unknown };
    if (typeof v.s !== 'string' || !WIRE_SCOPES.includes(v.s as ConvScope) || !Array.isArray(v.ids)) return null;
    const ids = v.ids.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 80);
    return { scope: v.s as ConvScope, ids, ...(typeof v.w === 'string' && WHATS.includes(v.w as ChangeWhat) ? { what: v.w as ChangeWhat } : {}) };
  } catch {
    return null;
  }
}

/** Splits what the stream sent so far into whole events (their data lines joined) and the unfinished rest. */
export function splitSse(buffer: string): { events: { event: string; data: string }[]; rest: string } {
  const text = buffer.replace(/\r\n/g, '\n');
  const parts = text.split('\n\n');
  const rest = parts.pop() ?? '';
  const events: { event: string; data: string }[] = [];
  for (const block of parts) {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue;
      const at = line.indexOf(':');
      const field = at === -1 ? line : line.slice(0, at);
      const value = at === -1 ? '' : line.slice(at + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length) events.push({ event, data: data.join('\n') });
  }
  return { events, rest };
}

/** Runs `fn` once after the calls stop for `ms` (several events in a burst: one read). */
export function debounce(fn: () => void, ms: number): { call: () => void; cancel: () => void } {
  let t: ReturnType<typeof setTimeout> | null = null;
  return {
    call: () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        t = null;
        fn();
      }, ms);
    },
    cancel: () => {
      if (t) clearTimeout(t);
      t = null;
    },
  };
}
