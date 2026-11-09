import "server-only";
// Live Email and WhatsApp (MJ, 5 Nov 2026: "SPA and two-way talking live"). One small event, "these conversations changed", carries ids and nothing else: no name, no address,
// no text. It is published after a change is saved and reaches the browsers whose person may see that box (the same rules as the mail ping, server/mail/signal.ts):
//   - on a long-running server: this process's own hub, fed through PostgreSQL NOTIFY / LISTEN so every server process hears every change, streamed to the page (SSE);
//   - on a serverless host: the Supabase Realtime ping of mail/signal.ts (a page then asks again);
//   - and always the pages' own slow checks as the safety net.

export type LiveBoxKind = "hotel" | "platform" | "group" | "person";
export interface LiveBox {
  readonly kind: LiveBoxKind;
  readonly id: string;
}
export type ChangeWhat = "message" | "status" | "read" | "meta";
export interface ConvChange {
  box: LiveBox;
  /** The conversations that changed; empty = something in the box changed (the page reads its list and its open thread again). */
  ids: string[];
  what: ChangeWhat;
}
/** What a browser is sent: the page it is for, the conversation ids and the kind of change. */
export interface LiveWire {
  s: "hotel" | "platform" | "group" | "personal";
  ids: string[];
  w: ChangeWhat;
}

export const PLATFORM_BOX: LiveBox = { kind: "platform", id: "desks" };
export const NOTIFY_CHANNEL = "hms_conv";
/** More ids than this in one change: sent as "the box changed". */
export const MAX_IDS = 40;
const ID = /^[A-Za-z0-9_.:-]{1,80}$/;
const KINDS: readonly LiveBoxKind[] = ["hotel", "platform", "group", "person"];
const WHATS: readonly ChangeWhat[] = ["message", "status", "read", "meta"];
const RANK: Record<ChangeWhat, number> = { message: 3, status: 2, read: 1, meta: 0 };

export const boxKey = (b: LiveBox): string => `${b.kind}:${b.id}`;
const SCOPE: Record<LiveBoxKind, LiveWire["s"]> = { hotel: "hotel", platform: "platform", group: "group", person: "personal" };

export function wireOf(c: ConvChange): LiveWire {
  return { s: SCOPE[c.box.kind], ids: c.ids.length > MAX_IDS ? [] : c.ids.filter((x) => ID.test(x)), w: c.what };
}

/** One change per box: the ids joined (an empty list wins: the whole box), the strongest kind kept. */
export function mergeChanges(list: readonly ConvChange[]): ConvChange[] {
  const by = new Map<string, ConvChange>();
  for (const c of list) {
    const key = boxKey(c.box);
    const had = by.get(key);
    if (!had) {
      by.set(key, { box: c.box, ids: [...new Set(c.ids)], what: c.what });
      continue;
    }
    const ids = had.ids.length === 0 || c.ids.length === 0 ? [] : [...new Set([...had.ids, ...c.ids])];
    by.set(key, { box: c.box, ids: ids.length > MAX_IDS ? [] : ids, what: RANK[c.what] > RANK[had.what] ? c.what : had.what });
  }
  return [...by.values()];
}

export function encodeNotify(c: ConvChange): string {
  return JSON.stringify({ k: c.box.kind, i: c.box.id, c: c.ids.length > MAX_IDS ? [] : c.ids, w: c.what });
}

/** A NOTIFY payload back into a change; anything not shaped like ours is dropped. */
export function decodeNotify(payload: string): ConvChange | null {
  try {
    const v = JSON.parse(payload) as { k?: unknown; i?: unknown; c?: unknown; w?: unknown };
    if (typeof v.k !== "string" || !KINDS.includes(v.k as LiveBoxKind) || typeof v.i !== "string" || !ID.test(v.i) || typeof v.w !== "string" || !WHATS.includes(v.w as ChangeWhat) || !Array.isArray(v.c)) return null;
    const ids = v.c.filter((x): x is string => typeof x === "string" && ID.test(x)).slice(0, MAX_IDS);
    return { box: { kind: v.k as LiveBoxKind, id: v.i }, ids, what: v.w as ChangeWhat };
  } catch {
    return null;
  }
}

/** Who may hear a box. The person's own mailbox (any staff login), the platform desks (platform staff), their hotel (its staff, never a visitor), their group (its Group Admin). */
export interface LiveSessionFacts {
  userId: string;
  hotelId: string;
  accountRole: string;
  client?: string;
  token?: unknown;
  visit?: unknown;
}
export function boxesForSession(session: LiveSessionFacts, opts: { groupId?: string | null; hotelInbox?: boolean } = {}): LiveBox[] {
  if (session.client !== "web" || session.token !== undefined) return [];
  const role = session.accountRole;
  if (role === "guest_user" || role === "corporate_user") return [];
  const out: LiveBox[] = [{ kind: "person", id: session.userId }];
  if (session.visit !== undefined && session.visit !== null) return out;
  if (role === "platform_admin" || role === "super_admin") out.push(PLATFORM_BOX);
  else if ((role === "hotel_admin" || role === "hotel_user") && session.hotelId && opts.hotelInbox !== false) out.push({ kind: "hotel", id: session.hotelId });
  else if (role === "group_hotel_admin" && opts.groupId) out.push({ kind: "group", id: opts.groupId });
  return out;
}

export interface LiveHub {
  subscribe(boxes: readonly LiveBox[], send: (w: LiveWire) => void): () => void;
  deliver(change: ConvChange): void;
  /** Open streams (diagnostics, tests). */
  size(): number;
}

export function createLiveHub(): LiveHub {
  const byBox = new Map<string, Set<(w: LiveWire) => void>>();
  let open = 0;
  return {
    subscribe(boxes, send) {
      const keys = [...new Set(boxes.map(boxKey))];
      for (const k of keys) {
        let set = byBox.get(k);
        if (!set) byBox.set(k, (set = new Set()));
        set.add(send);
      }
      open += 1;
      let done = false;
      return () => {
        if (done) return;
        done = true;
        open -= 1;
        for (const k of keys) {
          const set = byBox.get(k);
          set?.delete(send);
          if (set && set.size === 0) byBox.delete(k);
        }
      };
    },
    deliver(change) {
      const set = byBox.get(boxKey(change.box));
      if (!set) return;
      const w = wireOf(change);
      for (const send of [...set]) {
        try {
          send(w);
        } catch {
          // one broken stream never stops the others
        }
      }
    },
    size: () => open,
  };
}

export interface LiveDeps {
  /** Sends one NOTIFY on the shared pool (absent: no database). */
  notify?: (payload: string) => Promise<void>;
  /** Opens this process's LISTEN connection (absent or null: none possible). */
  listen?: (onPayload: (payload: string) => void, onState: (up: boolean) => void) => { close(): Promise<void> } | null;
  /** The serverless host's ping (mail/signal.ts), when it is set up. */
  signal?: (box: LiveBox) => Promise<void>;
  /** Runs work after the answer when the host allows it, else at once. */
  later?: (work: () => Promise<void>) => void;
  /** A serverless host: a held-open stream is cut by the host, so the page uses the ping instead. */
  serverless?: boolean;
}

export interface ConvLive {
  readonly hub: LiveHub;
  /** "sse" where this server can hold a stream open, else "off". */
  transport(): "sse" | "off";
  publish(changes: readonly ConvChange[]): void;
  /** The event stream of one page: a ready line, then one data line per change of its boxes, a comment every `heartbeatMs`, closed after `lifetimeMs` (the page opens a new one, signed in again). */
  stream(boxes: readonly LiveBox[], abort: AbortSignal | undefined, opts?: { heartbeatMs?: number; lifetimeMs?: number }): ReadableStream<Uint8Array>;
  close(): Promise<void>;
}

export function createConvLive(deps: LiveDeps = {}): ConvLive {
  const hub = createLiveHub();
  let listener: { close(): Promise<void> } | null = null;
  let tried = false;
  let listening = false;
  const ensureListening = () => {
    if (tried || !deps.listen) return;
    tried = true;
    listener = deps.listen(
      (payload) => {
        const c = decodeNotify(payload);
        if (c) hub.deliver(c);
      },
      (up) => {
        listening = up;
      },
    );
  };
  const later = deps.later ?? ((work: () => Promise<void>) => void work().catch(() => undefined));

  return {
    hub,
    transport: () => (deps.serverless ? "off" : "sse"),
    publish(changes) {
      for (const c of mergeChanges(changes)) {
        if (deps.notify) {
          // our own LISTEN brings it back to this process's pages; while it is down they are told here
          if (!listening) hub.deliver(c);
          const payload = encodeNotify(c);
          later(() => deps.notify!(payload).catch(() => undefined));
        } else hub.deliver(c);
        if (deps.signal) later(() => deps.signal!(c.box).catch(() => undefined));
      }
    },
    stream(boxes, abort, opts = {}) {
      ensureListening();
      const enc = new TextEncoder();
      let stop: () => void = () => undefined;
      return new ReadableStream<Uint8Array>({
        start(ctrl) {
          let ended = false;
          const send = (text: string) => {
            if (ended) return;
            try {
              ctrl.enqueue(enc.encode(text));
            } catch {
              stop();
            }
          };
          const off = hub.subscribe(boxes, (w) => send(`data: ${JSON.stringify(w)}\n\n`));
          const beat = setInterval(() => send(": beat\n\n"), opts.heartbeatMs ?? 25_000);
          const end = setTimeout(() => {
            stop();
            try {
              ctrl.close();
            } catch {
              // already closed by the browser
            }
          }, opts.lifetimeMs ?? 300_000);
          stop = () => {
            if (ended) return;
            ended = true;
            off();
            clearInterval(beat);
            clearTimeout(end);
          };
          if (abort) {
            if (abort.aborted) stop();
            else abort.addEventListener("abort", () => stop(), { once: true });
          }
          send(`retry: 3000\nevent: ready\ndata: {"transport":"sse"}\n\n`);
        },
        cancel() {
          stop();
        },
      });
    },
    async close() {
      const l = listener;
      listener = null;
      if (l) await l.close();
    },
  };
}
