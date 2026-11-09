import "server-only";
import type { Paise } from "../money/paise";
import type { BillingRepos } from "./billing";
import type { ListResult, Page, VersionedResult } from "./types";

// Front Office (Pallav "Pms"): rooms, reservations, stays and their charges, in the hotel's own database (pms_rooms, pms_reservations,
// pms_stays, pms_charges), plus READ-ONLY neighbours: the room categories and plans of the website (site_rooms, site_rate_plans), website
// enquiries (site_enquiries), ID proof types and the hotel settings. Plain records, money as bigint paise, no SQL. Rules every implementation
// keeps (the in-memory double included): another hotel's id is not found; reservations and stays carry `version` (start 1, +1 per update;
// another expected version = conflict); rooms and charges have no version (no column) and rooms are hard-deleted only when no stay names them;
// ONE in-house stay per room (Pallav: functional unique index pms_stays_one_in_house_per_room_key) -> RepoError "unique" "one_in_house_per_room";
// a reservation's reference is unique. Check-out writes the bill through the BILLING repositories of the SAME unit (FrontOfficeRepos extends
// BillingRepos). Spec: docs/specs/front-office.md.

/* ---------------------------------------------------------------- rooms */

export interface RoomFields {
  number: string;
  floor: string | null;
  roomTypeId: string | null;
  hkStatus: "clean" | "dirty";
  outOfOrder: boolean;
  outOfOrderReason: string | null;
  notes: string | null;
  sortOrder: number;
}
export interface RoomRecord extends RoomFields {
  id: string;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RoomRepo {
  /** Every room, by sort order then number (a hotel has at most a few hundred: the board shows them all). */
  all(): Promise<RoomRecord[]>;
  /** `forUpdate`: lock the row until the unit ends (a check-in or a move reads the room this way). */
  get(id: string, options?: { forUpdate?: boolean }): Promise<RoomRecord | null>;
  /** Which of these numbers already exist (exact match; the number column is case-insensitive in Pallav's collation). */
  existingNumbers(numbers: readonly string[]): Promise<string[]>;
  maxSortOrder(): Promise<number>;
  /** Unique number -> RepoError "unique" "pms_rooms_number". */
  create(input: RoomFields & { createdBy: string }): Promise<RoomRecord>;
  update(id: string, patch: Partial<RoomFields>, actorId: string): Promise<RoomRecord | null>;
  /** Hard delete (Pallav has no recycle bin for rooms); false when gone. */
  delete(id: string): Promise<boolean>;
  /** Does any stay (in house or past) name this room? */
  hasStays(roomId: string): Promise<boolean>;
  /** The same for many rooms at once (the rooms list's "has history", no N+1). */
  withStays(roomIds: readonly string[]): Promise<Set<string>>;
}

/* ---------------------------------------------------------------- reservations */

export type ReservationStatus = "confirmed" | "checked_in" | "checked_out" | "cancelled" | "no_show";
export type ReservationSource = "walk_in" | "phone" | "website" | "company" | "agent" | "other";

export interface ReservationFields {
  guestName: string;
  mobile: string | null;
  email: string | null;
  companyId: string | null;
  roomTypeId: string | null;
  rooms: number;
  plan: string | null;
  ratePaise: Paise;
  adults: number;
  children: number;
  /** YYYY-MM-DD; check-out is the morning they leave (a stay holds check-in night through the night before). */
  checkIn: string;
  checkOut: string;
  source: ReservationSource;
  status: ReservationStatus;
  siteEnquiryId: string | null;
  notes: string | null;
  cancelReason: string | null;
}
export interface ReservationRecord extends ReservationFields {
  id: string;
  /** "RES-26-00042" */
  reference: string;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

/** ReservationController::index views (:3-6). `today` is the hotel's today in IST. */
export type ReservationView = "upcoming" | "today" | "in_house" | "past" | "cancelled" | "all";

interface ReservationRepo {
  get(id: string, options?: { forUpdate?: boolean }): Promise<ReservationRecord | null>;
  /** Many at once (a page's DTOs: no N+1). */
  getMany(ids: readonly string[]): Promise<Map<string, ReservationRecord>>;
  /** The view's filter and order (:13-24), words matched in guest name, mobile or reference, paged. */
  list(query: { view: ReservationView; today: string; words?: readonly string[] } & Page): Promise<ListResult<ReservationRecord>>;
  countByView(today: string, words?: readonly string[]): Promise<Record<ReservationView, number>>;
  /** Confirmed, check-in on or before today: the board's arrivals (BoardController.php:151). */
  arrivals(today: string): Promise<ReservationRecord[]>;
  /** How many reservations arrive on `date` and have not checked in: status confirmed (not checked in, cancelled or no-show), check_in = date. The dashboard's "arrivals today". */
  arrivalsToday(date: string): Promise<number>;
  /**
   * Reservations HOLDING rooms of a category on any of [firstNight, lastNight] (status confirmed or checked_in, check_in <= lastNight,
   * check_out > firstNight; FrontDesk::held :88-95), optionally without one reservation and without website ones.
   */
  holding(roomTypeId: string, firstNight: string, lastNight: string, options?: { ignoreId?: string; countWebsite?: boolean }): Promise<{ checkIn: string; checkOut: string; rooms: number }[]>;
  byEnquiry(siteEnquiryId: string): Promise<ReservationRecord | null>;
  /** Confirmed or checked-in reservations (the check-in picker), by check-in; capped at `limit`. */
  openForCheckIn(limit: number): Promise<ReservationRecord[]>;
  /** Reservations whose mobile ends with `digits` (6 to 10 digits; 10 is the indexed last-ten match, migration 0050), newest first, at most `limit`. */
  byMobileSuffix(digits: string, limit: number): Promise<ReservationRecord[]>;
  /**
   * Creates with the next reference number taken INSIDE the unit: "RES-{yy}-{n padded to 5}" where n is one past the highest number of any
   * reference so far (Pallav uses the auto-increment id, Reservation.php:42-48; Pallav: locked like entry numbers).
   */
  create(input: ReservationFields & { createdBy: string; year2: string }): Promise<ReservationRecord>;
  update(id: string, expectedVersion: number, patch: Partial<ReservationFields>, actorId: string): Promise<VersionedResult<ReservationRecord>>;
}

/* ---------------------------------------------------------------- stays and charges */

/** The main guest's details asked at check-in (all optional, free text as typed except the date and the vehicle type). */
export interface StayGuestDetails {
  dateOfBirth?: string;
  houseNo?: string;
  locality?: string;
  district?: string;
  zipCode?: string;
  state?: string;
  country?: string;
  phone?: string;
  comingFrom?: string;
  goingTo?: string;
  vehicleType?: string;
  vehicleRegistration?: string;
  /** The room's other guests (MJ: all members are saved; still one entry per room). No ID photo for them. */
  members?: StayMember[];
  /**
   * More ID images of the stay after the main guest's (idProofPath is always the first): the back of a card, the other guests' IDs. Stored names in the private ID-photo store, in the
   * order they were added. Kept by every edit of the details; changed only by the ID-photo routes.
   */
  idPhotos?: string[];
}

export interface StayMember {
  fullName: string;
  mobile?: string;
  idType?: string;
  idNumber?: string;
}

export interface StayFields {
  reservationId: string | null;
  roomId: string;
  grNumber: string | null;
  guestName: string;
  mobile: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  nationality: string | null;
  idProofType: string | null;
  /** Plain text (no encryption: Pallav shows it in full). */
  idProofNumber: string | null;
  /** The main guest's ID photo: its stored name in the private ID-photo store (never served by a public route); null when none. */
  idProofPath: string | null;
  companyId: string | null;
  guestGstin: string | null;
  adults: number;
  children: number;
  plan: string | null;
  ratePaise: Paise;
  checkInAt: Date;
  /** YYYY-MM-DD */
  expectedCheckOut: string;
  checkOutAt: Date | null;
  status: "in_house" | "checked_out";
  billId: string | null;
  /** The GST percents actually used at check-out (MIGRATION REQUEST: pms_stays.hotel_gst_percent / food_gst_percent DECIMAL(5,2) NULL). */
  hotelGstPercent: string | null;
  foodGstPercent: string | null;
  notes: string | null;
  /** The main guest's further details (migration hotel 0023), only the keys that were given; null when none. */
  guestDetails: StayGuestDetails | null;
}
export interface StayRecord extends StayFields {
  id: string;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export type StayView = "in_house" | "past";

interface StayRepo {
  get(id: string, options?: { forUpdate?: boolean }): Promise<StayRecord | null>;
  /** In house: by expected check-out; past: by check-out time, newest first (StayController::index :32-40); words in guest, mobile, GR, room number. */
  list(query: { view: StayView; words?: readonly string[] } & Page): Promise<ListResult<StayRecord>>;
  countByView(words?: readonly string[]): Promise<Record<StayView, number>>;
  /** The in-house stay of each of these rooms (Room::currentStay), many at once. */
  currentByRoom(roomIds: readonly string[]): Promise<Map<string, StayRecord>>;
  /** In house, expected check-out on or before today (the board's departures). */
  departures(today: string): Promise<StayRecord[]>;
  inHouseCount(): Promise<number>;
  /** The stays of many reservations at once. */
  byReservation(reservationIds: readonly string[]): Promise<Map<string, StayRecord[]>>;
  /** In-house stays with no reservation, in rooms of a category (walk-ins hold nights too, FrontDesk::held :105-120). */
  walkInsOfType(roomTypeId: string): Promise<StayRecord[]>;
  /** The duplicate warning (decision 74): the OTHER in-house stays whose main ID number is the same number (spaces, dashes and case ignored), newest first, at most 5. */
  sameIdInHouse(idNumber: string, exceptId: string): Promise<StayRecord[]>;
  /** Stays (in house or past) whose mobile ends with `digits` (6 to 10 digits; 10 is the indexed last-ten match, migration 0050), newest check-in first, at most `limit`. */
  byMobileSuffix(digits: string, limit: number): Promise<StayRecord[]>;
  /** The highest whole number inside any G.R. number of this hotel (digits only: "GR-12" is 12); 0 when none. */
  highestGrNumber(): Promise<number>;
  /** A second in-house stay in the same room -> RepoError "unique" "one_in_house_per_room". */
  create(input: StayFields & { createdBy: string }): Promise<StayRecord>;
  update(id: string, expectedVersion: number, patch: Partial<StayFields>, actorId: string): Promise<VersionedResult<StayRecord>>;
}

export type ChargeCategory = "food" | "room_service" | "laundry" | "extra_bed" | "other";

export interface ChargeRecord {
  id: string;
  stayId: string;
  chargeDate: string;
  category: ChargeCategory;
  side: "hotel" | "food";
  description: string;
  /** decimal(8,2) as text ("1.50"): a quantity, not money. */
  quantity: string;
  unitPricePaise: Paise;
  amountPaise: Paise;
  createdBy: string | null;
  createdAt: Date;
}

interface ChargeRepo {
  /** The charges of many stays, each by charge date then creation (Stay::charges, :45-48). */
  forStays(stayIds: readonly string[]): Promise<Map<string, ChargeRecord[]>>;
  get(id: string): Promise<ChargeRecord | null>;
  create(input: Omit<ChargeRecord, "id" | "createdAt">): Promise<ChargeRecord>;
  /** Hard delete (Pallav removes the line; the log keeps what it was). */
  delete(id: string): Promise<boolean>;
}

/* ---------------------------------------------------------------- read-only neighbours */

export interface RoomTypeRecord {
  id: string;
  name: string;
  /** site_rooms.total_count: the capacity before any real rooms are set up (FrontDesk::capacity :57-66). */
  totalCount: number;
  sortOrder: number;
  plans: { code: string; name: string; singlePaise: Paise | null; doublePaise: Paise; active: boolean; sortOrder: number }[];
}
/** site_rooms + site_rate_plans (the Website module owns writes). */
interface RoomTypeRepo {
  all(): Promise<RoomTypeRecord[]>;
  get(id: string): Promise<RoomTypeRecord | null>;
}

export interface EnquiryRecord {
  id: string;
  reference: string;
  name: string;
  phone: string | null;
  email: string | null;
  message: string | null;
  roomId: string | null;
  checkIn: string | null;
  checkOut: string | null;
  guests: number | null;
  children: number | null;
}
/** site_enquiries, read-only (the Website module confirms or declines and then calls the front office's conversion). */
export interface EnquiryRepo {
  get(id: string): Promise<EnquiryRecord | null>;
  getMany(ids: readonly string[]): Promise<Map<string, EnquiryRecord>>;
}

/** id_proof_types: the active names, by name (StayController::create :65). */
export interface IdProofTypeRepo {
  activeNames(): Promise<string[]>;
}

/** app_settings by key (e.g. checkout.hotel_gst_percent, checkout.food_gst_percent: seeded 5, CHECK 0..28). */
export interface SettingsRepo {
  values(keys: readonly string[]): Promise<Map<string, string | null>>;
}

/** What a front-office service gets inside a unit: its own tables AND billing's (check-out writes the bill in the same unit). */
/* ---------------------------------------------------------------- guest requests (G2, hotel migration 0031) */

export type GuestRequestKind = "towels" | "water" | "cleaning" | "late_checkout" | "extend_stay" | "other";
export type GuestRequestStatus = "open" | "done" | "declined";

export interface GuestRequestRecord {
  id: string;
  stayId: string;
  kind: GuestRequestKind;
  note: string | null;
  status: GuestRequestStatus;
  reply: string | null;
  /** The guest's own account. */
  createdBy: string | null;
  doneBy: string | null;
  doneAt: Date | null;
  createdAt: Date;
}

export interface GuestRequestRepo {
  get(id: string): Promise<GuestRequestRecord | null>;
  /** One stay's requests, newest first. */
  byStay(stayId: string): Promise<GuestRequestRecord[]>;
  /** The hotel's requests: open ones oldest first (the queue), closed ones newest first. */
  list(query: { view: "open" | "closed" } & Page): Promise<ListResult<GuestRequestRecord>>;
  countOpen(): Promise<number>;
  create(input: { stayId: string; kind: GuestRequestKind; note: string | null; createdBy: string | null }): Promise<GuestRequestRecord>;
  /** Closes an open one; null when it is gone or already closed. */
  close(id: string, next: { status: "done" | "declined"; reply: string | null; doneBy: string; doneAt: Date }): Promise<GuestRequestRecord | null>;
}

export interface FrontOfficeRepos extends BillingRepos {
  /** G2: the guests' requests from the portal. */
  guestRequests: GuestRequestRepo;
  rooms: RoomRepo;
  reservations: ReservationRepo;
  stays: StayRepo;
  charges: ChargeRepo;
  roomTypes: RoomTypeRepo;
  enquiries: EnquiryRepo;
  idProofTypes: IdProofTypeRepo;
  settings: SettingsRepo;
}
