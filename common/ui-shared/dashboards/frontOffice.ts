// Front Office (PMS) module contract: types, mock API, copy and mock data.
// Source: Hotel Pallav front office (room board, rooms, reservations, check-in, stays, check-out).
// Pure TypeScript. Money in paise, stay nights as plain dates (YYYY-MM-DD), timestamps as ISO (UTC).
// ID numbers are stored as entered; printed copies show only the last 4 digits.

import type { Page, Tone } from './common';
import type { createFrontOfficeApi } from './frontOffice.mock';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** What the board shows for a room. */
export type RoomState = 'vacant' | 'occupied' | 'dirty' | 'outOfOrder';
export type HkStatus = 'clean' | 'dirty';

/** Plan codes: the four usual ones, but any plan code text is accepted (the website's own plans; request 3). */
export type MealPlanCode = 'EP' | 'CP' | 'MAP' | 'AP' | (string & {});

export interface MealPlan {
  code: MealPlanCode;
  name: string;
  /** Rate per room per night for one adult. */
  singlePaise: number;
  /** Rate per room per night for two adults. */
  doublePaise: number;
}

/** A room category (the same ones the website sells). */
export interface RoomType {
  id: string;
  name: string;
  plans: MealPlan[];
}

export interface CompanyOption {
  id: string;
  name: string;
}

export interface Room {
  id: string;
  number: string;
  floor: string | null;
  roomTypeId: string | null;
  roomTypeName: string | null;
  notes: string;
  hkStatus: HkStatus;
  outOfOrder: boolean;
  outOfOrderReason: string | null;
  /** True once any guest has stayed in it (then it cannot be deleted). */
  hasHistory: boolean;
  /** The guest in it now. */
  currentStay: { id: string; guestName: string; expectedCheckOut: string } | null;
  state: RoomState;
}

export interface RoomInput {
  number: string;
  floor: string;
  roomTypeId: string;
  notes: string;
}

export interface BulkRoomsInput {
  /** "101-110, 112, 115" */
  numbers: string;
  floor: string;
  roomTypeId: string;
}

export interface BulkRoomsResult {
  added: number;
  skipped: string[];
}

export type ReservationStatus = 'confirmed' | 'checkedIn' | 'checkedOut' | 'cancelled' | 'noShow';
export type ReservationSource = 'walkIn' | 'phone' | 'website' | 'company' | 'agent' | 'other';
export type ReservationView = 'upcoming' | 'today' | 'inHouse' | 'past' | 'cancelled' | 'all';

/** A payment taken against a reservation (kept in Guest Advances). */
export interface Advance {
  id: string;
  receiptNumber: string;
  paymentDate: string;
  hotelPaise: number;
  foodPaise: number;
  hotelMode: string;
  foodMode: string;
  instruction: string;
  /** What is still unused (not refunded, not taken off a bill). */
  balancePaise: number;
  refunded: boolean;
}

export interface AdvanceInput {
  receiptNumber: string;
  paymentDate: string;
  hotelPaise: number | null;
  foodPaise: number | null;
  hotelMode: string;
  foodMode: string;
  instruction: string;
}

export interface ReservationStayLink {
  id: string;
  guestName: string;
  roomNumber: string;
  status: StayStatus;
}

export interface Reservation {
  id: string;
  /** Row version (MJ #14): send it on edit, cancel and no-show. */
  version: number;
  /** RES-26-00042 */
  reference: string;
  guestName: string;
  mobile: string;
  email: string;
  companyId: string | null;
  companyName: string | null;
  roomTypeId: string;
  roomTypeName: string;
  rooms: number;
  plan: string;
  /** Per room per night. */
  ratePaise: number;
  adults: number;
  children: number;
  checkIn: string;
  checkOut: string;
  nights: number;
  /** nights x rooms x rate, before tax and extras. */
  roomTotalPaise: number;
  source: ReservationSource;
  /** Website enquiry it came from, if any. */
  enquiryRef: string | null;
  notes: string;
  status: ReservationStatus;
  cancelReason: string | null;
  advances: Advance[];
  advancePaidPaise: number;
  advanceBalancePaise: number;
  stays: ReservationStayLink[];
  createdAt: string;
}

export interface ReservationInput {
  guestName: string;
  mobile: string;
  email: string;
  companyId: string;
  source: ReservationSource;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  roomTypeId: string;
  rooms: number;
  plan: string;
  ratePaise: number | null;
  notes: string;
  /** Required on EDIT: the version the user saw. */
  version?: number;
}

export type ChargeCategory = 'food' | 'roomService' | 'laundry' | 'extraBed' | 'other';
/** The book a charge goes into. */
export type ChargeSide = 'hotel' | 'food';

export interface Charge {
  id: string;
  category: ChargeCategory;
  side: ChargeSide;
  description: string;
  chargeDate: string;
  quantity: number;
  unitPricePaise: number;
  amountPaise: number;
}

export interface ChargeInput {
  category: ChargeCategory;
  description: string;
  chargeDate: string;
  /** At most 2 decimal places (the column is decimal(8,2)); a third is refused, never rounded (request 7). */
  quantity: number;
  unitPricePaise: number | null;
}

export type StayStatus = 'inHouse' | 'checkedOut';
export type StayView = 'inHouse' | 'past';

export interface StayBill {
  billNumber: string;
  billDate: string;
  hotelGstPercent: number;
  foodGstPercent: number;
  totals: FolioTotals;
}

export interface Stay extends GuestRegisterFields {
  id: string;
  /** Row version (MJ #14): send it on move, extend and check-out. */
  version: number;
  reservationId: string | null;
  reservationRef: string | null;
  roomId: string;
  roomNumber: string;
  roomTypeId: string | null;
  roomTypeName: string | null;
  /** Guest register number. */
  grNumber: string;
  guestName: string;
  mobile: string;
  email: string;
  address: string;
  city: string;
  nationality: string;
  idProofType: string;
  /** As the server sends it: only the last 4 characters ("••••9012") when `idProofMasked` is true (decision 74); the whole number comes from `revealStayIdNumbers`. The mock sends it whole. */
  idProofNumber: string;
  /** True when `idProofNumber` is the shortened form. */
  idProofMasked?: boolean;
  /** The duplicate warning (decision 74): other guests in the house with this same main ID number (a stay that is in house only). Absent or empty = none. Never blocks anything. */
  sameIdElsewhere?: { stayId: string; roomNumber: string; guestName: string }[];
  companyId: string | null;
  companyName: string | null;
  guestGstin: string;
  adults: number;
  children: number;
  plan: string;
  ratePaise: number;
  checkInAt: string;
  /** Plain date of arrival (IST). */
  checkInDate: string;
  expectedCheckOut: string;
  checkOutAt: string | null;
  status: StayStatus;
  notes: string;
  /** The other guests of the room; empty when none were entered. */
  members: StayMember[];
  /** The main guest's ID photo is stored (members have none). */
  hasIdPhoto: boolean;
  charges: Charge[];
  /** Nights so far (to today while in house), at least 1. */
  nights: number;
  roomChargePaise: number;
  hotelExtrasPaise: number;
  foodPaise: number;
  /** Room + every charge, before tax. */
  totalSoFarPaise: number;
  /** The reservation's unused advance, taken off at check-out. */
  advancePaise: number;
  bill: StayBill | null;
}

/** Another guest staying in the room. No ID photo for members. */
export interface StayMemberInput {
  fullName: string;
  mobile: string;
  idType: string;
  idNumber: string;
}

/** A member as the stay returns it ("" when not given); `idNumber` is its last 4 characters when `idMasked` is true (decision 74). */
export type StayMember = StayMemberInput & { idMasked?: boolean };

/** The whole ID numbers of a stay (Show): the main guest's and each other guest's, in the stay's order. */
export interface StayIdNumbers {
  idProofNumber: string;
  members: { idNumber: string }[];
}

/** The main guest's further register fields, all strings, "" when not given. */
export interface GuestRegisterFields {
  dateOfBirth: string;
  houseNo: string;
  locality: string;
  district: string;
  zipCode: string;
  state: string;
  country: string;
  phone: string;
  comingFrom: string;
  goingTo: string;
  /** '' or one of the vehicle types. */
  vehicleType: string;
  vehicleRegistration: string;
}

export const EMPTY_REGISTER_FIELDS: GuestRegisterFields = {
  dateOfBirth: '', houseNo: '', locality: '', district: '', zipCode: '', state: '', country: '', phone: '', comingFrom: '', goingTo: '', vehicleType: '', vehicleRegistration: '',
};

/** PUT /front-office/stays/{id}/guest-details: replaces the whole set (the 12 fields and the members). Allowed in house or after check-out. */
export interface GuestDetailsInput extends GuestRegisterFields, MainGuestFields {
  members: StayMemberInput[];
}

/** The main guest's own stay fields, editable after check-in in the same call (the stay answer names them idProofType / idProofNumber / email / address / city). */
export interface MainGuestFields {
  idProofType: string;
  idProofNumber: string;
  email: string;
  address: string;
  city: string;
}

export interface CheckInInput extends Partial<GuestRegisterFields> {
  reservationId: string;
  roomId: string;
  expectedCheckOut: string;
  grNumber: string;
  adults: number;
  children: number;
  plan: string;
  ratePaise: number | null;
  guestName: string;
  mobile: string;
  email: string;
  address: string;
  city: string;
  nationality: string;
  idProofType: string;
  /** Typed in full at the desk and stored as entered; printed copies show only the last 4 digits. */
  idProofNumber: string;
  companyId: string;
  guestGstin: string;
  notes: string;
  /** The other guests of the room. */
  members?: StayMemberInput[];
  // The register fields (GuestRegisterFields) are all optional here.
}

export interface CheckInPrefill {
  reservation: Reservation | null;
  /** Guests of this reservation already in. */
  alreadyIn: number;
  /** Free rooms: the reserved category first, clean before needing cleaning. */
  rooms: Room[];
  /** The next guest-register number, given by HMS; the desk may still change it. */
  suggestedGrNumber?: string;
}

/** A past guest of this hotel found by mobile number (GET /front-office/guests/lookup?mobile=). */
export interface GuestLookupMatch {
  guestName: string;
  mobile: string;
  email: string;
  address: string;
  city: string;
  nationality: string;
  idProofType: string;
  idProofNumber: string;
  dateOfBirth: string;
  /** Stays at this hotel so far. */
  stays: number;
  lastRoomNumber: string | null;
  lastCheckOut: string | null;
  companyId: string | null;
}

export interface GuestLookupResult {
  matches: GuestLookupMatch[];
}

/** Room GST since 22 Sep 2025: 5% at or under ₹7,500 a night, 18% above. The hotel may change the limit in Settings. */
export const GST_SLAB_LIMIT_PAISE = 750_000;
export function gstSlabPercent(ratePaise: number | null, limitPaise: number = GST_SLAB_LIMIT_PAISE): 5 | 18 {
  return ratePaise !== null && ratePaise > limitPaise ? 18 : 5;
}

export interface CheckOutInput {
  billNumber: string;
  billDate: string;
  hotelGstPercent: number;
  foodGstPercent: number;
  hotelMode: string;
  foodMode: string;
  instruction: string;
  /** The stay's version the user saw. */
  version?: number;
}

/** Check-out form defaults from the server (GET /stays/checkout-defaults; request 3 and 5). */
export interface CheckoutDefaults {
  /** Hotel setting (MJ #19): pre-filled HOTEL-side GST percent (default 5), editable 0 to 28. */
  hotelGstPercent: number;
  /** Hotel setting (MJ #19): pre-filled FOOD-side GST percent (default 5), editable 0 to 28. */
  foodGstPercent: number;
  /** One past the highest bill number typed this year (Pallav Billing::suggest). */
  suggestedBillNumber: string;
}

/** Result of cancelling or marking a no-show (request 4). */
export interface CancelResult {
  reservation: Reservation;
  /** Pallav's sentence about an advance still held, or null. */
  notice: string | null;
}

export interface FolioTotals {
  roomPaise: number;
  hotelExtrasPaise: number;
  /** Room + hotel extras. */
  hotelPaise: number;
  foodPaise: number;
  subtotalPaise: number;
  hotelGstPaise: number;
  foodGstPaise: number;
  grandTotalPaise: number;
  advancePaise: number;
  /** Grand total less the advance (never below zero). */
  payablePaise: number;
}

export interface BoardStats {
  rooms: number;
  occupied: number;
  vacant: number;
  dirty: number;
  outOfOrder: number;
  /** Occupied as % of rooms in service. */
  occupancy: number;
}

export interface Board {
  floors: { floor: string; rooms: Room[] }[];
  stats: BoardStats;
  /** Confirmed reservations due today or earlier. */
  arrivals: Reservation[];
  /** In-house stays due out today or earlier. */
  departures: Stay[];
  inHouse: number;
}

export interface FrontOfficeOptions {
  roomTypes: RoomType[];
  companies: CompanyOption[];
  idTypes: string[];
  paymentModes: string[];
}

export type ReservationPage = Page<Reservation> & { counts: Record<ReservationView, number> };
export type StayPage = Page<Stay> & { counts: Record<StayView, number> };
export type RoomFilter = 'all' | RoomState;
export type RoomList = Page<Room> & { counts: Record<RoomFilter, number> };

/* ------------------------------------------------------------------ */
/* Labels, tones and pure helpers                                      */
/* ------------------------------------------------------------------ */

export const roomStateLabel: Record<RoomState, string> = {
  vacant: 'Vacant',
  occupied: 'Occupied',
  dirty: 'Needs cleaning',
  outOfOrder: 'Out of order',
};

export const roomStateTone: Record<RoomState, Tone> = {
  vacant: 'success',
  occupied: 'graphite',
  dirty: 'warning',
  outOfOrder: 'danger',
};

export const reservationStatusLabel: Record<ReservationStatus, string> = {
  confirmed: 'Confirmed',
  checkedIn: 'Checked in',
  checkedOut: 'Checked out',
  cancelled: 'Cancelled',
  noShow: 'No show',
};

export const reservationStatusTone: Record<ReservationStatus, Tone> = {
  confirmed: 'graphite',
  checkedIn: 'success',
  checkedOut: 'info',
  cancelled: 'danger',
  noShow: 'danger',
};

export const stayStatusLabel: Record<StayStatus, string> = { inHouse: 'In house', checkedOut: 'Checked out' };
export const stayStatusTone: Record<StayStatus, Tone> = { inHouse: 'success', checkedOut: 'info' };

export const reservationSourceLabel: Record<ReservationSource, string> = {
  walkIn: 'Walk-in',
  phone: 'Phone',
  website: 'Website',
  company: 'Company',
  agent: 'Travel agent',
  other: 'Other',
};

export const reservationViews: { id: ReservationView; label: string }[] = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'today', label: 'Arriving today' },
  { id: 'inHouse', label: 'In house' },
  { id: 'past', label: 'Checked out' },
  { id: 'cancelled', label: 'Cancelled / no show' },
  { id: 'all', label: 'All' },
];

export const chargeCategories: Record<ChargeCategory, { label: string; side: ChargeSide }> = {
  food: { label: 'Restaurant / food', side: 'food' },
  roomService: { label: 'Room service', side: 'food' },
  laundry: { label: 'Laundry', side: 'hotel' },
  extraBed: { label: 'Extra bed', side: 'hotel' },
  other: { label: 'Other', side: 'hotel' },
};

export const chargeSideLabel: Record<ChargeSide, string> = { hotel: 'Hotel', food: 'Food' };

/** Today's plain date in IST (YYYY-MM-DD). */
export function todayIst(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

/** Add days to a plain date. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Whole days from a to b (plain dates). */
export function daysBetween(a: string, b: string): number {
  const p = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((p(b) - p(a)) / 86_400_000);
}

/** IST plain date of an ISO timestamp. */
export function istDate(iso: string): string {
  return new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

export function isPlainDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "1st", "2nd", "3rd", "4th" ... "11th", "12th", "13th", "21st", "112th". */
export function ordinal(n: number): string {
  const v = n % 100;
  const s = v > 10 && v < 14 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${s}`;
}

/** "Aadhaar 2341 0000 4821" style text for an ID (the full number is stored). */
export function maskedId(type: string, number: string): string {
  if (!type && !number) return '';
  return number ? `${type || 'ID'} ${number}` : type;
}

/** Last 4 characters of an ID number, digits and letters only. */
export function idLast4(raw: string): string {
  return raw.replace(/[^0-9A-Za-z]/g, '').slice(-4).toUpperCase();
}

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export function isGstin(s: string): boolean {
  return GSTIN_RE.test(s.trim().toUpperCase());
}

/** Bill totals for a stay at the given GST rates. */
export function folioTotals(stay: Pick<Stay, 'roomChargePaise' | 'hotelExtrasPaise' | 'foodPaise' | 'advancePaise'>, hotelGstPercent: number, foodGstPercent: number): FolioTotals {
  const hotelPaise = stay.roomChargePaise + stay.hotelExtrasPaise;
  const hotelGstPaise = Math.round((hotelPaise * hotelGstPercent) / 100);
  const foodGstPaise = Math.round((stay.foodPaise * foodGstPercent) / 100);
  const subtotalPaise = hotelPaise + stay.foodPaise;
  const grandTotalPaise = subtotalPaise + hotelGstPaise + foodGstPaise;
  return {
    roomPaise: stay.roomChargePaise,
    hotelExtrasPaise: stay.hotelExtrasPaise,
    hotelPaise,
    foodPaise: stay.foodPaise,
    subtotalPaise,
    hotelGstPaise,
    foodGstPaise,
    grandTotalPaise,
    advancePaise: stay.advancePaise,
    payablePaise: Math.max(0, grandTotalPaise - stay.advancePaise),
  };
}

/** The rate a plan suggests for the number of adults. */
export function planRate(plan: MealPlan, adults: number): number {
  return adults <= 1 ? plan.singlePaise : plan.doublePaise;
}

/* ------------------------------------------------------------------ */
/* Copy                                                                */
/* ------------------------------------------------------------------ */

export const frontOfficeCopy = {
  board: {
    title: 'Room board',
    subtitle: 'Every room at a glance. Tap a room to check a guest in, open their account, or change its state.',
    rooms: 'Rooms',
    floor: (f: string) => (/^\d+$/.test(f) ? `Floor ${f}` : f),
    noCategory: 'No category',
    until: (d: string) => `until ${d}`,
    dueOut: 'Due out',
    arriving: 'Arriving',
    leaving: 'Leaving',
    noArrivals: 'Nobody else is due today.',
    noDepartures: 'Nobody is due to leave today.',
    dueOn: (d: string) => `due ${d}`,
    wasDue: (d: string) => `was due ${d}`,
    checkIn: 'Check in',
    checkOut: 'Check out',
    newReservation: 'New reservation',
    walkIn: 'Walk-in',
    guestsInHouse: 'Guests in the house',
    kpi: {
      occupancy: 'Occupancy',
      ready: 'Ready to sell',
      dirty: 'Needs cleaning',
      today: 'Arriving / leaving',
    },
    occupancyFoot: (occ: number, inService: number) => `${occ} of ${inService} rooms in service`,
    emptyTitle: 'No rooms set up yet',
    emptyBody: "Add the hotel's room numbers first, each with its category.",
    setUpRooms: 'Set up rooms',
    roomActionsTitle: (n: string) => `Room ${n}`,
    markClean: 'Mark clean',
    markDirty: 'Mark dirty',
    backInService: 'Back in service',
    openRooms: 'Open rooms list',
    oooBody: (reason: string | null) => (reason ? `Out of order: ${reason}` : 'Out of order.'),
  },
  rooms: {
    title: 'Rooms',
    subtitle: "The hotel's rooms. Each belongs to a room category, which is what reservations book.",
    add: 'Add room',
    addSeveral: 'Add several',
    tabs: { all: 'All', vacant: 'Vacant', occupied: 'Occupied', dirty: 'Needs cleaning', outOfOrder: 'Out of order' } satisfies Record<RoomFilter, string>,
    searchPlaceholder: 'Search room, floor, category, guest…',
    summary: (n: number) => plural(n, 'room'),
    cols: { room: 'Room', floor: 'Floor', category: 'Category', now: 'Now', housekeeping: 'Housekeeping', actions: 'Actions' },
    notSet: 'Not set',
    vacant: 'Vacant',
    clean: 'Clean',
    dirty: 'Dirty',
    markClean: 'Mark clean',
    markDirty: 'Mark dirty',
    sheetTitle: (n: string) => `Room ${n}`,
    outOfOrder: 'Out of order',
    backInService: 'Back in service',
    edit: 'Edit',
    delete: 'Delete',
    emptyTitle: 'No rooms yet',
    emptyBody: 'Add the room numbers, one by one or several at once ("101-110").',
    noMatchTitle: 'No rooms match',
    noMatchBody: 'Try another search or filter.',
    form: {
      addTitle: 'Add a room',
      editTitle: (n: string) => `Edit room ${n}`,
      number: 'Room number',
      numberPh: 'e.g. 101',
      floor: 'Floor',
      floorPh: 'e.g. 1',
      category: 'Category',
      note: 'Note',
      notePh: 'e.g. Sea-facing, near the lift',
      save: 'Save',
      cancel: 'Cancel',
    },
    bulk: {
      title: 'Add several rooms',
      numbers: 'Room numbers',
      numbersPh: '101-110, 112, 115',
      hint: 'A range with a dash, or numbers separated by commas. Numbers already there are skipped.',
      submit: 'Add rooms',
    },
    ooo: {
      title: (n: string) => `Take room ${n} out of order`,
      reason: 'Reason',
      reasonPh: 'e.g. AC repair',
      hint: 'The room is not offered to guests or reservations until it is back in service.',
      submit: 'Take out of order',
    },
    deleteTitle: (n: string) => `Delete room ${n}?`,
    deleteBody: 'It has no guests on record, so it can be removed. This cannot be undone.',
    toast: {
      added: (n: string) => `Room ${n} added.`,
      updated: (n: string) => `Room ${n} updated.`,
      removed: (n: string) => `Room ${n} removed.`,
      bulk: (added: number, skipped: string[]) =>
        `${plural(added, 'room')} added.${skipped.length ? ` Already there: ${skipped.join(', ')}.` : ''}`,
      nowClean: (n: string) => `Room ${n} is now clean.`,
      nowDirty: (n: string) => `Room ${n} is now dirty.`,
      ooo: (n: string) => `Room ${n} is out of order.`,
      back: (n: string) => `Room ${n} is back in service.`,
    },
    noTypesWarning: 'There are no room categories yet. Add them under Website › Rooms so each room can be given one.',
  },
  reservations: {
    title: 'Reservations',
    subtitle: 'Rooms booked for coming dates. Open one to take an advance, change it, cancel it or check the guest in.',
    newReservation: 'New reservation',
    searchPlaceholder: 'Search name, mobile, reference…',
    summary: (n: number) => plural(n, 'reservation'),
    cols: { guest: 'Guest', reference: 'Reference', room: 'Room', stay: 'Stay', advance: 'Advance', status: 'Status' },
    roomsOf: (n: number, type: string) => `${n} × ${type}`,
    guests: (a: number, c: number) => `${plural(a, 'adult')}${c ? `, ${plural(c, 'child', 'children')}` : ''}`,
    nightsAt: (n: number, rate: string) => `${plural(n, 'night')} @ ${rate}`,
    emptyTitle: 'Nothing here',
    emptyBody: 'Reservations made here, and website enquiries once confirmed, appear in this list.',
  },
  reservation: {
    title: (ref: string) => `Reservation ${ref}`,
    booking: 'The booking',
    checkIn: 'Check in',
    edit: 'Edit',
    k: {
      guest: 'Guest',
      mobile: 'Mobile',
      email: 'Email',
      company: 'Company',
      rooms: 'Rooms',
      guests: 'Guests',
      stay: 'Stay',
      planRate: 'Plan and rate',
      roomTotal: 'Room total',
      source: 'Source',
      reason: 'Reason',
      notes: 'Notes',
    },
    perRoomNight: 'per room per night',
    beforeTax: 'before tax and extras',
    fromEnquiry: (ref: string) => `website enquiry ${ref}`,
    guestsIn: 'Guests checked in',
    advances: 'Advances',
    advancesSub: 'Kept in Guest Advances',
    noAdvance: 'No advance taken yet.',
    paidInAdvance: 'Paid in advance',
    left: (amt: string) => `left ${amt}`,
    refunded: 'refunded',
    takeAdvance: 'Take advance',
    cancelCard: 'Cancel',
    cancelHint: 'The rooms are free again for these dates.',
    cancel: 'Cancel reservation',
    noShow: 'Guest did not arrive (no-show)',
    cancelTitle: (ref: string) => `Cancel ${ref}?`,
    cancelReason: 'Reason',
    cancelReasonPh: 'Why is it cancelled?',
    cancelConfirmBody: 'The rooms are free again for these dates.',
    noShowTitle: 'Mark as no-show?',
    noShowBody: 'The guest did not arrive; the rooms are free again.',
    keep: 'Keep it',
    advanceForm: {
      title: 'Take an advance',
      receipt: 'Receipt number',
      date: 'Date',
      hotel: 'Room (hotel)',
      food: 'Food',
      paidBy: 'Paid by',
      instruction: 'Instruction',
      submit: 'Record advance',
      needAmount: 'Enter how much the guest paid.',
    },
    toast: {
      cancelled: 'Reservation cancelled.',
      noShow: 'Marked as no-show.',
      refundHint: ' It still has an advance: refund it from Guest Advances if it is to be returned.',
      advance: (receipt: string, ref: string) => `Advance ${receipt} recorded against ${ref}.`,
    },
    locked: 'A reservation that is finished or cancelled cannot be changed.',
  },
  reservationForm: {
    newTitle: 'New reservation',
    editTitle: (ref: string) => `Edit ${ref}`,
    pageSub: 'Guest first, then dates and room. A draft is kept until you save.',
    guestSection: 'Guest',
    staySection: 'Stay',
    guestName: 'Guest name',
    mobile: 'Mobile',
    email: 'Email',
    company: 'Company',
    companyHint: 'If billed to one',
    none: 'No company',
    source: 'Source',
    checkIn: 'Check-in',
    checkOut: 'Check-out',
    adults: 'Adults',
    children: 'Children',
    roomType: 'Room category',
    choose: 'Choose',
    rooms: 'Rooms',
    plan: 'Meal plan',
    noPlan: 'No plan',
    rate: 'Rate per room per night',
    rateHint: 'Picking a plan fills its price when the rate is empty.',
    notes: 'Notes',
    notesPh: 'Early arrival, extra bed, preferences…',
    nightsTotal: (nights: number, total: string) => `${plural(nights, 'night')} · room total ${total} before tax`,
    save: 'Save booking',
    create: 'Make booking',
    cancel: 'Cancel',
    toast: { created: (ref: string) => `Booking ${ref} made.`, updated: 'Booking updated.' },
    // The two-step booking (MJ's preview, section 4, 5 Nov 2026)
    steps: ['Guest', 'Dates and room'],
    newPage: 'New booking',
    editPage: (ref: string) => `Edit booking ${ref}`,
    whoIsBooking: 'Who is booking?',
    mobileHint: 'Type the mobile first; a past guest is found by it.',
    checkingPast: 'Checking past stays…',
    returning: 'Returning guest',
    /** `n` past stays: this visit is the (n + 1)th ("3rd stay"). */
    nthStay: (n: number) => `${ordinal(n + 1)} stay`,
    bookedBefore: 'Booked before',
    newGuest: 'New guest',
    lookupFailed: 'Past stays could not be checked.',
    retryLookup: 'Try again',
    filledFrom: 'Name, email and company copied from the last stay. Change any value here.',
    whenAndWhich: 'When and which room',
    stripHint: 'Tap the check-in day, then the check-out day. Further dates in the pickers.',
    pickCheckOut: 'Now tap the check-out day.',
    nights: (n: number) => plural(n, 'night'),
    sameDay: (d: string) => `Check-out must be after check-in. Pick ${d} or later.`,
    roomTypeHint: 'Per room per night, before GST.',
    noTypes: 'No room categories yet. Add them under Website › Rooms.',
    gstLine: (p: number) => `GST ${p}% at this rate`,
    rateFrom: (plan: string) => `From the ${plan} plan. Change it if the desk agreed another.`,
    more: 'More details',
    less: 'Fewer details',
    moreHint: 'Notes for the desk',
    summary: 'Summary',
    k: { guest: 'Guest', mobile: 'Mobile', dates: 'Dates', nights: 'Nights', category: 'Category', rooms: 'Rooms', rate: 'Rate', gst: (p: number) => `GST ${p}%`, estimate: 'Estimate' },
    nextStep: 'next step',
    notChosen: 'Not chosen yet',
    continueToDates: 'Continue to dates',
    back: 'Back',
    draftNote: 'Draft saved on every change.',
    estimateNote: 'Room nights only; extras are added on the stay.',
    checkStep1: 'Check the marked fields in step 1.',
    nameFirst: 'Type the guest\'s name to continue',
    pickCategory: 'Pick a room category',
    draftRestored: 'An unsaved draft from earlier is filled in.',
    startFresh: 'Start fresh',
  },
  inHouse: {
    title: 'In-house guests',
    subtitleIn: 'Guests staying now. Open one for their account, to add charges, move room or check out.',
    subtitlePast: 'Guests who have checked out, newest first.',
    tabs: { inHouse: 'In house', past: 'Checked out' } satisfies Record<StayView, string>,
    searchPlaceholder: 'Search name, mobile, room or register number',
    summary: (n: number) => plural(n, 'guest'),
    cols: { room: 'Room', guest: 'Guest', arrived: 'Arrived', leaves: 'Leaves', left: 'Left', soFar: 'So far' },
    due: 'Due',
    gr: (n: string) => `Register ${n}`,
    emptyIn: 'Nobody is in the house',
    emptyPast: 'Nobody has checked out yet',
    emptyBody: 'Check a guest in from a reservation or as a walk-in.',
    checkIn: 'Check in',
  },
  checkIn: {
    title: 'Check-in',
    fromReservation: (ref: string, rooms: number, type: string, already: number) =>
      `Booking ${ref} · ${rooms} × ${type}${already ? ` · ${already} already in` : ''}`,
    walkIn: 'A walk-in guest, with no booking.',
    roomSection: 'Room and stay',
    roomHint: 'Rooms of the reserved category come first, clean before needing cleaning.',
    guestSection: 'Guest',
    guestHint: 'As on their ID.',
    reservation: 'Reservation',
    walkInOption: 'Walk-in (no reservation)',
    room: 'Room',
    needsCleaning: 'needs cleaning',
    expectedCheckOut: 'Expected check-out',
    gr: 'Register number',
    grHint: 'Guest register',
    grAuto: 'given automatically',
    grChange: 'Change',
    adults: 'Adults',
    children: 'Children',
    plan: 'Meals included',
    planNone: 'Not chosen',
    planWords: { EP: 'Room only', CP: 'Breakfast', MAP: 'Breakfast and dinner', AP: 'All meals' } as Record<string, string>,
    rate: 'Rate per night',
    name: 'Name',
    mobile: 'Mobile',
    email: 'Email',
    address: 'Address',
    city: 'City',
    nationality: 'Nationality',
    idType: 'ID card shown',
    idNumber: 'ID number',
    idHint: 'The ID number is stored as entered. Printed copies show only the last 4 digits.',
    idPhoto: 'ID photo',
    idPhotoNote: 'Photo upload comes with the backend.',
    company: 'Company',
    none: 'No company',
    gstin: 'Company GST number (only for a company bill)',
    gstinPh: '24ABCDE1234F1Z5',
    notes: 'Notes',
    submit: 'Check in guest',
    cancel: 'Cancel',
    noRoomsTitle: 'No room is free to give',
    noRoomsBody: 'Every room is occupied or out of order.',
    toast: (name: string, room: string) => `${name} checked in to room ${room}.`,
    // The two-step check-in (MJ's preview, 5 Nov 2026)
    steps: ['Who is arriving', 'Room and confirm'],
    arrivingToday: (n: number) => `Arriving today · ${plural(n, 'booking')}`,
    searchArrivals: 'Mobile, name or booking reference',
    noArrivals: 'Nobody is due today. A guest without a booking is checked in as a walk-in.',
    noArrivalMatch: 'No booking matches. Try the mobile or the reference, or check the guest in as a walk-in.',
    walkInGuest: 'Walk-in guest',
    returning: 'Returning guest',
    newGuest: 'New guest',
    checkingPast: 'Checking past stays…',
    mobileHint: 'Past stays are found by this number.',
    /** `n` past stays: this visit is the (n + 1)th ("2nd stay", "21st stay", "112th stay"). */
    nthStay: (n: number) => `${ordinal(n + 1)} stay`,
    lastStay: (room: string | null, date: string | null) => [room ? `last in room ${room}` : 'last stay', date].filter(Boolean).join(', '),
    lookupFailed: 'Past stays could not be checked.',
    retryLookup: 'Try again',
    filledFrom: 'Filled from the booking and past stays. Change any value here.',
    leadGuest: 'Lead guest',
    otherGuests: 'Other guests in the room',
    addWithId: 'Add a guest with ID',
    addByName: 'Add a guest by name only',
    nameOnly: 'Name only',
    nameOnlyHint: 'No ID carried. Entered in the register as an accompanying guest.',
    memberNeedsName: 'Give every added guest a name, or remove the row.',
    noIdCarried: (names: string) => `No ID carried: ${names}.`,
    removeGuest: 'Remove this guest',
    photoChosen: 'Photo chosen',
    changePhoto: 'Change photo',
    more: 'More details',
    less: 'Fewer details',
    moreHint: 'Plan, company, GSTIN, notes and the register',
    register: 'Guest register',
    dateOfBirth: 'Date of birth',
    houseNo: 'House number',
    locality: 'Locality',
    district: 'District',
    zipCode: 'PIN code',
    state: 'State',
    country: 'Country',
    phone: 'Other phone',
    comingFrom: 'Coming from',
    goingTo: 'Going to',
    vehicleType: 'Vehicle',
    vehicleRegistration: 'Vehicle registration',
    vehicleTypes: ['Car', 'Bike', 'Bus', 'Auto', 'Other'],
    roomCard: 'Room',
    roomCardHint: 'Clean rooms first; the booked category at the top.',
    bookedType: (t: string) => `${t} booked`,
    lastStayMark: 'last stay',
    clean: 'clean',
    stayCard: 'Stay',
    fromBooking: 'From the booking',
    tomorrowDefault: 'Tomorrow, unless the guest says otherwise',
    gstLine: (p: number) => `GST ${p}% at this rate`,
    grGiven: 'Suggested by HMS. Change it if the register says otherwise.',
    summary: 'Summary',
    k: { booking: 'Booking', dates: 'Dates', nights: 'Nights', guests: 'Guests', room: 'Room', category: 'Category', rate: 'Rate', gst: (p: number) => `GST ${p}%`, advance: 'Advance paid', balance: 'Balance' },
    chooseRoom: 'Not chosen yet',
    walkInBooking: 'Walk-in',
    balanceNote: 'Room nights only; extras are added on the stay.',
    continueToRoom: 'Continue to room',
    back: 'Back',
    checkInTo: (room: string) => `Check in guest to room ${room}`,
    savingPhotos: 'Saving ID photos…',
    checkStep1: 'Check the marked fields in step 1.',
    pickGuest: 'Pick a guest to continue',
    pickRoom: 'Pick a room',
    draftNote: 'Draft saved on every change.',
    photoNotSaved: (who: string, why: string) => `${who}'s ID photo was not saved (${why.replace(/\.$/, '')}).`,
    fromStay: 'Add it again from the stay page.',
    photosInterrupted: 'The ID photos were not all saved.',
  },
  stay: {
    title: (room: string, name: string) => `Room ${room} · ${name}`,
    walkIn: 'Walk-in',
    account: 'Account',
    addCharge: 'Add charge',
    changeCheckOut: 'Change check-out',
    moveRoom: 'Move room',
    checkOut: 'Check out',
    viewBill: (n: string) => `Bill ${n}`,
    cols: { date: 'Date', what: 'What', book: 'Book', amount: 'Amount', remove: '' },
    roomLine: (room: string, plan: string, nights: number, rate: string) =>
      `Room ${room}${plan ? ` (${plan})` : ''}: ${plural(nights, 'night')} × ${rate}`,
    qtyAt: (q: number, price: string) => `${q} × ${price}`,
    totals: {
      hotel: 'Hotel (room and extras)',
      food: 'Food',
      subtotal: 'Total before tax',
      gstHotel: (p: number) => `GST on hotel (${p}%)`,
      gstFood: (p: number) => `GST on food (${p}%)`,
      grand: 'Total with tax',
      advance: 'Advance to take off',
      payable: 'To pay',
      /** Pass `food` only when it differs from the hotel percent. */
      estimate: (p: number, food?: number) =>
        food === undefined || food === p
          ? `Tax shown at ${p}%. Set the rates when checking out.`
          : `Tax shown at ${p}% on rooms and ${food}% on food. Set the rates when checking out.`,
    },
    guest: 'Guest',
    k: {
      name: 'Name',
      mobile: 'Mobile',
      email: 'Email',
      address: 'Address',
      id: 'ID',
      company: 'Company',
      gstin: 'GSTIN',
      guests: 'Guests',
      arrived: 'Arrived',
      leaves: 'Leaves',
      left: 'Left',
      gr: 'Register number',
      notes: 'Notes',
      reservation: 'Reservation',
    },
    removeChargeTitle: 'Remove this charge?',
    removeChargeBody: (desc: string, amt: string) => `${desc}, ${amt}`,
    remove: 'Remove',
    charge: {
      title: 'Add a charge',
      kind: 'Kind',
      date: 'Date',
      description: 'Description',
      descriptionPh: 'e.g. Dinner, 2 shirts pressed',
      quantity: 'Quantity',
      price: 'Price each',
      amount: (amt: string) => `Amount: ${amt}`,
      submit: 'Add charge',
    },
    extend: { title: 'Change check-out', leavesOn: 'Leaves on', save: 'Save' },
    move: {
      title: 'Move to another room',
      newRoom: 'New room',
      newRate: 'New rate',
      hint: (room: string) => `Leave the rate empty to keep it. Room ${room} is left to be cleaned.`,
      submit: 'Move',
      noneFree: 'No other room is free.',
    },
    checkout: {
      title: 'Check out',
      billNumber: 'Bill number',
      billDate: 'Bill date',
      gstHotel: 'GST on hotel (%)',
      gstFood: 'GST on food (%)',
      hotelMode: 'Hotel paid by',
      foodMode: 'Food paid by',
      instruction: 'Instruction',
      hint: (nights: number) => `Room: ${plural(nights, 'night')} to today. Choose "Debit" as the payment to bill a company later.`,
      advanceHint: (amt: string) => `The reservation's advance (${amt}) is taken off.`,
      submit: 'Check out and bill',
      confirmTitle: (name: string) => `Check out ${name}?`,
      confirmBody: (room: string) => `The bill is added to Bills and room ${room} is left to be cleaned.`,
      confirm: 'Check out',
    },
    billCard: 'Bill',
    billSummary: (n: string, d: string) => `Bill ${n} · ${d}`,
    openBills: 'Open bills',
    toast: {
      charge: 'Charge added.',
      removed: 'Charge removed.',
      moved: (room: string) => `Moved to room ${room}.`,
      extended: (d: string) => `Check-out date changed to ${d}.`,
      checkedOut: (bill: string) => `Checked out. Bill ${bill} is in Bills.`,
    },
  },
  common: {
    back: 'Back',
    cancel: 'Cancel',
    save: 'Save',
    required: 'This is required.',
    invalidDate: 'Enter a valid date.',
    invalidEmail: 'Enter a valid email.',
    invalidGstin: 'Enter a valid 15-character GSTIN.',
    dash: '-',
  },
} as const;

/* ------------------------------------------------------------------ */
/* In-memory store (one per app session, shared by every screen)       */
/* ------------------------------------------------------------------ */

export interface RoomRow {
  id: string;
  number: string;
  floor: string | null;
  roomTypeId: string | null;
  notes: string;
  hkStatus: HkStatus;
  outOfOrder: boolean;
  outOfOrderReason: string | null;
  sort: number;
}

export interface ReservationRow {
  id: string;
  /** Mock row version (missing = 1). */
  version?: number;
  reference: string;
  guestName: string;
  mobile: string;
  email: string;
  companyId: string | null;
  roomTypeId: string;
  rooms: number;
  plan: string;
  ratePaise: number;
  adults: number;
  children: number;
  checkIn: string;
  checkOut: string;
  source: ReservationSource;
  enquiryRef: string | null;
  notes: string;
  status: ReservationStatus;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdvanceRow extends Advance {
  reservationId: string;
}

export interface StayRow extends Partial<GuestRegisterFields> {
  id: string;
  /** Mock row version (missing = 1). */
  version?: number;
  reservationId: string | null;
  roomId: string;
  grNumber: string;
  guestName: string;
  mobile: string;
  email: string;
  address: string;
  city: string;
  nationality: string;
  idProofType: string;
  idProofNumber: string;
  companyId: string | null;
  guestGstin: string;
  adults: number;
  children: number;
  plan: string;
  ratePaise: number;
  checkInAt: string;
  expectedCheckOut: string;
  checkOutAt: string | null;
  status: StayStatus;
  notes: string;
  charges: Charge[];
  bill: StayBill | null;
  members?: StayMemberInput[];
  hasIdPhoto?: boolean;
}

/** PUT /front-office/stays/{id}/id-photo answers this (and DELETE with hasIdPhoto false); send the stay version, use the returned one next. */
/** What the reader found on an ID photo (the intake reader's fast part). `unclear` = the photo is rejected: `retake` says what to do, nothing is filled. `unread` lists the form fields it could not read. */
export interface IdReading {
  outcome: 'read' | 'unclear';
  fields: Partial<Record<'guestName' | 'idProofType' | 'idProofNumber' | 'dateOfBirth' | 'address' | 'city' | 'nationality', string>>;
  unread: string[];
  retake: string | null;
  /** Other people found on the same sheet (the others in the room). */
  others?: { fullName: string; idType: string; idNumber: string }[];
}

export interface IdPhotoResult {
  version: number;
  hasIdPhoto: boolean;
}

/**
 * GET/POST/PUT /front-office/stays/{id}/id-photos and GET/DELETE .../id-photos/{photoId}: ALL of the stay's ID images (the back of a card, the other guests' IDs), in order:
 * the first is the main guest's (the same as the single id-photo route).
 * See one with `idPhotoPath(stayId, photoId)` as an <img src> (behind the same sign-in).
 */
export interface IdPhotoList {
  version: number;
  photos: { id: string }[];
  storeMax: number;
}

export const idPhotoPath = (stayId: string, photoId: string): string => `/api/v1/front-office/stays/${encodeURIComponent(stayId)}/id-photos/${encodeURIComponent(photoId)}`;

export interface FrontOfficeStore {
  roomTypes: RoomType[];
  companies: CompanyOption[];
  rooms: RoomRow[];
  reservations: ReservationRow[];
  advances: AdvanceRow[];
  stays: StayRow[];
  seq: number;
  billSeq: number;
  receiptSeq: number;
  /** Number of the first reservation (RES-yy-NNNNN); missing = 101 (the demo data). */
  firstReservationNo?: number;
}

/** "101-110, 112" -> ["101", ..., "110", "112"]. */
export function parseRoomNumbers(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[,\s]+/).filter(Boolean)) {
    const m = /^(\d+)-(\d+)$/.exec(part);
    const a = m ? Number(m[1]) : NaN;
    const b = m ? Number(m[2]) : NaN;
    if (m && b >= a && b - a < 200) for (let n = a; n <= b; n += 1) out.push(String(n));
    else out.push(part.slice(0, 20));
  }
  return [...new Set(out)];
}

export type FrontOfficeApi = ReturnType<typeof createFrontOfficeApi>;
