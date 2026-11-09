import "server-only";
import { randomUUID } from "node:crypto";
import type { RoomRecord, StayRecord } from "../frontOffice";
import { GUEST_CANCEL_KEY, type RoomOrderRecord, type RoomOrderRow, type RoomServiceRepo } from "../roomService";
import { RepoError } from "../types";

// The in-memory double of the room-service orders (repos/roomService.ts), in the SAME per-hotel data as the stays and charges. It keeps the rules of migration 0041: a unique
// order number, the cancel pair (a cancelled order says who cancelled), a hotel cancel needs a reason; the hotel's queue oldest first, every other list newest first.

export interface RoomServiceData {
  roomOrders: RoomOrderRecord[];
}
export const emptyRoomServiceData = (): RoomServiceData => ({ roomOrders: [] });

const copy = <T>(r: T): T => structuredClone(r);

export function bindRoomService(data: RoomServiceData & { stays: StayRecord[]; rooms: RoomRecord[]; settings: Map<string, string | null> }): RoomServiceRepo {
  const orders = () => (data.roomOrders ??= []);
  return {
    async create(input) {
      if (orders().some((o) => o.orderNo === input.orderNo)) throw new RepoError("unique", "room_service_orders_order_no_key");
      const id = randomUUID();
      const row: RoomOrderRecord = {
        ...copy({ ...input, lines: [] }),
        tableLabel: input.tableLabel ?? null,
        source: input.source ?? "guest",
        id,
        status: "placed",
        statusAt: input.placedAt,
        statusBy: input.placedBy,
        statusByName: null,
        cancelledByKind: null,
        cancelReason: null,
        lines: input.lines.map((l) => ({ ...copy(l), id: randomUUID() })),
      };
      orders().push(row);
      return copy(row);
    },
    async get(id) {
      const o = orders().find((x) => x.id === id);
      return o ? copy(o) : null;
    },
    async forStays(stayIds) {
      return orders()
        .filter((o) => o.stayId !== null && stayIds.includes(o.stayId))
        .sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime() || (a.id < b.id ? 1 : -1))
        .map(copy);
    },
    async list(query) {
      const rows: RoomOrderRow[] = orders()
        .filter((o) => (query.status === "open" ? o.status !== "delivered" && o.status !== "cancelled" : query.status ? o.status === query.status : true))
        .filter((o) => !query.source || o.source === query.source)
        .map((o) => {
          const stay = data.stays.find((s) => s.id === o.stayId);
          return { ...copy(o), roomNumber: data.rooms.find((r) => r.id === stay?.roomId)?.number ?? null, guestName: stay?.guestName ?? "" };
        })
        .filter((o) => {
          const hay = [o.orderNo, o.tableLabel ?? "", o.roomNumber ?? "", o.guestName, ...o.lines.map((l) => l.name)].join(" ").toLowerCase();
          return !query.words || query.words.every((w) => hay.includes(w.toLowerCase()));
        })
        .sort((a, b) => (query.status === "open" ? a.placedAt.getTime() - b.placedAt.getTime() || (a.id < b.id ? -1 : 1) : b.placedAt.getTime() - a.placedAt.getTime() || (a.id < b.id ? 1 : -1)));
      return { rows: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: rows.length };
    },
    async setStatus(id, status, by, at, cancel) {
      const o = orders().find((x) => x.id === id);
      if (!o) return null;
      if (status === "cancelled" && !cancel) throw new RepoError("check", "room_service_orders_cancel_pair");
      if (cancel?.kind === "hotel" && !(cancel.reason ?? "").trim()) throw new RepoError("check", "room_service_orders_hotel_reason");
      Object.assign(o, { status, statusAt: at, statusBy: by.id, statusByName: by.name.slice(0, 150), cancelledByKind: cancel ? cancel.kind : null, cancelReason: cancel ? cancel.reason : null });
      return copy(o);
    },
    async guestCancelMinutes() {
      const v = Number(data.settings.get(GUEST_CANCEL_KEY));
      return data.settings.has(GUEST_CANCEL_KEY) && Number.isFinite(v) ? v : null;
    },
    async setGuestCancelMinutes(minutes) {
      data.settings.set(GUEST_CANCEL_KEY, String(minutes));
    },
  };
}
