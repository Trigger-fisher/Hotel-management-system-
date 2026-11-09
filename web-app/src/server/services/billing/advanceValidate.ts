import "server-only";
import { AppError } from "../../errors";
import type { AdvanceCreateInput, RefundBodyInput } from "./schemas";

// Validation of a guest advance and its refund with Pallav's rules and Laravel 11's default wording, word for word
// (BillMasterController.php:134-148 create, :194-207 edit, :245-254 refund). Field keys are the apps' (ui-shared AdvanceInput / RefundInput).
// Force mode (ForceMode::relax/fill, ForceMode.php:55-137): required, max, min and exists step aside, the types stay (the schema already
// holds them), and an empty required field gets a harmless blank (a date: today; text: empty). Spec: docs/specs/billing-advances.md §3, §6.

export type Fields = Record<string, string>;

const MAX_PAISE = BigInt(999_999_999_999);
const ZERO = BigInt(0);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Laravel `date`: a real calendar day (we take only YYYY-MM-DD: the apps send that). */
export function isDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

const chars = (s: string): number => Array.from(s).length;
/** Laravel TrimStrings + ConvertEmptyStringsToNull. */
export const clean = (s: string | null | undefined): string | null => {
  const t = (s ?? "").trim();
  return t === "" ? null : t;
};

export interface Ctx {
  force: boolean;
  today: string;
  fields: Fields;
}

export function maxLen(ctx: Ctx, key: string, label: string, value: string | null, max: number): void {
  if (!ctx.force && value !== null && chars(value) > max) ctx.fields[key] = `The ${label} field must not be greater than ${max} characters.`;
}

export function required(ctx: Ctx, key: string, label: string, value: string | null): boolean {
  if (value !== null) return true;
  if (!ctx.force) ctx.fields[key] = `The ${label} field is required.`;
  return false;
}

/** A required date (`required, date`): under force an empty one becomes today. */
export function requiredDate(ctx: Ctx, key: string, label: string, raw: string): string {
  const value = clean(raw);
  if (value === null) {
    if (ctx.force) return ctx.today;
    ctx.fields[key] = `The ${label} field is required.`;
    return "";
  }
  // `date` is a type rule: it stays under force
  if (!isDate(value)) ctx.fields[key] = `The ${label} field must be a valid date.`;
  return value;
}

/** `nullable, numeric, min:0` on paise (the schema made it a whole number already). */
function amount(ctx: Ctx, key: string, label: string, value: number | null): bigint | null {
  if (value === null) return null;
  const p = BigInt(value);
  // min:0 stays even under force: the table refuses a negative amount (HMS deviation, docs/specs/billing-advances.md §6)
  if (p < ZERO) ctx.fields[key] = `The ${label} field must be at least 0.`;
  // the column holds decimal(12,2): not a Pallav rule but the database's, so it stays under force
  else if (p > MAX_PAISE || p < -MAX_PAISE) ctx.fields[key] = `The ${label} field must not be greater than 9999999999.99.`;
  return p;
}

interface AdvanceValues {
  receiptTyped: string;
  guestName: string;
  mobileNumber: string | null;
  roomNumber: string | null;
  companyId: string | null;
  paymentDate: string;
  hotelPaise: bigint | null;
  foodPaise: bigint | null;
  hotelMode: string | null;
  foodMode: string | null;
  referenceName: string | null;
  referenceMobileNumber: string | null;
  instruction: string | null;
}

/** The fields of a new or edited advance. `companyExists` answers Laravel's `exists:company_profiles,id`. Throws VALIDATION_FAILED. */
export async function validateAdvance(input: AdvanceCreateInput, opts: { isNew: boolean; force: boolean; today: string; companyExists: (id: string) => Promise<boolean> }): Promise<AdvanceValues> {
  const ctx: Ctx = { force: opts.force, today: opts.today, fields: {} };
  const receipt = clean(input.receiptNo);
  if (opts.isNew && required(ctx, "receiptNo", "receipt number", receipt)) maxLen(ctx, "receiptNo", "receipt number", receipt, 50);
  const guest = clean(input.guestName);
  if (required(ctx, "guestName", "guest name", guest)) maxLen(ctx, "guestName", "guest name", guest, 255);
  const mobile = clean(input.mobile);
  maxLen(ctx, "mobile", "mobile number", mobile, 15);
  const room = clean(input.roomNo);
  maxLen(ctx, "roomNo", "room number", room, 20);
  if (input.companyId !== null && !opts.force && !(await opts.companyExists(input.companyId))) ctx.fields.companyId = "The selected company id is invalid.";
  const paymentDate = requiredDate(ctx, "paymentDate", "payment date", input.paymentDate);
  const hotelPaise = amount(ctx, "hotelPaise", "hotel amount", input.hotelPaise);
  const foodPaise = amount(ctx, "foodPaise", "food amount", input.foodPaise);
  const hotelMode = clean(input.hotelMode);
  maxLen(ctx, "hotelMode", "hotel mode", hotelMode, 20);
  const foodMode = clean(input.foodMode);
  maxLen(ctx, "foodMode", "food mode", foodMode, 20);
  const referenceName = clean(input.referenceName);
  maxLen(ctx, "referenceName", "reference name", referenceName, 255);
  const referenceMobile = clean(input.referenceMobile);
  maxLen(ctx, "referenceMobile", "reference mobile number", referenceMobile, 15);
  const instruction = clean(input.instruction);
  maxLen(ctx, "instruction", "instruction", instruction, 255);
  failIfAny(ctx.fields);
  return {
    receiptTyped: receipt ?? "",
    guestName: guest ?? "",
    mobileNumber: mobile,
    roomNumber: room,
    companyId: input.companyId,
    paymentDate,
    hotelPaise,
    foodPaise,
    hotelMode,
    foodMode,
    referenceName,
    referenceMobileNumber: referenceMobile,
    instruction,
  };
}

interface RefundValues {
  refundPaymentDate: string;
  hotelRefundAmountPaise: bigint | null;
  foodRefundAmountPaise: bigint | null;
  hotelRefundMode: string | null;
  foodRefundMode: string | null;
  refundGuestName: string | null;
  refundMobileNumber: string | null;
  refundInstruction: string | null;
}

/** :245-254 the refund's fields. */
export function validateRefund(input: RefundBodyInput, opts: { force: boolean; today: string }): RefundValues {
  const ctx: Ctx = { force: opts.force, today: opts.today, fields: {} };
  const hotel = amount(ctx, "hotelPaise", "hotel refund amount", input.hotelPaise);
  const food = amount(ctx, "foodPaise", "food refund amount", input.foodPaise);
  const hotelMode = clean(input.hotelMode);
  maxLen(ctx, "hotelMode", "hotel refund mode", hotelMode, 20);
  const foodMode = clean(input.foodMode);
  maxLen(ctx, "foodMode", "food refund mode", foodMode, 20);
  const date = requiredDate(ctx, "date", "refund payment date", input.date);
  const toName = clean(input.toName);
  maxLen(ctx, "toName", "refund guest name", toName, 255);
  const toMobile = clean(input.toMobile);
  maxLen(ctx, "toMobile", "refund mobile number", toMobile, 15);
  const note = clean(input.note);
  maxLen(ctx, "note", "refund instruction", note, 255);
  failIfAny(ctx.fields);
  return {
    refundPaymentDate: date,
    hotelRefundAmountPaise: hotel,
    foodRefundAmountPaise: food,
    hotelRefundMode: hotelMode,
    foodRefundMode: foodMode,
    refundGuestName: toName,
    refundMobileNumber: toMobile,
    refundInstruction: note,
  };
}

export function failIfAny(fields: Fields): void {
  if (Object.keys(fields).length > 0) throw new AppError("VALIDATION_FAILED", undefined, { fields });
}

export const fail = (field: string, message: string): AppError => new AppError("VALIDATION_FAILED", message, { fields: { [field]: message } });
