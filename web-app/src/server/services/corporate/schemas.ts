import "server-only";
import { z } from "zod";

// The company portal's inputs: strict and bounded. The company is never an input: it is the session's record scope.
const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/;
const text = (max: number) => z.string().max(max).regex(NO_CONTROL);
/** Cursor paging for "All hotels" lists (portal/cursor.ts): send `limit` to read by cursor, then each answer's `nextCursor` as `cursor`. */
const cursorBase = {
  cursor: z.string().max(400).regex(/^[A-Za-z0-9_.-]+$/).optional(),
  limit: z.coerce.number().pipe(z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)])).optional(),
};
const listBase = {
  search: z.string().trim().max(200).regex(NO_CONTROL).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};

/** Decision 48: `?hotel=<hotelId>|all`. */
const hotel = z.string().trim().max(40).regex(/^[A-Za-z0-9-]*$/).optional();
export const hotelQuery = z.strictObject({ hotel });
/** The three Accounts pages (due bills, payment history, ledger): paged, searchable, per hotel or all. */
export const accountsListQuery = z.strictObject({ ...listBase, ...cursorBase, hotel });
export const accountsLedgerQuery = z.strictObject({ ...listBase, ...cursorBase, hotel, period: z.enum(["all", "month", "last", "year"]).default("all"), pageSize: z.coerce.number().int().min(1).max(200).default(50) });
/** The editable contact fields of the company profile (strict: a percentage, city or any unknown field is a 422; the percentages are set by the hotel). */
export const companyProfileBody = z.strictObject({
  mainContactName: text(100).optional(),
  email: text(254).optional(),
  mobile: text(15).optional(),
  landline: text(15).optional(),
  address: text(500).optional(),
  pincode: text(15).optional(),
  country: text(60).optional(),
  gstin: text(50).optional(),
  contacts: z.array(z.strictObject({ name: text(100), role: text(60), email: text(254), mobile: text(20) })).max(20).optional(),
});
export const payDuesBody = z.strictObject({ businesses: z.array(z.enum(["hotel", "food"])).min(1).max(2) });
export type CompanyProfileBody = z.infer<typeof companyProfileBody>;
