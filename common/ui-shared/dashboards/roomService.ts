// Room service with a status (guest portal round 3, decision 61, rebuilt on main 18 Oct 2026; hotel migration 0041). Contract of docs/BACKEND.md "Room service".
// GUEST (guest portal): GET /guest/orders?hotel= -> GuestRoomOrders; POST /guest/orders/{id}/cancel?hotel= -> RoomOrder; POST /guest/orders (unchanged body) now also answers
// orderId, status and cancellableUntil; GET /guest/order-info carries guestCancelMinutes.
// HOTEL (Front Office > Room service orders): GET /front-office/room-service/orders?status=open|all|<status>&search=&page=&pageSize= -> DeskRoomOrderPage;
// POST .../orders/{id}/status { status } ; POST .../orders/{id}/cancel { reason } ; GET/PUT /front-office/room-service/settings { guestCancelMinutes }.
// The HOTEL decides (MJ): staff cancel until delivered, with a reason the guest sees; a guest only while the order is still "placed" and inside the hotel's window
// (0 = never, at most 60, default 5), by the server's clock: show the guest's Cancel button only while `cancellableUntil` is set and in the future.
import type { createRoomServiceMock } from './roomService.mock';

export type RoomOrderStatus = 'placed' | 'accepted' | 'preparing' | 'on_the_way' | 'delivered' | 'cancelled';
/** The forward steps the desk offers (a step may be skipped, never undone). */
export const ROOM_ORDER_STEPS: readonly Exclude<RoomOrderStatus, 'cancelled'>[] = ['placed', 'accepted', 'preparing', 'on_the_way', 'delivered'];
export const GUEST_CANCEL_MINUTES_MAX = 60;
export const GUEST_CANCEL_MINUTES_DEFAULT = 5;

/** The guests' cancel window is the Hotel Admin's (and the roles above) to change, never a Hotel User's, whatever their grants (MJ, 5 Nov 2026). */
export function mayChangeGuestCancelWindow(role: string): boolean {
  return role === 'hotel_admin' || role === 'group_hotel_admin' || role === 'super_admin' || role === 'platform_admin';
}
export const CANCEL_REASON_MAX = 300;

export interface RoomOrderLine {
  name: string;
  qty: number;
  amountPaise: number;
}

export interface RoomOrderBase {
  id: string;
  orderNo: string;
  status: RoomOrderStatus;
  placedAt: string;
  scheduledFor: string | null;
  note: string | null;
  totalPaise: number;
  lines: RoomOrderLine[];
  /** When the status last changed. */
  statusAt: string;
  /** Who cancelled (null while not cancelled). */
  cancelledBy: 'guest' | 'hotel' | null;
  /** The hotel's reason, for "Cancelled by the hotel: <reason>" (null otherwise). */
  cancelReason: string | null;
}

/** An order as the GUEST sees it. */
export interface RoomOrder extends RoomOrderBase {
  hotelId: string;
  hotelName: string;
  /** Until when the guest may cancel (ISO, server time); null = no Cancel button. */
  cancellableUntil: string | null;
}

export interface GuestRoomOrders {
  items: RoomOrder[];
  /** Each hotel's guest window (minutes; 0 = guests cannot cancel). */
  guestCancelMinutes: { hotelId: string; minutes: number }[];
  unavailable: { hotelId: string; hotelName: string }[];
}

/** An order on the hotel's desk. */
export interface DeskRoomOrder extends RoomOrderBase {
  roomNumber: string | null;
  guestName: string;
  /** A restaurant table order has a table and no room. */
  tableLabel: string | null;
  /** Who took it: the guest in the portal or the hotel's staff. */
  source: 'guest' | 'staff';
  /** Until when the GUEST may still cancel (guest orders only, by the server's clock); null for staff orders and once the window has passed. */
  cancellableUntil: string | null;
  /** Who made the last change ("Kamal Cook", or the guest's name for a guest cancel). */
  statusByName: string | null;
}

export interface DeskRoomOrderPage {
  items: DeskRoomOrder[];
  total: number;
  page: number;
  pageSize: number;
  /** Orders not delivered or cancelled (the badge). */
  openCount: number;
  /** Open orders in each part of the page: guests' own orders and the ones staff took. */
  openByPart: { guest: number; staff: number };
  guestCancelMinutes: number;
}

export interface PosSetup {
  menu: { id: string; name: string; category: string; veg: 'yes' | 'no' | 'unknown'; pricePaise: number }[];
  tables: string[];
  rooms: { stayId: string; roomNumber: string; guestName: string }[];
}

export type PlaceOrderInput = { kind: 'table'; table: string; qty: Record<string, number>; note: string } | { kind: 'room'; stayId: string; qty: Record<string, number>; note: string };

export interface RoomServiceSettings {
  guestCancelMinutes: number;
  maxMinutes: number;
}

export const roomServiceCopy = {
  noLongerCancellable: 'This order can no longer be cancelled. Please call reception.',
  alreadyDelivered: 'This order was already delivered, so it cannot be cancelled.',
  cancelledByHotel: (reason: string) => `Cancelled by the hotel: ${reason}`,
  cancelledByYou: 'You cancelled this order.',
  reasonNeeded: 'Say why the order is cancelled (the guest sees it).',
  statusLabel: { placed: 'Placed', accepted: 'Accepted', preparing: 'Preparing', on_the_way: 'On the way', delivered: 'Delivered', cancelled: 'Cancelled' } as Record<RoomOrderStatus, string>,
} as const;

export type RoomServiceApi = ReturnType<typeof createRoomServiceMock>;
