import "server-only";
import type { Advance } from "@shared/dashboards/billing";
import { paiseToNumber } from "../../money/paise";
import type { AdvanceRecord } from "../../repos/billing";
import { fromBillNumber } from "./advanceRules";

// The advance as the apps get it: ui-shared `Advance`, integer paise, ISO dates, '' for an empty text the contract types as string.
// `version` is what "someone else changed this" checks (MJ #14).
export type AdvanceDto = Advance;

const n = (p: bigint | null): number => (p === null ? 0 : paiseToNumber(p));
// Pallav keeps whatever mode text the form sent; the contract's PaymentMode accepts any string
const mode = (m: string | null): string | null => m;

interface AdvanceDtoContext {
  companies: ReadonlyMap<string, string>;
  usedOn: ReadonlyMap<string, string[]>;
}

export function advanceDto(a: AdvanceRecord, ctx: AdvanceDtoContext): AdvanceDto {
  return {
    id: a.id,
    entryNo: a.entryNo,
    version: a.version,
    receiptNo: a.receiptNumber,
    paymentDate: a.paymentDate,
    guestName: a.guestName,
    mobile: a.mobileNumber ?? "",
    companyId: a.companyId,
    companyName: a.companyId ? (ctx.companies.get(a.companyId) ?? null) : null,
    roomNo: a.roomNumber ?? "",
    hotelPaise: n(a.hotelAmountPaise),
    foodPaise: n(a.foodAmountPaise),
    hotelMode: mode(a.hotelMode),
    foodMode: mode(a.foodMode),
    hotelBalancePaise: n(a.hotelBalancePaise),
    foodBalancePaise: n(a.foodBalancePaise),
    referenceName: a.referenceName ?? "",
    referenceMobile: a.referenceMobileNumber ?? "",
    instruction: a.instruction ?? "",
    refund:
      a.refundPaymentDate === null
        ? null
        : {
            date: a.refundPaymentDate,
            hotelPaise: n(a.hotelRefundAmountPaise),
            foodPaise: n(a.foodRefundAmountPaise),
            hotelMode: mode(a.hotelRefundMode),
            foodMode: mode(a.foodRefundMode),
            toName: a.refundGuestName ?? "",
            toMobile: a.refundMobileNumber ?? "",
            note: a.refundInstruction ?? "",
          },
    usedOn: ctx.usedOn.get(a.id) ?? [],
    fromBillNo: fromBillNumber(a.receiptNumber),
    createdAt: a.createdAt.toISOString(),
  };
}

/** The fields of the record as the system log shows them (Pallav's column names, made readable; money in paise; empty left out unless keepEmpty). */
export function advanceLogFields(a: AdvanceRecord | (Partial<AdvanceRecord> & { receiptNumber?: string }), keys: readonly (keyof AdvanceRecord)[], keepEmpty = false): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const column = COLUMN[key as string];
    if (!column) continue;
    let value = (a as Record<string, unknown>)[key as string];
    if (typeof value === "bigint") value = Number(value);
    // only the DATE columns are shown as d-m-Y (held(): a DateTimeInterface), never a text that happens to look like a date
    if ((key === "paymentDate" || key === "refundPaymentDate") && typeof value === "string") value = `${value.slice(8, 10)}-${value.slice(5, 7)}-${value.slice(0, 4)}`;
    if (keepEmpty || (value !== null && value !== undefined && value !== "")) out[column] = value ?? null;
  }
  return out;
}

/** Record field -> Pallav's readable column name (BillMasterController::readable / SystemLogger::fieldName; golden-tested). */
const COLUMN: Record<string, string> = {
  receiptNumber: "Receipt number",
  guestName: "Guest name",
  mobileNumber: "Mobile number",
  roomNumber: "Room number",
  companyId: "Company id",
  paymentDate: "Payment date",
  hotelAmountPaise: "Hotel amount",
  foodAmountPaise: "Food amount",
  hotelMode: "Hotel mode",
  foodMode: "Food mode",
  referenceName: "Reference name",
  referenceMobileNumber: "Reference mobile number",
  instruction: "Instruction",
  hotelBalancePaise: "Hotel balance",
  foodBalancePaise: "Food balance",
  totalPaise: "Total",
  hotelRefundAmountPaise: "Hotel refund amount",
  foodRefundAmountPaise: "Food refund amount",
  hotelRefundMode: "Hotel refund mode",
  foodRefundMode: "Food refund mode",
  refundPaymentDate: "Refund payment date",
  refundGuestName: "Refund guest name",
  refundMobileNumber: "Refund mobile number",
  refundInstruction: "Refund instruction",
  entryNo: "Entry no",
  reservationId: "Reservation id",
};

/** `whole` (BillMasterController.php:82-87): every field holding a value, except id, created_at, updated_at, created_by. */
export const WHOLE_KEYS: readonly (keyof AdvanceRecord)[] = [
  "receiptNumber", "guestName", "mobileNumber", "roomNumber", "companyId", "paymentDate", "hotelAmountPaise", "foodAmountPaise", "hotelMode", "foodMode",
  "referenceName", "referenceMobileNumber", "instruction", "hotelBalancePaise", "foodBalancePaise", "totalPaise", "hotelRefundAmountPaise", "foodRefundAmountPaise",
  "hotelRefundMode", "foodRefundMode", "refundPaymentDate", "refundGuestName", "refundMobileNumber", "refundInstruction", "reservationId", "entryNo",
];
export const EDIT_KEYS: readonly (keyof AdvanceRecord)[] = [
  "guestName", "mobileNumber", "roomNumber", "companyId", "paymentDate", "hotelAmountPaise", "foodAmountPaise", "hotelMode", "foodMode",
  "referenceName", "referenceMobileNumber", "instruction", "hotelBalancePaise", "foodBalancePaise", "totalPaise",
];
export const REFUND_KEYS: readonly (keyof AdvanceRecord)[] = [
  "hotelRefundAmountPaise", "foodRefundAmountPaise", "hotelRefundMode", "foodRefundMode", "refundPaymentDate", "refundGuestName", "refundMobileNumber",
  "refundInstruction", "hotelBalancePaise", "foodBalancePaise", "totalPaise",
];
/** What the reversal log shows (:276-277): the refund fields, not the balances. */
export const REFUND_HELD_KEYS: readonly (keyof AdvanceRecord)[] = [
  "refundPaymentDate", "hotelRefundAmountPaise", "foodRefundAmountPaise", "hotelRefundMode", "foodRefundMode", "refundGuestName", "refundMobileNumber", "refundInstruction",
];
