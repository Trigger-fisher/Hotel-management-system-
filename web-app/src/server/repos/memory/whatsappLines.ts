import "server-only";
import { randomUUID } from "node:crypto";
import type { CreateLineResult, LineAdminStore, LineRecord } from "../../services/whatsapp/connectionPorts";

// In-memory double of the connection manager's store (tests and the local demo). It follows the rules of platform migration 0180: one line per phone number id, one platform line,
// one current own line per hotel. `attachments` stands for the current whatsapp_line_hotels rows (line id -> hotel ids).
export function createMemoryLineAdminStore(known: { hotels?: readonly string[]; logins?: readonly string[] } = {}): LineAdminStore & { rows: LineRecord[]; attachments: Map<string, Set<string>>; hotels: Set<string>; logins: Set<string> } {
  const rows: LineRecord[] = [];
  const attachments = new Map<string, Set<string>>();
  const hotels = new Set(known.hotels ?? []);
  const logins = new Set(known.logins ?? []);
  const withCount = (r: LineRecord): LineRecord => ({ ...r, subscribedFields: [...r.subscribedFields], hotelsAttached: attachments.get(r.id)?.size ?? 0 });
  return {
    rows,
    attachments,
    hotels,
    logins,
    async list() {
      return rows.map(withCount);
    },
    async get(id) {
      const r = rows.find((x) => x.id === id);
      return r ? withCount(r) : null;
    },
    async create(input): Promise<CreateLineResult> {
      if (rows.some((r) => r.phoneNumberId === input.phoneNumberId)) return { ok: false, reason: "number_taken" };
      if (input.kind === "platform" && rows.some((r) => r.kind === "platform" && r.status !== "banned")) return { ok: false, reason: "platform_exists" };
      if (input.kind === "hotel" && input.hotelId !== null) {
        const ownHotel = rows.some((r) => r.kind === "hotel" && attachments.get(r.id)?.has(input.hotelId as string));
        if (ownHotel) return { ok: false, reason: "hotel_has_own_line" };
      }
      const row: LineRecord = {
        id: randomUUID(), kind: input.kind, phoneNumberId: input.phoneNumberId, wabaId: input.wabaId, displayPhone: null, displayName: null, status: "test", quality: "unknown",
        ownerLoginId: input.ownerLoginId, tokenSecret: input.tokenSecret, pinSecret: null, managed: false, webhookSubscribed: false, subscribedFields: [], lastEventAt: null, registered: false,
        nameStatus: null, messagingTier: null, tokenCheckedAt: null, lastVerifiedAt: null, lastErrorCode: null, lastErrorAt: null, tokenFailures: 0, connectedBy: input.connectedBy,
        connectedByName: null, connectedAt: input.at, createdAt: input.at, hotelsAttached: 0,
      };
      rows.push(row);
      if (input.kind === "hotel" && input.hotelId !== null) attachments.set(row.id, new Set([input.hotelId]));
      return { ok: true, line: withCount(row) };
    },
    async update(id, patch) {
      const r = rows.find((x) => x.id === id);
      if (!r) return null;
      Object.assign(r, patch);
      return withCount(r);
    },
    async hotelExists(hotelId) {
      return hotels.has(hotelId);
    },
    async loginExists(loginId) {
      return logins.has(loginId);
    },
  };
}
