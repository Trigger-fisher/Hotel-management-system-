import "server-only";
import type { ListResult, Page } from "./types";

// Room-service orders with a status (hotel migration 0041; guest portal round 3, decision 61, rebuilt on main). An order is placed by an in-house guest from the portal; its lines
// keep the name and price as ordered and point at the stay charge each one added. The hotel moves it placed -> accepted -> preparing -> on_the_way -> delivered, or cancels it
// (with a reason) until it is delivered; a guest may cancel while it is still placed and inside the hotel's window. Cancelling removes its charges (the service does that in the
// same unit). Plain records, no SQL.

export type RoomOrderStatus = "placed" | "accepted" | "preparing" | "on_the_way" | "delivered" | "cancelled";
export const ROOM_ORDER_FLOW: readonly RoomOrderStatus[] = ["placed", "accepted", "preparing", "on_the_way", "delivered"];

export interface RoomOrderLineRecord {
  id: string;
  itemId: string | null;
  name: string;
  qty: number;
  unitPricePaise: bigint;
  chargeId: string | null;
  sortOrder: number;
}

export interface RoomOrderRecord {
  id: string;
  orderNo: string;
  /** The stay it is charged to; empty for a restaurant table order taken by staff (billed at the table). */
  stayId: string | null;
  tableLabel: string | null;
  /** Who took it: the guest in the portal, or the hotel's staff. */
  source: "guest" | "staff";
  status: RoomOrderStatus;
  scheduledFor: Date | null;
  note: string | null;
  totalPaise: bigint;
  placedBy: string | null;
  placedAt: Date;
  statusAt: Date;
  statusBy: string | null;
  statusByName: string | null;
  cancelledByKind: "guest" | "hotel" | null;
  cancelReason: string | null;
  lines: RoomOrderLineRecord[];
}

/** A row of the hotel's list: the order and where it goes. */
export interface RoomOrderRow extends RoomOrderRecord {
  roomNumber: string | null;
  guestName: string;
}

export interface RoomServiceRepo {
  create(input: Omit<RoomOrderRecord, "id" | "status" | "statusAt" | "statusBy" | "statusByName" | "cancelledByKind" | "cancelReason" | "lines" | "tableLabel" | "source"> & { tableLabel?: string | null; source?: "guest" | "staff"; lines: Omit<RoomOrderLineRecord, "id">[] }): Promise<RoomOrderRecord>;
  get(id: string, options?: { forUpdate?: boolean }): Promise<RoomOrderRecord | null>;
  /** The orders of these stays, newest first. */
  forStays(stayIds: readonly string[]): Promise<RoomOrderRecord[]>;
  /** The hotel's list: `open` = not delivered or cancelled (oldest first, the kitchen's queue); a status = that one; none = all (newest first). Words in the order no, room, guest or items. */
  list(query: { status?: RoomOrderStatus | "open"; source?: "guest" | "staff"; words?: readonly string[] } & Page): Promise<ListResult<RoomOrderRow>>;
  /** Moves the order to `status` at `at` by `by`; a cancel carries who cancelled and why. Null when there is no such order. */
  setStatus(id: string, status: RoomOrderStatus, by: { id: string | null; name: string }, at: Date, cancel?: { kind: "guest" | "hotel"; reason: string | null }): Promise<RoomOrderRecord | null>;
  /** The hotel's guest cancel window in minutes (app setting room_service.guest_cancel_minutes); null = never set. */
  guestCancelMinutes(): Promise<number | null>;
  setGuestCancelMinutes(minutes: number): Promise<void>;
}

export const GUEST_CANCEL_KEY = "room_service.guest_cancel_minutes";
