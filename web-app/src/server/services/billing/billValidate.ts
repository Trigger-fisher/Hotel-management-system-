import "server-only";
import { clean, failIfAny, isDate, maxLen, required, requiredDate, type Ctx } from "./advanceValidate";
import type { FoodLines, HotelLines, StayPart } from "./billRules";
import type { BillCreateInput, SettleBodyInput } from "./schemas";

// Validation of a bill and of a debit settlement with Pallav's rules and Laravel 11's wording (BillMasterController::billRules, :324-368;
// storeDebitBill, :508-523). Field keys are the apps' (ui-shared BillInput / SettleInput), the words name Pallav's fields. The money lines are
// `nullable, numeric` with NO minimum in Pallav (an adjustment may be negative); the input shape already holds them to whole paise and the
// decimal(12,2) range. Force mode relaxes required/max/min/exists, keeps the types. Spec: docs/specs/billing-bills.md §2, §8.

const ISO_MOMENT = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const ZERO = BigInt(0);

/** Laravel `date` for a moment the apps send as ISO: a real instant. */
function moment(ctx: Ctx, key: string, label: string, raw: string | null): Date | null {
  const value = clean(raw);
  if (value === null) return null;
  const at = ISO_MOMENT.test(value) ? new Date(value) : null;
  if (!at || Number.isNaN(at.getTime()) || !isDate(value.slice(0, 10))) {
    ctx.fields[key] = `The ${label} field must be a valid date.`;
    return null;
  }
  return at;
}

export interface BillValues {
  billTyped: string;
  billDate: string;
  grNumber: string | null;
  guestName: string;
  mobileNumber: string | null;
  roomNumber: string | null;
  companyId: string | null;
  guestAddress: string | null;
  guestGstin: string | null;
  persons: number | null;
  arrivalAt: Date | null;
  departureAt: Date | null;
  hotelPlan: string | null;
  hotelMode: string | null;
  foodMode: string | null;
  hotel: HotelLines;
  food: FoodLines;
  stay: StayPart[];
  referenceName: string | null;
  referenceMobileNumber: string | null;
  instruction: string | null;
}

export async function validateBill(input: BillCreateInput, opts: { isNew: boolean; force: boolean; today: string; companyExists: (id: string) => Promise<boolean> }): Promise<BillValues> {
  const ctx: Ctx = { force: opts.force, today: opts.today, fields: {} };
  const typed = clean(input.billNo);
  if (opts.isNew && required(ctx, "billNo", "bill number", typed)) maxLen(ctx, "billNo", "bill number", typed, 50);
  if (input.companyId !== null && !opts.force && !(await opts.companyExists(input.companyId))) ctx.fields.companyId = "The selected company id is invalid.";
  const billDate = requiredDate(ctx, "billDate", "bill date", input.billDate);
  const guest = clean(input.guestName);
  if (required(ctx, "guestName", "guest name", guest)) maxLen(ctx, "guestName", "guest name", guest, 255);
  const mobile = clean(input.mobile);
  maxLen(ctx, "mobile", "mobile number", mobile, 15);
  const room = clean(input.roomNo);
  maxLen(ctx, "roomNo", "room number", room, 20);
  const plan = clean(input.hotel.plan);
  maxLen(ctx, "hotel.plan", "hotel plan", plan, 100);
  const hotelMode = clean(input.hotel.mode);
  maxLen(ctx, "hotel.mode", "hotel mode of payment", hotelMode, 100);
  const foodMode = clean(input.food.mode);
  maxLen(ctx, "food.mode", "food mode of payment", foodMode, 100);
  const referenceName = clean(input.referenceName);
  maxLen(ctx, "referenceName", "reference name", referenceName, 100);
  const referenceMobile = clean(input.referenceMobile);
  maxLen(ctx, "referenceMobile", "reference mobile number", referenceMobile, 15);
  const gr = clean(input.grNo);
  maxLen(ctx, "grNo", "gr number", gr, 50);
  const address = clean(input.address);
  maxLen(ctx, "address", "guest address", address, 255);
  // Pallav checks only the length of a guest GSTIN (:354); the format check is the apps' (billing-bills.md §11.7)
  const gstin = clean(input.gstin);
  maxLen(ctx, "gstin", "guest gstin", gstin, 20);
  if (input.persons !== null && !opts.force) {
    if (input.persons < 1) ctx.fields.persons = "The persons field must be at least 1.";
    else if (input.persons > 99) ctx.fields.persons = "The persons field must not be greater than 99.";
  }
  const arrivalAt = moment(ctx, "arrivalAt", "arrival at", input.arrivalAt);
  const departureAt = moment(ctx, "departureAt", "departure at", input.departureAt);
  if (!opts.force && arrivalAt && departureAt && departureAt < arrivalAt) ctx.fields.departureAt = "The departure at field must be a date after or equal to arrival at.";

  if (!opts.force && input.stay.length > 30) ctx.fields.stay = "The stay field must not have more than 30 items.";
  const stay: StayPart[] = [];
  input.stay.forEach((part, i) => {
    const key = `stay.${i}`;
    const from = clean(part.from);
    const to = clean(part.to);
    // from/to are `required, date` and stay types even under force
    if (from === null) {
      if (!opts.force) ctx.fields[`${key}.from`] = `The ${key}.from field is required.`;
    } else if (!isDate(from)) ctx.fields[`${key}.from`] = `The ${key}.from field must be a valid date.`;
    if (to === null) {
      if (!opts.force) ctx.fields[`${key}.to`] = `The ${key}.to field is required.`;
    } else if (!isDate(to)) ctx.fields[`${key}.to`] = `The ${key}.to field must be a valid date.`;
    else if (!opts.force && from !== null && isDate(from) && to <= from) ctx.fields[`${key}.to`] = `The ${key}.to field must be a date after ${key}.from.`;
    const partPlan = clean(part.plan);
    maxLen(ctx, `${key}.plan`, `${key}.plan`, partPlan, 100);
    if (!opts.force && part.persons < 1) ctx.fields[`${key}.persons`] = `The ${key}.persons field must be at least 1.`;
    else if (!opts.force && part.persons > 99) ctx.fields[`${key}.persons`] = `The ${key}.persons field must not be greater than 99.`;
    stay.push({ from: from ?? "", to: to ?? "", plan: partPlan, persons: part.persons });
  });
  const instruction = clean(input.instruction);
  failIfAny(ctx.fields);

  const b = (n: number): bigint => BigInt(n);
  return {
    billTyped: typed ?? "",
    billDate,
    grNumber: gr,
    guestName: guest ?? "",
    mobileNumber: mobile,
    roomNumber: room,
    companyId: input.companyId,
    guestAddress: address,
    guestGstin: gstin,
    persons: input.persons,
    arrivalAt,
    departureAt,
    hotelPlan: plan,
    hotelMode,
    foodMode,
    hotel: { roomPaise: b(input.hotel.roomPaise), planPaise: b(input.hotel.planPaise), extraBedPaise: b(input.hotel.extraBedPaise), laundryPaise: b(input.hotel.laundryPaise), otherPaise: b(input.hotel.vpoPaise), gstPaise: b(input.hotel.gstPaise) },
    food: { foodPaise: b(input.food.foodPaise), planPaise: b(input.food.planPaise), laundryPaise: b(input.food.laundryPaise), gstPaise: b(input.food.gstPaise) },
    stay,
    referenceName,
    referenceMobileNumber: referenceMobile,
    instruction,
  };
}

interface SettleSlot {
  date: string | null;
  hotelMode: string | null;
  foodMode: string | null;
  hotelPaise: bigint | null;
  foodPaise: bigint | null;
}

interface SettleValues {
  slots: SettleSlot[];
  referenceName: string | null;
  referenceMobileNumber: string | null;
  instruction: string | null;
}

/** :508-523 the five slots ("debit bill date", "debit bill date 1" ...) and the reference. HMS: the first slot's date is required (§11.3). */
export function validateSettle(input: SettleBodyInput, opts: { force: boolean; today: string }): SettleValues {
  const ctx: Ctx = { force: opts.force, today: opts.today, fields: {} };
  const slots = input.installments.map((inst, i): SettleSlot => {
    const suffix = i === 0 ? "" : ` ${i}`;
    const key = `installments.${i}`;
    let date = clean(inst.date);
    if (i === 0 && date === null) {
      // HMS deviation (§11.3): the date that marks the bill settled; under force it becomes today like any required date
      if (opts.force) date = opts.today;
      else ctx.fields[`${key}.date`] = "The debit bill date field is required.";
    } else if (date !== null && !isDate(date)) ctx.fields[`${key}.date`] = `The debit bill date${suffix} field must be a valid date.`;
    const hotelMode = clean(inst.hotelMode);
    maxLen(ctx, `${key}.hotelMode`, `debit hotel mode${suffix}`, hotelMode, 20);
    const foodMode = clean(inst.foodMode);
    maxLen(ctx, `${key}.foodMode`, `debit food mode${suffix}`, foodMode, 20);
    // a negative instalment would raise the balance: refused even under force
    if (inst.hotelPaise < 0) ctx.fields[`${key}.hotelPaise`] = `The debit hotel amount${suffix} field must be at least 0.`;
    if (inst.foodPaise < 0) ctx.fields[`${key}.foodPaise`] = `The debit food amount${suffix} field must be at least 0.`;
    return { date, hotelMode, foodMode, hotelPaise: BigInt(inst.hotelPaise), foodPaise: BigInt(inst.foodPaise) };
  });
  if (!opts.force && slots.every((slot) => slot.hotelPaise === ZERO && slot.foodPaise === ZERO)) ctx.fields.installments = "Enter an amount on at least one installment.";
  const referenceName = clean(input.referenceName);
  maxLen(ctx, "referenceName", "debit reference name", referenceName, 100);
  const referenceMobile = clean(input.referenceMobile);
  maxLen(ctx, "referenceMobile", "debit reference mobile number", referenceMobile, 15);
  failIfAny(ctx.fields);
  return { slots, referenceName, referenceMobileNumber: referenceMobile, instruction: clean(input.instruction) };
}
