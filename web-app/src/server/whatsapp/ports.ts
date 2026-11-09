import "server-only";
// The two stores the WhatsApp intake and the event processor stand on (the repository pattern of the rest of the app: a port here, an in-memory double in memory.ts for the unit tests, the
// PostgreSQL repository in repos/postgres/whatsapp.ts). Neither holds message text except as the sealed payload of a saved event.

export type WaLineKind = "platform" | "shared" | "hotel" | "group" | "person";
export type WaLineStatus = "test" | "active" | "paused" | "needs_reconnect" | "banned";

/** A connected number as the webhook needs to know it (never its token). */
export interface WaLine {
  id: string;
  kind: WaLineKind;
  phoneNumberId: string;
  wabaId: string;
  status: WaLineStatus;
}

export interface WaLineStore {
  /** A line by its id (any status), or null. */
  findById(id: string): Promise<WaLine | null>;
  /** The line of a Meta phone number id (any status), or null when HMS does not know the number. */
  findByPhoneNumberId(phoneNumberId: string): Promise<WaLine | null>;
  /** A line of this business account that is not banned (for the changes that name no number, such as a template's approval). */
  findByWabaId(wabaId: string): Promise<WaLine | null>;
  /** The time of the last event received on a line (shown in the line's health panel). */
  touchEvent(lineId: string, at: Date): Promise<void>;
}

export type WaEventKind = "message" | "status" | "template" | "other";
export type WaEventState = "received" | "processing" | "done" | "failed" | "dead" | "parked";

export interface NewWaEvent {
  lineId: string;
  kind: WaEventKind;
  /** "m:<line>:<wamid>", "s:<line>:<wamid>:<status>" or "o:<line>:<hash>": a repeat delivery has the same key and is saved once. */
  dedupeKey: string;
  /** The change as sealed JSON (it carries the guest's text). */
  payloadSecret: string;
  receivedAt: Date;
}

export interface WaEventRow {
  id: string;
  lineId: string;
  kind: WaEventKind;
  dedupeKey: string;
  /** Null once the event is done. */
  payloadSecret: string | null;
  state: WaEventState;
  attempts: number;
  receivedAt: Date;
}

export interface WaEventStore {
  /** Save events before anything is processed. A key that is already saved is not saved again (counted as a duplicate). Returns the ids that were new. */
  save(events: readonly NewWaEvent[]): Promise<{ saved: string[]; duplicates: number }>;
  /**
   * Take up to `limit` events that are due (received, failed or parked and past their time, or processing with an expired lease), oldest first, mark them processing for
   * `leaseSeconds` and count the attempt. Two callers never get the same event.
   */
  claim(now: Date, limit: number, leaseSeconds: number): Promise<WaEventRow[]>;
  /** One event by id, claimed the same way (for processEvent(eventId) straight after intake). Null when it is not due or somebody else holds it. */
  claimOne(id: string, now: Date, leaseSeconds: number): Promise<WaEventRow | null>;
  /** Done: the payload is cleared (the guest's text leaves the platform table at once). */
  complete(id: string, now: Date): Promise<void>;
  /** Not done: try again at `retryAt`, or dead when `retryAt` is null. `code` is a short machine code, never text from a guest. */
  fail(id: string, code: string, retryAt: Date | null, now: Date): Promise<void>;
  /** Waiting for something else (a status that arrived before its message): look again at `retryAt` without counting a failure. */
  park(id: string, retryAt: Date, now: Date): Promise<void>;
  /** Delete finished events after a day and failed or dead ones after 7 days. */
  purge(now: Date): Promise<{ done: number; failed: number }>;
}
