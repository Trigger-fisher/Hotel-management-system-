import "server-only";
import type { WaLineKind } from "./ports";

// Hotels on a number (MJ, 4 Nov 2026): which hotels use the SHARED guest number, and each hotel's short code (the word a guest can type, or a wa.me link can carry, to choose that hotel: "goa" or
// "goa: is breakfast included?"). A hotel's own number is attached when the number is connected; this is only for the shared number. History is kept: detaching closes the row (valid_to), it never
// deletes it, and the hotel's chats stay where they are.
export interface LineHotelRow {
  hotelId: string;
  hotelName: string;
  hotelCode: string | null;
  since: Date;
}

export type AttachResult = "ok" | "already" | "code_taken" | "no_hotel";
export type CodeResult = "ok" | "code_taken" | "not_attached";

export interface LineHotelsStore {
  lineKind(lineId: string): Promise<WaLineKind | null>;
  /** The hotel as the screen names it, and the slug a code is made from. Null when the hotel does not exist or was removed. */
  hotelInfo(hotelId: string): Promise<{ name: string; slug: string } | null>;
  /** The hotels attached to this line now (valid_to is null), by name. */
  list(lineId: string): Promise<LineHotelRow[]>;
  /** Live hotels not attached to this line now, by name (the picker). */
  available(lineId: string): Promise<{ hotelId: string; hotelName: string }[]>;
  attach(lineId: string, hotelId: string, code: string | null, at: Date): Promise<AttachResult>;
  /** Close the hotel's current row on this line. False when it was not attached. */
  detach(lineId: string, hotelId: string, at: Date): Promise<boolean>;
  setCode(lineId: string, hotelId: string, code: string | null): Promise<CodeResult>;
}

/** A code is 3 to 24 lower-case letters and digits (what a guest can type in one go). */
export const CODE = /^[a-z0-9]{3,24}$/;

/** The first choice of code for a hotel: its slug without dashes, at most 24 characters, at least 3. */
export function codeFromSlug(slug: string): string {
  const base = slug.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24);
  return base.length >= 3 ? base : `${base}hotel`.slice(0, 24);
}

/** In-memory double (tests, the local demo): the same rules as the PostgreSQL repository. */
export function createMemoryLineHotelsStore(seed: { lines?: Record<string, WaLineKind>; hotels?: Record<string, { name: string; slug: string }> } = {}): LineHotelsStore & { rows: { lineId: string; hotelId: string; code: string | null; since: Date; closed: Date | null }[] } {
  const rows: { lineId: string; hotelId: string; code: string | null; since: Date; closed: Date | null }[] = [];
  const hotels = seed.hotels ?? {};
  const live = (lineId: string) => rows.filter((r) => r.lineId === lineId && r.closed === null);
  const codeUsed = (code: string, exceptHotel?: string) => rows.some((r) => r.closed === null && r.code === code && r.hotelId !== exceptHotel);
  return {
    rows,
    async lineKind(id) {
      return seed.lines?.[id] ?? null;
    },
    async hotelInfo(id) {
      return hotels[id] ?? null;
    },
    async list(lineId) {
      return live(lineId).map((r) => ({ hotelId: r.hotelId, hotelName: hotels[r.hotelId]?.name ?? "", hotelCode: r.code, since: r.since })).sort((a, b) => a.hotelName.localeCompare(b.hotelName));
    },
    async available(lineId) {
      const on = new Set(live(lineId).map((r) => r.hotelId));
      return Object.entries(hotels).filter(([id]) => !on.has(id)).map(([hotelId, h]) => ({ hotelId, hotelName: h.name })).sort((a, b) => a.hotelName.localeCompare(b.hotelName));
    },
    async attach(lineId, hotelId, code, at) {
      if (!hotels[hotelId]) return "no_hotel";
      if (live(lineId).some((r) => r.hotelId === hotelId)) return "already";
      if (code !== null && codeUsed(code)) return "code_taken";
      rows.push({ lineId, hotelId, code, since: at, closed: null });
      return "ok";
    },
    async detach(lineId, hotelId, at) {
      const r = live(lineId).find((x) => x.hotelId === hotelId);
      if (!r) return false;
      r.closed = at;
      return true;
    },
    async setCode(lineId, hotelId, code) {
      const r = live(lineId).find((x) => x.hotelId === hotelId);
      if (!r) return "not_attached";
      if (code !== null && codeUsed(code, hotelId)) return "code_taken";
      r.code = code;
      return "ok";
    },
  };
}
