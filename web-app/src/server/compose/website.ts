import "server-only";
import path from "node:path";
import { getDatabase } from "../../db";
import { getConfig, mediaDriverOf, photoStorageUnavailable } from "../config/env";
import { createDbMediaStore } from "../media/db";
import { getLogger } from "../logger";
import { getPlatformUnit } from "./auth";
import { s3MediaStoreFromConfig } from "../media/s3";
import { createLocalMediaStore, createMemoryMediaStore, createUnavailableMediaStore, type MediaStore } from "../media/store";
import { createCalendarService, type CalendarService } from "../services/website/calendarService";
import type { PlatformUnit } from "../repos/auth";
import type { SiteEnquiryRecord } from "../repos/website";
import type { MailPayload } from "../services/auth/mail";
import { mailWake } from "../services/auth/mailWake";
import type { EnquiryMailInfo, EnquiryMailStatus, GoogleReviews, OAuthStates, SiteMail, WebsiteDeps } from "../services/website/context";
import { createEnquiryService, type EnquiryService } from "../services/website/enquiryService";
import { createGalleryService, type GalleryService } from "../services/website/galleryService";
import { createListService, type ListService } from "../services/website/listService";
import { createOverviewService, type OverviewService } from "../services/website/overviewService";
import { createContentService, type ContentService } from "../services/website/contentService";
import { createSettingsService, type SettingsService } from "../services/website/settingsService";
import { createPublicSiteService, type PublicSiteService } from "../services/website/publicService";
import { createSiteAccessService, type SiteAccessService } from "../services/website/siteAccessService";
import { createSiteTemplateService, type SiteTemplateService } from "../services/website/siteTemplateService";
import { githubSiteBuilder, noSiteBuilder } from "../sitebuild/github";
import { createRoomService, type RoomService } from "../services/website/roomService";
import { billingDefaults } from "./billing";
import { getFrontOfficeReservations } from "./frontOffice";

// The composition root of the website module: the SAME hotel unit as billing, the front office, companies and payroll (the front office reads the
// website's room types and enquiries, and confirming an enquiry makes its reservation in one unit), the front office's reservation service, and
// the PORTS. Until their owners exist: enquiry mail queues nothing (the enquiry still moves), Google Business Profile is not configured, and the
// OAuth state is kept in this process (a real deployment keeps it in the session store).
export const noSiteMail: SiteMail = { enquiryConfirmed: async () => "off", enquiryDeclined: async () => "off" };

/**
 * The real enquiry mail: one row in the platform outbox (kind enquiry_confirmed / enquiry_declined) in its own platform unit, AFTER the decision is saved.
 * No usable address is `no_email`; a queue failure is `failed` (and reported to the server log), never an error for the person who decided.
 */
export function outboxSiteMail(deps: { unit: PlatformUnit; now: () => Date; report?: (message: string, error: unknown) => void }): SiteMail {
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  async function tell(hotelId: string, kind: "enquiry_confirmed" | "enquiry_declined", e: SiteEnquiryRecord, info: EnquiryMailInfo): Promise<EnquiryMailStatus> {
    const to = (e.email ?? "").trim().toLowerCase();
    if (to === "" || to.length > 254 || !EMAIL_RE.test(to)) return "no_email";
    const payload: MailPayload = {
      name: e.name, hotelName: info.hotelName, reference: e.reference, ...(info.roomName ? { roomName: info.roomName } : {}),
      ...(e.checkIn ? { checkIn: e.checkIn } : {}), ...(e.checkOut ? { checkOut: e.checkOut } : {}), ...(kind === "enquiry_declined" && e.decisionNote ? { reason: e.decisionNote } : {}),
    };
    try {
      // sent from the hotel's own mail server (Settings > Email) when it has one: the guest sees the hotel's address
      await deps.unit.run((repos) => repos.outbox.enqueue({ userId: null, hotelId, kind, toEmail: to, template: kind.replace(/_/g, "-"), payload: JSON.stringify(payload) }, deps.now()));
      mailWake.touch();
      return "queued";
    } catch (error) {
      deps.report?.("website enquiry mail could not be queued", error);
      return "failed";
    }
  }
  return { enquiryConfirmed: (hotel, e, info) => tell(hotel, "enquiry_confirmed", e, info), enquiryDeclined: (hotel, e, info) => tell(hotel, "enquiry_declined", e, info) };
}

export const noGoogle: GoogleReviews = {
  authUrl: async () => null,
  connect: async () => ({ ok: false, error: "The Google Business Profile integration is not set up yet." }),
  refresh: async () => ({ ok: false, error: "The Google Business Profile integration is not set up yet." }),
  disconnect: async () => undefined,
  redirectUrl: () => "",
};

export function memoryOAuthStates(): OAuthStates {
  const states = new Map<string, string>();
  return {
    put: async (sessionId, state) => void states.set(sessionId, state),
    take: async (sessionId) => {
      const s = states.get(sessionId) ?? null;
      states.delete(sessionId);
      return s;
    },
  };
}

/**
 * The media store when a database is configured: files under web-app/.data/media (HMS_MEDIA_DIR to move it), or with MEDIA_DRIVER=s3 the prefix "media/"
 * of the S3 bucket (the ID photos use "id-photos/" in the same bucket and are never read here). In memory otherwise.
 */
let mediaStore: MediaStore | null = null;
function defaultMediaStore(): MediaStore {
  if (mediaStore) return mediaStore;
  const config = getConfig();
  if (!config.DATABASE_URL) return (mediaStore = createMemoryMediaStore());
  // Vercel keeps no disk between requests: uploads answer a plain 503 until MEDIA_DRIVER=s3 (warned at boot and in System Health)
  if (mediaDriverOf(config) === "db") return (mediaStore = createDbMediaStore(getDatabase().pool, "media"));
  if (photoStorageUnavailable(config)) return (mediaStore = createUnavailableMediaStore());
  return (mediaStore = config.MEDIA_DRIVER === "s3" ? s3MediaStoreFromConfig(config, "media/") : createLocalMediaStore(config.HMS_MEDIA_DIR ?? path.join(process.cwd(), ".data", "media")));
}

function websiteDefaults(): WebsiteDeps {
  const base = billingDefaults();
  const config = getConfig();
  // the build job is connected only when all three GITHUB_SITES_* settings are there (env.ts refuses a half set)
  const siteBuilder = config.GITHUB_SITES_TOKEN && config.GITHUB_SITES_REPO ? githubSiteBuilder({ token: config.GITHUB_SITES_TOKEN, repo: config.GITHUB_SITES_REPO }) : noSiteBuilder;
  return { ...base, reservations: getFrontOfficeReservations(), mail: outboxSiteMail({ unit: getPlatformUnit(), now: () => new Date(), report: (message, error) => getLogger().error(message, { error: String((error as Error)?.message ?? error) }) }), google: noGoogle, oauthStates: memoryOAuthStates(), media: defaultMediaStore(), platform: getPlatformUnit(), publicUrl: config.HMS_PUBLIC_URL ?? "http://localhost:3000", siteBuilder, ...(config.SITE_BUILD_SECRET ? { siteBuildSecret: config.SITE_BUILD_SECRET } : {}) };
}

interface WebsiteServices {
  enquiries: EnquiryService;
  rooms: RoomService;
  calendar: CalendarService;
  gallery: GalleryService;
  lists: ListService;
  content: ContentService;
  settings: SettingsService;
  siteAccess: SiteAccessService;
  siteTemplates: SiteTemplateService;
  publicSite: PublicSiteService | null;
  overview: OverviewService;
}
let services: WebsiteServices | null = null;

export function buildWebsiteServices(deps: WebsiteDeps): WebsiteServices {
  return { enquiries: createEnquiryService(deps), rooms: createRoomService(deps), calendar: createCalendarService(deps), gallery: createGalleryService(deps), lists: createListService(deps), content: createContentService(deps), settings: createSettingsService(deps), siteAccess: createSiteAccessService(deps), siteTemplates: createSiteTemplateService(deps), publicSite: deps.platform ? createPublicSiteService({ platform: deps.platform, unit: deps.unit, media: deps.media, now: deps.now, publicUrl: deps.publicUrl }) : null, overview: createOverviewService(deps) };
}

const all = (): WebsiteServices => (services ??= buildWebsiteServices(websiteDefaults()));
export const getWebsiteEnquiries = (): EnquiryService => all().enquiries;
export const getWebsiteRooms = (): RoomService => all().rooms;
export const getWebsiteCalendar = (): CalendarService => all().calendar;
export const getWebsiteGallery = (): GalleryService => all().gallery;
export const getWebsiteLists = (): ListService => all().lists;
export const getWebsiteContent = (): ContentService => all().content;
export const getWebsiteSettings = (): SettingsService => all().settings;
export const getWebsiteSiteAccess = (): SiteAccessService => all().siteAccess;
export const getWebsiteSiteTemplates = (): SiteTemplateService => all().siteTemplates;
export const getWebsitePublic = (): PublicSiteService => {
  const s = all().publicSite;
  if (!s) throw new Error("The public website API needs the platform data");
  return s;
};
export const getWebsiteOverview = (): OverviewService => all().overview;

/** Replaces the website services (start-up code and tests). */
export function configureWebsite(next: WebsiteServices | null): void {
  services = next;
}
