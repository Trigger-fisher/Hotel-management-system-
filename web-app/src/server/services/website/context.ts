import "server-only";
import type { Catalog } from "../../auth/catalog";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import type { PlatformUnit } from "../../repos/auth";
import type { BillingRepos } from "../../repos/billing";
import type { SystemLogEntry } from "../../repos/cashSupport";
import type { FrontOfficeRepos } from "../../repos/frontOffice";
import type { Unit } from "../../repos/types";
import type { SiteEnquiryRecord, WebsiteRepos } from "../../repos/website";
import type { MediaStore } from "../../media/store";
import type { PeopleDirectory, Person, PlatformAudit } from "../cash/ports";
import { istDate } from "../frontOffice/rules";
import type { ReservationService } from "../frontOffice/reservationService";
import { addDays, roomNights, stayNights, type NightState } from "./availability";

// What the website services share: dependencies, the PORTS approved for this module, the system-log line in Pallav's words (module `website`:
// Support/Site/WebsiteLog.php) and the glue that feeds the pure availability functions from the repositories. Spec: docs/specs/website.md.

export const WEBSITE = "website";

/**
 * What happened to the mail to the guest: `queued` (in the platform outbox, sent by the mail worker), `no_email` (the enquiry has no usable address),
 * `failed` (it could not be queued; the confirmation or cancellation still stands) or `off` (no mailer is wired: tests and bare setups).
 */
export type EnquiryMailStatus = "queued" | "no_email" | "failed" | "off";

/** What the mail says about the hotel and the room, read inside the decision's unit. */
export interface EnquiryMailInfo {
  hotelName: string;
  roomName: string | null;
}

/** Enquiry mail (Support/Site/SiteMail.php): told through the platform outbox AFTER the decision is saved; it never undoes the decision. */
export interface SiteMail {
  enquiryConfirmed(hotelId: string, enquiry: SiteEnquiryRecord, info: EnquiryMailInfo): Promise<EnquiryMailStatus>;
  enquiryDeclined(hotelId: string, enquiry: SiteEnquiryRecord, info: EnquiryMailInfo): Promise<EnquiryMailStatus>;
}

/** Google Business Profile reviews (Support/Site/Reviews.php): an integration owned by the integrations task; a port here (stub: not configured). */
export interface GoogleReviews {
  /** The consent URL for this state, or null when the OAuth client is not saved yet. */
  authUrl(hotelId: string, state: string): Promise<string | null>;
  /** Exchanges the code and finds the business: the listing's title, or why not. */
  connect(hotelId: string, code: string): Promise<{ ok: true; title: string } | { ok: false; error: string }>;
  /** Fetches every review: how many, or why not. */
  refresh(hotelId: string): Promise<{ ok: true; count: number } | { ok: false; error: string }>;
  disconnect(hotelId: string): Promise<void>;
  /** The redirect address to register with Google (shown beside the keys). */
  redirectUrl(hotelId: string): string;
}

/** Remembers the Google sign-in state per signed-in session until the callback (Pallav keeps it in the session). */
export interface OAuthStates {
  put(sessionId: string, state: string): Promise<void>;
  /** Returns and removes the state saved for this session. */
  take(sessionId: string): Promise<string | null>;
}

/** What the "Create hotel site" job is asked to do (website-templates/tools/create-site.mjs): copy this template into the hotel's own site folder, then report to `callbackUrl`. */
export interface SiteBuildJob {
  buildId: string;
  hotelSlug: string;
  templateKey: string;
  callbackUrl: string;
}

/** Starts that job (GitHub Actions in production: sitebuild/github.ts). It only STARTS it: the job reports its progress to the signed callback route. */
export interface SiteBuilder {
  /** False on a server without GITHUB_SITES_*: the page says designs are not set up yet. */
  readonly configured: boolean;
  start(job: SiteBuildJob): Promise<{ ok: true } | { ok: false; error: string }>;
}

export type WebsiteUnitRepos = WebsiteRepos & FrontOfficeRepos & Pick<BillingRepos, "systemLogs">;

export interface WebsiteDeps {
  unit: Unit<WebsiteUnitRepos>;
  people: PeopleDirectory;
  audit: PlatformAudit;
  catalog: Catalog;
  now: () => Date;
  /** The front office's reservation service: confirming an enquiry makes the reservation in the SAME unit; cancelling it frees the room. */
  reservations: Pick<ReservationService, "reserveFromEnquiry" | "cancelFromEnquiry">;
  mail: SiteMail;
  google: GoogleReviews;
  oauthStates: OAuthStates;
  /** The uploaded photos, icons and logo (server/media). */
  media: MediaStore;
  /** Decision 55: the platform data (hotel websites: the live switch and the registered domains). Without it the website switch is unavailable. */
  platform?: PlatformUnit;
  /** Where people open the app (HMS_PUBLIC_URL): the Google sign-in return address is built from it. */
  publicUrl: string;
  /** Hotel website designs: starts the build job. Without it (and `siteBuildSecret`) a hotel can see the designs but not apply one. */
  siteBuilder?: SiteBuilder;
  /** The secret the job signs its reports with (SITE_BUILD_SECRET): the callback route and the service read it from here. */
  siteBuildSecret?: string;
}

export interface Who {
  session: VerifiedSession;
  meta: RequestMeta;
  actor: Person | undefined;
}

export const today = (deps: Pick<WebsiteDeps, "now">): string => istDate(deps.now());

export async function actorOf(deps: Pick<WebsiteDeps, "people">, session: VerifiedSession): Promise<Person | undefined> {
  return (await deps.people.get([session.userId])).get(session.userId);
}

/** One line of the website's log: WebsiteLog::created / updated / deleted / did, with the subject and (for a change) what moved. */
export function logLine(w: Who, line: { action: SystemLogEntry["action"]; entity: string; summary: string; subject: { id: string; label: string } | null; details?: Record<string, unknown> }): SystemLogEntry {
  return {
    module: WEBSITE,
    action: line.action,
    entity: line.entity,
    subjectId: line.subject?.id ?? null,
    subjectLabel: line.subject?.label ?? null,
    summary: line.summary.slice(0, 500),
    details: line.details && Object.keys(line.details).length > 0 ? line.details : null,
    userId: w.session.userId,
    userName: w.actor?.name ?? "System",
    ipAddress: w.meta.ip,
    traceId: w.meta.traceId,
  };
}

export const notFound = (message?: string): AppError => new AppError("NOT_FOUND", message);
export const conflict = (message: string): AppError => new AppError("CONFLICT", message);
export const fieldError = (key: string, message: string): AppError => new AppError("VALIDATION_FAILED", message, { fields: { [key]: message } });

/**
 * The state of one room for these nights (Availability::room): the category's real rooms in service when the front office has set rooms up (else
 * the category's total), confirmed website enquiries, and front-office reservations and walk-ins holding rooms. Three reads however many nights.
 * `ignoreEnquiryId` leaves one enquiry out of the sold count; `respectOpenWindow` applies the rolling default closing.
 */
export async function roomState(deps: Pick<WebsiteDeps, "now">, repos: WebsiteUnitRepos, roomId: string, nights: readonly string[], options: { ignoreEnquiryId?: string; respectOpenWindow?: boolean } = {}): Promise<Record<string, NightState>> {
  if (nights.length === 0) return {};
  const room = await repos.siteRooms.get(roomId);
  const real = (await repos.rooms.all()).filter((r) => r.roomTypeId === roomId);
  const defaultCapacity = real.length > 0 ? real.filter((r) => !r.outOfOrder).length : (room?.totalCount ?? 0);
  const first = nights[0];
  const last = nights[nights.length - 1];
  const overrides = new Map((await repos.calendar.inventory([roomId], first, last)).map((i) => [i.date, { roomsLeft: i.roomsLeft, blocked: i.blocked }]));
  const stays = await repos.siteEnquiries.confirmedStays(roomId, first, last, options.ignoreEnquiryId);
  // FrontDesk::held with website reservations left out (the confirmed enquiries are counted above), plus walk-ins
  const held = new Map<string, number>();
  for (const r of await repos.reservations.holding(roomId, first, last, { countWebsite: false })) {
    for (const n of stayNights(r.checkIn, r.checkOut)) if (nights.includes(n)) held.set(n, (held.get(n) ?? 0) + Math.max(1, r.rooms));
  }
  const tomorrow = addDays(today(deps), 1);
  for (const s of await repos.stays.walkInsOfType(roomId)) {
    const until = s.expectedCheckOut > tomorrow ? s.expectedCheckOut : tomorrow;
    for (const n of stayNights(istDate(s.checkInAt), until)) if (nights.includes(n)) held.set(n, (held.get(n) ?? 0) + 1);
  }
  return roomNights({ today: today(deps), defaultCapacity, overrides, stays, held, nights, respectOpenWindow: options.respectOpenWindow ?? true });
}
