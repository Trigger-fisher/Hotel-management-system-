import "server-only";
import { z } from "zod";

// The shapes the companies routes accept (ui-shared companies.ts inputs). Strict: unknown keys refused, every string and number bounded; no
// identity, creator, source or login data can be sent. Pallav's rules and words are applied by the services.
const text = (max: number) => z.string().max(max);
const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const pageSize = z.coerce.number().pipe(z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)]));
const page = z.coerce.number().int().min(1).max(10_000);
const search = z.string().trim().max(200).regex(NO_CONTROL).optional();
const pct = z.number().min(-10_000).max(10_000).nullable();

const contact = z.strictObject({ role: text(1000), name: text(1000), email: text(1000), mobile: text(1000) });
export const companyBody = z.strictObject({
  name: text(1000),
  gstNumber: text(1000),
  mobile: text(1000),
  phone: text(1000),
  email: text(1000),
  address: text(1000),
  country: text(1000),
  pincode: text(1000),
  nationality: text(1000),
  discountPct: pct,
  gstPct: pct,
  tcsPct: pct,
  tdsPct: pct,
  instruction: text(20_000),
  // Pallav allows 30 real contacts; empty rows the form leaves are dropped first, so the shape allows a few more
  contacts: z.array(contact).max(100),
  // M1(b): the person confirmed that the shared fields change at every hotel
  confirmShared: z.boolean().optional(),
});
export const companyListQuery = z.strictObject({ search, page: page.default(1), pageSize: pageSize.default(25), deleted: z.enum(["no", "only"]).default("no") });

/** ui-shared CustomerInput. */
export const customerBody = z.strictObject({
  name: text(1000),
  mobile: text(1000),
  email: text(1000),
  address: text(1000),
  city: text(1000),
  idProofType: text(1000),
  idProofNumber: text(1000).optional(),
  notes: text(20_000),
  isActive: z.boolean(),
  // M1(b): the person confirmed that the shared fields change at every hotel
  confirmShared: z.boolean().optional(),
});
export const customerListQuery = z.strictObject({ search, tab: z.enum(["all", "active", "off"]).default("all"), page: page.default(1), pageSize: pageSize.default(25) });

export const campaignBody = z.strictObject({ subject: text(1000), body: text(20_000), audience: z.enum(["customers", "companies", "guests", "all"]) });
/** Sending: the number of addresses the hotel confirmed (the estimate); a different number now is a CONFLICT. */
export const campaignSendBody = z.strictObject({ expected: z.number().int().min(1).max(1_000_000) });
/** The unsubscribe link's parts (a public route): the hotel, the address and its signature. */
export const unsubscribeQuery = z.strictObject({ h: z.uuid(), e: z.string().trim().min(3).max(254), t: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/) });

export const ledgerOverviewQuery = z.strictObject({ search, show: z.enum(["all", "owing", "credit", "settled"]).default("all"), page: page.default(1), pageSize: pageSize.default(25) });
/** Pallav's account screen (CompanyLedgerController::account): a quick period or from/to, search, paged; no page = the last page. */
export const accountQuery = z.strictObject({
  period: z.enum(["all", "month", "last", "year", "custom"]).default("all"),
  from: z.string().regex(DAY).optional(),
  to: z.string().regex(DAY).optional(),
  search,
  page: page.optional(),
  pageSize: pageSize.default(25),
});
/** The statement (decided shape): a whole period, no paging. */
export const statementQuery = z.strictObject({ from: z.string().regex(DAY), to: z.string().regex(DAY) });
/** The typeahead (decided shape): prefix, at most 50. */
export const lookupQuery = z.strictObject({ q: z.string().trim().max(100).regex(NO_CONTROL).default(""), limit: z.coerce.number().int().min(1).max(50).default(20) });

export type CompanyBody = z.output<typeof companyBody>;
export type CustomerBody = z.output<typeof customerBody>;
export type CampaignBody = z.output<typeof campaignBody>;
