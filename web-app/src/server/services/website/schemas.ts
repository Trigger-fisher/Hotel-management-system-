import "server-only";
import { z } from "zod";

// The shapes the website routes accept (ui-shared website.ts inputs). Strict: unknown keys refused, every string and number bounded; no identity,
// creator or decision data can be sent. Pallav's rules and words are applied by the services. Spec: docs/specs/website.md.
const text = (max: number) => z.string().max(max);
const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = z.string().regex(DAY);
const pageSize = z.coerce.number().pipe(z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)]));
const page = z.coerce.number().int().min(1).max(10_000);
const search = z.string().trim().max(200).regex(NO_CONTROL).optional();
const money = z.number().int().min(0).max(99_999_999_999);

export const idParams = z.strictObject({ id: z.uuid() });

/* ---------------------------------------------------------------- enquiries */

/** The short website lists (rooms, rates, photos, services, policies, nearby places): `search` is words over the visible text. */
export const siteListQuery = z.strictObject({ search });
export const enquiryListQuery = z.strictObject({ search, tab: z.enum(["all", "pending", "confirmed", "declined"]).default("all"), page: page.default(1), pageSize: pageSize.default(25) });
export const enquiryBody = z.strictObject({
  name: text(1000),
  phone: text(1000),
  email: text(1000),
  roomId: z.union([z.uuid(), z.null()]),
  checkIn: text(40),
  checkOut: text(40),
  guests: z.number().int().min(-1000).max(1000),
  children: z.number().int().min(-1000).max(1000),
  message: text(20_000),
});
export type EnquiryBody = z.output<typeof enquiryBody>;
export const declineBody = z.strictObject({ reason: text(5000) });
export type DeclineBody = z.output<typeof declineBody>;

/* ---------------------------------------------------------------- rooms and plans */

export const roomBody = z.strictObject({
  name: text(1000),
  bedType: text(1000),
  size: text(1000),
  maxGuests: z.number().int().min(-1000).max(1000),
  totalCount: z.number().int().min(-1000).max(100_000),
  badgeLabel: text(1000),
  note: text(1000),
  showPrice: z.boolean(),
  available: z.boolean(),
  /** The photos kept, with their names and alt text; one left out is removed (uploads come with the media store). */
  photos: z.array(z.strictObject({ id: text(255), name: text(1000), alt: text(1000) })).max(60),
});
export type RoomBody = z.output<typeof roomBody>;
export const moveBody = z.strictObject({ direction: z.enum(["up", "down"]) });
export const planBody = z.strictObject({
  name: text(1000),
  code: text(1000),
  tiers: z.array(z.strictObject({ guests: z.number().int().min(-1000).max(1000), pricePaise: z.number().int().min(-1).max(99_999_999_999) })).max(40),
  extraPersonPaise: money.nullable(),
});
export type PlanBody = z.output<typeof planBody>;

/* ---------------------------------------------------------------- calendar */

export const weekQuery = z.strictObject({ start: day.optional() });
export const calendarSaveBody = z.strictObject({
  inventory: z.array(z.strictObject({ roomId: z.uuid(), date: day, capacity: z.number().int().min(-1000).max(100_000) })).max(2000),
  rates: z.array(z.strictObject({ planId: z.uuid(), date: day, occ: z.enum(["single", "double"]), pricePaise: z.number().int().min(-1).max(99_999_999_999) })).max(2000),
});
export type CalendarSaveBody = z.output<typeof calendarSaveBody>;
export const toggleBlockBody = z.strictObject({ roomId: z.uuid(), date: day });
export const blockBody = z.strictObject({ roomIds: z.array(z.uuid()).max(100), start: text(40), end: text(40) });
export type BlockBody = z.output<typeof blockBody>;
export const unblockBody = z.strictObject({ ranges: z.array(z.strictObject({ roomId: z.uuid(), start: day, end: day })).max(500) });
export const bulkRatesBody = z.strictObject({
  roomIds: z.array(z.uuid()).max(100),
  planName: text(1000),
  start: text(40),
  end: text(40),
  singlePaise: money.nullable(),
  doublePaise: money.nullable(),
  extraPaise: money.nullable(),
});
export type BulkRatesBody = z.output<typeof bulkRatesBody>;

/* ---------------------------------------------------------------- gallery, wording, cards, settings (website part 2) */

/** A file sent inside JSON: its name and the bytes as base64. The service checks the real type and size. */
// a gallery photo may be 20 MB (28 million base64 characters); icons and the logo are checked against their own 2 MB cap in the service
const upload = z.strictObject({ fileName: text(300), dataBase64: z.string().max(28_000_000) });
export const photosBody = z.strictObject({ caption: text(1000).default(""), files: z.array(upload).max(10) });
export const photoBody = z.strictObject({ caption: text(1000), altText: text(2000) });
export const fileParams = z.strictObject({ file: z.string().max(130) });

export const contentBody = z.strictObject({
  heroTitleLine1: text(5000), heroTitleEmphasis: text(5000), heroLead: text(50_000), quickCheckTitle: text(5000),
  qcMsgPickDates: text(5000), qcMsgAvailable: text(5000), qcMsgUnavailable: text(5000), qcMsgError: text(5000),
  aboutKicker: text(5000), aboutHeading: text(5000), aboutP1: text(50_000), aboutP2: text(50_000), aboutP3: text(50_000),
  enquireHeading: text(5000), enquireLead: text(50_000), enquirePoints: z.array(text(5000)).max(100), bookingTermsText: text(50_000),
  fmMsgName: text(5000), fmMsgPhone: text(5000), fmMsgEmail: text(5000), fmMsgCheckin: text(5000), fmMsgCheckout: text(5000), fmMsgRoom: text(5000),
  fmMsgAdults: text(5000), fmMsgChildren: text(5000), fmMsgMessage: text(5000), fmMsgTerms: text(5000), fmMsgSuccess: text(5000),
  policiesFooterNote: text(50_000), footerTagline: text(50_000),
});

export const serviceBody = z.strictObject({ title: text(1000), description: text(5000).default(""), icon: upload.optional(), removeIcon: z.boolean().optional() });
export const policyBody = z.strictObject({ title: text(1000), lines: z.array(text(5000)).max(200), icon: upload.optional(), removeIcon: z.boolean().optional() });
export const nearbyBody = z.strictObject({ title: text(1000), distanceLabel: text(1000).default(""), mapUrl: text(5000).default(""), mapQuery: text(5000).default("") });

const recipient = z.strictObject({ name: text(500), email: text(500) });
export const settingsBody = z.strictObject({
  gmPhone: text(100), receptionPhone: text(100), email: text(500),
  logo: upload.optional(), favicon: upload.optional(), removeLogo: z.boolean().optional(), removeFavicon: z.boolean().optional(),
  openedYear: z.number().int().min(-10_000).max(10_000), address: text(2000), checkinTime: text(100), checkoutTime: text(100),
  hotelMapUrl: text(5000).default(""), metaTitle: text(2000), metaDescription: text(10_000), metaKeywords: text(2000),
  gbpLink: text(2000), facebookLink: text(2000), instagramLink: text(2000), recipients: z.array(recipient).max(50),
  smtpHost: text(500), smtpPort: z.number().int().min(-1).max(1_000_000), smtpUsername: text(500), newSmtpPassword: text(1000).default(""),
  smtpFromEmail: text(500), smtpFromName: text(500), newGoogleMapsApiKey: text(1000).default(""), googlePlaceId: text(500),
  googleMinReviewRating: z.number().int().min(-10).max(100), gbpOauthClientId: text(1000), newGbpOauthClientSecret: text(1000).default(""),
});
export type SettingsBody = z.output<typeof settingsBody>;
/** Decision 55: Website live and the registered domains (the service cleans and judges each host name). */
export const siteAccessBody = z.strictObject({ live: z.boolean(), domains: z.array(z.string().max(300)).max(20) });

/* ---------------------------------------------------------------- the public website API (decision 55) */

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const publicSlugParams = z.strictObject({ slug: z.string().max(63).regex(SLUG) });
export const publicMediaParams = z.strictObject({ slug: z.string().max(63).regex(SLUG), file: z.string().max(120).regex(/^[a-z0-9][a-z0-9._-]{0,119}\.(jpg|png|gif|webp|svg|ico)$/) });
export const publicAvailabilityQuery = z.strictObject({
  checkIn: z.string().max(10),
  checkOut: z.string().max(10),
  adults: z.coerce.number().int().min(1).max(30).default(1),
  children: z.coerce.number().int().min(0).max(20).default(0),
});
const NO_CTRL = /^[^\u0000-\u001f\u007f]*$/;
export const publicEnquiryBody = z.strictObject({
  name: z.string().max(100).regex(NO_CTRL),
  phone: z.string().max(30).regex(NO_CTRL),
  email: z.string().max(150).regex(NO_CTRL).optional(),
  message: z.string().max(2000),
  roomSlug: z.string().max(100).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).optional(),
  checkIn: z.string().max(10).optional(),
  checkOut: z.string().max(10).optional(),
  adults: z.number().int().min(1).max(30),
  children: z.number().int().min(0).max(20),
  acceptedTerms: z.boolean(),
  /** The honeypot: real visitors never fill it. */
  website: z.string().max(200).optional(),
});
/* ------------------------------------------------------------ website designs */

/** The hotel picks a design: the folder name of a template (the service checks it is one of the listed ones). */
export const siteTemplateBody = z.strictObject({ template: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/) });
export const siteBuildParams = z.strictObject({ id: z.uuid() });
const https = z.string().max(500).regex(/^https:\/\/[^\s]+$/);
/** What the "Create hotel site" job reports (signed; sitebuild/signature.ts): building, then live or failed, with a plain sentence and its log page. */
export const siteBuildReportBody = z.strictObject({
  status: z.enum(["building", "live", "failed"]),
  message: z.string().max(500).regex(NO_CTRL).optional(),
  runUrl: https.optional(),
  siteUrl: https.optional(),
});
