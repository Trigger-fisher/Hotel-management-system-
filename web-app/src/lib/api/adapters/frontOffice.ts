// Front Office (board, rooms, reservations, check-in, in-house stays, check-out) over the real server: /api/v1/front-office/... (docs/BACKEND.md,
// docs/specs/front-office.md). Same TypeScript interface as the mock (`createFrontOfficeApi`). The server's DTOs are the ui-shared types; the
// differences handled here:
//  - list `tab` is the server's `filter` (rooms) or `view` (reservations, stays);
//  - a reservation advance, a new charge and a removed charge answer with the advance / charge / id, the screens want the whole
//    reservation or stay: it is read again after the write (if that read fails the write has still happened; the screen reloads);
//  - deleting a room answers `{ id }`, the screen wants the room number for its toast: it is looked up first;
//  - the next bill number comes from the check-out defaults.
import type { DashResult } from '@shared/dashboards/common';
import type {
  BulkRoomsInput, CheckInInput, CheckOutInput, FrontOfficeApi, GuestDetailsInput, HkStatus, Reservation, ReservationInput, ReservationView, RoomInput, RoomList, Stay,
  StayView, AdvanceInput, ChargeInput, CheckoutDefaults, IdPhotoList, IdReading,
} from '@shared/dashboards/frontOffice';

import * as api from '../client';
import { pick, snapPageSize } from './payrollShared';

const id = encodeURIComponent;
const FO = '/front-office';

type Q = { search?: string; tab?: string; page?: number; pageSize?: number };

const ROOM_FILTERS = ['all', 'vacant', 'occupied', 'dirty', 'outOfOrder'] as const;
const RESERVATION_VIEWS: readonly ReservationView[] = ['upcoming', 'today', 'inHouse', 'past', 'cancelled', 'all'];
const STAY_VIEWS: readonly StayView[] = ['inHouse', 'past'];
const oneOf = <T extends string>(v: string | undefined, allowed: readonly T[]): T | undefined => (v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined);
const paged = (q: Q) => ({ search: q.search?.trim() || undefined, page: q.page, pageSize: snapPageSize(q.pageSize) });

const ROOM_KEYS = ['number', 'floor', 'roomTypeId', 'notes'] as const;
const BULK_KEYS = ['numbers', 'floor', 'roomTypeId'] as const;
const RESERVATION_KEYS = ['guestName', 'mobile', 'email', 'companyId', 'source', 'checkIn', 'checkOut', 'adults', 'children', 'roomTypeId', 'rooms', 'plan', 'ratePaise', 'notes'] as const;
const ADVANCE_KEYS = ['receiptNumber', 'paymentDate', 'hotelPaise', 'foodPaise', 'hotelMode', 'foodMode', 'instruction'] as const;
const CHECK_IN_KEYS = [
  'reservationId', 'roomId', 'expectedCheckOut', 'grNumber', 'adults', 'children', 'plan', 'ratePaise', 'guestName', 'mobile', 'email', 'address', 'city',
  'nationality', 'idProofType', 'idProofNumber', 'companyId', 'guestGstin', 'notes',
  // the main guest's further register fields; all optional
  'dateOfBirth', 'houseNo', 'locality', 'district', 'zipCode', 'state', 'country', 'phone', 'comingFrom', 'goingTo', 'vehicleType', 'vehicleRegistration', 'members',
] as const;
const CHARGE_KEYS = ['category', 'description', 'chargeDate', 'quantity', 'unitPricePaise'] as const;
const CHECK_OUT_KEYS = ['billNumber', 'billDate', 'hotelGstPercent', 'foodGstPercent', 'hotelMode', 'foodMode', 'instruction'] as const;

/**
 * A write whose answer is not what the screen wants: on success, read the whole thing again. The write has happened, so a failed read is
 * tried once more; if it still fails the screen is told the change was saved (not to retry it), so a charge is never added twice.
 */
async function thenRead<W, T>(write: Promise<DashResult<W>>, read: () => Promise<DashResult<T>>): Promise<DashResult<T>> {
  const w = await write;
  if (!w.ok) return w;
  const first = await read();
  if (first.ok) return first;
  await new Promise((r) => setTimeout(r, 400));
  const again = await read();
  if (again.ok) return again;
  return { ok: false, error: { ...again.error, message: 'Saved. The page could not refresh: reload it to see the change (do not save again).' } };
}

const getStay = (sid: string) => api.get<Stay>(`${FO}/stays/${id(sid)}`);
const getReservation = (rid: string) => api.get<Reservation>(`${FO}/reservations/${id(rid)}`);

/** The room's number for the "Room 101 removed" toast; the server's delete answers only the id. */
async function deleteRoom(rid: string): Promise<DashResult<{ number: string }>> {
  // There is no GET for one room and a page holds at most 100: walk the pages until the room is found.
  let number = '';
  for (let page = 1; page <= 50; page++) {
    const list = await api.get<RoomList>(`${FO}/rooms`, { page, pageSize: 100 });
    if (!list.ok) break;
    number = list.data.items.find((r) => r.id === rid)?.number ?? '';
    if (number || page * list.data.pageSize >= list.data.total) break;
  }
  const r = await api.del<{ id: string }>(`${FO}/rooms/${id(rid)}`);
  return r.ok ? { ok: true, data: { number } } : r;
}

export function createHttpFrontOfficeApi(): FrontOfficeApi {
  return {
    getOptions: () => api.get(`${FO}/options`),
    getBoard: () => api.get(`${FO}/board`),

    // rooms
    listRooms: (q: Q = {}) => api.get(`${FO}/rooms`, { filter: oneOf(q.tab, ROOM_FILTERS), ...paged(q) }),
    createRoom: (input: RoomInput) => api.post(`${FO}/rooms`, pick(input, ROOM_KEYS)),
    bulkAddRooms: (input: BulkRoomsInput) => api.post(`${FO}/rooms/bulk`, pick(input, BULK_KEYS)),
    updateRoom: (rid: string, input: RoomInput) => api.patch(`${FO}/rooms/${id(rid)}`, pick(input, ROOM_KEYS)),
    deleteRoom,
    setHousekeeping: (rid: string, hkStatus: HkStatus) => api.put(`${FO}/rooms/${id(rid)}/housekeeping`, { hkStatus }),
    setService: (rid: string, outOfOrder: boolean, reason = '') => api.put(`${FO}/rooms/${id(rid)}/service`, { outOfOrder, reason }),

    // reservations
    listReservations: (q: Q = {}) => api.get(`${FO}/reservations`, { view: oneOf(q.tab, RESERVATION_VIEWS), ...paged(q) }),
    getReservation,
    createReservation: (input: ReservationInput) => api.post(`${FO}/reservations`, pick(input, RESERVATION_KEYS)),
    updateReservation: (rid: string, input: ReservationInput) => api.patch(`${FO}/reservations/${id(rid)}`, { ...pick(input, RESERVATION_KEYS), version: input.version }),
    cancelReservation: (rid: string, input: { noShow: boolean; reason: string; version?: number }) =>
      api.post(`${FO}/reservations/${id(rid)}/cancel`, { noShow: input.noShow, reason: input.reason, version: input.version }),
    getCheckoutDefaults: (stayId?: string) => api.get(`${FO}/stays/checkout-defaults`, { stayId }),
    suggestReceiptNumber: () => api.get(`${FO}/reservations/receipt-number`),
    addAdvance: (rid: string, input: AdvanceInput) => thenRead(api.post(`${FO}/reservations/${id(rid)}/advances`, pick(input, ADVANCE_KEYS)), () => getReservation(rid)),

    // G2: guest requests
    listRequests: (q: Q = {}) => api.get(`${FO}/requests`, { view: q.tab === 'closed' ? 'closed' : 'open', ...paged(q) }),
    closeRequest: (rid: string, body: { status: 'done' | 'declined'; reply: string }) => api.post(`${FO}/requests/${id(rid)}/close`, body),

    // stays
    listStays: (q: Q = {}) => api.get(`${FO}/stays`, { view: oneOf(q.tab, STAY_VIEWS), ...paged(q) }),
    getStay,
    roomsToMove: (sid: string) => api.get(`${FO}/stays/${id(sid)}/rooms`),
    suggestBillNumber: () => api.dashMap<CheckoutDefaults, string>('GET', `${FO}/stays/checkout-defaults`, {}, (d) => d.suggestedBillNumber),
    getCheckInPrefill: (reservationId?: string) => api.get(`${FO}/stays/prefill`, { reservationId }),
    listCheckInReservations: () => api.get(`${FO}/reservations/check-in`),
    // the check-in form passes a timeout signal, so a stalled lookup is reported rather than left spinning (a GET with a signal skips the 20 s cache)
    lookupGuest: (mobile: string, signal?: AbortSignal) => api.get(`${FO}/guests/lookup`, { mobile }, signal),
    checkIn: (input: CheckInInput) => api.post(`${FO}/stays`, pick(input, CHECK_IN_KEYS)),
    addCharge: (sid: string, input: ChargeInput) => thenRead(api.post(`${FO}/stays/${id(sid)}/charges`, pick(input, CHARGE_KEYS)), () => getStay(sid)),
    removeCharge: (sid: string, chargeId: string) => thenRead(api.del(`${FO}/stays/${id(sid)}/charges/${id(chargeId)}`), () => getStay(sid)),
    moveRoom: (sid: string, input: { roomId: string; ratePaise: number | null; version?: number }) =>
      api.post(`${FO}/stays/${id(sid)}/move`, { roomId: input.roomId, ratePaise: input.ratePaise, version: input.version }),
    // one request for all the pictures of a check-in (a card's two sides, or several people); the screen's Cancel aborts it
    readId: (files: { fileName: string; dataBase64: string } | { fileName: string; dataBase64: string }[], signal?: AbortSignal) =>
      api.post<IdReading>(`${FO}/id-read`, { files: Array.isArray(files) ? files : [files] }, { signal }),
    putIdPhoto: (sid: string, file: { fileName: string; dataBase64: string }, version?: number) => api.put(`${FO}/stays/${id(sid)}/id-photo`, { ...file, version }),
    deleteIdPhoto: (sid: string, version?: number) => api.del(`${FO}/stays/${id(sid)}/id-photo`, { version }),
    listIdPhotos: (sid: string) => api.get<IdPhotoList>(`${FO}/stays/${id(sid)}/id-photos`),
    addIdPhoto: (sid: string, file: { fileName: string; dataBase64: string }, version?: number) => api.post<IdPhotoList>(`${FO}/stays/${id(sid)}/id-photos`, { ...file, version }),
    reorderIdPhotos: (sid: string, order: string[], version?: number) => api.put<IdPhotoList>(`${FO}/stays/${id(sid)}/id-photos`, { order, version }),
    removeIdPhotoAt: (sid: string, photoId: string, version?: number) => api.del<IdPhotoList>(`${FO}/stays/${id(sid)}/id-photos/${id(photoId)}`, { version }),
    revealStayIdNumbers: (sid: string) => api.post(`${FO}/stays/${id(sid)}/id-number`),
    updateGuestDetails: (sid: string, input: GuestDetailsInput, version?: number) => api.put(`${FO}/stays/${id(sid)}/guest-details`, { ...input, version }),
    extendStay: (sid: string, expectedCheckOut: string, version?: number) => api.post(`${FO}/stays/${id(sid)}/extend`, { expectedCheckOut, version }),
    checkOut: (sid: string, input: CheckOutInput) => api.post(`${FO}/stays/${id(sid)}/checkout`, { ...pick(input, CHECK_OUT_KEYS), version: input.version }),
  };
}
