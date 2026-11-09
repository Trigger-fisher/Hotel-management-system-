import "server-only";
import type {
  Advance as FoAdvance,
  Charge,
  ChargeCategory,
  FolioTotals,
  Reservation,
  ReservationSource,
  ReservationStatus,
  Room,
  RoomState as UiRoomState,
  Stay,
} from "@shared/dashboards/frontOffice";
import { paiseToNumber } from "../../money/paise";
import type { AdvanceRecord, BillRecord } from "../../repos/billing";
import type { ChargeRecord, ReservationRecord, RoomRecord, RoomTypeRecord, StayRecord } from "../../repos/frontOffice";
import { istDate, nightsOf, roomCharge, roomState, stayNights } from "./rules";
import { maskNumber } from "../../crypto/fieldSeal";

// The front office as the apps get it (ui-shared frontOffice.ts): camelCase statuses, integer paise, ISO moments, `version` on a reservation
// and a stay (MJ #14). ID proof numbers are plain data and leave as stored (MJ).
export type ReservationDto = Reservation;
export type StayDto = Stay;

const n = (p: bigint): number => paiseToNumber(p);
const STATUS: Record<ReservationRecord["status"], ReservationStatus> = { confirmed: "confirmed", checked_in: "checkedIn", checked_out: "checkedOut", cancelled: "cancelled", no_show: "noShow" };
const SOURCE: Record<ReservationRecord["source"], ReservationSource> = { walk_in: "walkIn", phone: "phone", website: "website", company: "company", agent: "agent", other: "other" };
export const SOURCE_IN: Record<ReservationSource, ReservationRecord["source"]> = { walkIn: "walk_in", phone: "phone", website: "website", company: "company", agent: "agent", other: "other" };
const CATEGORY: Record<ChargeRecord["category"], ChargeCategory> = { food: "food", room_service: "roomService", laundry: "laundry", extra_bed: "extraBed", other: "other" };
export const CATEGORY_IN: Record<ChargeCategory, ChargeRecord["category"]> = { food: "food", roomService: "room_service", laundry: "laundry", extraBed: "extra_bed", other: "other" };
const STATE: Record<ReturnType<typeof roomState>, UiRoomState> = { occupied: "occupied", out_of_order: "outOfOrder", dirty: "dirty", vacant: "vacant" };

export function roomDto(r: RoomRecord, ctx: { types: ReadonlyMap<string, RoomTypeRecord>; current: StayRecord | undefined; hasHistory: boolean }): Room {
  return {
    id: r.id,
    number: r.number,
    floor: r.floor,
    roomTypeId: r.roomTypeId,
    roomTypeName: r.roomTypeId ? (ctx.types.get(r.roomTypeId)?.name ?? null) : null,
    notes: r.notes ?? "",
    hkStatus: r.hkStatus,
    outOfOrder: r.outOfOrder,
    outOfOrderReason: r.outOfOrderReason,
    hasHistory: ctx.hasHistory,
    currentStay: ctx.current ? { id: ctx.current.id, guestName: ctx.current.guestName, expectedCheckOut: ctx.current.expectedCheckOut } : null,
    state: STATE[roomState(r, ctx.current)],
  };
}

export function foAdvanceDto(a: AdvanceRecord): FoAdvance {
  return {
    id: a.id,
    receiptNumber: a.receiptNumber,
    paymentDate: a.paymentDate,
    hotelPaise: n(a.hotelAmountPaise),
    foodPaise: n(a.foodAmountPaise),
    hotelMode: a.hotelMode ?? "",
    foodMode: a.foodMode ?? "",
    instruction: a.instruction ?? "",
    balancePaise: n(a.hotelBalancePaise + a.foodBalancePaise),
    refunded: a.refundPaymentDate !== null,
  };
}

export interface ReservationDtoContext {
  types: ReadonlyMap<string, RoomTypeRecord>;
  companies: ReadonlyMap<string, string>;
  advances: ReadonlyMap<string, AdvanceRecord[]>;
  stays: ReadonlyMap<string, StayRecord[]>;
  roomNumbers: ReadonlyMap<string, string>;
  enquiryRefs: ReadonlyMap<string, string>;
}

export function reservationDto(r: ReservationRecord, ctx: ReservationDtoContext): ReservationDto {
  // Reservation::nights (Reservation.php:70-73): at least one
  const nights = Math.max(1, nightsOf(r.checkIn, r.checkOut).length);
  const advances = ctx.advances.get(r.id) ?? [];
  return {
    id: r.id,
    version: r.version,
    reference: r.reference,
    guestName: r.guestName,
    mobile: r.mobile ?? "",
    email: r.email ?? "",
    companyId: r.companyId,
    companyName: r.companyId ? (ctx.companies.get(r.companyId) ?? null) : null,
    roomTypeId: r.roomTypeId ?? "",
    roomTypeName: r.roomTypeId ? (ctx.types.get(r.roomTypeId)?.name ?? "") : "",
    rooms: r.rooms,
    plan: r.plan ?? "",
    ratePaise: n(r.ratePaise),
    adults: r.adults,
    children: r.children,
    checkIn: r.checkIn,
    checkOut: r.checkOut,
    nights,
    roomTotalPaise: n(r.ratePaise * BigInt(nights) * BigInt(r.rooms)),
    source: SOURCE[r.source],
    enquiryRef: r.siteEnquiryId ? (ctx.enquiryRefs.get(r.siteEnquiryId) ?? null) : null,
    notes: r.notes ?? "",
    status: STATUS[r.status],
    cancelReason: r.cancelReason,
    advances: advances.map(foAdvanceDto),
    advancePaidPaise: n(advances.reduce((t, a) => t + a.hotelAmountPaise + a.foodAmountPaise, BigInt(0))),
    // Reservation::advanceBalance (:76-79): what is left on its advances
    advanceBalancePaise: n(advances.reduce((t, a) => t + a.hotelBalancePaise + a.foodBalancePaise, BigInt(0))),
    stays: (ctx.stays.get(r.id) ?? []).map((s) => ({ id: s.id, guestName: s.guestName, roomNumber: ctx.roomNumbers.get(s.roomId) ?? "", status: s.status === "in_house" ? "inHouse" : "checkedOut" })),
    createdAt: r.createdAt.toISOString(),
  };
}

export const chargeDto = (c: ChargeRecord): Charge => ({
  id: c.id,
  category: CATEGORY[c.category],
  side: c.side,
  description: c.description,
  chargeDate: c.chargeDate,
  quantity: Number(c.quantity),
  unitPricePaise: n(c.unitPricePaise),
  amountPaise: n(c.amountPaise),
});

export interface StayDtoContext {
  room: RoomRecord | undefined;
  types: ReadonlyMap<string, RoomTypeRecord>;
  companies: ReadonlyMap<string, string>;
  charges: readonly ChargeRecord[];
  reservationRef: string | null;
  /** What is left on the reservation's advances (Stay show). */
  advancePaise: bigint;
  bill: BillRecord | null;
  /** The ID number as the screens get it: its last 4 characters (decision 74). */
  idNumber: string;
  idMasked: boolean;
  now: Date;
}

export function stayDto(s: StayRecord, ctx: StayDtoContext): StayDto {
  const until = s.checkOutAt ?? ctx.now;
  const nights = stayNights(s.checkInAt, until);
  const room = roomCharge(s.ratePaise, nights);
  const side = (cats: readonly ChargeRecord["category"][]): bigint => ctx.charges.filter((c) => cats.includes(c.category)).reduce((t, c) => t + c.amountPaise, BigInt(0));
  const hotelExtras = side(["extra_bed", "laundry", "other"]);
  const food = side(["food", "room_service"]);
  return {
    id: s.id,
    version: s.version,
    reservationId: s.reservationId,
    reservationRef: ctx.reservationRef,
    roomId: s.roomId,
    roomNumber: ctx.room?.number ?? "",
    roomTypeId: ctx.room?.roomTypeId ?? null,
    roomTypeName: ctx.room?.roomTypeId ? (ctx.types.get(ctx.room.roomTypeId)?.name ?? null) : null,
    grNumber: s.grNumber ?? "",
    guestName: s.guestName,
    mobile: s.mobile ?? "",
    email: s.email ?? "",
    address: s.address ?? "",
    city: s.city ?? "",
    nationality: s.nationality ?? "",
    idProofType: s.idProofType ?? "",
    idProofNumber: ctx.idNumber,
    idProofMasked: ctx.idMasked,
    companyId: s.companyId,
    companyName: s.companyId ? (ctx.companies.get(s.companyId) ?? null) : null,
    guestGstin: s.guestGstin ?? "",
    // the main guest's further details (not in the shared Stay type yet): every key, "" when not given
    ...{
      dateOfBirth: s.guestDetails?.dateOfBirth ?? "", houseNo: s.guestDetails?.houseNo ?? "", locality: s.guestDetails?.locality ?? "", district: s.guestDetails?.district ?? "",
      zipCode: s.guestDetails?.zipCode ?? "", state: s.guestDetails?.state ?? "", country: s.guestDetails?.country ?? "", phone: s.guestDetails?.phone ?? "",
      comingFrom: s.guestDetails?.comingFrom ?? "", goingTo: s.guestDetails?.goingTo ?? "", vehicleType: s.guestDetails?.vehicleType ?? "", vehicleRegistration: s.guestDetails?.vehicleRegistration ?? "",
      hasIdPhoto: s.idProofPath !== null,
      members: (s.guestDetails?.members ?? []).map((m) => ({ fullName: m.fullName, mobile: m.mobile ?? "", idType: m.idType ?? "", idNumber: maskNumber(m.idNumber), idMasked: Boolean(m.idNumber) })),
    },
    adults: s.adults,
    children: s.children,
    plan: s.plan ?? "",
    ratePaise: n(s.ratePaise),
    checkInAt: s.checkInAt.toISOString(),
    checkInDate: istDate(s.checkInAt),
    expectedCheckOut: s.expectedCheckOut,
    checkOutAt: s.checkOutAt ? s.checkOutAt.toISOString() : null,
    status: s.status === "in_house" ? "inHouse" : "checkedOut",
    notes: s.notes ?? "",
    charges: ctx.charges.map(chargeDto),
    nights,
    roomChargePaise: n(room),
    hotelExtrasPaise: n(hotelExtras),
    foodPaise: n(food),
    totalSoFarPaise: n(room + hotelExtras + food),
    advancePaise: n(ctx.advancePaise),
    bill: ctx.bill && s.status === "checked_out" ? stayBill(ctx.bill, s, { room, hotelExtras, food }) : null,
  };
}

/** The bill the stay was checked out into: its stored GST and totals (never recomputed: rates and charges may change later). */
function stayBill(b: BillRecord, s: StayRecord, parts: { room: bigint; hotelExtras: bigint; food: bigint }): Stay["bill"] {
  const hotelPercent = s.hotelGstPercent ?? "0";
  const foodPercent = s.foodGstPercent ?? "0";
  const advance = b.advanceHotelAmountPaise + b.advanceFoodAmountPaise;
  const grand = b.totalHotelAmountPaise + b.totalFoodAmountPaise;
  const totals: FolioTotals = {
    roomPaise: n(parts.room),
    hotelExtrasPaise: n(parts.hotelExtras),
    hotelPaise: n(parts.room + parts.hotelExtras),
    foodPaise: n(parts.food),
    subtotalPaise: n(parts.room + parts.hotelExtras + parts.food),
    hotelGstPaise: n(b.hotelGstPaise),
    foodGstPaise: n(b.foodGstPaise),
    grandTotalPaise: n(grand),
    advancePaise: n(advance),
    payablePaise: n(grand - advance > BigInt(0) ? grand - advance : BigInt(0)),
  };
  return { billNumber: b.billNumber, billDate: b.billDate, hotelGstPercent: Number(hotelPercent), foodGstPercent: Number(foodPercent), totals };
}
