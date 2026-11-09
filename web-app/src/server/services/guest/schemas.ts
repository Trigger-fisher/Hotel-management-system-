import "server-only";
import { z } from "zod";

// The guest portal's inputs: strict (unknown keys refused) and bounded. Identity is never an input: the guest is the session's record scope.
const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/;
const text = (max: number) => z.string().max(max).regex(NO_CONTROL);
const listBase = {
  search: z.string().trim().max(200).regex(NO_CONTROL).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  // cursor paging for "All hotels" (portal/cursor.ts): `limit` turns it on, `cursor` is the previous answer's `nextCursor`
  cursor: z.string().max(400).regex(/^[A-Za-z0-9_.-]+$/).optional(),
  limit: z.coerce.number().pipe(z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)])).optional(),
};

export const guestBillListQuery = z.strictObject({ ...listBase, hotel: z.string().trim().max(40).regex(/^[A-Za-z0-9-]*$/).optional(), tab: z.enum(["open", "paid", "cancelled", "all"]).default("all") });
export const guestHistoryQuery = z.strictObject({ ...listBase, hotel: z.string().trim().max(40).regex(/^[A-Za-z0-9-]*$/).optional(), tab: z.enum(["all", "charges", "payments"]).default("all") });

/** A guest bill id: "<bill uuid>.hotel|food" for a bill, "stay.<stay uuid>.hotel|food" for the stay going on now. */
/** The room-service menu: `search` is words over item, note and group. */
export const guestMenuQuery = z.strictObject({ hotel: z.string().trim().max(40).regex(/^[A-Za-z0-9-]*$/).optional(), search: z.string().trim().max(200).regex(NO_CONTROL).optional() });
const GUEST_BILL_ID = /^(?:stay\.)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:hotel|food)$/i;
export const guestBillParams = z.strictObject({ id: z.string().max(60).regex(GUEST_BILL_ID) });
export const payBillsBody = z.strictObject({ billIds: z.array(z.string().max(60).regex(GUEST_BILL_ID)).max(20) });

export const orderBody = z.strictObject({
  qty: z.record(z.string().max(60), z.number().int().min(0).max(1000)).refine((r) => Object.keys(r).length <= 200, "Too many items."),
  payWith: z.enum(["room_bill", "pay_now"]),
  note: text(500),
  /** Order for later (decision 52): an ISO date and time with the hotel's +05:30 offset; the service checks it is inside the stay and an open period. */
  scheduledFor: z.string().max(40).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?\+05:30$/, "Use a date and time with +05:30.").optional(),
});
export const guestProfileBody = z.strictObject({
  name: text(200),
  email: text(254),
  city: text(200),
  address: text(500),
  idProofType: z.enum(["aadhaar", "passport", "driving_licence", "voter_id", "none"]),
  idProofNumber: text(100),
  notifyEmail: z.boolean(),
});
/** Passwords are never trimmed; 128 is the password rule's own maximum. */
export const guestPasswordBody = z.strictObject({ current: z.string().max(128), next: z.string().max(128), confirm: z.string().max(128) });

export type GuestProfileBody = z.infer<typeof guestProfileBody>;
export type GuestPasswordBody = z.infer<typeof guestPasswordBody>;
export type OrderBody = z.infer<typeof orderBody>;
/** Round 3 c: one line of the guest's payment history (an advance `adv:<id>:<side>` or a payment on a bill `pay:<bill>:<payment>`), for its receipt PDF. */
export const guestHistoryParams = z.strictObject({ id: z.string().max(120).regex(/^(?:adv|pay):[0-9a-zA-Z.:-]+$/) });
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The statement PDF: a period (at most a year) and the hotel or all. */
export const guestStatementQuery = z.strictObject({ hotel: z.string().trim().max(40).regex(/^[A-Za-z0-9-]*$/).optional(), from: z.string().regex(DAY), to: z.string().regex(DAY) });
