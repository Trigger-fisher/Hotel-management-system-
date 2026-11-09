import type { createWebsiteApi } from './website.mock';
// Website admin (Hotel dashboard): the screens that run the hotel's public website.
// Source: Hotel Pallav "Website" module (enquiries, rooms, tariff plans, rate & inventory
// calendar, gallery, home page wording, services / house rules / nearby places, settings).
// Pure TypeScript, mock only. Money in paise. Stay dates are plain YYYY-MM-DD; timestamps ISO UTC.
// Email only: Pallav's chat and SMS fields are left out (MJ removed them).

// ---------------------------------------------------------------- types

/** Pallav stores "new" and "pending"; both read as pending. "declined" shows as Cancelled. */
export type WebEnquiryStatus = 'pending' | 'confirmed' | 'declined';

export interface WebEnquiry {
  id: string;
  /** e.g. "ENQ-2610-0042" */
  reference: string;
  name: string;
  phone: string;
  email: string | null;
  roomId: string | null;
  /** null = "Not sure yet". */
  roomName: string | null;
  checkIn: string;
  checkOut: string;
  /** TOTAL people (adults + children), as the server stores it. Adults = guests - children (see adultsOf). */
  guests: number;
  children: number;
  message: string;
  status: WebEnquiryStatus;
  createdAt: string;
  ipAddress: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
  /** Reason given when it was cancelled. */
  decisionNote: string | null;
}

/** Confirm and decline answer with the enquiry and the sentence for the toast. */
export interface EnquiryDecision { enquiry: WebEnquiry; message: string; mail?: EnquiryMailState }

/** What happened to the guest's mail (real server only): queued, the guest has no email address, it could not be queued, or mail is switched off. A mail failure never undoes the decision. */
export type EnquiryMailState = 'queued' | 'no_email' | 'failed' | 'off';
const ENQUIRY_MAIL_NOTE: Partial<Record<EnquiryMailState, string>> = { no_email: 'No email address, the guest was not told.', failed: 'The mail could not be queued.' };
/** The toast sentence of a decision: the server's sentence, plus a note when the guest was not mailed. */
export function decisionText(d: EnquiryDecision): string {
  const note = d.mail ? ENQUIRY_MAIL_NOTE[d.mail] : undefined;
  return note ? ` ` : d.message;
}

/** Adults in an enquiry (the record's guests is the total). */
export const adultsOf = (e: Pick<WebEnquiry, 'guests' | 'children'>): number => Math.max(1, e.guests - e.children);

export interface WebEnquiryInput {
  name: string;
  phone: string;
  email: string;
  roomId: string | null;
  checkIn: string;
  checkOut: string;
  /** ADULTS (1 to 30); the server stores adults + children as the total. */
  guests: number;
  children: number;
  message: string;
}

export interface WebEnquiryStats {
  all: number;
  pending: number;
  confirmed: number;
  declined: number;
}

export interface WebRoomPhoto {
  id: string;
  /** Image name (file name on the website). */
  name: string;
  alt: string;
}

export interface WebRoom {
  id: string;
  name: string;
  bedType: string;
  /** Free text, e.g. "160 sq.ft". */
  size: string;
  maxGuests: number;
  /** Physical rooms of this type. */
  totalCount: number;
  /** Small tag on the website card, e.g. "Most Booked". */
  badgeLabel: string;
  /** Note on the website, e.g. "Under renovation until March". */
  note: string;
  showPrice: boolean;
  /** Taking enquiries. */
  available: boolean;
  photos: WebRoomPhoto[];
  /** Rooms not sold or blocked today. */
  freeToday: number;
  plansCount: number;
}

export interface WebRoomInput {
  name: string;
  bedType: string;
  size: string;
  maxGuests: number;
  totalCount: number;
  badgeLabel: string;
  note: string;
  showPrice: boolean;
  available: boolean;
  photos: WebRoomPhoto[];
}

export interface WebPriceTier {
  /** Number of people this price is for. */
  guests: number;
  pricePaise: number;
}

export interface WebRatePlan {
  id: string;
  roomId: string;
  /** e.g. "Room Only", "With Breakfast". */
  name: string;
  /** Short code, e.g. "EP", "CP". */
  code: string;
  /** Price by number of people (at least one). */
  tiers: WebPriceTier[];
  /** Per additional guest; null = not offered. */
  extraPersonPaise: number | null;
  /** Paused plans are not shown on the website. */
  active: boolean;
}

export interface WebRatePlanInput {
  name: string;
  code: string;
  tiers: WebPriceTier[];
  extraPersonPaise: number | null;
}

export interface WebRoomRates {
  room: WebRoom;
  /** Lowest active price for tonight (calendar price when set). */
  tonightPaise: number;
  plans: WebRatePlan[];
}

export type WebOccupancy = 'single' | 'double';

export interface WebCalendarCell {
  date: string;
  /** Rooms open for sale that day. */
  capacity: number;
  /** Confirmed stays holding a room that night. */
  sold: number;
  blocked: boolean;
}

export interface WebCalendarPriceRow {
  occ: WebOccupancy;
  /** One per day of the week; changed = a dated price differs from the plan's base. */
  prices: { date: string; pricePaise: number; dated: boolean }[];
}

export interface WebCalendarRoom {
  roomId: string;
  roomName: string;
  totalCount: number;
  cells: WebCalendarCell[];
  plans: { planId: string; code: string; name: string; rows: WebCalendarPriceRow[] }[];
}

export interface WebCalendarWeek {
  /** Seven YYYY-MM-DD dates. */
  days: string[];
  prevStart: string;
  nextStart: string;
  today: string;
  rooms: WebCalendarRoom[];
  blocked: WebBlockedRange[];
}

export interface WebBlockedRange {
  roomId: string;
  roomName: string;
  start: string;
  end: string;
  nights: number;
}

export interface WebCalendarChanges {
  inventory: { roomId: string; date: string; capacity: number }[];
  rates: { planId: string; date: string; occ: WebOccupancy; pricePaise: number }[];
}

export interface WebBulkRatesInput {
  roomIds: string[];
  planName: string;
  start: string;
  end: string;
  singlePaise: number | null;
  doublePaise: number | null;
  extraPaise: number | null;
}

export interface WebBlockInput {
  roomIds: string[];
  start: string;
  end: string;
}

/** A picked file sent inside JSON (real server): its name and the bytes as base64. The mock keeps only the name (dataBase64 may be empty). */
export interface WebFileInput {
  fileName: string;
  dataBase64: string;
}

/** Photos may be 20 MB (the browser fits them first, the server then stores them as WebP of about 1 MB); icons and the logo 2 MB (the server checks the real type and size too). */
export const WEB_PHOTO_MAX_BYTES = 20 * 1024 * 1024;
export const WEB_ICON_MAX_BYTES = 2 * 1024 * 1024;

export interface WebPhoto {
  id: string;
  caption: string;
  altText: string;
  /** Picks the placeholder tint when there is no image (the mock has none). */
  shade: number;
  /** Real server only: the stored file name and a ready URL of the picture. */
  file?: string;
  url?: string;
}

/** The home page wording. Keys follow Pallav's sections. */
export interface WebContent {
  heroTitleLine1: string;
  heroTitleEmphasis: string;
  heroLead: string;
  quickCheckTitle: string;
  qcMsgPickDates: string;
  qcMsgAvailable: string;
  qcMsgUnavailable: string;
  qcMsgError: string;
  aboutKicker: string;
  aboutHeading: string;
  aboutP1: string;
  aboutP2: string;
  aboutP3: string;
  enquireHeading: string;
  enquireLead: string;
  /** One bullet per entry. */
  enquirePoints: string[];
  bookingTermsText: string;
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
  policiesFooterNote: string;
  footerTagline: string;
}

export type WebContentKey = keyof WebContent;

export interface WebService {
  id: string;
  title: string;
  description: string;
  hasIcon: boolean;
  /** Real server only: the stored icon file name and a ready URL (null = no icon). */
  icon?: string | null;
  iconUrl?: string | null;
}

export interface WebServiceInput {
  title: string;
  description: string;
  /** A newly picked icon file (the mock keeps only the name). */
  icon?: WebFileInput;
  /** Pallav's "Remove this icon" box. */
  removeIcon?: boolean;
}

export interface WebPolicyCard {
  id: string;
  title: string;
  lines: string[];
  hasIcon: boolean;
  icon?: string | null;
  iconUrl?: string | null;
}

export interface WebPolicyInput {
  title: string;
  lines: string[];
  icon?: WebFileInput;
  removeIcon?: boolean;
}

export type WebPlaceLocation = 'exact' | 'link' | 'name';

export interface WebNearbyPlace {
  id: string;
  title: string;
  distanceLabel: string;
  mapUrl: string;
  mapQuery: string;
  location: WebPlaceLocation;
}

export interface WebNearbyInput {
  title: string;
  distanceLabel: string;
  mapUrl: string;
  mapQuery: string;
}

export interface WebNearbyList {
  /** false = the hotel's own map pin is not set; distances must be typed. */
  hotelPinned: boolean;
  places: WebNearbyPlace[];
}

export interface WebRecipient {
  name: string;
  email: string;
}

export type WebGoogleStatus = 'notSetUp' | 'ready' | 'connected';

/** Secrets never come back: each secret field is only a set flag (the server never returns the value, not even a masked hint). */
export interface WebSettings {
  gmPhone: string;
  receptionPhone: string;
  email: string;
  openedYear: number;
  address: string;
  checkinTime: string;
  checkoutTime: string;
  mapLat: number | null;
  mapLng: number | null;
  metaTitle: string;
  metaDescription: string;
  metaKeywords: string;
  gbpLink: string;
  facebookLink: string;
  instagramLink: string;
  hasLogo: boolean;
  hasFavicon: boolean;
  /** Real server only: ready URLs of the saved logo / browser icon (null = none). */
  logoUrl?: string | null;
  faviconUrl?: string | null;
  /**
   * Real server only: false = this person may not see or change the mail and Google secrets (those fields come back empty and are ignored on
   * save), so the screen hides that part. Absent / true = shown.
   */
  secretsVisible?: boolean;
  recipients: WebRecipient[];
  smtpHost: string;
  smtpPort: number;
  smtpUsername: string;
  smtpPasswordSet: boolean;
  smtpFromEmail: string;
  smtpFromName: string;
  /** e.g. "AIza••••••••3kQw"; null = not set. */
  googleMapsApiKeySet: boolean;
  googlePlaceId: string;
  googleMinReviewRating: number;
  gbpOauthClientId: string;
  gbpOauthClientSecretSet: boolean;
  gbpRedirectUrl: string;
  googleStatus: WebGoogleStatus;
  googleLastFetchedAt: string | null;
  googleReviewCount: number;
}

export interface WebSettingsInput {
  gmPhone: string;
  receptionPhone: string;
  email: string;
  /** Newly picked logo / browser icon files (the mock keeps only the name). */
  logo?: WebFileInput;
  favicon?: WebFileInput;
  /** Pallav's "Remove" boxes next to a saved logo / browser icon. */
  removeLogo?: boolean;
  removeFavicon?: boolean;
  openedYear: number;
  address: string;
  checkinTime: string;
  checkoutTime: string;
  /** Paste only to move the pin; empty = keep. */
  hotelMapUrl: string;
  metaTitle: string;
  metaDescription: string;
  metaKeywords: string;
  gbpLink: string;
  facebookLink: string;
  instagramLink: string;
  recipients: WebRecipient[];
  smtpHost: string;
  smtpPort: number;
  smtpUsername: string;
  /** Empty = keep the saved password. */
  newSmtpPassword: string;
  smtpFromEmail: string;
  smtpFromName: string;
  /** Empty = keep the saved key. */
  newGoogleMapsApiKey: string;
  googlePlaceId: string;
  googleMinReviewRating: number;
  gbpOauthClientId: string;
  /** Empty = keep the saved secret. */
  newGbpOauthClientSecret: string;
}

export interface WebArrival {
  id: string;
  reference: string;
  name: string;
  phone: string;
  roomName: string | null;
  guests: number;
  children: number;
  checkIn: string;
  message: string;
}

export interface WebChange {
  id: string;
  summary: string;
  userName: string | null;
  at: string;
}

export interface WebOverview {
  siteUrl: string;
  /** Financial year start, e.g. 2026 = FY 2026-27. */
  fy: number;
  currentFy: number;
  years: number[];
  stats: WebEnquiryStats;
  arrivingToday: WebArrival[];
  arrivingWeek: WebArrival[];
  recent: WebEnquiry[];
  blocked: WebBlockedRange[];
  changes: WebChange[];
  facts: { rooms: number; photos: number };
}

export type WebDirection = 'up' | 'down';
export type WebListKind = 'services' | 'policies' | 'nearby';

// ---------------------------------------------------------------- helpers (pure, used by screens too)

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Today's date in IST as YYYY-MM-DD. */
export function todayIst(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/** Nights between two plain dates (0 when missing or out of order). */
export function nightsBetween(checkIn: string, checkOut: string): number {
  if (!checkIn || !checkOut) return 0;
  const n = Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** "2 adults, 1 child". */
export function guestsLabel(adults: number, children: number): string {
  const a = `${adults} ${adults === 1 ? 'adult' : 'adults'}`;
  return children > 0 ? `${a}, ${children} ${children === 1 ? 'child' : 'children'}` : a;
}

/** "+91 98250 12345" from a 10-digit Indian mobile; anything else as typed. */
export function displayPhone(phone: string): string {
  const d = phone.replace(/\D/g, '');
  const ten = d.length === 12 && d.startsWith('91') ? d.slice(2) : d;
  return ten.length === 10 ? `+91 ${ten.slice(0, 5)} ${ten.slice(5)}` : phone;
}

/** "FY 2026-27". */
export function fyLabel(fy: number): string {
  return `FY ${fy}-${String(fy + 1).slice(2)}`;
}

/** Monday of the week containing the date. */
export function weekStart(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, day === 0 ? -6 : 1 - day);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const URL_RE = /^https?:\/\/\S+\.\S+/i;

function phoneOk(p: string): boolean {
  const d = p.replace(/\D/g, '');
  return d.length >= 10 && d.length <= 13;
}

export type FieldErrors = Record<string, string>;

export function validateEnquiry(i: WebEnquiryInput): FieldErrors {
  const e: FieldErrors = {};
  if (i.name.trim().length < 2) e.name = 'Enter the guest name.';
  if (!phoneOk(i.phone)) e.phone = 'Enter a valid mobile number.';
  if (i.email.trim() && !EMAIL.test(i.email.trim())) e.email = 'Enter a valid email, or leave it empty.';
  if (!i.checkIn) e.checkIn = 'Pick the check-in date.';
  if (!i.checkOut) e.checkOut = 'Pick the check-out date.';
  else if (i.checkIn && nightsBetween(i.checkIn, i.checkOut) < 1) e.checkOut = 'Check-out must be after check-in.';
  if (!Number.isInteger(i.guests) || i.guests < 1 || i.guests > 30) e.guests = 'Between 1 and 30 adults.';
  if (!Number.isInteger(i.children) || i.children < 0 || i.children > 20) e.children = 'Between 0 and 20 children.';
  if (!i.message.trim()) e.message = 'Add a short message.';
  return e;
}

export function validateRoom(i: WebRoomInput): FieldErrors {
  const e: FieldErrors = {};
  if (!i.name.trim()) e.name = 'Enter the room name.';
  if (!Number.isInteger(i.maxGuests) || i.maxGuests < 1 || i.maxGuests > 20) e.maxGuests = 'Between 1 and 20 guests.';
  if (!Number.isInteger(i.totalCount) || i.totalCount < 1 || i.totalCount > 255) e.totalCount = 'Between 1 and 255 rooms.';
  return e;
}

export function validatePlan(i: WebRatePlanInput): FieldErrors {
  const e: FieldErrors = {};
  if (!i.name.trim()) e.name = 'Enter the plan name.';
  if (!i.code.trim()) e.code = 'Enter a short code, e.g. CP.';
  else if (i.code.trim().length > 10) e.code = 'Ten letters at most.';
  if (i.tiers.length === 0) e.tiers = 'Add at least one price.';
  else if (i.tiers.some((t) => t.guests < 1 || t.pricePaise <= 0)) e.tiers = 'Each price needs people (1 or more) and an amount.';
  else if (new Set(i.tiers.map((t) => t.guests)).size !== i.tiers.length) e.tiers = 'Each number of people can have only one price.';
  return e;
}

export function validateRange(start: string, end: string, roomIds: string[]): FieldErrors {
  const e: FieldErrors = {};
  if (roomIds.length === 0) e.roomIds = 'Pick at least one room category.';
  if (!start) e.start = 'Pick the start date.';
  if (!end) e.end = 'Pick the end date.';
  else if (start && end < start) e.end = 'End date cannot be before the start date.';
  return e;
}

/**
 * Decision 55: the "Website live" switch and the addresses the hotel's own website runs on (GET and PUT /website/site). The hotel's website may call
 * HMS only from these addresses, and its Sign in button must point at `signInUrl`. The whole list is replaced on save.
 */
export interface WebSite {
  live: boolean;
  /** Host names only, lower-case, at most MAX_SITE_DOMAINS. */
  domains: string[];
  /** The hotel's short name in HMS addresses. */
  slug: string;
  /** What the website's Sign in button must open: <HMS address>/?hotel=<slug>. */
  signInUrl: string;
}

export interface WebSiteInput {
  live: boolean;
  domains: string[];
}

export const MAX_SITE_DOMAINS = 5;
const HOST_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Client-side check of the address list (the server checks again and also refuses an address another hotel uses). Empty object = fine. */
export function validateSiteDomains(domains: string[]): FieldErrors {
  const list = domains.map((d) => d.trim()).filter(Boolean);
  if (list.length > MAX_SITE_DOMAINS) return { domains: `Add at most ${MAX_SITE_DOMAINS} addresses.` };
  const seen = new Set<string>();
  for (const d of list) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(d) || d.includes('/')) return { domains: `Write only the address, like www.thehotel.in (no http:// and no page path): ${d}` };
    if (/\s/.test(d)) return { domains: `An address cannot have spaces: ${d}` };
    if (d.includes(':')) return { domains: `Leave out the port number: ${d}` };
    if (d !== d.toLowerCase()) return { domains: `Use small letters only: ${d.toLowerCase()}` };
    if (!HOST_RE.test(d)) return { domains: `${d} is not a web address. Write it like www.thehotel.in.` };
    if (seen.has(d)) return { domains: `${d} is listed twice.` };
    seen.add(d);
  }
  return {};
}

export function validateSettings(i: WebSettingsInput): FieldErrors {
  const e: FieldErrors = {};
  if (!phoneOk(i.gmPhone)) e.gmPhone = 'Enter a valid phone number.';
  if (!phoneOk(i.receptionPhone)) e.receptionPhone = 'Enter a valid phone number.';
  if (!EMAIL.test(i.email.trim())) e.email = 'Enter a valid email.';
  if (!Number.isInteger(i.openedYear) || i.openedYear < 1800 || i.openedYear > new Date().getFullYear() + 1) e.openedYear = 'Enter a year like 2002.';
  if (!i.address.trim()) e.address = 'Enter the address.';
  if (!i.checkinTime.trim()) e.checkinTime = 'Enter the check-in time.';
  if (!i.checkoutTime.trim()) e.checkoutTime = 'Enter the check-out time.';
  for (const k of ['hotelMapUrl', 'gbpLink', 'facebookLink', 'instagramLink'] as const) {
    if (i[k].trim() && !URL_RE.test(i[k].trim())) e[k] = 'Enter a full link starting with https://';
  }
  i.recipients.forEach((r, idx) => {
    if (!EMAIL.test(r.email.trim())) e[`recipient${idx}`] = 'Enter a valid email.';
  });
  if (i.smtpFromEmail.trim() && !EMAIL.test(i.smtpFromEmail.trim())) e.smtpFromEmail = 'Enter a valid email.';
  if (!Number.isInteger(i.smtpPort) || i.smtpPort < 1 || i.smtpPort > 65535) e.smtpPort = 'Enter a port like 587.';
  return e;
}

// ---------------------------------------------------------------- copy

export const websiteCopy = {
  common: {
    save: 'Save',
    saveChanges: 'Save changes',
    cancel: 'Cancel',
    edit: 'Edit',
    delete: 'Delete',
    add: 'Add',
    moveUp: 'Move up',
    moveDown: 'Move down',
    back: 'Back',
    retry: 'Retry',
    saved: 'Saved. The website follows straight away.',
    deleted: 'Deleted.',
    moved: 'Order saved.',
    optional: '(optional)',
    none: '—',
    seeAll: 'See all',
    notSure: 'Not sure yet',
    comesWithBackend: 'Comes with the backend',
    uploadNote: 'Uploading images comes with the backend. For now each photo shows as a placeholder.',
    iconNote: 'Icon upload (SVG works best) comes with the backend.',
  },
  overview: {
    title: 'Website',
    subtitle: (host: string) => `The hotel website at ${host}: its enquiries, rooms, rates, photos and wording are all managed here.`,
    fyLabel: 'Financial year',
    current: '(current)',
    reviewPending: 'Review pending',
    openSite: 'Open website',
    kpiAll: 'All enquiries',
    kpiPending: 'Pending',
    kpiConfirmed: 'Confirmed',
    kpiCancelled: 'Cancelled',
    arriving: 'Arriving soon',
    arrivingSub: 'Confirmed bookings only',
    today: 'Today',
    week: 'Next 7 days',
    noToday: 'No arrivals today.',
    noWeek: 'No arrivals in the next 7 days.',
    recent: 'Recent enquiries',
    noRecent: 'No enquiries in this year yet.',
    blocked: 'Closed to booking',
    noBlocked: 'Nothing is blocked right now.',
    openCalendar: 'Open the calendar',
    changes: 'Recent changes',
    noChanges: 'Nothing changed yet.',
    system: 'System',
    facts: 'At a glance',
    roomCategories: 'Room categories',
    galleryPhotos: 'Gallery photos',
    noRoom: 'No room',
  },
  enquiries: {
    title: 'Enquiries',
    subtitle: 'Every enquiry from the website. Confirm one and it becomes a booking; cancel it and the room is free again.',
    search: 'Search name, phone, email, reference',
    tabs: { all: 'All', pending: 'Pending', confirmed: 'Confirmed', declined: 'Cancelled' },
    status: { pending: 'Pending', confirmed: 'Confirmed', declined: 'Cancelled' },
    cols: { sent: 'Sent', reference: 'Reference', guest: 'Guest', room: 'Room', stay: 'Stay', nights: 'Nights', status: 'Status' },
    summary: (shown: number, total: number) => `Showing ${shown} of ${total} enquiries`,
    emptyTitle: 'Nothing here yet',
    emptySearch: (q: string) => `Nothing matches "${q}"`,
    emptyBody: 'Enquiries sent from the website appear here as they arrive.',
    detailTitle: (ref: string) => `Enquiry ${ref}`,
    guest: 'Guest',
    said: 'What they said',
    noMessage: 'No message.',
    decision: 'Decision',
    decidedLine: (what: string, when: string, by: string | null) => `${what} ${when}${by ? ` by ${by}` : ''}`,
    reason: 'Reason',
    k: { name: 'Name', mobile: 'Mobile', email: 'Email', room: 'Room', guests: 'Guests', checkIn: 'Check-in', checkOut: 'Check-out', nights: 'Nights', sent: 'Sent', from: 'From (IP)' },
    confirm: 'Confirm',
    confirmTitle: (ref: string) => `Confirm ${ref}?`,
    confirmBody: (room: string) => `This holds ${room} for these dates and tells the team.`,
    confirmed: 'Confirmed. The guest will be emailed.',
    cancel: 'Cancel enquiry',
    cancelBooking: 'Cancel booking',
    cancelTitle: (ref: string, booking: boolean) => `${booking ? 'Cancel booking' : 'Cancel enquiry'} ${ref}`,
    reasonLabel: 'Reason',
    reasonPlaceholder: 'Why is this not going ahead?',
    reasonHint: 'The room is free again for those dates, and the team is told with this reason.',
    reasonMissing: 'Give a reason.',
    keep: 'Keep it',
    cancelIt: 'Cancel it',
    cancelled: 'Cancelled. The guest will be emailed.',
    editTitle: (ref: string) => `Edit ${ref}`,
    f: { name: 'Guest name', phone: 'Mobile', email: 'Email', guests: 'Adults', children: 'Children', room: 'Room', checkIn: 'Check-in', checkOut: 'Check-out', message: 'Message' },
    deleteTitle: (ref: string) => `Delete ${ref}?`,
    deleteBody: 'This enquiry will be removed for good.',
    call: 'Call',
    mail: 'Email',
  },
  rooms: {
    title: 'Website Rooms',
    subtitle: 'The room categories shown on the website, in the order guests see them.',
    add: 'Add room category',
    emptyTitle: 'No room categories yet',
    emptyBody: 'Add the first one and it appears on the website as soon as it is saved.',
    noPhoto: 'No photo yet',
    noDetails: 'No details yet',
    taking: 'Taking enquiries',
    unavailable: 'Unavailable',
    inCategory: 'Rooms in category',
    freeToday: 'Free today',
    plans: 'Rate plans',
    rates: 'Rates',
    deleteTitle: (name: string) => `Delete ${name}?`,
    deleteBody: 'This room category and its photos will be removed for good.',
    formAdd: 'Add room category',
    formEdit: (name: string) => `Edit ${name}`,
    formAddSub: 'Create a room category. It appears on the website once saved; set its prices under Rates.',
    formEditSub: 'Change this room category. The website follows as soon as it is saved.',
    sectionRoom: 'The room',
    sectionPhotos: 'Photos',
    photosHint: 'The first photo shows first in the room\'s slider. Give each a name and alt text for search engines and screen readers.',
    f: {
      name: 'Room name', namePh: 'e.g. Executive Suite',
      bed: 'Bed type', bedPh: 'e.g. Queen Bed',
      size: 'Size', sizePh: 'e.g. 160 sq.ft',
      maxGuests: 'Max guests',
      count: 'Rooms in this category', countHint: 'How many physical rooms of this type exist. The website\'s room count comes from this.',
      badge: 'Badge', badgePh: 'e.g. Most Booked, Premium, Best Value', badgeHint: 'The small tag on the top left of the room\'s card on the website.',
      note: 'Note on the website', notePh: 'e.g. Under renovation until March',
      showPrice: 'Show prices to guests',
      available: 'Taking enquiries',
      photoName: 'Image name',
      photoAlt: 'Alt text (for search and accessibility)',
    },
    removePhoto: 'Remove photo',
    addPhotos: 'Add photos',
    create: 'Create room',
    created: 'Room category created.',
    notFound: 'This room category no longer exists.',
  },
  rates: {
    title: 'Tariff Plans',
    subtitle: 'Several tariff plans per room (Room Only, With Breakfast). Dated prices are set in the calendar; guests see today\'s price on the website.',
    openCalendar: 'Open the calendar',
    emptyTitle: 'No rooms yet',
    emptyBody: 'Add a room category first, then give it tariff plans here.',
    addRoom: 'Add a room',
    tonight: 'Tonight\'s rate',
    pricesVisible: 'Prices visible to guests',
    pricesHidden: 'Prices hidden from guests',
    editRoom: 'Edit room',
    plansHead: 'Rate plans',
    addPlan: 'Add rate plan',
    noPlans: 'No tariff plans yet. Add "Room Only", "With Breakfast" and so on so guests can see prices on the website.',
    persons: (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`,
    extraPerson: 'Extra person',
    paused: 'Paused: not shown on the website',
    pause: 'Pause',
    activate: 'Activate',
    pausedToast: 'Plan paused. It is hidden from the website.',
    activeToast: 'Plan active again.',
    addTitle: (room: string) => `Add a plan to ${room}`,
    editTitle: (plan: string) => `Edit ${plan}`,
    f: {
      name: 'Plan name', namePh: 'e.g. With Breakfast',
      code: 'Short code', codePh: 'e.g. CP',
      tiers: 'Price by number of people',
      people: 'People',
      price: 'Price',
      addTier: 'Add another price',
      removeTier: 'Remove this price',
      extra: 'Extra person price', extraHint: 'Per additional guest.',
    },
    savePlan: 'Save plan',
    deleteTitle: (name: string) => `Delete ${name}?`,
    deleteBody: 'This plan and every dated price on it will be removed.',
  },
  calendar: {
    title: 'Rate & Inventory Calendar',
    subtitle: 'Change any day\'s rooms open or price, then save. A confirmed stay holds its room from check-in up to, but not including, check-out.',
    bulk: 'Bulk update rates',
    block: 'Block dates',
    unblock: 'Unblock dates',
    allRooms: 'All rooms',
    prevWeek: 'Previous week',
    nextWeek: 'Next week',
    thisWeek: 'This week',
    roomsPlans: 'Rooms & plans',
    roomsOpen: 'Rooms open',
    priceNote: 'Prices are in rupees (₹) per night.',
    swipeHint: 'Swipe sideways to see the other days.',
    sold: (n: number) => `${n} sold`,
    cantBlockSold: 'Cannot block: rooms are already sold for this day.',
    booked: 'Booked',
    bookedHint: 'Cancel the booking to free this date.',
    blockedTag: 'Blocked',
    blockDay: 'Block',
    unblockDay: 'Unblock',
    toggleTitle: (block: boolean, room: string) => `${block ? 'Block' : 'Unblock'} ${room}?`,
    toggleBody: (block: boolean, date: string) => `${block ? 'Close' : 'Open'} ${date} for booking?`,
    occ: { single: '1 guest rate', double: '2 guests rate' },
    noPlans: 'No tariff plans for this room yet.',
    addPlan: 'Add one',
    capacityHint: (sold: number, max: number) => `Between ${sold} (already confirmed) and ${max} (rooms in this category).`,
    unsaved: (n: number) => `${n} unsaved ${n === 1 ? 'change' : 'changes'}`,
    saveAll: 'Save all changes',
    discard: 'Discard',
    savedAll: 'Calendar saved.',
    savedSome: (n: number) => `${n} ${n === 1 ? 'change' : 'changes'} saved.`,
    blockedTitle: 'Blocked dates',
    blockedSub: 'Every stretch still closed to booking, from yesterday onward.',
    noBlocked: 'No blocked dates right now.',
    cols: { room: 'Room', dates: 'Dates', nights: 'Nights' },
    emptyTitle: 'No rooms yet',
    emptyBody: 'Add a room category and its tariff plans, then manage its dates here.',
    bulkHint: 'Sets a price on every date in the range, for the plan of that name in each room you pick.',
    rooms: 'Room categories',
    plan: 'Rate plan',
    planPh: 'Select plan',
    start: 'Start date',
    end: 'End date',
    prices: 'Prices',
    pricesHint: 'Fill only what you want to change.',
    single: '1 guest',
    double: '2 guests',
    extra: 'Extra person',
    apply: 'Apply',
    bulkDone: (n: number) => `Prices set on ${n} ${n === 1 ? 'date' : 'dates'}.`,
    bulkNothing: 'Fill at least one price.',
    planMissing: 'Pick a rate plan.',
    blockHint: 'Closes every date in the range for the rooms you pick: guests cannot book them. Dates that already have a confirmed booking are skipped.',
    blockDone: (n: number, skipped: number) => `${n} ${n === 1 ? 'date' : 'dates'} blocked${skipped ? `, ${skipped} skipped (already booked)` : ''}.`,
    unblockHint: 'Choose which blocked stretches open for booking again.',
    unblockSelected: 'Unblock selected',
    unblockTitle: 'Unblock these dates?',
    unblockBody: (room: string, dates: string) => `${room}, ${dates} opens for booking again.`,
    unblockDone: 'Dates open for booking again.',
    pickOne: 'Pick at least one stretch.',
    day: 'Day',
  },
  gallery: {
    title: 'Website Gallery',
    subtitle: 'The photos in the website gallery, in the order guests see them.',
    upload: 'Upload photos',
    photos: 'Photos',
    caption: 'Caption',
    captionPh: 'e.g. Deluxe room, Hotel lobby',
    captionHint: 'Also names the file and becomes the alt text, which search engines read.',
    uploadBtn: 'Upload',
    emptyTitle: 'No photos yet',
    emptyBody: 'Uploaded photos appear in the website\'s gallery.',
    noCaption: 'No caption',
    noAlt: 'No alt text',
    alt: (a: string) => `Alt: ${a}`,
    details: 'Photo details',
    altText: 'Alt text',
    altHint: 'Describes the photo for search engines and screen readers.',
    deleteTitle: 'Delete this photo?',
    deleteBody: 'It is removed from the website gallery and from the server.',
    position: (i: number, n: number) => `${i} of ${n}`,
  },
  content: {
    title: 'Website Content',
    subtitle: 'The wording of the website\'s home page. Services, house rules and nearby places have their own page.',
    preview: 'Preview site',
    saveAll: 'Save all changes',
    unsaved: 'Unsaved changes',
    required: (label: string) => `${label} is required.`,
    pointsHint: 'One per line.',
  },
  lists: {
    title: 'Services, Policies, Nearby',
    subtitle: 'What the website lists about the hotel, in the order guests see it.',
    tabs: { services: 'Services', policies: 'House rules', nearby: 'Nearby' },
    services: {
      intro: 'The services and facilities listed on the website.',
      add: 'Add service',
      addTitle: 'Add a service',
      editTitle: (t: string) => `Edit ${t}`,
      emptyTitle: 'No services yet',
      emptyBody: 'Add the facilities guests should know about: Wi-Fi, parking, a restaurant.',
      noDescription: 'No description',
      f: { title: 'Title', titlePh: 'e.g. Free parking', description: 'Short description', descriptionPh: 'One line guests will read', icon: 'Icon' },
      deleteTitle: (t: string) => `Delete ${t}?`,
      deleteBody: 'This service is removed from the website.',
    },
    policies: {
      intro: 'The house rules and booking terms shown as cards on the website.',
      add: 'Add card',
      addTitle: 'Add a rule card',
      editTitle: (t: string) => `Edit ${t}`,
      emptyTitle: 'No rule cards yet',
      emptyBody: 'Add cards such as Check-in and check-out, Cancellation, Guest rules.',
      more: (n: number) => `and ${n} more`,
      f: { title: 'Card title', titlePh: 'e.g. Check-in and check-out', lines: 'Rules', linesHint: 'One per line.', linesPh: 'Check-in is from 12:00 pm\nGovernment ID is required for every guest', icon: 'Icon' },
      deleteTitle: (t: string) => `Delete ${t}?`,
      deleteBody: 'This card is removed from the website.',
    },
    nearby: {
      intro: 'The places shown above the website\'s map, such as the airport and the railway station. Each links to directions to the hotel.',
      add: 'Add place',
      addTitle: 'Add a place',
      editTitle: (t: string) => `Edit ${t}`,
      emptyTitle: 'No places yet',
      emptyBody: 'Add the airport, the railway station, the bus stand: whatever guests ask about.',
      notPinned: 'The hotel\'s own location is not set yet, so distances cannot be worked out for you; type them by hand.',
      openSettings: 'Set it in Website Settings',
      located: { exact: 'Exact location found', link: 'Uses the pasted link', name: 'Found by name on Google Maps' },
      f: {
        title: 'Place name', titlePh: 'e.g. Rajkot Railway Station',
        mapUrl: 'Google Maps link', mapUrlHint: 'Open the place on Google Maps, press Share and paste the link. Its exact location is worked out once, when you save.',
        distance: 'Distance', distancePh: 'e.g. 4.5 km', distanceHint: 'Leave empty to have the driving distance worked out from the link.',
        query: 'Search words', queryHint: 'Only used without a link.', queryPh: 'e.g. Rajkot Junction railway station',
      },
      deleteTitle: (t: string) => `Delete ${t}?`,
      deleteBody: 'This place is removed from the website.',
      recommended: '(recommended)',
    },
    titleMissing: 'Enter a title.',
    linkInvalid: 'Enter a full link starting with https://',
    /** Picking a file (photos 20 MB, icons and logo 2 MB; the server also checks the real file type). */
    photoTooBig: (name: string) => `${name} is bigger than 20 MB. Choose a smaller photo.`,
    iconTooBig: (name: string) => `${name} is bigger than 2 MB. Choose a smaller picture.`,
    fileUnreadable: (name: string) => `${name} could not be read. Choose it again.`,
    /** Picked pictures are made smaller in the browser before they are sent (the limit is given in MB, e.g. "3.5"). */
    imageNotPicture: (name: string) => `${name} is not a picture that can be used. Choose a JPG, PNG or WebP image.`,
    imageStillTooBig: (name: string, mb: string) => `${name} is still bigger than ${mb} MB after it was made smaller, so it was not sent. Choose a smaller picture or crop it first.`,
    imageCannotShrink: (name: string, mb: string) => `${name} is bigger than ${mb} MB, and an SVG, GIF or ICO file cannot be made smaller here, so it was not sent. Choose a smaller file.`,
  },
  settings: {
    title: 'Website Settings',
    subtitle: 'How the hotel is reached, how it shows in search, who is told about enquiries, and the mail and Google connections.',
    save: 'Save settings',
    reach: 'How guests reach the hotel',
    reachHint: 'Shown on every page of the website and in every email it sends.',
    map: 'The hotel on the map',
    mapPinned: (lat: number, lng: number) => `Pinned at ${lat}, ${lng}. Paste a new link only to move the pin.`,
    mapNotPinned: 'Not pinned yet: the map uses a rough point. Paste a link to pin it.',
    mapHint: 'Open the hotel on Google Maps, press Share and paste the link. Nearby places measure their distance from it.',
    seo: 'Search engines and links',
    seoHint: 'Leave the search wording empty to use the website\'s own.',
    brand: 'Logo and browser icon',
    brandHint: 'Without a logo the website shows its own monogram.',
    logo: 'Logo',
    favicon: 'Browser icon',
    set: 'Saved',
    notSet: 'Not set',
    notify: 'Who is told about enquiries',
    notifyHint: 'Each person gets an email when an enquiry arrives, is confirmed or is cancelled, greeted by name.',
    addPerson: 'Add a person',
    removePerson: 'Remove this person',
    noRecipients: 'Nobody is told yet. Add at least one person.',
    mail: 'Mail account',
    mailHint: 'The website\'s emails go out through this account. Left empty, the app\'s own mail account is used.',
    reviews: 'Google reviews',
    reviewsHint: 'With an API key and the hotel\'s place id, the website shows the live Google rating and up to five reviews.',
    gbp: 'Every review (Google Business Profile)',
    gbpHint: (url: string) => `Optional. Needs a Google Cloud sign-in app, approved by Google for the Business Profile API, with this return address: ${url}`,
    status: 'Status',
    statusLabel: { notSetUp: 'Not set up', ready: 'Ready to connect', connected: 'Connected' },
    lastFetched: (when: string, n: number) => `Last fetched ${when}, ${n} reviews.`,
    connect: 'Connect Google Business Profile',
    refresh: 'Fetch reviews now',
    disconnect: 'Disconnect',
    disconnectTitle: 'Disconnect Google?',
    disconnectBody: 'The website goes back to showing at most five reviews.',
    connected: 'Google Business Profile connected.',
    refreshed: (n: number) => `Reviews fetched: ${n}.`,
    disconnected: 'Google disconnected.',
    gbpNote: 'The Google sign-in itself comes with the backend; here it is simulated.',
    stars: (n: number) => `${n} ${n === 1 ? 'star' : 'stars'}`,
    keepSecret: 'Saved. Type to change',
    secretEmpty: 'Not set',
    f: {
      gmPhone: 'General manager phone', receptionPhone: 'Reception phone', email: 'Email',
      openedYear: 'Opened in (year)', address: 'Address', checkin: 'Check-in time', checkout: 'Check-out time', timePh: '12:00 pm',
      mapUrl: 'Hotel\'s Google Maps link',
      metaTitle: 'Page title', metaDescription: 'Description', metaKeywords: 'Keywords',
      gbpLink: 'Google Business link', facebook: 'Facebook', instagram: 'Instagram',
      name: 'Name', personEmail: 'Email',
      smtpHost: 'SMTP host', smtpPort: 'Port', smtpUser: 'Username', smtpPass: 'Password', smtpPassPh: 'App password',
      fromEmail: 'Send as (email)', fromName: 'Send as (name)',
      apiKey: 'Google Maps API key', placeId: 'Place id', minRating: 'Lowest rating shown',
      clientId: 'OAuth client id', clientSecret: 'OAuth client secret',
    },
  },
} as const;

// ---------------------------------------------------------------- mock data

export const SITE_URL = 'https://www.hotelsunriserajkot.in';
/** The public website (Pallav's config('site.url')): the "View site" tab and "Preview site" button open it. */
export const WEBSITE_URL = SITE_URL;

export type WebsiteApi = ReturnType<typeof createWebsiteApi>;

// ---------------------------------------------------------------- content sections (form layout)

export interface WebContentField {
  key: WebContentKey;
  label: string;
  /** 'line' = one-line input, 'text' = paragraph, 'list' = one item per line. */
  kind: 'line' | 'text' | 'list';
  required: boolean;
  max: number;
  hint?: string;
}

export interface WebContentSection {
  id: string;
  label: string;
  title: string;
  hint: string;
  fields: WebContentField[];
}

const line = (key: WebContentKey, label: string, max = 150, hint?: string): WebContentField => ({ key, label, kind: 'line', required: true, max, hint });
const text = (key: WebContentKey, label: string, required = true, hint?: string): WebContentField => ({ key, label, kind: 'text', required, max: 2000, hint });

export const webContentSections: WebContentSection[] = [
  { id: 'hero', label: 'Hero', title: 'Hero banner', hint: 'The big section at the very top of the home page.',
    fields: [line('heroTitleLine1', 'Headline, line 1', 100), line('heroTitleEmphasis', 'Headline, line 2', 100, 'Shown in gold italic.'), text('heroLead', 'Lead paragraph')] },
  { id: 'check', label: 'Check availability', title: 'Check availability', hint: 'The strip just under the hero, and what it says once a guest checks dates.',
    fields: [line('quickCheckTitle', 'Bar title', 100), line('qcMsgPickDates', 'No dates picked', 200), line('qcMsgAvailable', 'Rooms available', 200), line('qcMsgUnavailable', 'Rooms not available', 300), line('qcMsgError', 'Could not check (network or server error)', 200)] },
  { id: 'about', label: 'About', title: 'About / Our story', hint: 'The "Our story" section. Years open, room count and Google rating there are worked out automatically.',
    fields: [line('aboutKicker', 'Kicker label', 50), line('aboutHeading', 'Heading', 150), text('aboutP1', 'Paragraph 1', false), text('aboutP2', 'Paragraph 2', false), text('aboutP3', 'Paragraph 3', false)] },
  { id: 'enquire', label: 'Enquiry section', title: 'Enquiry section', hint: 'The booking enquiry form near the bottom of the page.',
    fields: [line('enquireHeading', 'Heading', 150), text('enquireLead', 'Lead paragraph'), { key: 'enquirePoints', label: 'Bullet points', kind: 'list', required: false, max: 2000, hint: 'One per line.' },
      text('bookingTermsText', 'Terms & Conditions', false, 'Shown in the pop-up a guest opens from "I agree to the Terms & Conditions".')] },
  { id: 'messages', label: 'Form messages', title: 'Enquiry form messages', hint: 'Shown when a guest leaves a required box empty or types something invalid.',
    fields: [line('fmMsgName', 'Name missing or too short'), line('fmMsgPhone', 'Invalid mobile number'), line('fmMsgEmail', 'Invalid email'), line('fmMsgCheckin', 'Check-in missing'), line('fmMsgCheckout', 'Check-out missing'),
      line('fmMsgRoom', 'Room missing'), line('fmMsgAdults', 'Adults missing'), line('fmMsgChildren', 'Children missing'), line('fmMsgMessage', '"Anything we should know" missing'), line('fmMsgTerms', 'Terms & Conditions not accepted'),
      line('fmMsgSuccess', 'Success message', 250, 'Use {{reference}} where the enquiry reference should appear.')] },
  { id: 'policies', label: 'House rules note', title: 'House rules note', hint: 'The note at the bottom of the "House rules" section.',
    fields: [text('policiesFooterNote', 'Footer note', false, 'Use {{gm_phone}} where the General Manager\'s number (from Website Settings) should appear as a link.')] },
  { id: 'footer', label: 'Footer', title: 'Footer', hint: 'Contact details in the footer come from Website Settings; this is the line under the logo.',
    fields: [text('footerTagline', 'Footer tagline')] },
];
