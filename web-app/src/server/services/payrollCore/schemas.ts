import "server-only";
import { z } from "zod";

// The shapes the payroll routes accept (ui-shared payrollCore.ts inputs, as changed by the approved contract requests). Strict: unknown keys
// refused, every string and number bounded; no identity (isAdmin, sentBy, creator) can be sent. Pallav's rules and words are applied by the
// services. Spec: docs/specs/payroll-core.md.
const text = (max: number) => z.string().max(max);
const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const pageSize = z.coerce.number().pipe(z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)]));
const page = z.coerce.number().int().min(1).max(10_000);
const search = z.string().trim().max(200).regex(NO_CONTROL).optional();
const money = z.number().int().min(-999_999_999_999).max(999_999_999_999);

export const companyParams = z.strictObject({ companyId: z.uuid() });
export const companyItemParams = z.strictObject({ companyId: z.uuid(), id: z.uuid() });
export const monthParams = z.strictObject({ companyId: z.uuid(), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });

/** listCompanies(): the fixed companies in their fixed order; `search` (words over name, code, owner) narrows them. */
export const companyListQuery = z.strictObject({ search });

/** The short setup lists (attendance marks, deduction types): `search` is words over the name. */
export const setupListQuery = z.strictObject({ search });

/** PayrollCompanyInput: the details only; name, code and isActive are accepted and ignored (fixed companies). */
export const companyBody = z.strictObject({
  name: text(1000).optional(),
  code: text(1000).optional(),
  isActive: z.boolean().optional(),
  ownerName: text(1000),
  mobileNumber: text(1000),
  email: text(1000),
  address: text(1000),
  city: text(1000),
  state: text(1000),
  pincode: text(1000),
  panNumber: text(1000),
  tanNumber: text(1000),
  pfRegistrationNumber: text(1000),
  esicRegistrationNumber: text(1000),
  professionalTaxRegistrationNumber: text(1000),
  authorizedPersonName: text(1000),
  authorizedDesignation: text(1000),
  authorizedMobile: text(1000),
  authorizedEmail: text(1000),
  bankName: text(1000),
  branchName: text(1000),
  accountNumber: text(1000).optional(),
  ifscCode: text(1000),
});
export type CompanyBody = z.output<typeof companyBody>;

const assignment = z.strictObject({
  id: z.uuid().optional(),
  // an empty deduction is skipped (syncDeductions :252), so "" is allowed here
  deductionId: z.union([z.uuid(), z.literal("")]),
  type: z.enum(["One Time", "Monthly"]).optional(),
  amountPaise: money.nullable().optional(),
});

/** EmployeeInput. Bank and ID numbers: absent = keep, "" = remove; isActive and resumeFileName are not accepted. */
export const employeeBody = z.strictObject({
  name: text(1000),
  dateOfBirth: text(40),
  gender: text(1000),
  contactNumber: text(1000),
  contactCountry: text(10),
  email: text(1000),
  address: text(1000),
  nationality: text(1000),
  countryAndPincode: text(1000),
  emergencyContactName: text(1000),
  emergencyContactRelation: text(1000),
  emergencyContactNumber: text(1000),
  emergencyContactCountry: text(10),
  employeeCode: text(1000),
  designation: text(1000),
  department: text(1000),
  shift: text(1000),
  joiningDate: text(40),
  dailyWorkingHours: z.number().min(-1000).max(1000),
  qualification: text(1000),
  qualificationInstitution: text(1000),
  skills: text(20_000),
  responsibilities: text(20_000),
  salaryPaise: money,
  paymentMode: text(1000),
  bankName: text(1000),
  accountHolderName: text(1000),
  accountNumber: text(1000).optional(),
  ifscCode: text(1000),
  branchName: text(1000),
  deductions: z.array(assignment).max(100),
  idProofType: text(1000),
  idProofNumber: text(1000).optional(),
  sendOfferLetter: z.boolean().optional(),
});
export type EmployeeBody = z.output<typeof employeeBody>;

export const employeeListQuery = z.strictObject({
  search,
  tab: z.enum(["all", "active", "inactive"]).default("all"),
  /** The recycle bin (ListQuery & { deleted?: boolean }). */
  deleted: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  page: page.default(1),
  pageSize: pageSize.default(25),
});
export const lookupQuery = z.strictObject({ q: z.string().trim().max(100).regex(NO_CONTROL).default(""), limit: z.coerce.number().int().min(1).max(50).default(20) });

export const statusBody = z.strictObject({
  name: text(1000),
  shortcutKey: text(1000),
  color: text(1000),
  attendancePercentage: z.number().int().min(-1000).max(1000),
  statusType: text(100),
  skipsFood: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
export type StatusBody = z.output<typeof statusBody>;

export const deductionBody = z.strictObject({ name: text(1000), standardAmountPaise: money, isActive: z.boolean().optional() });
export type DeductionBody = z.output<typeof deductionBody>;

export const attendanceQuery = z.strictObject({ search, page: page.default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) });
const day = z.union([text(20), z.null()]);
export const attendanceSaveBody = z.strictObject({
  rows: z
    .array(
      z.strictObject({
        employeeId: z.uuid(),
        days: z.array(day).max(31),
        overtime: z.array(z.number().min(-1000).max(1000).nullable()).max(31).optional(),
      }),
    )
    .min(1)
    .max(100),
});
export type AttendanceSaveBody = z.output<typeof attendanceSaveBody>;

export const staffEmailListQuery = z.strictObject({
  search,
  status: z.enum(["sent", "sending", "failed"]).optional(),
  from: z.string().regex(DAY).optional(),
  to: z.string().regex(DAY).optional(),
  page: page.default(1),
  pageSize: pageSize.default(25),
});
export const staffEmailFeedQuery = z.strictObject({
  after: z.iso.datetime({ offset: true }),
  watch: z
    .string()
    .max(200 * 37)
    .default("")
    .transform((s) => s.split(",").filter(Boolean))
    .pipe(z.array(z.uuid()).max(200)),
});
export const staffEmailSendBody = z.strictObject({
  recipientId: z.union([z.uuid(), z.literal("")]),
  employeeIds: z.array(z.uuid()).max(100),
});
export type StaffEmailSendBody = z.output<typeof staffEmailSendBody>;
