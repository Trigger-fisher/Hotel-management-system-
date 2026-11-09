import "server-only";
import { z } from "zod";
import { versionField } from "../../validation/listQuery";
import { EXPENSE_KINDS, EXPENSE_SORTS } from "./expenseService";
import { DEPOSIT_SORTS } from "./revenueService";

// The shapes the revenue routes accept. Strict: an unknown key is refused, every string and number is bounded. The service then checks
// the RULES (Pallav's messages); these only guard the shape and size.
const stamp = z.strictObject({ date: z.string().max(10), time: z.string().max(8) });

const depositFields = {
  book: z.enum(["hotel", "food"]),
  depositor: z.string().max(1000),
  amountPaise: z.number().int().safe().nullable(),
  instruction: z.string().max(5000),
  stamp: stamp.nullable(),
};

/** ui-shared DepositInput without `version` (a new deposit has none). */
export const depositCreateBody = z.strictObject(depositFields);
/** DepositInput with the version the person saw: required to update. */
export const depositUpdateBody = z.strictObject({ ...depositFields, version: versionField });
/** Delete and restore carry only the version. */
export const versionBody = z.strictObject({ version: versionField });

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/;

/** Pallav's page sizes: 10, 25, 50 or 100 (CashLedger::PER_PAGE); anything else is refused here instead of silently becoming 25. */
const pageSize = z.coerce.number().pipe(z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)]));

export const depositListQuery = z.strictObject({
  book: z.enum(["all", "hotel", "food"]).default("all"),
  search: z.string().max(200).regex(NO_CONTROL).optional(),
  from: z.string().regex(DAY).optional(),
  to: z.string().regex(DAY).optional(),
  sort: z.enum(DEPOSIT_SORTS).default("at"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: pageSize.default(25),
  deleted: z.enum(["exclude", "only"]).default("exclude"),
});

// ---- expenses (cash withdrawals and miscellaneous expenses) ----
const lineInput = z.strictObject({
  key: z.string().max(100),
  lineId: z.string().max(100).nullable(),
  categoryId: z.string().max(100),
  itemId: z.string().max(100),
  quantity: z.string().max(40),
  pricing: z.enum(["listed", "custom"]),
  amountPaise: z.number().int().safe().nullable(),
});

const expenseFields = {
  kind: z.enum(["withdrawal", "misc", "advance"]),
  book: z.enum(["hotel", "food"]),
  withdrawer: z.string().max(1000),
  employeeId: z.string().max(100),
  yearMonth: z.string().max(20),
  amountPaise: z.number().int().safe().nullable(),
  lines: z.array(lineInput).max(60),
  instruction: z.string().max(5000),
  stamp: stamp.nullable(),
};

/** ui-shared ExpenseInput without `version`. */
export const expenseCreateBody = z.strictObject(expenseFields);
/** ExpenseInput with the version the person saw (a contract request: ExpenseInput has no `version` yet). */
export const expenseUpdateBody = z.strictObject({ ...expenseFields, version: versionField });

export const expenseListQuery = z.strictObject({
  book: z.enum(["all", "hotel", "food"]).default("all"),
  kind: z.enum(EXPENSE_KINDS).default("all"),
  search: z.string().max(200).regex(NO_CONTROL).optional(),
  from: z.string().regex(DAY).optional(),
  to: z.string().regex(DAY).optional(),
  sort: z.enum(EXPENSE_SORTS).default("at"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: pageSize.default(25),
  deleted: z.enum(["exclude", "only"]).default("exclude"),
});
