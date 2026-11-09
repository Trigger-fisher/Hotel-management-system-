import "server-only";
import { z } from "zod";

// The shapes the payroll-pay routes accept (ui-shared payrollPay.ts inputs, as changed by the approved contract requests). Strict: unknown keys
// refused, every string and number bounded; no identity (actor, changedBy, createdBy, paymentUpdatedBy) can be sent. Pallav's rules and words
// are applied by the services. Spec: docs/specs/payroll-pay.md.
const text = (max: number) => z.string().max(max);
const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const pageSize = z.coerce.number().pipe(z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)]));
const page = z.coerce.number().int().min(1).max(10_000);
const search = z.string().trim().max(200).regex(NO_CONTROL).optional();
const money = z.number().int().min(-999_999_999_999).max(999_999_999_999);
const flag = z.enum(["true", "false"]).default("false").transform((v) => v === "true");

export const companyParams = z.strictObject({ companyId: z.uuid() });
export const companyItemParams = z.strictObject({ companyId: z.uuid(), id: z.uuid() });
export const employeeParams = z.strictObject({ companyId: z.uuid(), employeeId: z.uuid() });
export const masterParams = z.strictObject({ companyId: z.uuid(), list: z.enum(["designations", "departments", "gender", "separation_type", "id_proofs", "salary_payment_mode", "share_emails"]) });

export const employeesQuery = z.strictObject({ activeOnly: z.enum(["true", "false"]).default("true").transform((v) => v === "true") });
export const profilesQuery = z.strictObject({ search, page: page.default(1), pageSize: pageSize.default(25) });

export const revisionBody = z.strictObject({
  effectiveDate: text(40),
  salaryPaise: money.nullable(),
  designation: text(1000),
  department: text(1000),
  dailyWorkingHours: text(40),
  paymentMode: text(1000),
  bankName: text(1000),
  accountHolderName: text(1000),
  accountNumber: text(1000).optional(),
  ifscCode: text(1000),
  branchName: text(1000),
});
export type RevisionBody = z.output<typeof revisionBody>;

export const periodQuery = z.strictObject({ period: z.string().regex(PERIOD).optional(), search });
/** The payments list: without `page` every row of the month (as before); with `page`, that page of rows (the summary always counts the whole month). */
export const paymentsQuery = z.strictObject({
  period: z.string().regex(PERIOD).optional(),
  page: page.optional(),
  pageSize: pageSize.default(25),
  // filter, search and sort, applied before paging
  status: z.enum(["Pending", "Processing", "On Hold", "Partially Paid", "Paid", "Failed"]).optional(),
  search,
  sort: z.enum(["employee", "net", "paid", "balance", "paidOn", "status"]).optional(),
  dir: z.enum(["asc", "desc"]).default("asc"),
});
/** The pay screens' lean staff picker: name or code prefix, at most 50. */
export const staffLookupQuery = z.strictObject({ q: search, limit: z.coerce.number().int().min(1).max(50).default(20), activeOnly: z.enum(["true", "false"]).default("true").transform((v) => v === "true") });
const status = z.enum(["Pending", "Processing", "On Hold", "Partially Paid", "Paid", "Failed"]);
export const paymentBody = z.strictObject({ status: z.union([status, text(40)]), paidPaise: money.nullable(), paidOn: text(40), reference: text(1000), remarks: text(5000), version: z.number().int().min(1).max(2_147_483_646).optional() });
export type PaymentBody = z.output<typeof paymentBody>;
export const bulkPaymentBody = z.strictObject({ ids: z.array(z.uuid()).max(2000), status: z.union([status, text(40)]), paidOn: text(40), reference: text(1000), versions: z.record(z.uuid(), z.number().int().min(1).max(2_147_483_646)).optional() });
export type BulkPaymentBody = z.output<typeof bulkPaymentBody>;

// The four pay lists (Slips, Advances, Bonus, Resignations) share the Payments paging contract (docs/BACKEND.md §7.6): period, search, status,
// sort and dir apply before paging; the summary never follows the page, the search, the status or the sort.
const dir = z.enum(["asc", "desc"]).default("asc");
const period = z.string().regex(PERIOD).optional();
export const slipsQuery = z.strictObject({
  search,
  period,
  page: page.default(1),
  pageSize: pageSize.default(25),
  status: z.enum(["Pending", "Processing", "On Hold", "Partially Paid", "Paid", "Failed"]).optional(),
  sort: z.enum(["period", "employee", "net", "processed", "status"]).optional(),
  dir,
});

const listBase = { search, period, deleted: flag, page: page.default(1), pageSize: pageSize.default(25), dir };
export const advancesQuery = z.strictObject({
  ...listBase,
  tab: z.enum(["all", "open", "settled"]).default("all"),
  status: z.enum(["open", "settled"]).optional(),
  sort: z.enum(["date", "entryNo", "employee", "amount", "recovery", "recovered", "outstanding"]).optional(),
});
export const bonusQuery = z.strictObject({
  ...listBase,
  tab: z.enum(["all", "Bonus", "Incentive"]).default("all"),
  status: z.enum(["Bonus", "Incentive"]).optional(),
  sort: z.enum(["date", "entryNo", "employee", "amount", "type"]).optional(),
});

export const advanceBody = z.strictObject({
  employeeId: z.union([z.uuid(), z.literal("")]),
  date: text(40),
  amountPaise: money.nullable(),
  recoveryType: text(40),
  instalmentPaise: money.nullable(),
  remarks: text(20_000),
});
export type AdvanceBody = z.output<typeof advanceBody>;

export const bonusBody = z.strictObject({
  employeeId: z.union([z.uuid(), z.literal("")]),
  date: text(40),
  type: text(40),
  amountPaise: money.nullable(),
  remarks: text(20_000),
});
export type BonusBody = z.output<typeof bonusBody>;

export const periodReportQuery = z.strictObject({ from: z.string().regex(DAY), to: z.string().regex(DAY), employeeId: z.uuid().optional(), search });

/* ---------------------------------------------------------------- part b (B6b): meals, letters, separations */

export const mealsQuery = z.strictObject({ period: z.string().regex(PERIOD).optional(), search });
export const mealPriceBody = z.strictObject({ monthlyPaise: money.nullable(), effectiveFrom: text(40) });
export type MealPriceBody = z.output<typeof mealPriceBody>;
export const mealPeriodBody = z.strictObject({ startsOn: text(40), endsOn: text(40) });
export type MealPeriodBody = z.output<typeof mealPeriodBody>;
export const mealStopBody = z.strictObject({ endsOn: text(40) });
export type MealStopBody = z.output<typeof mealStopBody>;

export const letterParams = z.strictObject({ companyId: z.uuid(), kind: z.enum(["joining", "experience"]) });
export const letterBody = z.strictObject({
  subject: text(1000),
  sections: z.array(z.strictObject({ id: text(40), label: text(200), text: text(50_000) })).max(10),
  signatoryName: text(1000),
  signatoryDesignation: text(1000),
});
export type LetterBody = z.output<typeof letterBody>;

export const separationsQuery = z.strictObject({
  ...listBase,
  tab: z.enum(["all", "notice", "relieved", "rejoined"]).default("all"),
  status: z.enum(["Pending", "Accepted", "Relieved"]).optional(),
  sort: z.enum(["lastWorkingDate", "resignationDate", "employee", "entryNo", "status", "type"]).optional(),
});
export type SlipsQuery = z.output<typeof slipsQuery>;
export type AdvancesQuery = z.output<typeof advancesQuery>;
export type BonusQuery = z.output<typeof bonusQuery>;
export type SeparationsQuery = z.output<typeof separationsQuery>;
export const separationBody = z.strictObject({
  employeeId: z.union([z.uuid(), z.literal("")]),
  type: text(1000),
  resignationDate: text(40),
  lastWorkingDate: text(40),
  reason: text(20_000),
  remarks: text(20_000),
  status: text(40),
  documentName: text(1000).nullable().optional(),
});
export type SeparationBody = z.output<typeof separationBody>;
export const rejoinBody = z.strictObject({
  joiningDate: text(40),
  designation: text(1000),
  department: text(1000),
  salaryPaise: money.nullable(),
  dailyWorkingHours: text(40),
  phone: text(1000),
  contactCountry: text(10).optional(),
  address: text(1000).optional(),
  paymentMode: text(1000),
  bankName: text(1000),
  accountHolderName: text(1000),
  accountNumber: text(1000).optional(),
  ifscCode: text(1000),
  branchName: text(1000).optional(),
});
export type RejoinBody = z.output<typeof rejoinBody>;
