import "server-only";
// The "which hotel?" question as Meta's interactive message (plan part 11), and the ids its buttons carry. Pure: no clock, no network, no logging.
// The question names only the hotel names it is given (hotels the guest already has a relation with) and says nothing else about any hotel.

// Interactive limits (verify against Meta docs; plan 27.9 gate "interactive limits"):
export const MAX_BUTTONS = 3; // reply buttons: up to 3 (verify against Meta docs)
export const BUTTON_TITLE_MAX = 20; // reply button title (verify against Meta docs)
export const MAX_LIST_ROWS = 10; // a list: up to 10 rows in all (verify against Meta docs)
export const ROW_TITLE_MAX = 24; // list row title (verify against Meta docs)
export const LIST_BUTTON_MAX = 20; // the label of the button that opens the list (verify against Meta docs)
export const BODY_MAX = 1024; // interactive body text (verify against Meta docs)

export const DEFAULT_QUESTION = "Which hotel is your message for?";
export const DEFAULT_GENERIC_QUESTION = "Which hotel is your message for? Please reply with the hotel's name or code.";

/** Cut a title to Meta's length, counting characters the way a phone does (not UTF-16 halves), with an ellipsis when something was cut. */
export function cutTitle(text: string, max: number): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  return chars.length <= max ? chars.join("") : `${chars.slice(0, Math.max(1, max - 1)).join("").trimEnd()}…`;
}

/** How many hotels a question shows: up to 10 as they are, beyond that 9 and an "Other hotel" row. */
export const offeredCount = (hotels: number): number => (hotels <= MAX_LIST_ROWS ? hotels : MAX_LIST_ROWS - 1);

export const choiceId = (holdId: string, index: number | "other"): string => `h:${holdId}:${index}`;
/** The id of a "Chat with Hotel X" quick-reply on an automatic notice (a tap is an explicit choice, plan 27.1). */
export const chatButtonId = (hotelId: string): string => `c:${hotelId}`;

/** The id of the "Wrong hotel?" button on a hotel's reply on the shared number: the guest taps it when they reached the wrong hotel. */
export const wrongButtonId = (hotelId: string): string => `w:${hotelId}`;
/** The label of that button (WhatsApp allows 20 characters on a reply button). */
export const WRONG_BUTTON_TITLE = "Wrong hotel?";

export type ParsedButtonId = { kind: "choice"; holdId: string; index: number | "other" } | { kind: "chat"; hotelId: string } | { kind: "wrong"; hotelId: string };

const ID = /^[A-Za-z0-9-]{1,64}$/;

/** What a tapped button or picked row means, or null for an id that is not ours. */
export function parseButtonId(id: string | null | undefined): ParsedButtonId | null {
  if (!id) return null;
  const parts = id.split(":");
  if (parts[0] === "h" && parts.length === 3) {
    const holdId = parts[1] ?? "";
    const last = parts[2] ?? "";
    if (!ID.test(holdId)) return null;
    if (last === "other") return { kind: "choice", holdId, index: "other" };
    return /^[0-9]{1,2}$/.test(last) ? { kind: "choice", holdId, index: Number(last) } : null;
  }
  if (parts[0] === "c" && parts.length === 2 && ID.test(parts[1] ?? "")) return { kind: "chat", hotelId: parts[1] as string };
  if (parts[0] === "w" && parts.length === 2 && ID.test(parts[1] ?? "")) return { kind: "wrong", hotelId: parts[1] as string };
  return null;
}

export type HotelQuestion =
  | { kind: "text"; body: string }
  | { kind: "interactive"; interactive: Record<string, unknown>; offered: number };

export interface HotelQuestionInput {
  holdId: string;
  /** Names in the order of the hold's candidate list (newest first). */
  hotelNames: readonly string[];
  body?: string;
  /** Label of the list-opening button (translated by the caller). */
  listButton?: string;
  otherLabel?: string;
  /** The heading of the list of hotels (translated by the caller). */
  sectionTitle?: string;
}

/** The question: buttons for 1 to 3 hotels, a list for 4 to 10, 9 and "Other hotel" beyond; plain text with no hotel names when there is none to offer. */
export function buildHotelQuestion(input: HotelQuestionInput): HotelQuestion {
  const n = input.hotelNames.length;
  if (n === 0) return { kind: "text", body: cutTitle(input.body ?? DEFAULT_GENERIC_QUESTION, BODY_MAX) };
  const body = { text: cutTitle(input.body ?? DEFAULT_QUESTION, BODY_MAX) };
  const offered = offeredCount(n);
  const names = input.hotelNames.slice(0, offered);
  if (n <= MAX_BUTTONS) {
    const buttons = names.map((name, i) => ({ type: "reply", reply: { id: choiceId(input.holdId, i), title: cutTitle(name, BUTTON_TITLE_MAX) } }));
    return { kind: "interactive", offered, interactive: { type: "button", body, action: { buttons } } };
  }
  const rows = names.map((name, i) => ({ id: choiceId(input.holdId, i), title: cutTitle(name, ROW_TITLE_MAX) }));
  if (n > MAX_LIST_ROWS) rows.push({ id: choiceId(input.holdId, "other"), title: cutTitle(input.otherLabel ?? "Other hotel", ROW_TITLE_MAX) });
  const action = { button: cutTitle(input.listButton ?? "Choose hotel", LIST_BUTTON_MAX), sections: [{ title: cutTitle(input.sectionTitle ?? "Hotels", ROW_TITLE_MAX), rows }] };
  return { kind: "interactive", offered, interactive: { type: "list", body, action } };
}
