import "server-only";
import type { WaMessageType } from "@shared/dashboards/whatsapp";
import { digitsOf, hashNumber } from "./config";
import { answerHold, createOrAppendHold, type HeldMessage } from "./holds";
import { buildHotelQuestion, parseButtonId, type HotelQuestion } from "./interactive";
import { textsFor, type Language, type SystemTexts } from "./language";
import type { MessageEvent, WaEventHandlers, WaHandlerResult } from "./processor";
import type { WaLine } from "./ports";
import { routeInbound, selectionAfter, type RoutingMode, type RoutingOutcome } from "./routing";
import type { WaHoldStore, WaRoutingStore } from "./routingPorts";

// The inbound path (plan part 9, phase 1 task 7): one message, already opened by the event processor, becomes a row in the right place. It asks the routing module where the message belongs and
// then:
//   a hotel          saved in THAT hotel's own Conversations tables (never anywhere shared); the message index, the guest's "last wrote" time and the day's received count follow
//   the platform     saved in the platform's own Conversations tables (Super Admin and Platform Admin share them)
//   "which hotel?"   the message is held (sealed, about 10 minutes) and the guest is asked once; a guest who answers has every held message delivered, in order
//   a moved hotel    the guest is told the hotel's own number; nothing is stored
// STOP and START change the guest's opt-out for the hotel they were talking to (STOP ALL for everyone) and are answered with one short confirmation. Photos, voice notes and documents are kept as
// a REFERENCE (Meta's media id, type, name, caption) for now: the download into the quarantined bucket is the media phase (plan 29.3). Nothing here logs text or numbers.

/** A message in the shape the stores save (the channel's own shape, not Meta's). */
export interface InboundMessage {
  wamid: string;
  /** The guest's number as digits with the country code. */
  digits: string;
  name: string | null;
  at: Date;
  type: WaMessageType;
  text: string | null;
  media: Record<string, unknown> | null;
  /** The message this one swipe-replies to. */
  contextWamid: string | null;
  /** The id of a tapped quick-reply button or a picked list row. */
  buttonId: string | null;
  reaction: { targetWamid: string; emoji: string } | null;
}

const obj = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.length > 0 ? v.slice(0, max) : null);

/** Meta's message as HMS keeps it. Types HMS cannot show become "unsupported" with no content. */
export function normalizeMessage(event: MessageEvent, now: Date): InboundMessage | null {
  const digits = digitsOf(event.from);
  if (!digits) return null;
  const m = event.message;
  const base = {
    wamid: event.wamid,
    digits,
    name: event.contactName,
    at: event.timestamp ? new Date(event.timestamp * 1000) : now,
    contextWamid: str(obj(m.context)?.id, 200),
    buttonId: null as string | null,
    reaction: null as InboundMessage["reaction"],
  };
  const type = typeof m.type === "string" ? m.type : "unsupported";
  const text = (t: string | null, cut = 4096): string | null => (t === null ? null : t.slice(0, cut));
  const mediaOf = (kind: string): Record<string, unknown> | null => {
    const x = obj(m[kind]);
    if (!x) return null;
    return { kind, id: str(x.id, 100), mime: str(x.mime_type, 100), name: str(x.filename, 200), caption: str(x.caption, 1024), voice: x.voice === true ? true : undefined, pending: true };
  };
  if (type === "text") return { ...base, type: "text", text: text(str(obj(m.text)?.body, 4096)), media: null };
  if (type === "image" || type === "video" || type === "document" || type === "audio" || type === "sticker") return { ...base, type, text: text(str(obj(m[type])?.caption, 1024)), media: mediaOf(type) };
  if (type === "location") {
    const loc = obj(m.location);
    return { ...base, type: "location", text: text([str(loc?.name, 200), str(loc?.address, 300)].filter(Boolean).join(", ") || null), media: null };
  }
  if (type === "contacts") {
    const names = (Array.isArray(m.contacts) ? m.contacts : []).map((c) => str(obj(obj(c)?.name)?.formatted_name, 120)).filter(Boolean);
    return { ...base, type: "contacts", text: text(names.join(", ") || null), media: null };
  }
  if (type === "interactive") {
    const i = obj(m.interactive);
    const reply = obj(i?.button_reply) ?? obj(i?.list_reply);
    return { ...base, type: "text", text: text(str(reply?.title, 300)), media: null, buttonId: str(reply?.id, 200) };
  }
  if (type === "button") {
    const b = obj(m.button);
    return { ...base, type: "text", text: text(str(b?.text, 300)), media: null, buttonId: str(b?.payload, 200) };
  }
  if (type === "reaction") {
    const r = obj(m.reaction);
    const target = str(r?.message_id, 200);
    return target ? { ...base, type: "text", text: null, media: null, reaction: { targetWamid: target, emoji: typeof r?.emoji === "string" ? r.emoji.slice(0, 16) : "" } } : { ...base, type: "unsupported", text: null, media: null };
  }
  return { ...base, type: "unsupported", text: null, media: null };
}

export type OptKeyword = "stop" | "stop_all" | "start" | null;
// the words guests use; the local-language ones are drafts to be checked by a native speaker ("verify")
const STOP_WORDS = new Set(["stop", "unsubscribe", "cancel", "end", "quit", "à¤¬à¤‚à¤¦", "à¤°à¥‹à¤•à¥‹", "à¤°à¥à¤•à¥‹", "à¤¬à¤‚à¤¦ à¤•à¤°à¥‹", "àª¬àª‚àª§", "àª…àªŸàª•àª¾àªµà«‹"]);
const START_WORDS = new Set(["start", "subscribe", "resume", "unstop", "à¤¶à¥à¤°à¥‚", "àª¶àª°à«‚"]);
export function optKeywordOf(text: string | null): OptKeyword {
  const t = (text ?? "").trim().toLowerCase().replace(/[.!\s]+$/g, "");
  if (t === "stop all" || t === "stopall") return "stop_all";
  if (STOP_WORDS.has(t)) return "stop";
  if (START_WORDS.has(t)) return "start";
  return null;
}

export type SaveTarget = { kind: "hotel"; hotelId: string } | { kind: "platform" };

/** Where an inbound message is written and what is noted about it. Each call is idempotent (the wamid is the key). */
export interface WaInboxStore {
  saveInbound(target: SaveTarget, message: InboundMessage, lineId: string): Promise<{ created: boolean; /** The conversations the message went into (the live pages are told). */ conversationIds?: string[] }>;
  /** A reaction updates the target message; it never makes a thread. False when the target is not in this place. */
  applyReaction(target: SaveTarget, reaction: { targetWamid: string; emoji: string }): Promise<boolean>;
  /** The message index (message id -> line and hotel, no content). */
  indexMessage(lineId: string, wamid: string, hotelId: string | null, direction: "in" | "out"): Promise<void>;
  /** guest_hotels.wa_last_in_at for the hotels this number belongs to. */
  touchGuestHotel(hotelId: string, digits: string, at: Date): Promise<void>;
  countReceived(target: SaveTarget, lineId: string, at: Date): Promise<void>;
  recordOptOut(hotelId: string, digits: string, lineId: string): Promise<void>;
  removeOptOut(hotelId: string, digits: string): Promise<void>;
  /** STOP ALL and the platform line's STOP: the number is never messaged automatically by anyone (platform-wide suppression). */
  suppressEverywhere(digits: string, reason: "stop" | "stop_all"): Promise<void>;
  liftSuppression(digits: string): Promise<void>;
  /** Media: is this saved message's file still waiting to be downloaded? Absent = media is not kept by this store. */
  mediaPending?(target: SaveTarget, wamid: string): Promise<boolean>;
  /** Media: writes what happened to the file (kept, or why not) into the message's media record. */
  attachMedia?(target: SaveTarget, wamid: string, patch: Record<string, unknown>): Promise<void>;
}

/** What the guest is told. The implementation sends through the sender or the Graph client on the line's own token; failures are thrown so the event is retried. */
export interface WaInboundNotifier {
  /** The question "which hotel?". Returns the question's own message id so an answer is tied to it. */
  askHotel(line: WaLine, to: string, question: HotelQuestion): Promise<{ wamid: string | null }>;
  /** A short plain message on the same line (confirmation, "write again", redirect). */
  tell(line: WaLine, to: string, body: string): Promise<void>;
  hotelNames(hotelIds: readonly string[]): Promise<string[]>;
}

export interface InboundDeps {
  routing: WaRoutingStore & { ownerHotelOf(lineId: string): Promise<string | null> };
  holds: WaHoldStore;
  inbox: WaInboxStore;
  notifier: WaInboundNotifier;
  hashKey: () => Buffer;
  sealKey: () => Buffer;
  /** Told after a message was saved for the first time (HMS's own automation engine hears it: the auto-replies). Its failure never reaches the guest or the event: it must not throw. */
  hooks?: { received(target: SaveTarget, line: WaLine, message: InboundMessage): Promise<void> };
  /** Downloads and keeps a guest's photo, voice note, video or document (whatsapp/media.ts). Returns what to write into the message's media record; never throws. Absent = the file stays a reference. */
  media?: { capture(target: SaveTarget, line: WaLine, message: InboundMessage): Promise<Record<string, unknown> | null> };
  /** whatsapp.routing_mode, routing_timeframe_minutes and hold_minutes, read at the moment of use (a changed switch applies to the next message). */
  settings: () => Promise<{ mode: RoutingMode; timeframeMinutes: number; holdMinutes: number; /** The language HMS uses with a guest whose own words do not tell it (whatsapp.default_language; English when absent). */ defaultLanguage?: Language }>;
}

export const TEXT_STOPPED = "You will not get automatic messages from this chat any more. Send START to get them again.";
export const TEXT_STARTED = "Automatic messages are back on. Send STOP to turn them off.";
export const TEXT_CHOICE_LOST = "We did not get your choice in time. Please write your message again.";
export const TEXT_ASK_NAME = "Please write part of the hotel's name.";
export const TEXT_WRONG_HOTEL = "Sorry about that. Which hotel did you mean?";
export const TEXT_WRONG_HOTEL_GENERIC = "Sorry about that. Please reply with the name or code of the hotel you meant.";
export const redirectText = (phone: string): string => `This hotel now chats on its own WhatsApp number: https://wa.me/${phone}`;

/** The labels of the "which hotel?" question in the guest's language: the question itself (unless a caller gives its own), the list button, "other hotel", and the list's heading. */
const questionWords = (say: SystemTexts, again: boolean, hasNames: boolean): { body: string; listButton: string; otherLabel: string; sectionTitle: string } => ({
  body: again ? (hasNames ? say.wrongHotel : say.wrongHotelGeneric) : hasNames ? say.question : say.questionGeneric,
  listButton: say.chooseHotel,
  otherLabel: say.otherHotel,
  sectionTitle: say.hotelsSection,
});

const done: WaHandlerResult = { kind: "done" };

export function createInboundHandler(deps: InboundDeps): Pick<WaEventHandlers, "message"> {
  /** Save one message into its place and note it; the common tail of every delivery (also used for held messages). */
  async function deliver(target: SaveTarget, line: WaLine, m: InboundMessage): Promise<void> {
    if (m.reaction) {
      await deps.inbox.applyReaction(target, m.reaction);
      return;
    }
    const saved = await deps.inbox.saveInbound(target, m, line.id);
    await deps.inbox.indexMessage(line.id, m.wamid, target.kind === "hotel" ? target.hotelId : null, "in");
    if (target.kind === "hotel") await deps.inbox.touchGuestHotel(target.hotelId, m.digits, m.at);
    // the guest's file is downloaded now (Meta's link expires); a failure is written into the message ("not kept") and never fails the event; a retried event only fetches what is still waiting
    if (m.media && deps.media && deps.inbox.attachMedia && (saved.created || (await deps.inbox.mediaPending?.(target, m.wamid)) === true)) {
      const patch = await deps.media.capture(target, line, m).catch(() => null);
      if (patch) await deps.inbox.attachMedia(target, m.wamid, patch).catch(() => undefined);
    }
    if (saved.created) {
      await deps.inbox.countReceived(target, line.id, m.at);
      await deps.hooks?.received(target, line, m).catch(() => undefined);
    }
  }

  /** STOP, STOP ALL and START of a guest talking to a place. */
  async function keyword(target: SaveTarget, line: WaLine, m: InboundMessage, word: Exclude<OptKeyword, null>, say: SystemTexts): Promise<void> {
    if (word === "stop_all") {
      await deps.inbox.suppressEverywhere(m.digits, "stop_all");
      await deps.notifier.tell(line, m.digits, say.stopped);
    } else if (word === "stop") {
      if (target.kind === "hotel") await deps.inbox.recordOptOut(target.hotelId, m.digits, line.id);
      else await deps.inbox.suppressEverywhere(m.digits, "stop");
      await deps.notifier.tell(line, m.digits, say.stopped);
    } else {
      if (target.kind === "hotel") await deps.inbox.removeOptOut(target.hotelId, m.digits);
      else await deps.inbox.liftSuppression(m.digits);
      await deps.notifier.tell(line, m.digits, say.started);
    }
  }

  async function place(outcome: RoutingOutcome, line: WaLine, event: MessageEvent, m: InboundMessage, now: Date, s: Awaited<ReturnType<InboundDeps["settings"]>>): Promise<void> {
    // what HMS says by itself is in the guest's own language when their words tell it, else the Super Admin's default
    const say = textsFor(m.text, s.defaultLanguage ?? "en").t;
    if (outcome.kind === "route" || outcome.kind === "platform") {
      const target: SaveTarget = outcome.kind === "route" ? { kind: "hotel", hotelId: outcome.hotelId } : { kind: "platform" };
      await deliver(target, line, m);
      if (outcome.kind === "route") {
        const sel = selectionAfter(outcome, now, s.timeframeMinutes);
        if (sel) await deps.routing.saveSelection(line.id, hashNumber(deps.hashKey(), m.digits), sel);
      }
      const word = m.reaction ? null : optKeywordOf(m.text);
      if (word) await keyword(target, line, m, word, say);
      return;
    }
    if (outcome.kind === "answer") {
      const lineHotels = await deps.routing.lineHotels(line.id);
      const result = await answerHold(
        { store: deps.holds, sealKey: deps.sealKey(), hashKey: deps.hashKey(), routing: deps.routing },
        {
          lineId: line.id,
          guestDigits: m.digits,
          holdId: outcome.holdId,
          index: outcome.index,
          now,
          lineHotels,
          deliver: async (hotelId, held) => {
            for (const h of held) {
              const heldEvent = h.content as MessageEvent;
              const hm = heldEvent && typeof heldEvent === "object" && "message" in heldEvent ? normalizeMessage(heldEvent, now) : null;
              if (hm) await deliver({ kind: "hotel", hotelId }, line, hm);
            }
          },
        },
      );
      if (!result.ok) await deps.notifier.tell(line, m.digits, say.choiceLost);
      else if (result.kind === "redirect" && result.phone) await deps.notifier.tell(line, m.digits, say.redirect(result.phone));
      else if (result.kind === "other") await deps.notifier.tell(line, m.digits, say.askName);
      return;
    }
    if (outcome.kind === "ask" || outcome.kind === "held-append") {
      const held: HeldMessage = { wamid: m.wamid, receivedAt: m.at.toISOString(), content: event };
      const candidates = outcome.kind === "ask" ? outcome.hotelIds : [];
      const hold = await createOrAppendHold({ store: deps.holds, sealKey: deps.sealKey(), hashKey: deps.hashKey() }, { lineId: line.id, guestDigits: m.digits, message: held, candidateHotelIds: candidates, holdMinutes: s.holdMinutes, now });
      // the question is asked once: only when the hold was just made (a retry of the same event, or a second message of the guest, never asks again)
      if (hold.created && outcome.kind === "ask") {
        const names = await deps.notifier.hotelNames(outcome.hotelIds);
        const sent = await deps.notifier.askHotel(line, m.digits, buildHotelQuestion({ holdId: hold.holdId, hotelNames: names, ...questionWords(say, false, names.length > 0) }));
        if (sent.wamid) await deps.holds.setQuestionWamid(hold.holdId, sent.wamid);
      }
      return;
    }
    if (outcome.kind === "wrong") {
      // forget the choice at once (a selection that ends now is ignored), then ask again among the guest's other hotels; the tap holds no text of its own to deliver
      await deps.routing.saveSelection(line.id, hashNumber(deps.hashKey(), m.digits), { hotelId: outcome.hotelId, expiresAt: now });
      const held: HeldMessage = { wamid: m.wamid, receivedAt: m.at.toISOString(), content: { wrongHotel: outcome.hotelId } };
      const hold = await createOrAppendHold({ store: deps.holds, sealKey: deps.sealKey(), hashKey: deps.hashKey() }, { lineId: line.id, guestDigits: m.digits, message: held, candidateHotelIds: outcome.hotelIds, holdMinutes: s.holdMinutes, now });
      if (hold.created) {
        const names = await deps.notifier.hotelNames(outcome.hotelIds);
        const sent = await deps.notifier.askHotel(line, m.digits, buildHotelQuestion({ holdId: hold.holdId, hotelNames: names, ...questionWords(say, true, names.length > 0) }));
        if (sent.wamid) await deps.holds.setQuestionWamid(hold.holdId, sent.wamid);
      }
      return;
    }
    if (outcome.kind === "redirect") {
      if (outcome.phone) await deps.notifier.tell(line, m.digits, say.redirect(outcome.phone));
      return;
    }
    // drop: nothing is stored
  }

  return {
    async message(ctx) {
      const now = ctx.now;
      const m = normalizeMessage(ctx.event, now);
      if (!m) return { kind: "dead", code: "BAD_NUMBER" };
      const s = await deps.settings();
      const own = ctx.line.kind === "hotel" ? await deps.routing.ownerHotelOf(ctx.line.id) : null;
      const parsed = parseButtonId(m.buttonId);
      const outcome = await routeInbound(
        { store: deps.routing, holds: deps.holds, hashKey: deps.hashKey() },
        { line: { id: ctx.line.id, kind: ctx.line.kind, hotelId: own }, mode: s.mode, now, timeframeMinutes: s.timeframeMinutes, guestDigits: m.digits, text: m.text, buttonId: parsed ? m.buttonId : null, replyToWamid: m.contextWamid },
      );
      await place(outcome, ctx.line, ctx.event, m, now, s);
      return done;
    },
  };
}
