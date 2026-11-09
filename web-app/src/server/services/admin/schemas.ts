import "server-only";
import { z } from "zod";

// The shapes the admin routes accept. Strict: unknown keys refused, every string and number bounded; no identity, creator or decision data can be sent.
// Pallav's rules and words are applied by the services. Spec: docs/specs/admin.md.
const text = (max: number) => z.string().max(max);

export const idParams = z.strictObject({ id: z.uuid() });
export const keyParams = z.strictObject({ key: z.string().regex(/^[a-z0-9_]{1,60}$/) });
export const groupParams = z.strictObject({ group: z.string().regex(/^[a-z0-9_]{1,40}$/) });
/** The restaurant's ordering hours: seven days (0 = Monday), an open day with HH:MM times (the service checks opens before closes). */
export const restaurantHoursBody = z.strictObject({
  accepting: z.boolean(),
  days: z.array(z.strictObject({ day: z.number().int().min(0).max(6), closed: z.boolean(), opens: z.string().max(5), closes: z.string().max(5) })).max(7),
});
export const listSearchQuery = z.strictObject({ search: z.string().trim().max(200).regex(/^[^\u0000-\u001f\u007f]*$/).optional() });
export const scopeSearchQuery = z.strictObject({ scope: z.enum(["both", "hotel", "food"]).optional(), search: z.string().trim().max(200).regex(/^[^\u0000-\u001f\u007f]*$/).optional() });
export const scopeQuery = z.strictObject({ scope: z.enum(["both", "hotel", "food"]).optional() });
export const settingsTabQuery = z.strictObject({ tab: z.string().regex(/^[a-z0-9_]{1,40}$/).optional() });
export const searchQuery = z.strictObject({ q: z.string().max(500).default("") });
export const preferencesBody = z.strictObject({ uiTheme: z.union([z.enum(["light", "dark"]), z.null()]).optional() });
export const directionBody = z.strictObject({ direction: z.enum(["up", "down"]) });

export const planRateBody = z.strictObject({
  plan: text(1000),
  /** Per person per night, in paise. */
  ratePaise: z.number().int().min(-1_000_000_000).max(1_000_000_000),
  effectiveFrom: text(40),
  note: text(5000).default(""),
});
export type PlanRateBody = z.output<typeof planRateBody>;

export const optionBody = z.strictObject({
  label: text(1000),
  value: text(1000).default(""),
  color: text(100).nullable().default(null),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
});
export type OptionBody = z.output<typeof optionBody>;

export const settingsBody = z.strictObject({ values: z.record(z.string().max(100), z.union([z.string().max(5000), z.boolean(), z.null()])).refine((v) => Object.keys(v).length <= 60, "Too many settings"), clear: z.array(z.string().max(100)).max(10).optional() });
export type SettingsBody = z.output<typeof settingsBody>;
/** "Send a test email": to this address, or the hotel's own from address when empty. */
export const testEmailBody = z.strictObject({ to: z.string().max(254).optional() });

/** Removing the newest accounting year: the person types DELETE and the year's label (checked by the service, in Pallav's words). */
export const removeYearBody = z.strictObject({ confirm: z.string().max(40) });

/** The recycle bin's list and the record a restore or removal names (the kind's key and the record's id). */
export const recycleQuery = z.strictObject({
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)])).default(25),
});
export const recycleParams = z.strictObject({ key: z.string().regex(/^[a-z]+(-[a-z]+)*$/).max(30), id: z.uuid() });

/** Razorpay: the list's paging, a payment link request and the payment a status is asked for. */
const razorpayBook = z.enum(["hotel", "food"]);
export const razorpayQuery = z.strictObject({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)])).default(25),
  business: razorpayBook.optional(),
  status: z.enum(["captured", "authorized", "failed", "refunded", "created", "attention"]).optional(),
  method: z.enum(["upi", "card", "netbanking", "wallet", "emi", "bank_transfer"]).optional(),
  search: z.string().trim().max(80).optional(),
});
/** A payment link: who pays, how much, what for, how long it works and how Razorpay tells them (SMS and email; the link itself can also be shared). */
export const razorpayLinkBody = z.strictObject({
  business: razorpayBook,
  amountPaise: z.number().int().min(100).max(1_000_000_000),
  description: text(255).default(""),
  name: text(100).min(1),
  contact: z.string().trim().regex(/^\+?[0-9 ()-]{8,20}$/, "A phone number, digits only.").optional(),
  email: z.string().trim().max(255).pipe(z.email()).optional(),
  validDays: z.union([z.literal(1), z.literal(3), z.literal(7), z.literal(30)]).default(1),
  sms: z.boolean().default(false),
  mail: z.boolean().default(false),
  /** Who the payment is for, so it shows on that company's or guest's own page and is tied to a bill: the ids of a company / customer of this hotel, and a bill number. */
  companyId: z.uuid().optional(),
  customerId: z.uuid().optional(),
  billRef: z.string().trim().min(1).max(60).optional(),
});
/** Refund all or part of a payment. */
export const razorpayRefundBody = z.strictObject({
  amountPaise: z.number().int().min(100).max(1_000_000_000),
  reason: text(100).min(1),
  note: text(200).default(""),
  instant: z.boolean().default(false),
});
export const razorpayLinkParams = z.strictObject({ business: razorpayBook, linkId: z.string().regex(/^plink_[A-Za-z0-9]{1,40}$/) });
export const razorpayResendBody = z.strictObject({ medium: z.enum(["sms", "email"]) });
export const razorpayListQuery = z.strictObject({ business: razorpayBook, page: z.coerce.number().int().min(1).max(100).default(1) });
export const razorpayStatusParams = z.strictObject({ business: razorpayBook, paymentId: z.string().regex(/^[A-Za-z0-9_]{1,40}$/) });

/** The room-service menu: an item is a name, an optional note, a price in whole paise and whether it can be ordered. */
export const menuItemBody = z.strictObject({
  group: z.enum(["restaurant", "laundry", "service"]),
  name: text(1000),
  note: text(1000).nullable().default(null),
  pricePaise: z.number(),
  available: z.boolean().default(true),
  // round 3 (hotel migration 0041): the hotel's own category (empty = the group's) and the veg mark; left out = unchanged
  category: text(1000).nullable().optional(),
  veg: z.enum(["yes", "no", "unknown"]).optional(),
});
export const menuItemEditBody = z.strictObject({
  name: text(1000),
  note: text(1000).nullable().default(null),
  pricePaise: z.number(),
  available: z.boolean().default(true),
  // round 3: left out = unchanged
  category: text(1000).nullable().optional(),
  veg: z.enum(["yes", "no", "unknown"]).optional(),
});
export type MenuItemBody = z.output<typeof menuItemBody>;
/** The expense catalogue: a category is a name; an item a name and a price in paise (null/absent is answered by the service with the screen's sentence). */
export const catalogCategoryBody = z.strictObject({ name: text(1000) });
export const catalogItemBody = z.strictObject({ name: text(1000), pricePaise: z.number().nullable().default(null) });
