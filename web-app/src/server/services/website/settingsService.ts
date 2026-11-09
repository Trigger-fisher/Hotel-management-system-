import "server-only";
import type { WebGoogleStatus, WebSettings, WebSettingsInput } from "@shared/dashboards/website";
import { validateSettings } from "@shared/dashboards/website";
import { requirePermission } from "../../auth/permissions";
import { isPlatformSetupSession, PLATFORM_SETS_UP } from "../../auth/secretSettings";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import { compressImage } from "../../media/compress";
import { BRANDING_TYPES, checkUpload, MAX_ICON_BYTES, randomName, type UploadInput } from "../../media/store";
import type { SiteSecrets, SiteSettingsFields } from "../../repos/website";
import { diffDetails } from "../cash/syslog";
import { actorOf, conflict, logLine, type WebsiteDeps, type Who } from "./context";
import { mediaUrl } from "./galleryService";
import { coordinatesFromUrl, isShortMapLink } from "./mapTools";

// Website Settings (Pallav Website/SettingsController, GoogleController): how the hotel is reached, how it shows in search, its links and map pin, who is
// told about enquiries, the logo and browser icon, and the Google connection. Part `website.settings`. THE SECRETS (the mail account, the Google keys and
// sign-in tokens) are the Set-up centre's (MJ, 5 Nov 2026): a hotel session never reads or writes them (saving can never blank them); only the Super Admin's set-up
// session (auth/secretSettings.ts) sets the Google keys and connects. A secret is never returned at all: only whether it is set. The ability `website.secrets` stays in the catalog only so saved roles load.
// The Google Business Profile sign-in and the review fetch sit behind the GoogleReviews port (not set up yet: connect and refresh answer a plain 409).

const PART = "website.settings";
const BAD_PIN = "Couldn't work out a location from that link - check it is a Google Maps share link and try again. Your other changes were not saved.";
const SHORT_PIN = "That is a short Google Maps link, which cannot be read here yet. Open it in a browser and paste the long address from the address bar.";

interface SettingsDto extends WebSettings {
  /** The signed-in person may see and change the mail and Google secrets; when false those fields come back empty and are ignored on save. */
  secretsVisible: boolean;
  logoUrl: string | null;
  faviconUrl: string | null;
}

const blank = (s: string | null | undefined): string | null => {
  const t = (s ?? "").trim();
  return t === "" ? null : t;
};

function googleStatus(secrets: SiteSecrets): WebGoogleStatus {
  if (!blank(secrets.gbpOauthClientId) || !blank(secrets.gbpOauthClientSecret)) return "notSetUp";
  return blank(secrets.gbpRefreshToken) ? "connected" : "ready";
}

export function createSettingsService(deps: WebsiteDeps) {
  const { unit, catalog, media, google } = deps;
  const who = async (session: VerifiedSession, meta: RequestMeta): Promise<Who> => ({ session, meta, actor: await actorOf(deps, session) });
  const mayHandleSecrets = (session: VerifiedSession): boolean => isPlatformSetupSession(session);

  function dto(session: VerifiedSession, fields: SiteSettingsFields, secrets: SiteSecrets): SettingsDto {
    const secret = mayHandleSecrets(session);
    return {
      gmPhone: fields.gmPhone ?? "", receptionPhone: fields.receptionPhone ?? "", email: fields.email ?? "",
      openedYear: fields.openedYear ?? 0, address: fields.address, checkinTime: fields.checkinTime, checkoutTime: fields.checkoutTime, mapLat: fields.mapLat, mapLng: fields.mapLng,
      metaTitle: fields.metaTitle ?? "", metaDescription: fields.metaDescription ?? "", metaKeywords: fields.metaKeywords ?? "", gbpLink: fields.gbpLink ?? "", facebookLink: fields.facebookLink ?? "",
      instagramLink: fields.instagramLink ?? "", hasLogo: fields.logoPath !== null, hasFavicon: fields.faviconPath !== null, recipients: fields.recipients.map((r) => ({ ...r })),
      smtpHost: secret ? (fields.smtpHost ?? "") : "", smtpPort: fields.smtpPort ?? 587, smtpUsername: secret ? (secrets.smtpUsername ?? "") : "", smtpPasswordSet: secret && blank(secrets.smtpPassword) !== null,
      smtpFromEmail: secret ? (fields.smtpFromEmail ?? "") : "", smtpFromName: secret ? (fields.smtpFromName ?? "") : "", googleMapsApiKeySet: secret && blank(secrets.googleMapsApiKey) !== null,
      googlePlaceId: fields.googlePlaceId ?? "", googleMinReviewRating: fields.googleMinReviewRating, gbpOauthClientId: secret ? (secrets.gbpOauthClientId ?? "") : "",
      gbpOauthClientSecretSet: secret && blank(secrets.gbpOauthClientSecret) !== null, gbpRedirectUrl: google.redirectUrl(""), googleStatus: googleStatus(secrets),
      googleLastFetchedAt: fields.googleLastFetchedAt ? fields.googleLastFetchedAt.toISOString() : null, googleReviewCount: fields.googleReviewCount,
      secretsVisible: secret, logoUrl: fields.logoPath ? mediaUrl(fields.logoPath) : null, faviconUrl: fields.faviconPath ? mediaUrl(fields.faviconPath) : null,
    };
  }

  const redirect = (session: VerifiedSession): string => google.redirectUrl(session.hotelId) || `${deps.publicUrl.replace(/\/+$/, "")}/admin/website/google/callback`;
  const withRedirect = (session: VerifiedSession, d: SettingsDto): SettingsDto => ({ ...d, gbpRedirectUrl: redirect(session) });

  /** A logo or icon after this save: removed if ticked, replaced if a new file came (a new file wins), else as it was (SettingsController::image). */
  async function imageAfter(session: VerifiedSession, current: string | null, file: UploadInput | undefined, remove: boolean | undefined, field: string): Promise<{ path: string | null; delete: string[]; created: string[] }> {
    if (file) {
      const c = checkUpload(file, BRANDING_TYPES, MAX_ICON_BYTES, field);
      // raster logos and icons are stored as WebP at most 1 MB; SVG and ICO stay as they are (media/compress.ts)
      const small = await compressImage(c.bytes, "icon", c.type, field);
      const name = await media.put(session.hotelId, randomName(small.type), small.bytes);
      return { path: name, delete: current ? [current] : [], created: [name] };
    }
    if (remove && current) return { path: null, delete: [current], created: [] };
    return { path: current, delete: [], created: [] };
  }

  return {
    async get(session: VerifiedSession): Promise<SettingsDto> {
      requirePermission(session, catalog, PART, "view");
      return unit.run(session, async (repos) => {
        const { fields, secrets } = await repos.siteSettings.get();
        return withRedirect(session, dto(session, fields, secrets));
      });
    },

    /** update (:39-133): validated like the contract's screen; the pin only moves when a link is pasted; secrets only for those who may handle them. */
    async update(session: VerifiedSession, input: WebSettingsInput & { logo?: UploadInput; favicon?: UploadInput }, meta: RequestMeta): Promise<SettingsDto> {
      requirePermission(session, catalog, PART, "edit");
      const problems = validateSettings(input);
      if (Object.keys(problems).length > 0) throw new AppError("VALIDATION_FAILED", Object.values(problems)[0], { fields: problems });
      const mapUrl = input.hotelMapUrl.trim();
      let pin: { lat: number; lng: number } | null = null;
      if (mapUrl !== "") {
        if (isShortMapLink(mapUrl)) throw new AppError("VALIDATION_FAILED", SHORT_PIN, { fields: { hotelMapUrl: SHORT_PIN } });
        pin = coordinatesFromUrl(mapUrl);
        if (!pin) throw new AppError("VALIDATION_FAILED", BAD_PIN, { fields: { hotelMapUrl: BAD_PIN } });
      }
      const w = await who(session, meta);
      const secret = mayHandleSecrets(session);
      const seen = new Set<string>();
      const recipients = input.recipients
        .map((r) => ({ name: r.name.trim(), email: r.email.trim() }))
        .filter((r) => (seen.has(r.email.toLowerCase()) ? false : (seen.add(r.email.toLowerCase()), true)));
      let created: string[] = [];
      let gone: string[] = [];
      try {
        const out = await unit.run(session, async (repos) => {
          const { fields: before } = await repos.siteSettings.get({ forUpdate: true });
          const logo = await imageAfter(session, before.logoPath, input.logo, input.removeLogo, "logo");
          const favicon = await imageAfter(session, before.faviconPath, input.favicon, input.removeFavicon, "favicon");
          created = [...logo.created, ...favicon.created];
          gone = [...logo.delete, ...favicon.delete];
          const patch: Partial<SiteSettingsFields> & { secrets?: Partial<SiteSecrets> } = {
            openedYear: input.openedYear, gmPhone: input.gmPhone.trim(), receptionPhone: input.receptionPhone.trim(),
            email: input.email.trim(), address: input.address.trim(), checkinTime: input.checkinTime.trim(), checkoutTime: input.checkoutTime.trim(), metaTitle: blank(input.metaTitle),
            metaDescription: blank(input.metaDescription), metaKeywords: blank(input.metaKeywords), gbpLink: blank(input.gbpLink), facebookLink: blank(input.facebookLink), instagramLink: blank(input.instagramLink),
            googlePlaceId: blank(input.googlePlaceId), googleMinReviewRating: Math.max(1, Math.min(5, input.googleMinReviewRating || 3)), mapLat: pin ? pin.lat : before.mapLat, mapLng: pin ? pin.lng : before.mapLng,
            recipients, logoPath: logo.path, faviconPath: favicon.path,
          };
          const secrets: Partial<SiteSecrets> = {};
          if (secret) {
            Object.assign(patch, { smtpHost: blank(input.smtpHost), smtpPort: input.smtpPort || 587, smtpFromEmail: blank(input.smtpFromEmail), smtpFromName: blank(input.smtpFromName) });
            secrets.smtpUsername = blank(input.smtpUsername);
            secrets.gbpOauthClientId = blank(input.gbpOauthClientId);
            if (input.newSmtpPassword.trim() !== "") secrets.smtpPassword = input.newSmtpPassword.trim();
            if (input.newGoogleMapsApiKey.trim() !== "") secrets.googleMapsApiKey = input.newGoogleMapsApiKey.trim();
            if (input.newGbpOauthClientSecret.trim() !== "") secrets.gbpOauthClientSecret = input.newGbpOauthClientSecret.trim();
            patch.secrets = secrets;
          }
          const saved = await repos.siteSettings.update(patch, session.userId);
          const show = (f: SiteSettingsFields): Record<string, string> => ({
            opened_year: String(f.openedYear ?? ""), gm_phone: f.gmPhone ?? "", reception_phone: f.receptionPhone ?? "", email: f.email ?? "",
            address: f.address, checkin_time: f.checkinTime, checkout_time: f.checkoutTime, meta_title: f.metaTitle ?? "", meta_description: f.metaDescription ?? "", meta_keywords: f.metaKeywords ?? "",
            gbp_link: f.gbpLink ?? "", facebook_link: f.facebookLink ?? "", instagram_link: f.instagramLink ?? "", google_place_id: f.googlePlaceId ?? "", google_min_review_rating: String(f.googleMinReviewRating),
            logo: f.logoPath ?? "", favicon: f.faviconPath ?? "",
          });
          // which secrets changed is worth a line; what they are is not
          const note = secret ? { "Mail and Google keys": `Saved by ${w.actor?.name ?? "System"}` } : {};
          const changes = { ...diffDetails(show(before), show(saved.fields)), ...note };
          await repos.systemLogs.write(logLine(w, { action: "updated", entity: "Website settings", summary: "Changed Website settings", subject: null, details: changes }));
          return { fields: saved.fields, secrets: saved.secrets };
        });
        for (const n of gone) await media.remove(session.hotelId, n).catch(() => undefined);
        return withRedirect(session, dto(session, out.fields, out.secrets));
      } catch (error) {
        for (const n of created) await media.remove(session.hotelId, n).catch(() => undefined);
        throw error;
      }
    },

    /** Connect with Google: needs the OAuth client saved first; the sign-in itself is behind the port (not set up yet -> the port's sentence, 409). */
    async googleConnect(session: VerifiedSession): Promise<SettingsDto> {
      if (!mayHandleSecrets(session)) throw new AppError("FORBIDDEN", PLATFORM_SETS_UP);
      return unit.run(session, async (repos) => {
        const { fields, secrets } = await repos.siteSettings.get();
        if (googleStatus(secrets) === "notSetUp") throw conflict("Save the Google client ID and secret first, then click Connect with Google.");
        const r = await google.connect(session.hotelId, "");
        if (!r.ok) throw conflict(r.error);
        return withRedirect(session, dto(session, fields, secrets));
      });
    },

    /** Refresh the reviews: needs a connected account. */
    async googleRefresh(session: VerifiedSession): Promise<SettingsDto> {
      requirePermission(session, catalog, PART, "edit");
      return unit.run(session, async (repos) => {
        const { secrets } = await repos.siteSettings.get();
        if (googleStatus(secrets) !== "connected") throw conflict("Google is not connected yet.");
        const r = await google.refresh(session.hotelId);
        if (!r.ok) throw conflict(r.error);
        const saved = await repos.siteSettings.update({ googleLastFetchedAt: deps.now(), googleReviewCount: r.count }, session.userId);
        return withRedirect(session, dto(session, saved.fields, saved.secrets));
      });
    },

    /** Disconnect: the tokens, the fetch time and the count are cleared (the OAuth client stays). */
    async googleDisconnect(session: VerifiedSession, meta: RequestMeta): Promise<SettingsDto> {
      if (!mayHandleSecrets(session)) throw new AppError("FORBIDDEN", PLATFORM_SETS_UP);
      const w = await who(session, meta);
      await google.disconnect(session.hotelId);
      return unit.run(session, async (repos) => {
        const saved = await repos.siteSettings.update({ googleLastFetchedAt: null, googleReviewCount: 0, secrets: { gbpRefreshToken: null, gbpAccessToken: null } }, session.userId);
        await repos.systemLogs.write(logLine(w, { action: "updated", entity: "Website settings", summary: "Disconnected Google Business Profile", subject: null }));
        return withRedirect(session, dto(session, saved.fields, saved.secrets));
      });
    },

    /** The Set-up centre: the website's Google keys (the Maps key, the Business Profile sign-in client) and where Google sends the sign-in back. Secrets never returned. */
    async setupView(session: VerifiedSession): Promise<WebsiteGoogleSetup> {
      if (!mayHandleSecrets(session)) throw new AppError("FORBIDDEN", PLATFORM_SETS_UP);
      return unit.run(session, async (repos) => setupOf(session, (await repos.siteSettings.get()).secrets));
    },

    /** Saves the Google keys from the Set-up centre; a secret left empty keeps what is saved. The website's mail goes out through the hotel's own mail (no second mail set-up). */
    async setupSave(session: VerifiedSession, input: { gbpOauthClientId?: string; newGoogleMapsApiKey?: string; newGbpOauthClientSecret?: string }, meta: RequestMeta): Promise<WebsiteGoogleSetup> {
      if (!mayHandleSecrets(session)) throw new AppError("FORBIDDEN", PLATFORM_SETS_UP);
      const w = await who(session, meta);
      const secrets: Partial<SiteSecrets> = {};
      if (input.gbpOauthClientId !== undefined) secrets.gbpOauthClientId = blank(input.gbpOauthClientId);
      if ((input.newGoogleMapsApiKey ?? "").trim() !== "") secrets.googleMapsApiKey = (input.newGoogleMapsApiKey ?? "").trim();
      if ((input.newGbpOauthClientSecret ?? "").trim() !== "") secrets.gbpOauthClientSecret = (input.newGbpOauthClientSecret ?? "").trim();
      return unit.run(session, async (repos) => {
        const saved = await repos.siteSettings.update({ secrets }, session.userId);
        await repos.systemLogs.write(logLine(w, { action: "updated", entity: "Website settings", summary: "Google keys saved from the Set-up centre", subject: null }));
        return setupOf(session, saved.secrets);
      });
    },
  };

  function setupOf(session: VerifiedSession, secrets: SiteSecrets): WebsiteGoogleSetup {
    return { googleStatus: googleStatus(secrets), googleMapsApiKeySet: blank(secrets.googleMapsApiKey) !== null, gbpOauthClientId: secrets.gbpOauthClientId ?? "", gbpOauthClientSecretSet: blank(secrets.gbpOauthClientSecret) !== null, gbpRedirectUrl: redirect(session) };
  }
}

/** The website's Google keys as the Set-up centre shows them (never a secret). */
export interface WebsiteGoogleSetup {
  googleStatus: WebGoogleStatus;
  googleMapsApiKeySet: boolean;
  gbpOauthClientId: string;
  gbpOauthClientSecretSet: boolean;
  gbpRedirectUrl: string;
}

export type SettingsService = ReturnType<typeof createSettingsService>;
