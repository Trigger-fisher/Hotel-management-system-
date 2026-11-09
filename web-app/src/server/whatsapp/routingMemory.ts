import "server-only";
// In-memory doubles of the routing stores, for unit tests and the local demo (same rules as the PostgreSQL repository the orchestrator writes).
import { randomUUID } from "node:crypto";
import type { WaGuestHotel, WaHoldRow, WaHoldStore, WaLineHotel, WaRoutingStore, WaSelection } from "./routingPorts";

export interface MemoryRoutingSeed {
  /** line id -> hotels on it */
  lineHotels?: Record<string, WaLineHotel[]>;
  /** guest digits -> the guest's hotels */
  guestHotels?: Record<string, WaGuestHotel[]>;
  /** "lineId:wamid" -> owner */
  index?: Record<string, { hotelId: string | null }>;
}

export function createMemoryRoutingStore(seed: MemoryRoutingSeed = {}): WaRoutingStore & {
  lineHotelsByLine: Record<string, WaLineHotel[]>;
  guestHotelsByDigits: Record<string, WaGuestHotel[]>;
  index: Record<string, { hotelId: string | null }>;
  selections: Map<string, WaSelection>;
} {
  const lineHotelsByLine = { ...(seed.lineHotels ?? {}) };
  const guestHotelsByDigits = { ...(seed.guestHotels ?? {}) };
  const index = { ...(seed.index ?? {}) };
  const selections = new Map<string, WaSelection>();
  const key = (lineId: string, guestHash: Buffer): string => `${lineId}:${guestHash.toString("hex")}`;
  return {
    lineHotelsByLine,
    guestHotelsByDigits,
    index,
    selections,
    async guestHotels(digits) {
      return [...(guestHotelsByDigits[digits] ?? [])];
    },
    async lineHotels(lineId) {
      return [...(lineHotelsByLine[lineId] ?? [])];
    },
    async messageOwner(lineId, wamid) {
      return index[`${lineId}:${wamid}`] ?? null;
    },
    async getSelection(lineId, guestHash) {
      return selections.get(key(lineId, guestHash)) ?? null;
    },
    async saveSelection(lineId, guestHash, selection) {
      selections.set(key(lineId, guestHash), selection);
    },
  };
}

export function createMemoryHoldStore(): WaHoldStore & { rows: WaHoldRow[] } {
  const rows: WaHoldRow[] = [];
  return {
    rows,
    async findByGuest(lineId, guestHash) {
      return rows.find((r) => r.lineId === lineId && r.guestHash.equals(guestHash)) ?? null;
    },
    async get(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
    async insert(row) {
      // one hold per guest per line (the unique index of the table)
      if (rows.some((r) => r.lineId === row.lineId && r.guestHash.equals(row.guestHash))) throw new Error("hold exists");
      const made = { ...row, id: randomUUID() };
      rows.push(made);
      return made;
    },
    async updatePayload(id, payloadSecret) {
      const r = rows.find((x) => x.id === id);
      if (r) r.payloadSecret = payloadSecret;
    },
    async setQuestionWamid(id, wamid) {
      const r = rows.find((x) => x.id === id);
      if (r) r.questionWamid = wamid;
    },
    async remove(id) {
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows.splice(i, 1);
    },
    async removeExpired(now) {
      let n = 0;
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if ((rows[i] as WaHoldRow).expiresAt.getTime() <= now.getTime()) {
          rows.splice(i, 1);
          n += 1;
        }
      }
      return n;
    },
  };
}
