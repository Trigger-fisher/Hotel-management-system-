import "server-only";
// The stores the shared-line routing stands on (plan parts 10, 11 and 14). Ports only: an in-memory double is in routingMemory.ts, the PostgreSQL repository is written by the orchestrator.
// None of these holds message text except the sealed payload of a hold, and a guest is only ever a keyed hash here (hashNumber in config.ts), never a number.

/**
 * How a hotel stands on the shared line. The repository folds the current whatsapp_line_hotels rows into one word per hotel:
 *   shared      an ordinary hotel on the shared line (it has no own line)
 *   pending     own line connected, templates not approved yet: still routed like a shared hotel (plan 14)
 *   transition  cut-over done: reachable only by a swipe-reply, an active selection or the hotel code, never offered in a question
 *   active      the hotel now chats on its own number: a message naming it is answered with a redirect, never delivered
 */
export type WaHotelLineState = "shared" | "pending" | "transition" | "active";

export interface WaLineHotel {
  hotelId: string;
  state: WaHotelLineState;
  /** The hotel's short code ("goa"), lower case, or null when it has none. */
  hotelCode: string | null;
  /** The hotel's own number as digits, for the redirect of an 'active' hotel. */
  redirectPhone: string | null;
}

/** One hotel the guest has a relation with (platform.guest_hotels, matched on the guest's mobile). */
export interface WaGuestHotel {
  hotelId: string;
  lastInAt: Date | null;
  lastOutAt: Date | null;
}

/** A guest's active choice of hotel (plan 27.1): it routes messages until it runs out. */
export interface WaSelection {
  hotelId: string;
  expiresAt: Date;
}

export interface WaRoutingStore {
  /** Hotels the guest (digits) is linked to through the central guest profile. A walk-in who is not in the profile has none. */
  guestHotels(guestDigits: string): Promise<WaGuestHotel[]>;
  /** Hotels attached to the line with a current row (valid_to null), folded as described above. */
  lineHotels(lineId: string): Promise<WaLineHotel[]>;
  /** The message index (30 days): which hotel owns a message id on this line. Null when unknown; hotelId is null for a platform thread. */
  messageOwner(lineId: string, wamid: string): Promise<{ hotelId: string | null } | null>;
  getSelection(lineId: string, guestHash: Buffer): Promise<WaSelection | null>;
  /** One selection per guest per line: a newer explicit choice replaces the older one. */
  saveSelection(lineId: string, guestHash: Buffer, selection: WaSelection): Promise<void>;
}

export interface WaHoldRow {
  id: string;
  lineId: string;
  guestHash: Buffer;
  payloadSecret: string;
  /** In the order the question showed them: a button id "h:{holdId}:{index}" points into this list. */
  candidateHotels: string[];
  questionWamid: string | null;
  expiresAt: Date;
}

export interface WaHoldStore {
  /** The hold of this guest on this line, expired or not (the caller checks the time). One per guest per line. */
  findByGuest(lineId: string, guestHash: Buffer): Promise<WaHoldRow | null>;
  get(id: string): Promise<WaHoldRow | null>;
  insert(row: Omit<WaHoldRow, "id">): Promise<WaHoldRow>;
  updatePayload(id: string, payloadSecret: string): Promise<void>;
  setQuestionWamid(id: string, wamid: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Delete every hold past its time; the held messages are discarded. Returns how many. */
  removeExpired(now: Date): Promise<number>;
}
