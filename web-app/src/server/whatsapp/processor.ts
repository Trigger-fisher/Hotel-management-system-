import "server-only";
import type { WaWebhookEvent } from "./payload";
import type { WaEventRow, WaEventStore, WaLine, WaLineStore } from "./ports";
import { openEvent } from "./seal";

// The event processor (plan part 29.1 and phase 1 task 5): processing is a function of an event id. Intake only SAVES events; this takes saved events, opens each (it is sealed), hands it to the
// handler of its kind and records the outcome. It never routes, saves a message or sends anything itself: those are the handlers' work (routing, inbound save, status apply), so the same
// processor serves the sweep, the "right after the answer" wake-up, a manual "run now" and a replay.
//   - the kill switch (whatsapp.enabled) off: nothing is taken, events wait (they are kept at most 7 days)
//   - an event is leased for 60 seconds; a worker that dies simply lets the lease run out and the event is taken again
//   - a handler that fails is retried on a fixed schedule (30 s, 2 min, 10 min, 1 h, 6 h) and then dead; a poison event (unreadable payload, a handler that says it can never work) is dead at once
//   - a status that arrives before its message is PARKED (looked at again in a minute, not counted as a failed attempt) and dropped after 10 minutes: it was not ours
//   - the guest's number is a lock key: two events of one guest never run at the same moment (a lock that cannot be had in 5 seconds is a retry, not a failure)
export const RETRY_SECONDS: readonly number[] = [30, 120, 600, 3600, 21_600];
export const LEASE_SECONDS = 60;
export const PARK_SECONDS = 60;
export const PARK_GIVE_UP_SECONDS = 600;
export const LOCK_WAIT_MS = 5000;

export type MessageEvent = Extract<WaWebhookEvent, { kind: "message" }>;
export type StatusEvent = Extract<WaWebhookEvent, { kind: "status" }>;
export type OtherEvent = Extract<WaWebhookEvent, { kind: "template" | "other" }>;

/** What a handler answers: finished; wait for something else; try again later; or never (poison). `code` is a short machine code, never guest text. */
export type WaHandlerResult = { kind: "done" } | { kind: "park" } | { kind: "retry"; code: string } | { kind: "dead"; code: string };

export interface HandlerContext<E> {
  event: E;
  line: WaLine;
  row: WaEventRow;
  now: Date;
}

export interface WaEventHandlers {
  message(ctx: HandlerContext<MessageEvent>): Promise<WaHandlerResult>;
  status(ctx: HandlerContext<StatusEvent>): Promise<WaHandlerResult>;
  other(ctx: HandlerContext<OtherEvent>): Promise<WaHandlerResult>;
}

/** Runs `work` while holding the lock of one guest on one line; rejects with LockTimeout when the lock is not free within `waitMs`. */
export type WaGuestLock = <T>(lineId: string, guestKey: string, waitMs: number, work: () => Promise<T>) => Promise<T>;

export class LockTimeout extends Error {
  constructor() {
    super("The guest's lock was busy");
    this.name = "LockTimeout";
  }
}

export interface ProcessorDeps {
  events: WaEventStore;
  lines: WaLineStore;
  handlers: WaEventHandlers;
  /** The key that opens saved events (WhatsAppConfig.sealKey). */
  sealKey: () => Buffer | null;
  /** The kill switch: platform setting whatsapp.enabled. */
  enabled: () => Promise<boolean>;
  lock?: WaGuestLock;
  now?: () => Date;
  /** One short line per problem, ids and codes only. */
  log?: (message: string, fields: Record<string, string | number>) => void;
}

export interface BatchResult {
  /** False when the kill switch was off or the key is missing: nothing was taken. */
  active: boolean;
  taken: number;
  done: number;
  parked: number;
  retried: number;
  dead: number;
}

const EMPTY: BatchResult = { active: false, taken: 0, done: 0, parked: 0, retried: 0, dead: 0 };

/** The next try after the n-th failed attempt, or null when the schedule is used up (the event is then dead). */
export function retryAt(now: Date, attempts: number): Date | null {
  const wait = RETRY_SECONDS[attempts - 1];
  return wait === undefined ? null : new Date(now.getTime() + wait * 1000);
}

/** Message and delivery states only move forward (sent, delivered, read); "failed" can follow sent or pending but never replaces delivered or read. Returns the state to keep. */
const RANK: Record<string, number> = { pending: 0, received: 0, sent: 1, delivered: 2, read: 3 };
export function nextStatus(current: string, incoming: "sent" | "delivered" | "read" | "failed"): string {
  if (incoming === "failed") return current === "delivered" || current === "read" ? current : "failed";
  if (current === "failed") return RANK[incoming] >= 1 ? incoming : current;
  return (RANK[incoming] ?? 0) > (RANK[current] ?? 0) ? incoming : current;
}

/** The lock key of an event: the guest's number for a message, the recipient for a status; none for template and account changes. */
export function guestKeyOf(event: WaWebhookEvent): string | null {
  if (event.kind === "message") return event.from;
  if (event.kind === "status") return event.recipient;
  return null;
}

export function createEventProcessor(deps: ProcessorDeps) {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => undefined);

  async function run(row: WaEventRow, at: Date): Promise<"done" | "parked" | "retried" | "dead"> {
    const settle = async (result: WaHandlerResult): Promise<"done" | "parked" | "retried" | "dead"> => {
      if (result.kind === "done") {
        await deps.events.complete(row.id, at);
        return "done";
      }
      if (result.kind === "park") {
        // a status that never finds its message is not ours: drop it after ten minutes instead of looking for ever
        if (at.getTime() - row.receivedAt.getTime() > PARK_GIVE_UP_SECONDS * 1000) {
          await deps.events.complete(row.id, at);
          return "done";
        }
        await deps.events.park(row.id, new Date(at.getTime() + PARK_SECONDS * 1000), at);
        return "parked";
      }
      if (result.kind === "dead") {
        await deps.events.fail(row.id, result.code, null, at);
        log("whatsapp event dead", { event: row.id, code: result.code });
        return "dead";
      }
      const next = retryAt(at, row.attempts);
      await deps.events.fail(row.id, result.code, next, at);
      if (next === null) log("whatsapp event dead", { event: row.id, code: result.code });
      return next === null ? "dead" : "retried";
    };

    const key = deps.sealKey();
    const line = await deps.lines.findById(row.lineId);
    if (!key || !line || row.payloadSecret === null) return settle({ kind: "dead", code: !key ? "NO_KEY" : !line ? "NO_LINE" : "NO_PAYLOAD" });
    if (line.status === "banned") return settle({ kind: "dead", code: "LINE_BANNED" });
    let event: WaWebhookEvent;
    try {
      event = openEvent(key, row.payloadSecret, row.lineId) as WaWebhookEvent;
      if (!event || typeof event !== "object" || event.kind !== row.kind) throw new Error("shape");
    } catch {
      // sealed under another key, or damaged: it can never be read
      return settle({ kind: "dead", code: "UNREADABLE" });
    }
    const dispatch = (): Promise<WaHandlerResult> => {
      if (event.kind === "message") return deps.handlers.message({ event, line, row, now: at });
      if (event.kind === "status") return deps.handlers.status({ event, line, row, now: at });
      return deps.handlers.other({ event, line, row, now: at });
    };
    const guest = guestKeyOf(event);
    try {
      return await settle(guest && deps.lock ? await deps.lock(row.lineId, guest, LOCK_WAIT_MS, dispatch) : await dispatch());
    } catch (error) {
      // only a code is kept: a thrown error may carry anything, and nothing of a guest's text is ever written to a log
      const code = error instanceof LockTimeout ? "LOCK_TIMEOUT" : "HANDLER_ERROR";
      return settle({ kind: "retry", code });
    }
  }

  return {
    /** Take up to `limit` due events and process them one after another (oldest first, so one guest's messages keep their order). */
    async runBatch(limit = 20): Promise<BatchResult> {
      if (!deps.sealKey() || !(await deps.enabled())) return { ...EMPTY };
      const at = now();
      const rows = await deps.events.claim(at, limit, LEASE_SECONDS);
      const out: BatchResult = { active: true, taken: rows.length, done: 0, parked: 0, retried: 0, dead: 0 };
      for (const row of rows) {
        const r = await run(row, now());
        if (r === "done") out.done += 1;
        else if (r === "parked") out.parked += 1;
        else if (r === "retried") out.retried += 1;
        else out.dead += 1;
      }
      return out;
    },

    /** Process one saved event by id (the wake-up right after intake, a replay). Null when it is not due or somebody else holds it. */
    async processEvent(id: string): Promise<"done" | "parked" | "retried" | "dead" | null> {
      if (!deps.sealKey() || !(await deps.enabled())) return null;
      const at = now();
      const row = await deps.events.claimOne(id, at, LEASE_SECONDS);
      return row ? run(row, now()) : null;
    },
  };
}

export type WhatsAppEventProcessor = ReturnType<typeof createEventProcessor>;

/** An in-process lock per guest, for tests and a single-instance run; the PostgreSQL one (advisory lock inside the hotel's transaction) comes with the inbound save. */
export function createMemoryGuestLock(): WaGuestLock {
  const tails = new Map<string, Promise<unknown>>();
  return async (lineId, guestKey, waitMs, work) => {
    const key = `${lineId}:${guestKey}`;
    const before = tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => (release = resolve));
    const chained = before.then(() => mine);
    tails.set(key, chained);
    const ready = await Promise.race([before.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), waitMs))]);
    if (!ready) {
      release();
      throw new LockTimeout();
    }
    try {
      return await work();
    } finally {
      release();
      if (tails.get(key) === chained) tails.delete(key);
    }
  };
}
