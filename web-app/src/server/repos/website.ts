import "server-only";
import type { Paise } from "../money/paise";
import type { EnquiryRecord, RoomTypeRecord } from "./frontOffice";
import type { ListResult, Page } from "./types";

// The Website module in the hotel's own database (hotel migration 0005_website): enquiries, room categories, tariff plans, the rate and
// inventory calendar, the gallery, the home page wording, services, house rules, nearby places and the settings. Plain records, no SQL.
// Spec: docs/specs/website.md. Rules every implementation keeps:
// - Hard delete everywhere (Pallav deletes these rows; the migration marks the tables); a room with enquiries is never deleted (the foreign key is SET NULL,
//   but Pallav refuses it first), plans and their dated rates go with their room (ON DELETE CASCADE).
// - Prices are paise. Dates are plain "YYYY-MM-DD". The in-memory double keeps rooms and enquiries IN the front office's own arrays (`roomTypes`,
//   `enquiries`) because the front office reads the same tables read-only: an enquiry or room seeded by the front office reads here with the defaults
//   of a row nobody has edited yet.
// - Integration secrets (plain columns, MJ: no field encryption): google_maps_api_key, gbp_oauth_client_id, gbp_oauth_client_secret, the two tokens,
//   smtp_username, smtp_password. They never leave the server; the settings read shows only whether one is set.
// - Scale: the calendar week is a handful of reads (rooms, active plans, dated rates and inventory of seven days, one availability pass per room);
//   lists are paged; the overview is aggregates and small top-N reads.

/* ---------------------------------------------------------------- enquiries */

export type EnquiryStatus = "new" | "pending" | "confirmed" | "declined";

export interface SiteEnquiryFields {
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

export interface SiteEnquiryRecord extends EnquiryRecord, SiteEnquiryFields {
  status: EnquiryStatus;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  ipAddress: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type EnquiryTab = "all" | "pending" | "confirmed" | "declined";

interface SiteEnquiryRepo {
  get(id: string, options?: { forUpdate?: boolean }): Promise<SiteEnquiryRecord | null>;
  /** Several in ONE read (a page's rooms and names are read the same way). */
  getMany(ids: readonly string[]): Promise<SiteEnquiryRecord[]>;
  /**
   * The tab's filter and order (EnquiryController::index): pending = new or pending; a decision sorts by when it was made (COALESCE(decided_at,
   * created_at) desc), the rest by arrival (created_at desc, id desc); words in name, phone, email or reference (and phone digits).
   */
  list(query: { tab: EnquiryTab; words?: readonly string[] } & Page): Promise<ListResult<SiteEnquiryRecord>>;
  /** "new" from an earlier day becomes "pending" (:20): one UPDATE, no scheduled job. */
  promoteNew(before: Date): Promise<number>;
  /** new + pending, confirmed, declined, all: ONE grouped count, optionally of enquiries created inside [from, to] (the overview's financial year). */
  counts(range?: { from: Date; to: Date }): Promise<{ all: number; pending: number; confirmed: number; declined: number }>;
  /** Confirmed enquiries of a room overlapping [from, to] (check_in <= to, check_out > from), optionally without one. */
  confirmedStays(roomId: string, from: string, to: string, ignoreId?: string): Promise<{ checkIn: string; checkOut: string }[]>;
  /** Confirmed arrivals with check-in in [from, to], by check-in then name, with the room's name. */
  arrivals(from: string, to: string): Promise<(SiteEnquiryRecord & { roomName: string | null })[]>;
  /** Created inside [from, to], newest first, at most `limit`, with the room's name. */
  recent(range: { from: Date; to: Date }, limit: number): Promise<(SiteEnquiryRecord & { roomName: string | null })[]>;
  hasForRoom(roomId: string): Promise<boolean>;
  create(row: SiteEnquiryFields & { reference: string; ipAddress: string | null; createdAt: Date }): Promise<SiteEnquiryRecord>;
  update(id: string, patch: Partial<SiteEnquiryFields>, by: string): Promise<SiteEnquiryRecord>;
  decide(id: string, decision: { status: "confirmed" | "declined"; by: string; byName: string; at: Date; note: string | null }): Promise<SiteEnquiryRecord>;
  remove(id: string): Promise<boolean>;
}

/** The reference counter (Support/Site/Reference.php): one row per fiscal year (1 April), locked while it is taken. */
interface ReferenceRepo {
  next(fiscalYear: number): Promise<number>;
}

/* ---------------------------------------------------------------- rooms, plans, calendar */

export interface RoomPhoto {
  /** The stored file name. */
  path: string;
  name: string | null;
  alt: string | null;
}

export interface SiteRoomFields {
  name: string;
  size: string | null;
  bedType: string | null;
  maxGuests: number;
  totalCount: number;
  note: string | null;
  badgeLabel: string | null;
  showPrice: boolean;
  available: boolean;
  photos: RoomPhoto[];
}

export interface SiteRoomRecord extends RoomTypeRecord, SiteRoomFields {
  slug: string;
  sortOrder: number;
}

export interface PriceTier {
  guests: number;
  pricePaise: Paise;
}

export interface SitePlanFields {
  name: string;
  code: string;
  /** Paise by number of guests, ascending (the occupancy ladder). */
  tiers: PriceTier[];
  doublePaise: Paise;
  singlePaise: Paise | null;
  extraPersonPaise: Paise | null;
}

export interface SitePlanRecord extends SitePlanFields {
  id: string;
  roomId: string;
  sortOrder: number;
  active: boolean;
}

export interface DateRateRecord {
  planId: string;
  date: string;
  doublePaise: Paise;
  singlePaise: Paise | null;
}

export interface InventoryRecord {
  roomId: string;
  date: string;
  roomsLeft: number;
  blocked: boolean;
}

interface SiteRoomRepo {
  /** sort_order, id; with how many plans each has from ONE grouped count. */
  list(): Promise<(SiteRoomRecord & { plansCount: number })[]>;
  get(id: string, options?: { forUpdate?: boolean }): Promise<SiteRoomRecord | null>;
  getMany(ids: readonly string[]): Promise<SiteRoomRecord[]>;
  slugTaken(slug: string, except?: string): Promise<boolean>;
  create(fields: SiteRoomFields & { slug: string }, by: string): Promise<SiteRoomRecord>;
  update(id: string, patch: Partial<SiteRoomFields>, by: string): Promise<SiteRoomRecord>;
  remove(id: string): Promise<boolean>;
  /** The order of the cards: positions 0..n in the order given (every id must exist). */
  setOrder(ids: readonly string[]): Promise<boolean>;
}

export interface PlanRepo {
  /** Plans of these rooms, by sort_order then id; active only when asked. */
  forRooms(roomIds: readonly string[], options?: { activeOnly?: boolean }): Promise<SitePlanRecord[]>;
  get(id: string, options?: { forUpdate?: boolean }): Promise<SitePlanRecord | null>;
  /** Distinct plan names across rooms, sorted (the bulk form's choices). */
  names(): Promise<string[]>;
  create(roomId: string, fields: SitePlanFields, by: string): Promise<SitePlanRecord>;
  update(id: string, patch: Partial<SitePlanFields> & { active?: boolean }, by: string): Promise<SitePlanRecord>;
  remove(id: string): Promise<boolean>;
  /** Positions 0..n for plans of ONE room. */
  setOrder(ids: readonly string[]): Promise<boolean>;
}

interface CalendarRepo {
  rates(planIds: readonly string[], from: string, to: string): Promise<DateRateRecord[]>;
  inventory(roomIds: readonly string[], from: string, to: string): Promise<InventoryRecord[]>;
  /** One batch of dated prices: an existing row changes only the field given, a new row takes the rest from the plan (Pallav saveRate). */
  upsertRates(rows: readonly { planId: string; date: string; doublePaise?: Paise; singlePaise?: Paise | null; planDouble: Paise; planSingle: Paise | null }[]): Promise<void>;
  upsertInventory(rows: readonly { roomId: string; date: string; roomsLeft: number; blocked: boolean }[]): Promise<void>;
  /** blocked = true/false for these rooms and dates; a missing row is made with `roomsLeft` (the room's total) when blocking. */
  setBlocked(rows: readonly { roomId: string; date: string; blocked: boolean; totalCount: number }[]): Promise<void>;
  /** Every blocked date from `from` on, by room then date (Availability::blockedRanges reads these). */
  blockedFrom(from: string): Promise<{ roomId: string; roomName: string; date: string }[]>;
}

/* ---------------------------------------------------------------- the wording, lists, settings */

export interface PageContentFields {
  heroTitleLine1: string;
  heroTitleEmphasis: string;
  heroLead: string | null;
  quickCheckTitle: string;
  qcMsgPickDates: string;
  qcMsgAvailable: string;
  qcMsgUnavailable: string;
  qcMsgError: string;
  aboutKicker: string;
  aboutHeading: string;
  aboutP1: string | null;
  aboutP2: string | null;
  aboutP3: string | null;
  enquireHeading: string;
  enquireLead: string | null;
  enquirePoints: string[];
  bookingTermsText: string | null;
  fmMsgName: string;
  fmMsgPhone: string;
  fmMsgEmail: string;
  fmMsgCheckin: string;
  fmMsgCheckout: string;
  fmMsgRoom: string;
  fmMsgAdults: string;
  fmMsgChildren: string;
  fmMsgMessage: string;
  fmMsgTerms: string;
  fmMsgSuccess: string;
  policiesFooterNote: string | null;
  footerTagline: string | null;
}

interface ContentRepo {
  /** The hotel's one row (made on first use with the column defaults). */
  get(): Promise<PageContentFields>;
  update(patch: Partial<PageContentFields>, by: string): Promise<PageContentFields>;
}

export interface GalleryPhotoRecord {
  id: string;
  path: string;
  caption: string | null;
  altText: string | null;
  sortOrder: number;
}
export interface ServiceRecord {
  id: string;
  title: string;
  description: string | null;
  iconPath: string | null;
  sortOrder: number;
}
export interface PolicyRecord {
  id: string;
  title: string;
  lines: string[];
  iconPath: string | null;
  sortOrder: number;
}
export interface NearbyRecord {
  id: string;
  title: string;
  distanceLabel: string;
  mapQuery: string | null;
  mapUrl: string | null;
  originLat: number | null;
  originLng: number | null;
  sortOrder: number;
}

/** An ordered list of cards (sort_order, id): the gallery, services, house rules and nearby places share this shape. */
export interface OrderedRepo<T extends { id: string }, Fields> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | null>;
  create(fields: Fields, by: string): Promise<T>;
  update(id: string, patch: Partial<Fields>, by: string): Promise<T>;
  remove(id: string): Promise<boolean>;
  setOrder(ids: readonly string[]): Promise<boolean>;
  count(): Promise<number>;
}

type PhotoFields = { path: string; caption: string | null; altText: string | null };
type ServiceFields = { title: string; description: string | null; iconPath?: string | null };
type PolicyFields = { title: string; lines: string[]; iconPath?: string | null };
type NearbyFields = { title: string; distanceLabel: string; mapQuery: string | null; mapUrl: string | null; originLat: number | null; originLng: number | null };

export interface SiteSettingsFields {
  openedYear: number | null;
  gmPhone: string | null;
  receptionPhone: string | null;
  email: string | null;
  address: string;
  checkinTime: string;
  checkoutTime: string;
  metaTitle: string | null;
  metaDescription: string | null;
  metaKeywords: string | null;
  logoPath: string | null;
  faviconPath: string | null;
  gbpLink: string | null;
  facebookLink: string | null;
  instagramLink: string | null;
  mapLat: number | null;
  mapLng: number | null;
  googlePlaceId: string | null;
  googleMinReviewRating: number;
  recipients: { name: string; email: string }[];
  smtpHost: string | null;
  smtpPort: number | null;
  smtpFromEmail: string | null;
  smtpFromName: string | null;
  gbpAccountId: string | null;
  gbpLocationId: string | null;
  /** When the reviews were last fetched, and how many (the Google integration fills these). */
  googleLastFetchedAt: Date | null;
  googleReviewCount: number;
}

/** The secret columns, each as stored or null. */
export interface SiteSecrets {
  googleMapsApiKey: string | null;
  gbpOauthClientId: string | null;
  gbpOauthClientSecret: string | null;
  gbpRefreshToken: string | null;
  gbpAccessToken: string | null;
  smtpUsername: string | null;
  smtpPassword: string | null;
}

interface SiteSettingsRepo {
  get(options?: { forUpdate?: boolean }): Promise<{ fields: SiteSettingsFields; secrets: SiteSecrets }>;
  update(patch: Partial<SiteSettingsFields> & { secrets?: Partial<SiteSecrets> }, by: string): Promise<{ fields: SiteSettingsFields; secrets: SiteSecrets }>;
}

/* ---------------------------------------------------------------- the website's change log, for the overview */

interface WebsiteChange {
  id: string;
  summary: string;
  userName: string | null;
  at: Date;
}
interface ChangeRepo {
  /** The latest lines of the website module in system_logs, newest first. */
  recent(limit: number): Promise<WebsiteChange[]>;
}

/* ---------------------------------------------------------------- the unit */

export interface WebsiteRepos {
  siteEnquiries: SiteEnquiryRepo;
  references: ReferenceRepo;
  siteRooms: SiteRoomRepo;
  sitePlans: PlanRepo;
  calendar: CalendarRepo;
  content: ContentRepo;
  gallery: OrderedRepo<GalleryPhotoRecord, PhotoFields>;
  services: OrderedRepo<ServiceRecord, ServiceFields>;
  policies: OrderedRepo<PolicyRecord, PolicyFields>;
  nearby: OrderedRepo<NearbyRecord, NearbyFields>;
  siteSettings: SiteSettingsRepo;
  websiteChanges: ChangeRepo;
}
