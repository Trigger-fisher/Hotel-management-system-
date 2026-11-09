import "server-only";
import { z } from "zod";

// The hotel's room-service desk inputs (Front Office > Room service orders). Strict and bounded.
const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/;
export const roomOrderListQuery = z.strictObject({
  status: z.enum(["open", "all", "placed", "accepted", "preparing", "on_the_way", "delivered", "cancelled"]).default("open"),
  source: z.enum(["guest", "staff"]).optional(),
  search: z.string().trim().max(200).regex(NO_CONTROL).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)])).default(25),
});
export const roomOrderStatusBody = z.strictObject({ status: z.enum(["accepted", "preparing", "on_the_way", "delivered"]) });
export const roomOrderCancelBody = z.strictObject({ reason: z.string().max(1000).regex(NO_CONTROL) });
// A staff order: for a restaurant table (a label such as "5") or for the room of an in-house stay; items as menu id -> quantity.
export const roomOrderPlaceBody = z.strictObject({
  kind: z.enum(["table", "room"]),
  table: z.string().trim().max(40).regex(NO_CONTROL).optional(),
  stayId: z.string().uuid().optional(),
  qty: z.record(z.string().uuid(), z.number().int().min(0).max(100)).refine((q) => Object.keys(q).length <= 100),
  note: z.string().max(500).regex(NO_CONTROL).default(""),
});
export const roomServiceSettingsBody = z.strictObject({ guestCancelMinutes: z.number().int() });