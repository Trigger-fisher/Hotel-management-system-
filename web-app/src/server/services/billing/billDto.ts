import "server-only";
import type { Bill, BillPreview, Installment } from "@shared/dashboards/billing";
import { paiseToNumber } from "../../money/paise";
import { amountInWords } from "../../money/words";
import type { BillGuests, BillRecord } from "../../repos/billing";
import { personsOf, type BillPersons } from "./guests";

// The bill as the apps get it (ui-shared `Bill`), its printable preview (data, no PDF: MJ's rule) and its fields for the system log.
export type BillDto = Bill & { guests?: BillPersons };
export type { BillPreview };

const n = (p: bigint | null): number => (p === null ? 0 : paiseToNumber(p));
const isoDate = (d: Date | null): string | null => (d === null ? null : d.toISOString());
/** The plan text is free in Pallav (PlanText). */
const plan = (p: string | null): string | null => (p === null || p === "" ? null : p);
const rate = (pct: string | null): number | null => (pct === null || pct.trim() === "" || !Number.isFinite(Number(pct)) ? null : Number(pct));

function installmentsOf(b: BillRecord): Installment[] {
  // bills.blade.php:26-35: a slot counts when it has a date or an amount
  return b.debit
    .filter((s) => s.date !== null || (s.hotelPaise !== null && s.hotelPaise !== BigInt(0)) || (s.foodPaise !== null && s.foodPaise !== BigInt(0)))
    .map((s) => ({ date: s.date ?? "", hotelPaise: n(s.hotelPaise), hotelMode: s.hotelMode, foodPaise: n(s.foodPaise), foodMode: s.foodMode }));
}

export const settlementRecorded = (b: Pick<BillRecord, "debit">): boolean => b.debit[0].date !== null;

export function billDto(b: BillRecord, companies: ReadonlyMap<string, string>, stays?: ReadonlyMap<string, BillGuests>): BillDto {
  return {
    guests: personsOf(stays?.get(b.id), b),
    id: b.id,
    entryNo: b.entryNo,
    version: b.version,
    billNo: b.billNumber,
    billDate: b.billDate,
    grNo: b.grNumber ?? "",
    guestName: b.guestName,
    mobile: b.mobileNumber ?? "",
    address: b.guestAddress ?? "",
    gstin: b.guestGstin ?? "",
    companyId: b.companyId,
    companyName: b.companyId ? (companies.get(b.companyId) ?? null) : null,
    roomNo: b.roomNumber ?? "",
    persons: b.persons,
    arrivalAt: isoDate(b.arrivalAt),
    departureAt: isoDate(b.departureAt),
    hotel: {
      plan: plan(b.hotelPlan),
      roomPaise: n(b.hotelAmountPaise),
      planPaise: n(b.hotelPlanAmountPaise),
      extraBedPaise: n(b.hotelExtraBedAmountPaise),
      laundryPaise: n(b.hotelLaundryAmountPaise),
      vpoPaise: n(b.hotelOtherAmountPaise),
      gstPaise: n(b.hotelGstPaise),
      mode: b.hotelModeOfPayment,
    },
    food: { foodPaise: n(b.foodAmountPaise), planPaise: n(b.foodPlanAmountPaise), laundryPaise: n(b.foodLaundryAmountPaise), gstPaise: n(b.foodGstPaise), mode: b.foodModeOfPayment },
    hotelGstPercent: rate(b.hotelGstPercent),
    foodGstPercent: rate(b.foodGstPercent),
    hotelSac: b.hotelSac,
    foodSac: b.foodSac,
    hotelTotalPaise: n(b.totalHotelAmountPaise),
    foodTotalPaise: n(b.totalFoodAmountPaise),
    // bills.blade.php:279: shown when the bill names an advance
    advance:
      b.advanceId !== null || b.advanceReceiptNumber !== null
        ? { advanceId: b.advanceId ?? "", receiptNo: b.advanceReceiptNumber ?? "", guestName: b.advanceGuestName ?? "", hotelPaise: n(b.advanceHotelAmountPaise), foodPaise: n(b.advanceFoodAmountPaise) }
        : null,
    balanceHotelPaise: n(b.balanceHotelAmountPaise),
    balanceFoodPaise: n(b.balanceFoodAmountPaise),
    stay: (b.staySegments ?? []).map((s) => ({ from: s.from, to: s.to, plan: s.plan === "" ? null : s.plan, persons: s.persons, nights: s.nights, ratePaise: s.ratePaise === null ? null : n(s.ratePaise), amountPaise: n(s.amountPaise) })),
    planFoodOwedPaise: n(b.planFoodAmountPaise),
    referenceName: b.referenceName ?? "",
    referenceMobile: b.referenceMobileNumber ?? "",
    instruction: b.instruction ?? "",
    settlement: settlementRecorded(b)
      ? {
          installments: installmentsOf(b),
          referenceName: b.debitReferenceName ?? "",
          referenceMobile: b.debitReferenceMobileNumber ?? "",
          instruction: b.debitInstruction ?? "",
          excessReceiptNo: b.formattedAdvanceReceiptNumber,
          // Pallav keeps no "settled at": the row's last change is when the settlement was recorded (a settled bill cannot be edited)
          recordedAt: b.updatedAt.toISOString(),
        }
      : null,
    createdAt: b.createdAt.toISOString(),
  };
}

/* ---------------------------------------------------------------- the preview (ui-shared BillPreview: the paper, as data) */

export function billPreview(b: BillRecord, header: { name: string; foodName: string; address: string | null; phone: string | null; gstin: string | null; foodGstin: string | null }, companies: ReadonlyMap<string, string>, stays?: ReadonlyMap<string, BillGuests>): BillPreview {
  return {
    // the hotel's and the food business's GSTIN are hotel settings (MJ #20 A)
    header: { name: header.name, foodName: header.foodName, address: header.address ?? "", phone: header.phone ?? "", gstin: header.gstin, foodGstin: header.foodGstin } as BillPreview["header"],
    bill: billDto(b, companies, stays),
    hotelWords: amountInWords(b.totalHotelAmountPaise),
    foodWords: amountInWords(b.totalFoodAmountPaise),
  };
}

/* ---------------------------------------------------------------- the system log (Pallav's column names, readable; money in paise) */

const COLUMN: Record<string, string> = {
  billNumber: "Bill number", companyId: "Company id", billDate: "Bill date", guestName: "Guest name", mobileNumber: "Mobile number", roomNumber: "Room number",
  advanceId: "Advance id", hotelPlan: "Hotel plan", hotelAmountPaise: "Hotel amount", hotelPlanAmountPaise: "Hotel plan amount", hotelLaundryAmountPaise: "Hotel laundry amount",
  hotelGstPaise: "Hotel gst", hotelModeOfPayment: "Hotel mode of payment", foodPlanAmountPaise: "Food plan amount", foodLaundryAmountPaise: "Food laundry amount",
  foodAmountPaise: "Food amount", foodGstPaise: "Food gst", foodModeOfPayment: "Food mode of payment", referenceName: "Reference name",
  referenceMobileNumber: "Reference mobile number", instruction: "Instruction", grNumber: "Gr number", guestAddress: "Guest address", guestGstin: "Guest gstin",
  persons: "Persons", arrivalAt: "Arrival at", departureAt: "Departure at", hotelExtraBedAmountPaise: "Hotel extra bed amount", hotelOtherAmountPaise: "Hotel other amount",
  totalHotelAmountPaise: "Total hotel amount", totalFoodAmountPaise: "Total food amount", staySegments: "Stay segments", planFoodAmountPaise: "Plan food amount",
  balanceHotelAmountPaise: "Balance hotel amount", balanceFoodAmountPaise: "Balance food amount", advanceReceiptNumber: "Advance receipt number",
  advanceGuestName: "Advance guest name", advanceHotelAmountSnapshot: "Advance hotel amount snapshot", advanceFoodAmountSnapshot: "Advance food amount snapshot",
  advanceDateSnapshot: "Advance date snapshot", advanceCompanySnapshot: "Advance company snapshot", advanceHotelAmountPaise: "Advance hotel amount",
  advanceFoodAmountPaise: "Advance food amount", advanceDeleteHotelAmountPaise: "Advance delete hotel amount", advanceDeleteFoodAmountPaise: "Advance delete food amount",
  formattedAdvanceReceiptNumber: "Formatted advance receipt number", debitHotelAdvance: "Debit hotel advance", debitFoodAdvance: "Debit food advance",
  debitReferenceName: "Debit reference name", debitReferenceMobileNumber: "Debit reference mobile number", debitInstruction: "Debit instruction", entryNo: "Entry no",
};

/** A bill's fields as the log shows them (held()/readable(): dates d-m-Y, arrival/departure d-m-Y H:i in IST, the five slots by Pallav's names). */
export function billLogFields(b: BillRecord, keys: readonly string[], keepEmpty = false): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const dmy = (d: string): string => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
  const put = (label: string, value: unknown): void => {
    if (keepEmpty || (value !== null && value !== undefined && value !== "")) out[label] = value ?? null;
  };
  for (const key of keys) {
    if (key === "debit") {
      b.debit.forEach((s, i) => {
        const suffix = i === 0 ? "" : ` ${i}`;
        put(`Debit bill date${suffix}`, s.date ? dmy(s.date) : null);
        put(`Debit hotel mode${suffix}`, s.hotelMode);
        put(`Debit food mode${suffix}`, s.foodMode);
        put(`Debit hotel amount${suffix}`, s.hotelPaise === null ? null : Number(s.hotelPaise));
        put(`Debit food amount${suffix}`, s.foodPaise === null ? null : Number(s.foodPaise));
      });
      continue;
    }
    const label = COLUMN[key];
    if (!label) continue;
    let value = (b as unknown as Record<string, unknown>)[key];
    if (typeof value === "bigint") value = Number(value);
    else if (value instanceof Date) value = istDayTime(value);
    else if (key === "billDate" && typeof value === "string") value = dmy(value);
    else if (Array.isArray(value)) value = JSON.stringify(value, (_k, v: unknown) => (typeof v === "bigint" ? Number(v) : v));
    put(label, value);
  }
  return out;
}

const istDayTime = (d: Date): string => {
  const t = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  const p = (x: number): string => String(x).padStart(2, "0");
  return `${p(t.getUTCDate())}-${p(t.getUTCMonth() + 1)}-${t.getUTCFullYear()} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
};

/** `whole` for a bill. */
export const BILL_WHOLE_KEYS = [
  "billNumber", "companyId", "billDate", "guestName", "mobileNumber", "roomNumber", "advanceId", "hotelPlan", "hotelAmountPaise", "hotelPlanAmountPaise",
  "hotelLaundryAmountPaise", "hotelGstPaise", "hotelModeOfPayment", "foodPlanAmountPaise", "foodLaundryAmountPaise", "foodAmountPaise", "foodGstPaise",
  "foodModeOfPayment", "referenceName", "referenceMobileNumber", "instruction", "grNumber", "guestAddress", "guestGstin", "persons", "arrivalAt", "departureAt",
  "hotelExtraBedAmountPaise", "hotelOtherAmountPaise", "totalHotelAmountPaise", "totalFoodAmountPaise", "staySegments", "planFoodAmountPaise",
  "advanceReceiptNumber", "advanceGuestName", "advanceHotelAmountSnapshot", "advanceFoodAmountSnapshot", "advanceDateSnapshot", "advanceCompanySnapshot",
  "advanceHotelAmountPaise", "advanceFoodAmountPaise", "advanceDeleteHotelAmountPaise", "advanceDeleteFoodAmountPaise", "balanceHotelAmountPaise",
  "balanceFoodAmountPaise", "debit", "debitHotelAdvance", "debitFoodAdvance", "debitReferenceName", "debitReferenceMobileNumber", "debitInstruction",
  "formattedAdvanceReceiptNumber", "entryNo",
] as const;
/** The fields an edit names (:470 held over the validated and worked-out keys). */
export const BILL_EDIT_KEYS = [
  "companyId", "billDate", "guestName", "mobileNumber", "roomNumber", "hotelPlan", "hotelAmountPaise", "hotelPlanAmountPaise", "hotelLaundryAmountPaise",
  "hotelGstPaise", "hotelModeOfPayment", "foodPlanAmountPaise", "foodLaundryAmountPaise", "foodAmountPaise", "foodGstPaise", "foodModeOfPayment", "referenceName",
  "referenceMobileNumber", "instruction", "grNumber", "guestAddress", "guestGstin", "persons", "arrivalAt", "departureAt", "hotelExtraBedAmountPaise",
  "hotelOtherAmountPaise", "totalHotelAmountPaise", "totalFoodAmountPaise", "staySegments", "planFoodAmountPaise", "balanceHotelAmountPaise", "balanceFoodAmountPaise",
] as const;
/** The settlement's fields (:543 and :586-591). */
export const SETTLEMENT_KEYS = ["debitReferenceName", "debitReferenceMobileNumber", "debitInstruction", "debit", "debitHotelAdvance", "debitFoodAdvance", "balanceHotelAmountPaise", "balanceFoodAmountPaise"] as const;
export const SETTLEMENT_HELD_KEYS = ["debitReferenceName", "debitReferenceMobileNumber", "debitInstruction", "debitHotelAdvance", "debitFoodAdvance", "debit"] as const;
