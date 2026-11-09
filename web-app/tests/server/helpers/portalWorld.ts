// Record builders and the route wiring for the guest and company portal tests (tests/server/portal.*.test.ts): one in-memory hotel store with the
// portals' reads, the real route files through the wrapper, sessions picked by a test header.
import type { MailQueue } from "../../../src/server/services/auth/mail";
import type { VerifiedSession } from "../../../src/server/auth/session";
import { configurePortal } from "../../../src/server/compose/portal";
import { AppError } from "../../../src/server/errors";
import { createMemoryIdempotencyStore } from "../../../src/server/http/idempotency";
import { configureRoutes } from "../../../src/server/http/route";
import { createLogger } from "../../../src/server/logger";
import type { AdvanceRecord, BillRecord, DebitSlot } from "../../../src/server/repos/billing";
import type { CompanyRecord, CustomerRecord } from "../../../src/server/repos/companies";
import type { ChargeRecord, ReservationRecord, RoomRecord, RoomTypeRecord, StayRecord } from "../../../src/server/repos/frontOffice";
import { createMemoryPortalHotel } from "../../../src/server/repos/memory/portal";
import { createCorporateService } from "../../../src/server/services/corporate/corporateService";
import { createGuestService } from "../../../src/server/services/guest/guestService";
import type { Memberships } from "../../../src/server/services/portal/multiHotel";
import type { CentralProfilesUnit } from "../../../src/server/repos/centralProfiles";
import { catalog } from "./session";

export const pid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T0 = new Date("2026-01-01T00:00:00Z");
const P = (rupees: number): bigint => BigInt(Math.round(rupees * 100));
const slot = (): DebitSlot => ({ date: null, hotelMode: null, foodMode: null, hotelPaise: null, foodPaise: null });

export function customer(over: Partial<CustomerRecord> & { id: string; mobile: string }): CustomerRecord {
  return { name: "Amit Joshi", email: "amit@example.com", address: "Satellite Road", city: "Ahmedabad", idProofType: "Aadhaar Card", idProofNumber: "123456784321", notes: null, isActive: true, source: "admin", createdBy: null, updatedBy: null, createdAt: T0, updatedAt: T0, ...over };
}

export function company(over: Partial<CompanyRecord> & { id: string; name: string }): CompanyRecord {
  return {
    email: "desk@example.com", mobileNumber: "9824012345", phoneNumber: null, country: "India", nationality: null, pincode: "360005", gstNumber: "24AAACT2727Q1ZV", address: "Kalawad Road",
    discountPercentage: "10", gstPercentage: "12", tcsPercentage: null, tdsPercentage: "2", instruction: null,
    contacts: [{ role: "Travel Desk Manager", name: "Deepa Iyer", email: "deepa@example.com", mobile: "9824012345" }, { role: "Accounts", name: "Rajesh Patel", email: "", mobile: "9898123456" }],
    createdBy: null, updatedBy: null, deletedAt: null, deletedBy: null, createdAt: T0, updatedAt: T0, ...over,
  };
}

let entry = 1;
export function bill(over: Partial<BillRecord> & { id: string; billNumber: string; billDate: string }): BillRecord {
  return {
    companyId: null, guestName: "Amit Joshi", mobileNumber: "9876543210", roomNumber: "204", grNumber: null, guestAddress: null, guestGstin: null, persons: 2,
    arrivalAt: new Date(`${over.billDate}T06:30:00Z`), departureAt: new Date(`${over.billDate}T06:30:00Z`), hotelPlan: "CP",
    hotelAmountPaise: P(4000), hotelPlanAmountPaise: P(0), hotelExtraBedAmountPaise: P(0), hotelLaundryAmountPaise: P(500), hotelOtherAmountPaise: P(0), hotelGstPaise: P(225), hotelModeOfPayment: "Cash",
    foodAmountPaise: P(1000), foodPlanAmountPaise: P(0), foodLaundryAmountPaise: P(0), foodGstPaise: P(50), foodModeOfPayment: "Cash",
    totalHotelAmountPaise: P(4725), totalFoodAmountPaise: P(1050), balanceHotelAmountPaise: P(0), balanceFoodAmountPaise: P(0),
    referenceName: null, referenceMobileNumber: null, instruction: null, invoicePdfPath: null, foodInvoicePdfPath: null, staySegments: null, planFoodAmountPaise: P(0),
    hotelGstPercent: null, foodGstPercent: null, hotelSac: "996311", foodSac: "996331", advanceId: null, advanceReceiptNumber: null, advanceGuestName: null, advanceHotelAmountSnapshot: null, advanceFoodAmountSnapshot: null,
    advanceDateSnapshot: null, advanceCompanySnapshot: null, advanceHotelAmountPaise: P(0), advanceFoodAmountPaise: P(0), advanceDeleteHotelAmountPaise: P(0), advanceDeleteFoodAmountPaise: P(0),
    debit: [slot(), slot(), slot(), slot(), slot()], debitHotelAdvance: null, debitFoodAdvance: null, debitReferenceName: null, debitReferenceMobileNumber: null, debitInstruction: null,
    formattedAdvanceReceiptNumber: null, entryNo: entry++, createdBy: null, updatedBy: null, deletedAt: null, deletedBy: null, createdAt: T0, updatedAt: T0, version: 1, ...over,
  };
}

export function advance(over: Partial<AdvanceRecord> & { id: string; receiptNumber: string; paymentDate: string }): AdvanceRecord {
  return {
    guestName: "Amit Joshi", mobileNumber: "9876543210", roomNumber: null, companyId: null, reservationId: null, hotelAmountPaise: P(5000), foodAmountPaise: P(0), hotelMode: "UPI", foodMode: null,
    referenceName: null, referenceMobileNumber: null, instruction: null, hotelBalancePaise: P(5000), foodBalancePaise: P(0), totalPaise: P(5000), hotelRefundAmountPaise: null, foodRefundAmountPaise: null,
    hotelRefundMode: null, foodRefundMode: null, refundPaymentDate: null, refundGuestName: null, refundMobileNumber: null, refundInstruction: null,
    entryNo: entry++, createdBy: null, updatedBy: null, deletedAt: null, deletedBy: null, createdAt: T0, updatedAt: T0, version: 1, ...over,
  };
}

export function room(over: Partial<RoomRecord> & { id: string; number: string }): RoomRecord {
  return { floor: "1", roomTypeId: null, hkStatus: "clean", outOfOrder: false, outOfOrderReason: null, notes: null, sortOrder: 0, createdBy: null, updatedBy: null, createdAt: T0, updatedAt: T0, ...over };
}

export function stay(over: Partial<StayRecord> & { id: string; roomId: string }): StayRecord {
  return {
    reservationId: null, grNumber: "GR-1", guestName: "Amit Joshi", mobile: "9876543210", email: null, address: null, city: null, nationality: "Indian", idProofType: null, idProofNumber: null,
    companyId: null, guestGstin: null, adults: 2, children: 0, plan: "CP", ratePaise: P(4000), checkInAt: new Date("2026-10-03T08:00:00Z"), expectedCheckOut: "2026-10-07", checkOutAt: null,
    status: "in_house", billId: null, hotelGstPercent: null, foodGstPercent: null, notes: null, guestDetails: null, idProofPath: null, createdBy: null, updatedBy: null, createdAt: T0, updatedAt: T0, version: 1, ...over,
  };
}

export function charge(over: Partial<ChargeRecord> & { id: string; stayId: string }): ChargeRecord {
  return { chargeDate: "2026-10-04", category: "laundry", side: "hotel", description: "Laundry: 6 items", quantity: "1", unitPricePaise: P(450), amountPaise: P(450), createdBy: null, createdAt: new Date("2026-10-04T05:00:00Z"), ...over };
}

export function reservation(over: Partial<ReservationRecord> & { id: string; reference: string }): ReservationRecord {
  return {
    guestName: "Priya Sharma", mobile: "9898012345", email: null, companyId: null, roomTypeId: null, rooms: 1, plan: "CP", ratePaise: P(4050), adults: 1, children: 0, checkIn: "2026-10-12", checkOut: "2026-10-15",
    source: "company", status: "confirmed", siteEnquiryId: null, notes: null, cancelReason: null, createdBy: null, updatedBy: null, createdAt: T0, updatedAt: T0, version: 1, ...over,
  };
}

export function roomType(over: Partial<RoomTypeRecord> & { id: string; name: string }): RoomTypeRecord {
  return { totalCount: 3, sortOrder: 0, plans: [{ code: "CP", name: "With breakfast", singlePaise: null, doublePaise: P(4500), active: true, sortOrder: 0 }], ...over };
}

export const ORIGIN = "https://hms.test";
export function req(method: string, path: string, who: string | null, body?: unknown): Request {
  const h: Record<string, string> = { host: "hms.test", origin: ORIGIN };
  if (who) h["x-test-session"] = who;
  if (body !== undefined) h["content-type"] = "application/json";
  return new Request(`${ORIGIN}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
export const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: bodies are asserted field by field
export const json = async (res: Response) => (await res.json()) as any;

/** The current password the fake credential side accepts. */
export const CURRENT_PASSWORD = "Old@pass12";

/** A fresh hotel store, the portal services over it and the routes reading sessions from the map. */
export function wirePortal(
  sessions: ReadonlyMap<string, VerifiedSession>,
  now: () => Date,
  staff: Map<string, string> = new Map(),
  options: { memberships?: Memberships; mail?: MailQueue; central?: CentralProfilesUnit; photoName?: (userId: string) => Promise<string | null> } = {},
) {
  const hotel = createMemoryPortalHotel();
  const changed: string[] = [];
  configurePortal({
    guest: createGuestService({
      unit: hotel.unit,
      now,
      memberships: options.memberships,
      mail: options.mail,
      central: options.central,
      photoName: options.photoName,
      accounts: { lastLogins: async () => new Map() },
      credentials: {
        changeMyPassword: async (session, r) => {
          if (r.currentPassword !== CURRENT_PASSWORD) throw new AppError("INVALID_CREDENTIALS", "The current password is not correct.");
          changed.push(session.userId);
          return { changed: true, otherSessionsEnded: 0 };
        },
      },
    }),
    corporate: createCorporateService({ unit: hotel.unit, now, memberships: options.memberships, central: options.central, photoName: options.photoName, people: { get: async (ids) => new Map(ids.filter((i) => staff.has(i)).map((i) => [i, { id: i, name: staff.get(i) as string, roleKey: "editor", roleLevel: 2, deleted: false }])) } }),
  });
  configureRoutes({ resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: () => undefined }) });
  return { hotel, changed };
}
