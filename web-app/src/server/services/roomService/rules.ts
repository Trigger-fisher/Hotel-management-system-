import "server-only";
import { paiseToNumber } from "../../money/paise";
import type { PortalRepos } from "../../repos/portal";
import { ROOM_ORDER_FLOW, type RoomOrderRecord, type RoomOrderStatus } from "../../repos/roomService";

// Room service with a status: the rules both sides share (the guest portal and the hotel's Guest Desk). MJ, 18 Oct 2026: the HOTEL decides.
// - Staff may cancel until the order is delivered, with a reason; a guest only while it is still "placed" AND inside the hotel's window (room_service.guest_cancel_minutes:
//   default 5, 0 = guests cannot cancel, at most 60), measured from placed_at by the SERVER's clock (never the phone's).
// - Cancelling removes the order's stay charges in the same unit, so the room bill is right again; the order row keeps who cancelled, when and why.
// - The status only moves forward: placed -> accepted -> preparing -> on_the_way -> delivered (a step may be skipped, never undone).

export const DEFAULT_GUEST_CANCEL_MINUTES = 5;
export const MAX_GUEST_CANCEL_MINUTES = 60;
export const CANCEL_REASON_MAX = 300;

export const NO_LONGER_CANCELLABLE = "This order can no longer be cancelled. Please call reception.";
export const ALREADY_DELIVERED = "This order was already delivered, so it cannot be cancelled.";

/** The hotel's guest window in minutes (the setting, else the default), clamped to 0..60. */
export async function guestCancelMinutesOf(repos: Pick<PortalRepos, "roomService">): Promise<number> {
  const set = await repos.roomService.guestCancelMinutes();
  const v = set === null ? DEFAULT_GUEST_CANCEL_MINUTES : Math.trunc(set);
  return Math.min(MAX_GUEST_CANCEL_MINUTES, Math.max(0, v));
}

/** Until when the GUEST may cancel this order (ISO), or null when they no longer can (not placed any more, the window is 0 or has passed). */
export function cancellableUntil(order: Pick<RoomOrderRecord, "status" | "placedAt">, minutes: number, now: Date): string | null {
  if (order.status !== "placed" || minutes <= 0) return null;
  const until = new Date(order.placedAt.getTime() + minutes * 60_000);
  return until.getTime() > now.getTime() ? until.toISOString() : null;
}

/** Whether `next` is a step forward from `current` (never back, never out of delivered or cancelled; cancelling is its own action). */
export function canMoveTo(current: RoomOrderStatus, next: RoomOrderStatus): boolean {
  if (next === "cancelled" || current === "cancelled" || current === "delivered") return false;
  return ROOM_ORDER_FLOW.indexOf(next) > ROOM_ORDER_FLOW.indexOf(current);
}

/** Cancels the order inside the caller's unit: its stay charges are removed, then the row is marked cancelled by `kind` with the reason. Returns the order as it is now. */
export async function cancelInUnit(repos: Pick<PortalRepos, "roomService" | "charges">, order: RoomOrderRecord, kind: "guest" | "hotel", reason: string | null, by: { id: string | null; name: string }, at: Date): Promise<RoomOrderRecord> {
  for (const line of order.lines) if (line.chargeId) await repos.charges.delete(line.chargeId);
  return (await repos.roomService.setStatus(order.id, "cancelled", by, at, { kind, reason })) ?? order;
}

/** The order as both screens show it (money in paise as numbers). `reason` is shown to the guest only for a hotel cancel ("Cancelled by the hotel: ..."). */
export function orderView(o: RoomOrderRecord) {
  return {
    id: o.id,
    orderNo: o.orderNo,
    status: o.status,
    placedAt: o.placedAt.toISOString(),
    scheduledFor: o.scheduledFor ? o.scheduledFor.toISOString() : null,
    note: o.note,
    totalPaise: paiseToNumber(o.totalPaise),
    lines: o.lines.map((l) => ({ name: l.name, qty: l.qty, amountPaise: paiseToNumber(l.unitPricePaise * BigInt(l.qty)) })),
    statusAt: o.statusAt.toISOString(),
    cancelledBy: o.cancelledByKind,
    cancelReason: o.cancelledByKind === "hotel" ? o.cancelReason : null,
  };
}
