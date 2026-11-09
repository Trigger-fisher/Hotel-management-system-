import "server-only";
// Holds (plan part 11): a guest message that waits for the answer to "which hotel?". The held text is the only moment guest text sits outside a hotel database, so it is sealed
// (seal.ts, bound to the line), lives at most hold_minutes (default 10) and is never logged. The guest is a keyed hash of the number. Time is passed in, never read.
import { timingSafeEqual } from "node:crypto";
import { hashNumber } from "./config";
import type { WaHoldRow, WaHoldStore, WaLineHotel, WaRoutingStore } from "./routingPorts";
import { openHold, sealHold } from "./seal";

/** One inbound message as it is kept while waiting. `content` is whatever the inbound path needs to replay it (the parsed message); this module never reads it. */
export interface HeldMessage {
  wamid: string;
  receivedAt: string;
  content: unknown;
}

interface HoldPayload {
  messages: HeldMessage[];
}

/** A guest who keeps typing does not grow a hold without end. */
export const MAX_HELD_MESSAGES = 20;
export const DEFAULT_STICKY_MINUTES = 10;
const MINUTE = 60_000;

export interface HoldDeps {
  store: WaHoldStore;
  sealKey: Buffer;
  hashKey: Buffer;
}

/** The open hold of this guest, or null. An expired one is deleted on the way (the lazy sweep: its messages are discarded). */
export async function findOpenHold(store: WaHoldStore, lineId: string, guestHash: Buffer, now: Date): Promise<WaHoldRow | null> {
  const row = await store.findByGuest(lineId, guestHash);
  if (!row) return null;
  if (row.expiresAt.getTime() <= now.getTime()) {
    await store.remove(row.id);
    return null;
  }
  return row;
}

export interface CreateHoldInput {
  lineId: string;
  guestDigits: string;
  message: HeldMessage;
  /** The offered hotels in the order the question shows them (used only when a new hold is made). */
  candidateHotelIds: readonly string[];
  holdMinutes: number;
  now: Date;
}

/** Hold a message. A guest with an open hold gets the message appended (never asked twice, and the expiry is not extended). */
export async function createOrAppendHold(deps: HoldDeps, input: CreateHoldInput): Promise<{ holdId: string; created: boolean; appended: boolean }> {
  const guestHash = hashNumber(deps.hashKey, input.guestDigits);
  const open = await findOpenHold(deps.store, input.lineId, guestHash, input.now);
  if (open) {
    const payload = openHold(deps.sealKey, open.payloadSecret, input.lineId) as HoldPayload;
    if (payload.messages.some((m) => m.wamid === input.message.wamid) || payload.messages.length >= MAX_HELD_MESSAGES) return { holdId: open.id, created: false, appended: false };
    payload.messages.push(input.message);
    await deps.store.updatePayload(open.id, sealHold(deps.sealKey, payload, input.lineId));
    return { holdId: open.id, created: false, appended: true };
  }
  const row = await deps.store.insert({
    lineId: input.lineId,
    guestHash,
    payloadSecret: sealHold(deps.sealKey, { messages: [input.message] } satisfies HoldPayload, input.lineId),
    candidateHotels: [...input.candidateHotelIds],
    questionWamid: null,
    expiresAt: new Date(input.now.getTime() + input.holdMinutes * MINUTE),
  });
  return { holdId: row.id, created: true, appended: true };
}

export interface AnswerHoldInput {
  lineId: string;
  guestDigits: string;
  holdId: string;
  index: number | "other";
  now: Date;
  /** The hotels on the line now (state decides between delivering and redirecting). */
  lineHotels: readonly WaLineHotel[];
  /** Hand the held messages to the normal inbound path, in order. The hold is deleted only after this returns. */
  deliver: (hotelId: string, messages: HeldMessage[]) => Promise<void>;
  stickyMinutes?: number;
}

export type AnswerHoldResult =
  | { ok: true; kind: "delivered"; hotelId: string; count: number }
  | { ok: true; kind: "redirect"; hotelId: string; phone: string | null }
  | { ok: true; kind: "other" }
  | { ok: false; reason: "missing" | "expired" | "guest_mismatch" | "bad_choice" | "hotel_gone" | "unreadable" };

/** The guest answered the question: check it, deliver everything held to the chosen hotel, delete the hold and remember the choice for a while. */
export async function answerHold(deps: HoldDeps & { routing: Pick<WaRoutingStore, "saveSelection"> }, input: AnswerHoldInput): Promise<AnswerHoldResult> {
  const row = await deps.store.get(input.holdId);
  if (!row || row.lineId !== input.lineId) return { ok: false, reason: "missing" };
  if (row.expiresAt.getTime() <= input.now.getTime()) {
    await deps.store.remove(row.id);
    return { ok: false, reason: "expired" };
  }
  const guestHash = hashNumber(deps.hashKey, input.guestDigits);
  if (guestHash.length !== row.guestHash.length || !timingSafeEqual(guestHash, row.guestHash)) return { ok: false, reason: "guest_mismatch" };
  // "Other hotel": the hold stays; the caller asks for part of the name
  if (input.index === "other") return { ok: true, kind: "other" };
  const hotelId = Number.isInteger(input.index) && input.index >= 0 ? row.candidateHotels[input.index] : undefined;
  if (hotelId === undefined) return { ok: false, reason: "bad_choice" };
  const hotel = input.lineHotels.find((h) => h.hotelId === hotelId);
  if (!hotel) return { ok: false, reason: "hotel_gone" };
  // a hold that offered a hotel and is answered after its cut-over is a redirect, not a delivery (plan 14)
  if (hotel.state === "active") {
    await deps.store.remove(row.id);
    return { ok: true, kind: "redirect", hotelId, phone: hotel.redirectPhone };
  }
  let payload: HoldPayload;
  try {
    payload = openHold(deps.sealKey, row.payloadSecret, input.lineId) as HoldPayload;
  } catch {
    await deps.store.remove(row.id);
    return { ok: false, reason: "unreadable" };
  }
  await deps.routing.saveSelection(input.lineId, guestHash, { hotelId, expiresAt: new Date(input.now.getTime() + (input.stickyMinutes ?? DEFAULT_STICKY_MINUTES) * MINUTE) });
  await input.deliver(hotelId, payload.messages);
  await deps.store.remove(row.id);
  return { ok: true, kind: "delivered", hotelId, count: payload.messages.length };
}

/** The sweeper job (every minute): delete expired holds, their messages are discarded and nothing is delivered. */
export async function sweepExpiredHolds(store: WaHoldStore, now: Date): Promise<number> {
  return store.removeExpired(now);
}
