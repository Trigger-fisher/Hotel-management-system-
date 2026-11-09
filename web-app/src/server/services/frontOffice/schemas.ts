import "server-only";
import { z } from "zod";
import { versionField } from "../../validation/listQuery";

// The shapes the front-office routes accept (ui-shared frontOffice.ts inputs). Strict: unknown keys refused, every string and number bounded;
// no identity, no status, no bill and no total can be sent. Pallav's rules and words are applied by the services (validate.ts).
const text = (max: number) => z.string().max(max);
const paise = z.number().int().min(-999_999_999_999).max(999_999_999_999);
const count = z.number().int().min(-1000).max(1000);
const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/;
const pageSize = z.coerce.number().pipe(z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)]));
const search = z.string().trim().max(200).regex(NO_CONTROL).optional();
const optionalId = z.union([z.uuid(), z.literal("")]);

export const roomBody = z.strictObject({ number: text(1000), floor: text(1000), roomTypeId: optionalId, notes: text(5000) });
export const bulkRoomsBody = z.strictObject({ numbers: text(5000), floor: text(1000), roomTypeId: optionalId });
/** HMS: the status the clerk wants (set, not toggle: two clerks toggling at once would cancel each other out). */
export const housekeepingBody = z.strictObject({ hkStatus: z.enum(["clean", "dirty"]) });
export const serviceBody = z.strictObject({ outOfOrder: z.boolean(), reason: text(5000) });
export const roomListQuery = z.strictObject({
  filter: z.enum(["all", "vacant", "occupied", "dirty", "outOfOrder"]).default("all"),
  search,
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: pageSize.default(100),
});

const reservationFields = {
  guestName: text(5000),
  mobile: text(1000),
  email: text(1000),
  companyId: optionalId,
  source: z.enum(["walkIn", "phone", "website", "company", "agent", "other"]),
  checkIn: text(40),
  checkOut: text(40),
  adults: count,
  children: count,
  roomTypeId: optionalId,
  rooms: count,
  plan: text(1000),
  ratePaise: paise.nullable(),
  notes: text(10_000),
};
export const reservationCreateBody = z.strictObject(reservationFields);
export const reservationUpdateBody = z.strictObject({ ...reservationFields, version: versionField });
export const cancelBody = z.strictObject({ noShow: z.boolean(), reason: text(5000), version: versionField });
export const reservationAdvanceBody = z.strictObject({
  receiptNumber: text(1000),
  paymentDate: text(40),
  hotelPaise: paise.nullable(),
  foodPaise: paise.nullable(),
  hotelMode: text(1000),
  foodMode: text(1000),
  instruction: text(5000),
});
export const reservationListQuery = z.strictObject({
  view: z.enum(["upcoming", "today", "inHouse", "past", "cancelled", "all"]).default("upcoming"),
  search,
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: pageSize.default(25),
});

export const checkInBody = z.strictObject({
  reservationId: optionalId,
  roomId: z.uuid(),
  expectedCheckOut: text(40),
  grNumber: text(1000),
  adults: count,
  children: count,
  plan: text(1000),
  ratePaise: paise.nullable(),
  guestName: text(5000),
  mobile: text(1000),
  email: text(1000),
  address: text(5000),
  city: text(1000),
  nationality: text(1000),
  idProofType: text(1000),
  idProofNumber: text(1000),
  companyId: optionalId,
  guestGstin: text(1000),
  notes: text(10_000),
  // the main guest's further register details, all optional (services/frontOffice/guestDetails.ts checks them)
  dateOfBirth: text(100).optional(),
  houseNo: text(1000).optional(),
  locality: text(1000).optional(),
  district: text(1000).optional(),
  zipCode: text(100).optional(),
  state: text(1000).optional(),
  country: text(1000).optional(),
  phone: text(100).optional(),
  comingFrom: text(1000).optional(),
  goingTo: text(1000).optional(),
  vehicleType: text(100).optional(),
  vehicleRegistration: text(100).optional(),
  members: z.array(z.strictObject({ fullName: text(1000).optional(), mobile: text(100).optional(), idType: text(1000).optional(), idNumber: text(1000).optional() })).max(50).optional(),
});
export const chargeBody = z.strictObject({
  category: z.enum(["food", "roomService", "laundry", "extraBed", "other"]),
  description: text(5000),
  chargeDate: text(40),
  quantity: z.number().min(-100_000).max(100_000),
  unitPricePaise: paise.nullable(),
});
export const moveBody = z.strictObject({ roomId: z.uuid(), ratePaise: paise.nullable(), version: versionField });
export const extendBody = z.strictObject({ expectedCheckOut: text(40), version: versionField });
export const checkOutBody = z.strictObject({
  billNumber: text(1000),
  billDate: text(40),
  hotelGstPercent: z.number().min(-1000).max(1000),
  foodGstPercent: z.number().min(-1000).max(1000),
  hotelMode: text(1000),
  foodMode: text(1000),
  instruction: text(5000),
  version: versionField,
});
export const stayListQuery = z.strictObject({
  view: z.enum(["inHouse", "past"]).default("inHouse"),
  search,
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: pageSize.default(25),
});
export const prefillQuery = z.strictObject({ reservationId: z.uuid().optional() });
/** The check-out defaults, for one stay when named (its rate picks the GST slab). */
export const checkoutDefaultsQuery = z.strictObject({ stayId: z.uuid().optional() });
/** HMS: a past guest by mobile (the digits the desk has, 6 to 20 characters as typed). */
export const guestLookupQuery = z.strictObject({ mobile: z.string().trim().min(6).max(20).regex(NO_CONTROL) });
export const chargeParams = z.strictObject({ id: z.uuid(), chargeId: z.uuid() });

export type RoomBody = z.output<typeof roomBody>;
export type ReservationBody = z.output<typeof reservationCreateBody>;
export type CheckInBody = z.output<typeof checkInBody>;
export type ChargeBody = z.output<typeof chargeBody>;
export type CheckOutBody = z.output<typeof checkOutBody>;
export type ReservationAdvanceBody = z.output<typeof reservationAdvanceBody>;

/** The main guest's details and the room's other guests, edited after check-in (PUT .../stays/{id}/guest-details): the whole set is replaced. */
export const guestDetailsBody = checkInBody.pick({ dateOfBirth: true, houseNo: true, locality: true, district: true, zipCode: true, state: true, country: true, phone: true, comingFrom: true, goingTo: true, vehicleType: true, vehicleRegistration: true, members: true }).extend({
  // the main guest's own stay fields (only the ones sent change; an empty string clears)
  idProofType: text(1000).optional(),
  idProofNumber: text(1000).optional(),
  email: text(1000).optional(),
  address: text(5000).optional(),
  city: text(1000).optional(),
  version: z.number().int().min(1),
});
export type GuestDetailsBody = z.output<typeof guestDetailsBody>;

/** Guest requests (G2): the queue and closing one. */
export const requestListQuery = z.strictObject({ view: z.enum(["open", "closed"]).default("open"), page: z.coerce.number().int().min(1).max(10_000).default(1), pageSize: pageSize.default(25) });
export const closeRequestBody = z.strictObject({ status: z.enum(["done", "declined"]), reply: text(1000).default("") });
