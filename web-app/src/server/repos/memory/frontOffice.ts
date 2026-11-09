import "server-only";
import type { PayrollCoreRepos } from "../payrollCore";
import type { PayrollPayRepos } from "../payrollPay";
import type { AdminRepos } from "../admin";
import type { WebsiteRepos } from "../website";
import { bindAdmin, emptyAdminData, type AdminData } from "./admin";
import { bindWebsite, emptyWebsiteData, type WebsiteData } from "./website";
import { bindPayrollPay, emptyPayrollPayData, type PayrollPayData } from "./payrollPay";
import { bindPayrollCore, emptyPayrollData, type PayrollData } from "./payrollCore";
import { randomUUID } from "node:crypto";
import { cleanForIndex } from "../../crypto/fieldSeal";
import type { CompaniesRepos } from "../companies";
import type { ChargeRecord, EnquiryRecord, FrontOfficeRepos, GuestRequestRecord, ReservationRecord, ReservationView, RoomRecord, RoomTypeRecord, StayRecord, StayView } from "../frontOffice";
import { RepoError, type ListResult, type VersionedResult } from "../types";
import { bindBillingRepos, emptyBillingData, type BillingData } from "./billing";
import { bindCompanies, emptyCompaniesData, type CompaniesData } from "./companies";
import { createMemoryUnit, MemoryStore } from "./store";

// The in-memory double of the front-office repositories, in ONE data set per hotel together with billing's (check-out writes the bill in the
// same unit). It keeps the table rules of repos/frontOffice.ts: the one-in-house-stay-per-room index, unique room numbers and references,
// the version step on reservations and stays, hard deletes for rooms and charges, the reference number taken inside the unit. One unit runs
// at a time per hotel, so `forUpdate` needs nothing here.

interface FrontOfficeData {
  rooms: RoomRecord[];
  reservations: ReservationRecord[];
  stays: StayRecord[];
  charges: ChargeRecord[];
  roomTypes: RoomTypeRecord[];
  enquiries: EnquiryRecord[];
  idProofTypes: { name: string; active: boolean }[];
  settings: Map<string, string | null>;
  guestRequests: GuestRequestRecord[];
}
export type HotelData = BillingData & FrontOfficeData & CompaniesData & PayrollData & PayrollPayData & WebsiteData & AdminData;

export const emptyHotelData = (): HotelData => ({
  ...emptyBillingData(),
  ...emptyCompaniesData(),
  ...emptyPayrollData(),
  ...emptyPayrollPayData(),
  ...emptyWebsiteData(),
  ...emptyAdminData(),
  rooms: [],
  reservations: [],
  stays: [],
  charges: [],
  roomTypes: [],
  enquiries: [],
  idProofTypes: [],
  guestRequests: [],
  settings: new Map(),
});

const copy = <T>(r: T): T => structuredClone(r);
const lower = (s: string | null | undefined): string => (s ?? "").toLowerCase();
const hasEvery = (hay: string, words: readonly string[] | undefined): boolean => !words || words.every((w) => hay.includes(w));
const paged = <T>(rows: T[], p: { page: number; pageSize: number }): ListResult<T> => ({ rows: rows.slice((p.page - 1) * p.pageSize, p.page * p.pageSize).map(copy), total: rows.length });
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** The last ten digits of a mobile, as the *_mobile_last10_idx indexes see it. */
const last10 = (mobile: string | null): string => (mobile ?? "").replace(/[^0-9]/g, "").slice(-10);
const mobileEndsWith = (mobile: string | null, digits: string): boolean => mobile !== null && last10(mobile) !== "" && last10(mobile).endsWith(digits);
const digitsOf = (text: string | null): number => Number((text ?? "").replace(/[^0-9]/g, "") || 0);

function versioned<R extends { id: string; version: number; updatedAt: Date; updatedBy: string | null }>(rows: R[], id: string, expected: number, change: (row: R) => void): VersionedResult<R> {
  const row = rows.find((r) => r.id === id);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.version !== expected) return { ok: false, reason: "conflict", currentVersion: row.version };
  const before = copy(row);
  try {
    change(row);
  } catch (error) {
    Object.assign(row, before);
    throw error;
  }
  row.version += 1;
  row.updatedAt = new Date();
  return { ok: true, record: copy(row) };
}

function bindFrontOffice(data: HotelData): Omit<FrontOfficeRepos, keyof ReturnType<typeof bindBillingRepos>> {
  const roomNumberTaken = (n: string, except: string | null): void => {
    if (data.rooms.some((r) => r.id !== except && r.number.toLowerCase() === n.toLowerCase())) throw new RepoError("unique", "pms_rooms_number");
  };
  const oneInHouse = (stay: Pick<StayRecord, "id" | "roomId" | "status">): void => {
    if (stay.status === "in_house" && data.stays.some((s) => s.id !== stay.id && s.status === "in_house" && s.roomId === stay.roomId)) throw new RepoError("unique", "one_in_house_per_room");
  };
  const checkStay = (s: StayRecord): void => {
    if (s.ratePaise < BigInt(0)) throw new RepoError("check", "rate_paise >= 0");
    if (s.checkOutAt && s.checkOutAt < s.checkInAt) throw new RepoError("check", "pms_stays_actual_out_ck");
    oneInHouse(s);
  };
  const roomNumber = (id: string): string => data.rooms.find((r) => r.id === id)?.number ?? "";

  const reservationView = (r: ReservationRecord, view: ReservationView, today: string): boolean => {
    switch (view) {
      case "upcoming": return r.status === "confirmed";
      case "today": return r.status === "confirmed" && r.checkIn <= today;
      case "in_house": return r.status === "checked_in";
      case "past": return r.status === "checked_out";
      case "cancelled": return r.status === "cancelled" || r.status === "no_show";
      default: return true;
    }
  };
  const reservationOrder = (view: ReservationView) => (a: ReservationRecord, b: ReservationRecord): number => {
    const first =
      view === "upcoming" || view === "today" ? byText(b.checkIn, a.checkIn)
        : view === "in_house" ? byText(b.checkOut, a.checkOut)
          : view === "past" ? byText(b.checkOut, a.checkOut)
            : view === "cancelled" ? b.updatedAt.getTime() - a.updatedAt.getTime()
              : byText(b.checkIn, a.checkIn);
    // then newest first (orderByDesc('id'); ids are creation order)
    return first || b.createdAt.getTime() - a.createdAt.getTime() || byText(b.reference, a.reference);
  };
  const reservationWords = (r: ReservationRecord, words?: readonly string[]): boolean => hasEvery(lower([r.guestName, r.mobile, r.reference].join(" ")), words);
  const stayWords = (s: StayRecord, words?: readonly string[]): boolean => hasEvery(lower([s.guestName, s.mobile, s.grNumber, roomNumber(s.roomId)].join(" ")), words);

  return {
    rooms: {
      all: async () => [...data.rooms].sort((a, b) => a.sortOrder - b.sortOrder || byText(a.number, b.number)).map(copy),
      get: async (id) => {
        const r = data.rooms.find((x) => x.id === id);
        return r ? copy(r) : null;
      },
      existingNumbers: async (numbers) => data.rooms.filter((r) => numbers.some((n) => n.toLowerCase() === r.number.toLowerCase())).map((r) => r.number),
      maxSortOrder: async () => data.rooms.reduce((m, r) => Math.max(m, r.sortOrder), 0),
      create: async (input) => {
        roomNumberTaken(input.number, null);
        const now = new Date();
        const { createdBy, ...fields } = input;
        const row: RoomRecord = { ...fields, id: randomUUID(), createdBy, updatedBy: null, createdAt: now, updatedAt: now };
        data.rooms.push(row);
        return copy(row);
      },
      update: async (id, patch, actorId) => {
        const row = data.rooms.find((r) => r.id === id);
        if (!row) return null;
        if (patch.number !== undefined) roomNumberTaken(patch.number, id);
        Object.assign(row, patch, { updatedBy: actorId, updatedAt: new Date() });
        return copy(row);
      },
      delete: async (id) => {
        // pms_stays.room_id is ON DELETE RESTRICT
        if (data.stays.some((s) => s.roomId === id)) throw new RepoError("check", "pms_stays_room_id_fk");
        const i = data.rooms.findIndex((r) => r.id === id);
        if (i < 0) return false;
        data.rooms.splice(i, 1);
        return true;
      },
      hasStays: async (roomId) => data.stays.some((s) => s.roomId === roomId),
      withStays: async (roomIds) => new Set(roomIds.filter((id) => data.stays.some((s) => s.roomId === id))),
    },

    reservations: {
      get: async (id) => {
        const r = data.reservations.find((x) => x.id === id);
        return r ? copy(r) : null;
      },
      getMany: async (ids) => new Map(data.reservations.filter((r) => ids.includes(r.id)).map((r) => [r.id, copy(r)])),
      list: async (q) => paged(data.reservations.filter((r) => reservationView(r, q.view, q.today) && reservationWords(r, q.words)).sort(reservationOrder(q.view)), q),
      countByView: async (today, words) => {
        const views: ReservationView[] = ["upcoming", "today", "in_house", "past", "cancelled", "all"];
        return Object.fromEntries(views.map((v) => [v, data.reservations.filter((r) => reservationView(r, v, today) && reservationWords(r, words)).length])) as Record<ReservationView, number>;
      },
      arrivalsToday: async (date) => data.reservations.filter((r) => r.status === "confirmed" && r.checkIn === date).length,
      arrivals: async (today) => data.reservations.filter((r) => r.status === "confirmed" && r.checkIn <= today).sort((a, b) => byText(a.checkIn, b.checkIn) || byText(a.guestName, b.guestName)).map(copy),
      holding: async (roomTypeId, firstNight, lastNight, options) =>
        data.reservations
          .filter((r) => r.roomTypeId === roomTypeId && (r.status === "confirmed" || r.status === "checked_in") && r.checkIn <= lastNight && r.checkOut > firstNight)
          .filter((r) => r.id !== options?.ignoreId && (options?.countWebsite !== false || r.siteEnquiryId === null))
          .map((r) => ({ checkIn: r.checkIn, checkOut: r.checkOut, rooms: r.rooms })),
      byEnquiry: async (siteEnquiryId) => {
        const r = data.reservations.find((x) => x.siteEnquiryId === siteEnquiryId);
        return r ? copy(r) : null;
      },
      openForCheckIn: async (limit) => data.reservations.filter((r) => r.status === "confirmed" || r.status === "checked_in").sort((a, b) => byText(a.checkIn, b.checkIn)).slice(0, limit).map(copy),
      byMobileSuffix: async (digits, limit) => data.reservations.filter((r) => mobileEndsWith(r.mobile, digits)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit).map(copy),
      create: async (input) => {
        const { createdBy, year2, ...fields } = input;
        // one past the highest number of ANY reference (ruled; Pallav: the auto-increment id)
        const n = data.reservations.reduce((m, r) => Math.max(m, Number(/(\d+)$/.exec(r.reference)?.[1] ?? 0)), 0) + 1;
        const reference = `RES-${year2}-${String(n).padStart(5, "0")}`;
        if (data.reservations.some((r) => r.reference === reference)) throw new RepoError("unique", "pms_reservations_reference");
        if (fields.siteEnquiryId && data.reservations.some((r) => r.siteEnquiryId === fields.siteEnquiryId)) throw new RepoError("unique", "pms_reservations_site_enquiry_id");
        if (fields.checkOut <= fields.checkIn) throw new RepoError("check", "pms_reservations_dates_ck");
        const now = new Date();
        const row: ReservationRecord = { ...fields, id: randomUUID(), reference, createdBy, updatedBy: null, createdAt: now, updatedAt: now, version: 1 };
        data.reservations.push(row);
        return copy(row);
      },
      update: async (id, expectedVersion, patch, actorId) =>
        versioned(data.reservations, id, expectedVersion, (row) => {
          Object.assign(row, patch, { updatedBy: actorId });
          if (row.checkOut <= row.checkIn) throw new RepoError("check", "pms_reservations_dates_ck");
        }),
    },

    stays: {
      get: async (id) => {
        const s = data.stays.find((x) => x.id === id);
        return s ? copy(s) : null;
      },
      list: async (q) => {
        const rows = data.stays.filter((s) => s.status === (q.view === "past" ? "checked_out" : "in_house") && stayWords(s, q.words));
        rows.sort((a, b) => (q.view === "past" ? (b.checkOutAt?.getTime() ?? 0) - (a.checkOutAt?.getTime() ?? 0) : b.checkInAt.getTime() - a.checkInAt.getTime()) || b.createdAt.getTime() - a.createdAt.getTime());
        return paged(rows, q);
      },
      countByView: async (words) => {
        const views: StayView[] = ["in_house", "past"];
        return Object.fromEntries(views.map((v) => [v, data.stays.filter((s) => s.status === (v === "past" ? "checked_out" : "in_house") && stayWords(s, words)).length])) as Record<StayView, number>;
      },
      currentByRoom: async (roomIds) => {
        const out = new Map<string, StayRecord>();
        for (const s of data.stays) if (s.status === "in_house" && roomIds.includes(s.roomId)) out.set(s.roomId, copy(s));
        return out;
      },
      departures: async (today) => data.stays.filter((s) => s.status === "in_house" && s.expectedCheckOut <= today).sort((a, b) => byText(a.expectedCheckOut, b.expectedCheckOut)).map(copy),
      inHouseCount: async () => data.stays.filter((s) => s.status === "in_house").length,
      byReservation: async (ids) => {
        const out = new Map<string, StayRecord[]>(ids.map((id) => [id, []]));
        for (const s of data.stays) if (s.reservationId && out.has(s.reservationId)) out.get(s.reservationId)?.push(copy(s));
        return out;
      },
      sameIdInHouse: async (idNumber, exceptId) => {
        const clean = cleanForIndex(idNumber);
        if (clean === "") return [];
        return data.stays.filter((s) => s.status === "in_house" && s.id !== exceptId && s.idProofNumber !== null && cleanForIndex(s.idProofNumber) === clean).sort((a, b) => b.checkInAt.getTime() - a.checkInAt.getTime()).slice(0, 5).map(copy);
      },
      walkInsOfType: async (roomTypeId) => {
        const rooms = new Set(data.rooms.filter((r) => r.roomTypeId === roomTypeId).map((r) => r.id));
        return data.stays.filter((s) => s.reservationId === null && s.status === "in_house" && rooms.has(s.roomId)).map(copy);
      },
      byMobileSuffix: async (digits, limit) => data.stays.filter((s) => mobileEndsWith(s.mobile, digits)).sort((a, b) => b.checkInAt.getTime() - a.checkInAt.getTime() || b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit).map(copy),
      highestGrNumber: async () => data.stays.reduce((m, s) => Math.max(m, digitsOf(s.grNumber)), 0),
      create: async (input) => {
        const now = new Date();
        const { createdBy, ...fields } = input;
        const row: StayRecord = { ...copy(fields), id: randomUUID(), createdBy, updatedBy: null, createdAt: now, updatedAt: now, version: 1 };
        checkStay(row);
        data.stays.push(row);
        return copy(row);
      },
      update: async (id, expectedVersion, patch, actorId) =>
        versioned(data.stays, id, expectedVersion, (row) => {
          Object.assign(row, copy(patch), { updatedBy: actorId });
          checkStay(row);
        }),
    },

    charges: {
      forStays: async (stayIds) => {
        const out = new Map<string, ChargeRecord[]>(stayIds.map((id) => [id, []]));
        const rows = data.charges.filter((c) => out.has(c.stayId)).sort((a, b) => byText(a.chargeDate, b.chargeDate) || a.createdAt.getTime() - b.createdAt.getTime());
        for (const c of rows) out.get(c.stayId)?.push(copy(c));
        return out;
      },
      get: async (id) => {
        const c = data.charges.find((x) => x.id === id);
        return c ? copy(c) : null;
      },
      create: async (input) => {
        if (input.amountPaise < BigInt(0) || input.unitPricePaise < BigInt(0)) throw new RepoError("check", "pms_charges amounts >= 0");
        const row: ChargeRecord = { ...input, id: randomUUID(), createdAt: new Date() };
        data.charges.push(row);
        return copy(row);
      },
      delete: async (id) => {
        const i = data.charges.findIndex((c) => c.id === id);
        if (i < 0) return false;
        data.charges.splice(i, 1);
        return true;
      },
    },

    roomTypes: {
      all: async () => [...data.roomTypes].sort((a, b) => a.sortOrder - b.sortOrder || byText(a.name, b.name)).map(copy),
      get: async (id) => {
        const t = data.roomTypes.find((x) => x.id === id);
        return t ? copy(t) : null;
      },
    },
    enquiries: {
      get: async (id) => {
        const e = data.enquiries.find((x) => x.id === id);
        return e ? copy(e) : null;
      },
      getMany: async (ids) => new Map(data.enquiries.filter((e) => ids.includes(e.id)).map((e) => [e.id, copy(e)])),
    },
    guestRequests: {
      get: async (id) => {
        const r = data.guestRequests.find((x) => x.id === id);
        return r ? copy(r) : null;
      },
      byStay: async (stayId) => data.guestRequests.filter((r) => r.stayId === stayId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map(copy),
      list: async (q) => {
        const rows = data.guestRequests.filter((r) => (q.view === "open") === (r.status === "open"));
        rows.sort((a, b) => (q.view === "open" ? a.createdAt.getTime() - b.createdAt.getTime() : (b.doneAt?.getTime() ?? 0) - (a.doneAt?.getTime() ?? 0)));
        return paged(rows, q);
      },
      countOpen: async () => data.guestRequests.filter((r) => r.status === "open").length,
      create: async (input) => {
        if (!data.stays.some((s) => s.id === input.stayId)) throw new RepoError("check", "guest_requests_stay_id_fkey");
        const row: GuestRequestRecord = { id: randomUUID(), stayId: input.stayId, kind: input.kind, note: input.note, status: "open", reply: null, createdBy: input.createdBy, doneBy: null, doneAt: null, createdAt: new Date() };
        data.guestRequests.push(row);
        return copy(row);
      },
      close: async (id, next) => {
        const r = data.guestRequests.find((x) => x.id === id && x.status === "open");
        if (!r) return null;
        Object.assign(r, { status: next.status, reply: next.reply, doneBy: next.doneBy, doneAt: next.doneAt });
        return copy(r);
      },
    },
    idProofTypes: { activeNames: async () => data.idProofTypes.filter((t) => t.active).map((t) => t.name).sort(byText) },
    settings: { values: async (keys) => new Map(keys.map((k) => [k, data.settings.get(k) ?? null])) },
  };
}

/** Every repository of one hotel's database: billing, front office, companies and payroll share the data (one unit = one transaction). */
export const bindHotelRepos = (data: HotelData): FrontOfficeRepos & CompaniesRepos & PayrollCoreRepos & PayrollPayRepos & WebsiteRepos & AdminRepos => ({ ...bindBillingRepos(data), ...bindFrontOffice(data), ...bindCompanies(data), ...bindPayrollCore(data), ...bindPayrollPay(data), ...bindWebsite(data), ...bindAdmin(data) });

/** ONE in-memory store for the hotel's billing, front-office and companies tables (tests look inside a hotel through `store.dataFor`). */
export function createMemoryHotel() {
  const store = new MemoryStore<HotelData>(emptyHotelData);
  return { store, unit: createMemoryUnit(store, bindHotelRepos) };
}
