import "server-only";
// Routing of an inbound message (plan parts 10, 14 and 27.1). decide() is a PURE function: every fact it needs is passed in, the time included, nothing is read or written.
// routeInbound() gathers the facts from the stores and calls it. Only the shared line has rules: the platform line routes everything to the platform, an own line to its hotel.
//
// Shared line, in this order:
//   1 reply context found in the message index        -> that hotel          (both modes)
//   2 a tapped answer to our question (h:...)         -> answer the hold      (both modes)
//     a tapped "Chat with Hotel X" button (c:...)     -> that hotel, opens a selection
//   3 the text starts with a hotel code ("goa: ...")  -> that hotel, opens a selection
//   - an active selection (strict and balanced)       -> the selected hotel
//   4 no candidate hotel                              -> ask
//   5 one candidate                                   -> balanced: route, strict: ask
//   6 hotels that wrote within the timeframe          -> balanced: one active, or one clearly newest: route; else ask; strict: ask
// A hotel on its own number ('active') is never delivered to: a message naming it gets a redirect. A hotel in 'transition' is reached only by rules 1 to 3 and a selection.
import { hashNumber } from "./config";
import { findOpenHold } from "./holds";
import { parseButtonId } from "./interactive";
import type { WaGuestHotel, WaHoldStore, WaLineHotel, WaRoutingStore, WaSelection } from "./routingPorts";
import type { WaLineKind } from "./ports";

export type RoutingMode = "strict" | "balanced";
export type RouteVia = "own_line" | "reply" | "code" | "chat_button" | "selection" | "single" | "recent";

export type RoutingOutcome =
  | { kind: "route"; hotelId: string; via: RouteVia; /** an explicit choice by the guest: the caller opens a selection (selectionAfter) */ explicit: boolean }
  | { kind: "platform" }
  | { kind: "answer"; holdId: string; index: number | "other" }
  | { kind: "ask"; hotelIds: string[]; /** true when there is no hotel to name: a plain "which hotel?" text */ generic: boolean }
  | { kind: "held-append"; holdId: string }
  /** The guest tapped "Wrong hotel?" on this hotel's reply: forget the choice and ask again, offering the guest's other hotels on this number. */
  | { kind: "wrong"; hotelId: string; hotelIds: string[] }
  | { kind: "redirect"; hotelId: string; phone: string | null }
  | { kind: "drop"; reason: "unsupported_line" | "own_line_without_hotel" };

export interface RoutingDecisionInput {
  line: { kind: WaLineKind; /** the hotel of an own line */ hotelId?: string | null };
  mode: RoutingMode;
  now: Date;
  /** whatsapp.routing_timeframe_minutes (default 120) */
  timeframeMinutes: number;
  message: {
    text: string | null;
    /** the id of a tapped button or picked row */
    buttonId: string | null;
    /** the hotel that owns the message the guest swiped a reply to, from the message index; null when there was no reply context or it is unknown */
    replyOwnerHotelId: string | null;
  };
  lineHotels: readonly WaLineHotel[];
  /** the guest's hotels from the central profile */
  guestHotels: readonly WaGuestHotel[];
  openHoldId: string | null;
  selection: WaSelection | null;
}

const MINUTE = 60_000;
const lastTouch = (g: WaGuestHotel): number => Math.max(g.lastInAt?.getTime() ?? 0, g.lastOutAt?.getTime() ?? 0);

/** "goa: hello" or just "goa" names the hotel with code goa; a code in the middle of a sentence does not. */
function codeIn(text: string | null, hotels: readonly WaLineHotel[]): WaLineHotel | null {
  const t = (text ?? "").trim().toLowerCase();
  if (t === "") return null;
  return hotels.find((h) => h.hotelCode !== null && (t === h.hotelCode || t.startsWith(`${h.hotelCode}:`))) ?? null;
}

export function decide(input: RoutingDecisionInput): RoutingOutcome {
  const { line, now } = input;
  if (line.kind === "platform" || line.kind === "person") return { kind: "platform" };
  if (line.kind === "hotel") return line.hotelId ? { kind: "route", hotelId: line.hotelId, via: "own_line", explicit: false } : { kind: "drop", reason: "own_line_without_hotel" };
  if (line.kind !== "shared") return { kind: "drop", reason: "unsupported_line" };

  const byId = new Map(input.lineHotels.map((h) => [h.hotelId, h]));
  /** deliver to a hotel the guest named or was already talking to; a hotel on its own number is redirected, one the line does not know is skipped */
  const target = (hotelId: string, via: RouteVia, explicit: boolean): RoutingOutcome | null => {
    const h = byId.get(hotelId);
    if (!h) return null;
    return h.state === "active" ? { kind: "redirect", hotelId, phone: h.redirectPhone } : { kind: "route", hotelId, via, explicit };
  };
  const ask = (hotelIds: string[]): RoutingOutcome => (input.openHoldId ? { kind: "held-append", holdId: input.openHoldId } : { kind: "ask", hotelIds, generic: hotelIds.length === 0 });

  // 0 "Wrong hotel?" comes before the reply context: the tap is itself a reply to that hotel's message, and it must not send the guest back to it
  const tapped = parseButtonId(input.message.buttonId);
  if (tapped?.kind === "wrong") {
    const others = input.guestHotels
      .filter((g) => g.hotelId !== tapped.hotelId && ["shared", "pending"].includes(byId.get(g.hotelId)?.state ?? ""))
      .sort((a, b) => lastTouch(b) - lastTouch(a))
      .map((g) => g.hotelId);
    return { kind: "wrong", hotelId: tapped.hotelId, hotelIds: others };
  }
  // 1 reply context
  if (input.message.replyOwnerHotelId) {
    const r = target(input.message.replyOwnerHotelId, "reply", false);
    if (r) return r;
  }
  // 2 a tapped button
  const button = parseButtonId(input.message.buttonId);
  if (button?.kind === "choice") return { kind: "answer", holdId: button.holdId, index: button.index };
  if (button?.kind === "chat") {
    const r = target(button.hotelId, "chat_button", true);
    if (r) return r;
  }
  // 3 a hotel code
  const coded = codeIn(input.message.text, input.lineHotels);
  if (coded) {
    const r = target(coded.hotelId, "code", true);
    if (r) return r;
  }
  // an active selection
  if (input.selection && input.selection.expiresAt.getTime() > now.getTime()) {
    const r = target(input.selection.hotelId, "selection", false);
    if (r) return r;
  }

  // candidates: the guest's hotels that sit on this line in an ordinary state, newest first ('transition' and 'active' hotels are not candidates)
  const cand = input.guestHotels
    .filter((g) => {
      const s = byId.get(g.hotelId)?.state;
      return s === "shared" || s === "pending";
    })
    .sort((a, b) => lastTouch(b) - lastTouch(a));
  const ids = cand.map((g) => g.hotelId);
  // 4
  if (cand.length === 0) return ask([]);
  // strict mode: everything else asks
  if (input.mode === "strict") return ask(ids);
  // 5
  const only = cand.length === 1 ? cand[0] : undefined;
  if (only) return { kind: "route", hotelId: only.hotelId, via: "single", explicit: false };
  // 6
  const window = input.timeframeMinutes * MINUTE;
  const active = cand.filter((g) => lastTouch(g) > 0 && now.getTime() - lastTouch(g) <= window);
  const [first, second] = active;
  if (first && !second) return { kind: "route", hotelId: first.hotelId, via: "recent", explicit: false };
  if (first && second) {
    if (lastTouch(first) - lastTouch(second) > window) return { kind: "route", hotelId: first.hotelId, via: "recent", explicit: false };
    return ask(active.map((g) => g.hotelId));
  }
  return ask(ids);
}

/** What to save as the guest's selection after an outcome: an explicit choice opens one, a message routed by a selection keeps it alive; everything else leaves it alone. */
export function selectionAfter(outcome: RoutingOutcome, now: Date, timeframeMinutes: number): WaSelection | null {
  if (outcome.kind !== "route" || !(outcome.explicit || outcome.via === "selection")) return null;
  return { hotelId: outcome.hotelId, expiresAt: new Date(now.getTime() + timeframeMinutes * MINUTE) };
}

export interface RouteInboundDeps {
  store: WaRoutingStore;
  holds: WaHoldStore;
  hashKey: Buffer;
}

export interface RouteInboundRequest {
  line: { id: string; kind: WaLineKind; hotelId?: string | null };
  mode: RoutingMode;
  now: Date;
  timeframeMinutes: number;
  guestDigits: string;
  text: string | null;
  buttonId: string | null;
  replyToWamid: string | null;
}

/** Gather the facts from the stores and decide. The platform line and an own line need no lookups at all. */
export async function routeInbound(deps: RouteInboundDeps, req: RouteInboundRequest): Promise<RoutingOutcome> {
  const base = { line: req.line, mode: req.mode, now: req.now, timeframeMinutes: req.timeframeMinutes };
  const empty = { message: { text: req.text, buttonId: req.buttonId, replyOwnerHotelId: null }, lineHotels: [], guestHotels: [], openHoldId: null, selection: null };
  if (req.line.kind !== "shared") return decide({ ...base, ...empty });
  const guestHash = hashNumber(deps.hashKey, req.guestDigits);
  const owner = req.replyToWamid ? await deps.store.messageOwner(req.line.id, req.replyToWamid) : null;
  const lineHotels = await deps.store.lineHotels(req.line.id);
  const guestHotels = await deps.store.guestHotels(req.guestDigits);
  const selection = await deps.store.getSelection(req.line.id, guestHash);
  const hold = await findOpenHold(deps.holds, req.line.id, guestHash, req.now);
  return decide({ ...base, message: { text: req.text, buttonId: req.buttonId, replyOwnerHotelId: owner?.hotelId ?? null }, lineHotels, guestHotels, openHoldId: hold?.id ?? null, selection });
}
