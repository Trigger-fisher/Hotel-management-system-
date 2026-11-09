import "server-only";
import type { PortalRepo, PortalRepos } from "../portal";
import type { Unit } from "../types";
import { bindHotelRepos, type HotelData } from "./frontOffice";
import { bindNotifications, emptyNotificationsHotelData, type NotificationsHotelData } from "./notifications";
import { bindRoomService, emptyRoomServiceData, type RoomServiceData } from "./roomService";
import { createMemoryUnit, MemoryStore } from "./store";
import { bindSupport, emptySupportData, type SupportData } from "./supportRequests";

// The in-memory double of the portals' reads (repos/portal.ts), over the SAME hotel data as billing, the front office and companies. It keeps the
// rules of the real repository: live rows only, never a row billed to a company for a guest, digits-only mobile match, newest first, capped.

const copy = <T>(r: T): T => structuredClone(r);
const digits = (s: string | null | undefined): string => (s ?? "").replace(/\D/g, "");
const matches = (mobile: string | null, forms: readonly string[]): boolean => forms.length > 0 && forms.includes(digits(mobile));

function bindPortal(data: HotelData): PortalRepo {
  return {
    guestBills: async (forms, limit) =>
      data.bills
        .filter((b) => b.deletedAt === null && b.companyId === null && matches(b.mobileNumber, forms))
        .sort((a, b) => (a.billDate < b.billDate ? 1 : a.billDate > b.billDate ? -1 : b.entryNo - a.entryNo))
        .slice(0, limit)
        .map(copy),
    guestAdvances: async (forms, limit) =>
      data.advances
        .filter((a) => a.deletedAt === null && a.companyId === null && matches(a.mobileNumber, forms))
        .sort((a, b) => (a.paymentDate < b.paymentDate ? 1 : a.paymentDate > b.paymentDate ? -1 : b.entryNo - a.entryNo))
        .slice(0, limit)
        .map(copy),
    guestStays: async (forms, limit) =>
      data.stays
        .filter((s) => s.companyId === null && matches(s.mobile, forms))
        .sort((a, b) => b.checkInAt.getTime() - a.checkInAt.getTime() || (a.id < b.id ? 1 : -1))
        .slice(0, limit)
        .map(copy),
    companyReservations: async (companyId, limit) =>
      data.reservations
        .filter((r) => r.companyId === companyId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
        .slice(0, limit)
        .map(copy),
  };
}

/** One hotel's data for the portals: the hotel's own, the notifications and the room-service orders. */
export type PortalHotelData = NotificationsHotelData & RoomServiceData & SupportData;
const emptyPortalHotelData = (): PortalHotelData => ({ ...emptyNotificationsHotelData(), ...emptyRoomServiceData(), ...emptySupportData() });

const bindPortalHotel = (data: PortalHotelData): PortalRepos =>
  ({ ...bindHotelRepos(data), portal: bindPortal(data), notifications: bindNotifications(data), roomService: bindRoomService(data), supportRequests: bindSupport(data) }) as PortalRepos;

/** ONE in-memory hotel store with the portals' reads (and the notifications and room-service orders) on top (tests look inside through `store.dataFor`). */
export function createMemoryPortalHotel(): { store: MemoryStore<PortalHotelData>; unit: Unit<PortalRepos> } {
  const store = new MemoryStore<PortalHotelData>(emptyPortalHotelData);
  return { store, unit: createMemoryUnit(store, bindPortalHotel) };
}
