import "server-only";

// A hotel's move from the shared guest number to its own number (plan part 14), kept on the hotel's own line row (platform.whatsapp_line_hotels, own = true):
//   pending     the own number is connected; the hotel still chats on the shared number (its guests are asked and delivered as before)
//   transition  the cut-over is done: the hotel sends from its own number; the shared number still reaches it by a swipe-reply, a live choice or its code, for `transition_days`
//   active      the move is finished: a guest who writes to the shared number is told the hotel's own number
// Nothing is copied or moved: conversations keep one thread, old messages keep the shared line's id and new ones the own line's id.
export type MoveState = "none" | "pending" | "transition" | "active";

export interface MoveView {
  hotelId: string;
  hotelName: string;
  /** The hotel's own number, when it has connected one. */
  ownLine: { id: string; phone: string | null; status: string } | null;
  state: MoveState;
  transitionEndsAt: Date | null;
}

export interface MoveStore {
  view(hotelId: string): Promise<MoveView | null>;
  /** The days a cut-over keeps the shared number reachable (the setting whatsapp.transition_days). */
  transitionDays(): Promise<number>;
  /** Moves the hotel's own row from one of `from` to `to`; false when it was in none of them (somebody else moved it first). */
  setState(hotelId: string, from: readonly MoveState[], to: "pending" | "transition" | "active", endsAt: Date | null): Promise<boolean>;
  /** Cut-overs whose days are over become active. Returns how many. */
  finishDue(now: Date): Promise<number>;
}

/** The in-memory double (tests and the local demo): the same rules as the table. */
export function createMemoryMoveStore(hotels: Record<string, { name: string; ownLine: MoveView["ownLine"]; state: MoveState; endsAt?: Date | null }> = {}, days = 30): MoveStore & { rows: typeof hotels } {
  return {
    rows: hotels,
    async view(hotelId) {
      const h = hotels[hotelId];
      return h ? { hotelId, hotelName: h.name, ownLine: h.ownLine, state: h.state, transitionEndsAt: h.endsAt ?? null } : null;
    },
    async transitionDays() {
      return days;
    },
    async setState(hotelId, from, to, endsAt) {
      const h = hotels[hotelId];
      if (!h || !from.includes(h.state)) return false;
      h.state = to;
      h.endsAt = to === "transition" ? endsAt : null;
      return true;
    },
    async finishDue(now) {
      let n = 0;
      for (const h of Object.values(hotels)) {
        if (h.state === "transition" && h.endsAt && h.endsAt.getTime() <= now.getTime()) {
          h.state = "active";
          h.endsAt = null;
          n += 1;
        }
      }
      return n;
    },
  };
}
