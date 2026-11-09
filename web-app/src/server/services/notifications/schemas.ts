import "server-only";
import { NOTIFICATION_LINK_VIEWS } from "@shared/dashboards/notifications";
import { z } from "zod";

// The shapes the notifications routes accept (ui-shared notifications.ts inputs). Strict: unknown keys refused, every string and list bounded. The hotel (and for the portal
// the company) is never an input: it is the session. Plain text only: control characters other than a line break are refused, and the services store the text as it is
// (nothing is rendered as HTML anywhere).
const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/;
// a message may hold line breaks and tabs
const NO_CONTROL_MULTILINE = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const page = z.coerce.number().int().min(1).max(10_000);
const search = z.string().trim().max(200).regex(NO_CONTROL).optional();

/** The hotel picked these companies (at most 1,000 at a time; use "all" for every company). */
const companyIds = z.union([z.literal("all"), z.array(z.uuid()).min(1).max(1000)]);

export const notificationBody = z.strictObject({
  companyIds,
  title: z.string().max(1000).regex(NO_CONTROL),
  body: z.string().max(20_000).regex(NO_CONTROL_MULTILINE),
  priority: z.enum(["normal", "important"]).default("normal"),
  expiresAt: z.string().regex(DAY).nullable().optional(),
  alsoEmail: z.boolean().default(false),
  linkView: z.enum(NOTIFICATION_LINK_VIEWS).nullable().optional(),
  linkId: z.uuid().nullable().optional(),
});
export const notificationListQuery = z.strictObject({
  search,
  status: z.enum(["active", "withdrawn", "expired"]).optional(),
  page: page.default(1),
  pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)])).default(25),
});

/** `?hotel=<hotelId>|all` as everywhere in the company portal. */
const hotel = z.string().trim().max(40).regex(/^[A-Za-z0-9-]*$/).optional();
const flag = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");
export const portalNotificationQuery = z.strictObject({
  hotel,
  unread: flag.optional(),
  /** Only the ones already read (the Earlier tab, MJ 26 Oct 2026). */
  read: flag.optional(),
  search,
  page: z.coerce.number().int().min(1).max(200).default(1),
  pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(25), z.literal(50)])).default(25),
  // cursor paging (portal/cursor.ts): `limit` turns it on, `cursor` is the previous answer's `nextCursor`
  cursor: z.string().max(400).regex(/^[A-Za-z0-9_.-]+$/).optional(),
  limit: z.coerce.number().pipe(z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)])).optional(),
});
export const portalHotelQuery = z.strictObject({ hotel });

export type NotificationBody = z.output<typeof notificationBody>;
export type NotificationListQuery = z.output<typeof notificationListQuery>;
export type PortalNotificationQuery = z.output<typeof portalNotificationQuery>;
