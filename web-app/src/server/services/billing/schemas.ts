import "server-only";
import { z } from "zod";
import { versionField } from "../../validation/listQuery";
import { ADVANCE_SORTS, BILL_SORTS } from "../../repos/billing";

// The shapes the billing routes accept. Strict: an unknown key is refused (no identity, no balance, no entry number can be sent), every
// string and number is bounded. The service then applies Pallav's RULES with Pallav's words (advanceValidate.ts); these only guard shape and size.
const text = (max: number) => z.string().max(max);
const paise = z.number().int().min(-999_999_999_999).max(999_999_999_999);
const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const advanceFields = {
  receiptNo: text(1000),
  paymentDate: text(40),
  guestName: text(5000),
  mobile: text(1000),
  companyId: z.uuid().nullable(),
  roomNo: text(1000),
  covers: z.enum(["hotel", "food", "both"]),
  hotelPaise: paise.nullable(),
  foodPaise: paise.nullable(),
  hotelMode: text(1000).nullable(),
  foodMode: text(1000).nullable(),
  referenceName: text(5000),
  referenceMobile: text(1000),
  instruction: text(5000),
};

/** ui-shared AdvanceInput. */
export const advanceCreateBody = z.strictObject(advanceFields);
/** AdvanceInput with the version the person saw (contract request: AdvanceInput has no `version` yet). */
export const advanceUpdateBody = z.strictObject({ ...advanceFields, version: versionField });

/** ui-shared RefundInput with the version. */
export const refundBody = z.strictObject({
  date: text(40),
  hotelPaise: paise.nullable(),
  foodPaise: paise.nullable(),
  hotelMode: text(1000).nullable(),
  foodMode: text(1000).nullable(),
  toName: text(5000),
  toMobile: text(1000),
  note: text(5000),
  version: versionField,
});

/** Delete, reverse a refund, restore: only the version. */
export const versionBody = z.strictObject({ version: versionField });

/** Pallav's page sizes. */
const pageSize = z.coerce.number().pipe(z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)]));

/** ui-shared AdvanceQuery, bounded and whitelisted. */
export const advanceListQuery = z.strictObject({
  tab: z.enum(["all", "unused", "partly", "used", "refunded"]).default("all"),
  search: z.string().trim().max(200).regex(NO_CONTROL).optional(),
  mode: z.string().trim().max(20).regex(NO_CONTROL).optional(),
  companyId: z.union([z.uuid(), z.literal("walkin")]).optional(),
  month: z.string().regex(MONTH).optional(),
  from: z.string().regex(DAY).optional(),
  to: z.string().regex(DAY).optional(),
  sort: z.enum(ADVANCE_SORTS).default("paymentDate"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: pageSize.default(25),
  deleted: z.enum(["no", "only"]).default("no"),
});

export type AdvanceCreateInput = z.output<typeof advanceCreateBody>;
export type AdvanceUpdateInput = z.output<typeof advanceUpdateBody>;
export type RefundBodyInput = z.output<typeof refundBody>;
export type AdvanceListInput = z.output<typeof advanceListQuery>;

/* ---------------------------------------------------------------- bills */

const hotelCharges = z.strictObject({
  plan: text(1000).nullable(),
  roomPaise: paise,
  planPaise: paise,
  extraBedPaise: paise,
  laundryPaise: paise,
  vpoPaise: paise,
  gstPaise: paise,
  mode: text(1000).nullable(),
});
const foodCharges = z.strictObject({ foodPaise: paise, planPaise: paise, laundryPaise: paise, gstPaise: paise, mode: text(1000).nullable() });
const stayPart = z.strictObject({ from: text(40), to: text(40), plan: text(1000).nullable(), persons: z.number().int().min(-1000).max(1000) });

const billFields = {
  billNo: text(1000),
  billDate: text(40),
  grNo: text(1000),
  advanceId: z.uuid().nullable(),
  guestName: text(5000),
  mobile: text(1000),
  address: text(5000),
  gstin: text(1000),
  companyId: z.uuid().nullable(),
  roomNo: text(1000),
  persons: z.number().int().min(-1000).max(1000).nullable(),
  arrivalAt: text(40).nullable(),
  departureAt: text(40).nullable(),
  hotel: hotelCharges,
  food: foodCharges,
  // Pallav allows 30 parts; a longer list is refused with Pallav's message by the service, so the shape allows a little more
  stay: z.array(stayPart).max(100),
  referenceName: text(5000),
  referenceMobile: text(1000),
  instruction: text(5000),
};

/** ui-shared BillInput. The totals, balances, advance snapshots and stay prices are worked out by the server: none can be sent. */
export const billCreateBody = z.strictObject(billFields);
/** BillInput with the version the person saw (billNo and advanceId are ignored on edit). */
export const billUpdateBody = z.strictObject({ ...billFields, version: versionField });

const installment = z.strictObject({ date: text(40), hotelPaise: paise, hotelMode: text(1000).nullable(), foodPaise: paise, foodMode: text(1000).nullable() });

/** ui-shared SettleInput with the version: up to five instalments (Pallav's five slots). */
export const settleBody = z.strictObject({
  installments: z.array(installment).min(1).max(5),
  referenceName: text(5000),
  referenceMobile: text(1000),
  instruction: text(5000),
  version: versionField,
});

export const billListQuery = z.strictObject({
  tab: z.enum(["all", "paid", "due", "settled"]).default("all"),
  search: z.string().trim().max(200).regex(NO_CONTROL).optional(),
  mode: z.string().trim().max(100).regex(NO_CONTROL).optional(),
  companyId: z.union([z.uuid(), z.literal("walkin")]).optional(),
  month: z.string().regex(MONTH).optional(),
  from: z.string().regex(DAY).optional(),
  to: z.string().regex(DAY).optional(),
  sort: z.enum(BILL_SORTS).default("billDate"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: pageSize.default(25),
  deleted: z.enum(["no", "only"]).default("no"),
});

export type BillCreateInput = z.output<typeof billCreateBody>;
export type BillUpdateInput = z.output<typeof billUpdateBody>;
export type SettleBodyInput = z.output<typeof settleBody>;
export type BillListInput = z.output<typeof billListQuery>;
/** "Email bill" / "Email receipt": the address to send to; left out = the guest's email kept in the hotel's customers. */
export const emailBody = z.strictObject({ to: z.string().max(400).optional() });
