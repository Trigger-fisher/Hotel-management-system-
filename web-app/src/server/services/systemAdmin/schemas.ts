import "server-only";
import { z } from "zod";
import { FORCE_LOG_VIEWS, SYSTEM_LOG_VIEWS } from "./logService";

// The shapes the System Log, Force Log, System Health, Payroll Master and Payroll Log routes accept. Strict and bounded: an unknown key, a repeated
// name, a page size other than 10/25/50/100 or a control character is refused before the service runs.
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/;
const word = (max: number) => z.string().trim().max(max).regex(NO_CONTROL);
const pageSize = z.coerce.number().pipe(z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)]));
const page = z.coerce.number().int().min(1).max(10_000).default(1);
const blankable = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const common = {
  search: blankable(word(200)),
  module: blankable(word(40)),
  action: blankable(word(30)),
  user: blankable(word(150)),
  from: blankable(z.string().regex(DAY)),
  to: blankable(z.string().regex(DAY)),
  page,
  pageSize: pageSize.default(25),
};

export const systemLogQuery = z.strictObject({ ...common, view: blankable(z.enum(SYSTEM_LOG_VIEWS)), status: blankable(z.enum(["success", "failed"])) });
export const forceLogQuery = z.strictObject({ ...common, view: blankable(z.enum(FORCE_LOG_VIEWS)) });
export const systemLogPdfQuery = systemLogQuery.omit({ page: true, pageSize: true });
/** GET /system/log/record: the record's id. */
export const recordHistoryQuery = z.strictObject({ id: z.uuid() });
export const forceLogPdfQuery = forceLogQuery.omit({ page: true, pageSize: true });

export const errorsQuery = z.strictObject({ show: z.enum(["open", "resolved", "all"]).default("open"), feature: blankable(word(60)), search: blankable(word(200)), page, pageSize: pageSize.default(25) });

/** "all" (every company) or a payroll company id. */
const scope = z.union([z.literal("all"), z.uuid()]).default("all");
const LIST_KEYS = ["share_emails", "designations", "departments", "gender", "separation_type", "id_proofs", "salary_payment_mode"] as const;

export const masterQuery = z.strictObject({ scope, list: z.enum(LIST_KEYS).default("share_emails"), search: blankable(word(200)) });
export const scopeQuery = z.strictObject({ scope });
export const listParams = z.strictObject({ list: z.enum(LIST_KEYS) });
/** ui-shared MasterItemInput: the value matters only for an email list. */
export const masterItemBody = z.strictObject({ label: z.string().max(1000), value: z.string().max(1000).default("") });
/** Toggle: nothing (Pallav's toggle) or the state wanted (a SET). */
export const toggleBody = z.strictObject({ isActive: z.boolean().optional() });

export const payrollLogQuery = z.strictObject({
  scope,
  search: blankable(word(200)),
  view: blankable(z.enum(["today", "week", "emails", "money", "deletions", "problems"])),
  action: blankable(z.enum(["created", "updated", "deleted", "emailed", "error"])),
  entity: blankable(word(60)),
  status: blankable(z.enum(["success", "failed"])),
  user: blankable(word(150)),
  from: blankable(z.string().regex(DAY)),
  to: blankable(z.string().regex(DAY)),
  page,
  pageSize: pageSize.default(25),
});
export const payrollLogPdfQuery = payrollLogQuery.omit({ page: true, pageSize: true });
