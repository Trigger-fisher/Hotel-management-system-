import "server-only";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { HotelSiteRecord, PlatformUnit } from "../../repos/auth";
import type { Unit } from "../../repos/types";
import type { SiteSettingsFields } from "../../repos/website";
import type { MediaStore } from "../../media/store";
import { paiseToNumber } from "../../money/paise";
import { istDate } from "../frontOffice/rules";
import { Rules } from "../payrollCore/validate";
import { addMonthsNoOverflow, freeForStay, stayNights } from "./availability";
import { roomState, type WebsiteUnitRepos } from "./context";
import type { MailPayload } from "../auth/mail";
import { mailWake } from "../auth/mailWake";
import { fiscalYearOf, normalizePhone, referenceText } from "./rules";

// The PUBLIC read side of a hotel website (decision 55, docs/deploy/WEBSITE-CONNECT.md section 2): no sign-in, one hotel found by its slug, whitelist answers only
// (never the admin DTOs). A hotel that does not exist, is not active or whose website is not live is the SAME plain 404. A room whose "show price" is
// off shows no price anywhere. Photos are file names in the private media store: the answers give URLs of the public media route, never storage keys.

const PUBLIC_USER = "00000000-0000-4000-8000-0000000000f5";
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_NIGHTS = 60;
const ROOMS_LEFT_CAP = 3;
const REFERENCE_PREFIX = "WEB";

export interface PublicDeps {
  platform: PlatformUnit;
  unit: Unit<WebsiteUnitRepos>;
  media: MediaStore;
  now: () => Date;
  /** Where the public routes live (HMS_PUBLIC_URL): photo addresses are built from it. */
  publicUrl: string;
}

export interface PublicHotel {
  site: HotelSiteRecord;
  session: VerifiedSession;
}

const rupees = (paise: bigint | null): number | null => (paise === null ? null : paiseToNumber(paise) / 100);

export function createPublicSiteService(deps: PublicDeps) {
  const base = deps.publicUrl.replace(/\/+$/, "");
  const notFound = (): AppError => new AppError("NOT_FOUND");

  /** The hotel behind a slug, or the one 404. */
  async function hotelOf(slug: string): Promise<PublicHotel> {
    if (!SLUG.test(slug) || slug.length > 63) throw notFound();
    const site = await deps.platform.run((r) => r.sites.bySlug(slug));
    if (!site || !site.live || site.status !== "active") throw notFound();
    const session = { userId: PUBLIC_USER, hotelId: site.hotelId, accountRole: "hotel_user", roleId: "", roleKey: "public_site", roleLevel: 0, permissions: { grants: new Map() }, sessionId: "public-site", client: "web", expiresAt: new Date(deps.now().getTime() + 60_000) } as unknown as VerifiedSession;
    return { site, session };
  }

  const urlOf = (slug: string, file: string | null): string | null => (file ? `${base}/api/v1/public/hotels/${slug}/media/${encodeURIComponent(file)}` : null);
  const fileOf = (s: SiteSettingsFields, key: "logoPath" | "faviconPath"): string | null => s[key];

  /** The stored names this hotel's public pages may show (the media route serves nothing else). */
  async function listedFiles(repos: WebsiteUnitRepos): Promise<Set<string>> {
    const out = new Set<string>();
    const settings = (await repos.siteSettings.get()).fields;
    for (const f of [settings.logoPath, settings.faviconPath]) if (f) out.add(f);
    for (const r of await repos.siteRooms.list()) if (r.available) for (const p of r.photos) out.add(p.path);
    for (const g of await repos.gallery.list()) out.add(g.path);
    for (const s of await repos.services.list()) if (s.iconPath) out.add(s.iconPath);
    for (const p of await repos.policies.list()) if (p.iconPath) out.add(p.iconPath);
    return out;
  }

  const run = <T>(h: PublicHotel, work: (repos: WebsiteUnitRepos) => Promise<T>): Promise<T> => deps.unit.run(h.session, work);

  function checkDates(checkIn: string, checkOut: string, today: string): string[] {
    const real = (d: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
    const fields: Record<string, string> = {};
    if (!real(checkIn)) fields.checkIn = "Pick a check-in date.";
    else if (checkIn < today) fields.checkIn = "Check-in cannot be in the past.";
    if (!real(checkOut)) fields.checkOut = "Pick a check-out date.";
    else if (real(checkIn) && checkOut <= checkIn) fields.checkOut = "Check-out must be after check-in.";
    if (Object.keys(fields).length === 0 && Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000) > MAX_NIGHTS) fields.checkOut = `Choose a stay of at most ${MAX_NIGHTS} nights.`;
    if (Object.keys(fields).length > 0) throw new AppError("VALIDATION_FAILED", Object.values(fields)[0], { fields });
    return stayNights(checkIn, checkOut);
  }

  return {
    hotelOf,

    /** The registered domains of the hotel behind a slug (the CORS decision). Never throws: unknown means "none". */
    async domainsOf(slug: string): Promise<string[]> {
      if (!SLUG.test(slug) || slug.length > 63) return [];
      const site = await deps.platform.run((r) => r.sites.bySlug(slug));
      return site && site.live && site.status === "active" ? site.domains : [];
    },

    async brand(slug: string) {
      const h = await hotelOf(slug);
      const s = await run(h, async (repos) => (await repos.siteSettings.get()).fields);
      return { name: h.site.name, slug: h.site.slug, logoUrl: urlOf(h.site.slug, fileOf(s, "logoPath")), faviconUrl: urlOf(h.site.slug, fileOf(s, "faviconPath")), websiteUrl: h.site.domains[0] ? `https://${h.site.domains[0]}` : null };
    },

    async site(slug: string) {
      const h = await hotelOf(slug);
      const s = await run(h, async (repos) => (await repos.siteSettings.get()).fields);
      return {
        name: h.site.name, city: h.site.city, state: h.site.state, address: s.address, gmPhone: s.gmPhone, receptionPhone: s.receptionPhone,
        email: s.email, checkinTime: s.checkinTime, checkoutTime: s.checkoutTime, openedYear: s.openedYear, mapLat: s.mapLat, mapLng: s.mapLng, gbpLink: s.gbpLink, facebookLink: s.facebookLink,
        instagramLink: s.instagramLink, googlePlaceId: s.googlePlaceId, metaTitle: s.metaTitle, metaDescription: s.metaDescription, metaKeywords: s.metaKeywords,
      };
    },

    async content(slug: string) {
      const h = await hotelOf(slug);
      return run(h, (repos) => repos.content.get());
    },

    async rooms(slug: string) {
      const h = await hotelOf(slug);
      return run(h, async (repos) => {
        const rooms = (await repos.siteRooms.list()).filter((r) => r.available);
        const plans = await repos.sitePlans.forRooms(rooms.map((r) => r.id), { activeOnly: true });
        return rooms.map((r) => ({
          slug: r.slug,
          name: r.name,
          size: r.size,
          bedType: r.bedType,
          maxGuests: r.maxGuests,
          note: r.note,
          badge: r.badgeLabel,
          photos: r.photos.map((p) => ({ url: urlOf(h.site.slug, p.path), alt: p.alt ?? p.name ?? r.name })),
          showPrice: r.showPrice,
          plans: plans
            .filter((p) => p.roomId === r.id)
            .map((p) => ({ name: p.name, code: p.code, ...(r.showPrice ? { priceSingle: rupees(p.singlePaise), priceDouble: rupees(p.doublePaise), extraPerson: rupees(p.extraPersonPaise) } : {}) })),
        }));
      });
    },

    async availability(slug: string, q: { checkIn: string; checkOut: string; adults: number; children: number }) {
      const h = await hotelOf(slug);
      const today = istDate(deps.now());
      const nights = checkDates(q.checkIn, q.checkOut, today);
      const guests = q.adults + q.children;
      return run(h, async (repos) => {
        const rooms = (await repos.siteRooms.list()).filter((r) => r.available);
        const plans = await repos.sitePlans.forRooms(rooms.map((r) => r.id), { activeOnly: true });
        const out = [];
        for (const r of rooms) {
          const free = freeForStay(await roomState({ now: deps.now }, repos, r.id, nights, { respectOpenWindow: true }));
          const available = free > 0 && guests <= r.maxGuests;
          const from = r.showPrice ? plans.filter((p) => p.roomId === r.id).map((p) => rupees(p.doublePaise) as number).sort((a, b) => a - b)[0] : undefined;
          out.push({ slug: r.slug, available, roomsLeft: Math.min(free, ROOMS_LEFT_CAP), roomsLeftIsCapped: free >= ROOMS_LEFT_CAP, nights: nights.length, ...(from !== undefined ? { fromPerNight: from } : {}) });
        }
        return { checkIn: q.checkIn, checkOut: q.checkOut, nights: nights.length, windowThrough: addMonthsNoOverflow(today, 3), rooms: out };
      });
    },

    async gallery(slug: string) {
      const h = await hotelOf(slug);
      return run(h, async (repos) => (await repos.gallery.list()).map((g) => ({ url: urlOf(h.site.slug, g.path), caption: g.caption, alt: g.altText ?? g.caption ?? "" })));
    },

    async services(slug: string) {
      const h = await hotelOf(slug);
      return run(h, async (repos) => (await repos.services.list()).map((s) => ({ title: s.title, description: s.description, iconUrl: urlOf(h.site.slug, s.iconPath) })));
    },

    async policies(slug: string) {
      const h = await hotelOf(slug);
      return run(h, async (repos) => (await repos.policies.list()).map((p) => ({ title: p.title, lines: p.lines, iconUrl: urlOf(h.site.slug, p.iconPath) })));
    },

    async nearby(slug: string) {
      const h = await hotelOf(slug);
      return run(h, async (repos) => (await repos.nearby.list()).map((n) => ({ title: n.title, distance: n.distanceLabel, mapUrl: n.mapUrl, mapQuery: n.mapQuery, originLat: n.originLat, originLng: n.originLng })));
    },

    /** One photo, icon or logo: only a file name the public pages list; anything else is the same 404. */
    async media(slug: string, file: string) {
      const h = await hotelOf(slug);
      const listed = await run(h, (repos) => listedFiles(repos));
      if (!listed.has(file)) throw notFound();
      const f = await deps.media.get(h.site.hotelId, file);
      if (!f) throw notFound();
      return { bytes: f.bytes, contentType: f.contentType };
    },

    /** A guest's enquiry from the website: a `new` row the hotel sees under Guest Enquiries. A filled honeypot is answered as success and dropped. */
    async enquire(slug: string, input: { name: string; phone: string; email?: string; message: string; roomSlug?: string; checkIn?: string; checkOut?: string; adults: number; children: number; acceptedTerms: boolean; website?: string }, ip: string | null) {
      const h = await hotelOf(slug);
      if ((input.website ?? "") !== "") return { reference: referenceText(REFERENCE_PREFIX, istDate(deps.now()), 0) };
      const today = istDate(deps.now());
      const v = new Rules();
      const name = v.max("name", "name", v.required("name", "name", input.name, "Please enter your name."), 100);
      if (name !== null && Array.from(name).length < 2) v.fail("name", "Please enter your name.");
      const email = input.email ? v.max("email", "email", v.email("email", "email", Rules.clean(input.email)), 150) : null;
      const message = v.max("message", "message", v.required("message", "message", input.message, "Please write your message."), 2000);
      const phone = normalizePhone(input.phone);
      const digits = phone.replace(/^\+/, "");
      if (digits.length < 7 || digits.length > 15) v.fail("phone", "Please enter a valid phone number with country code.");
      if (!input.acceptedTerms) v.fail("acceptedTerms", "Please accept the booking terms.");
      let checkIn: string | null = null;
      let checkOut: string | null = null;
      if (input.checkIn || input.checkOut) {
        try {
          checkDates(input.checkIn ?? "", input.checkOut ?? "", today);
          checkIn = input.checkIn as string;
          checkOut = input.checkOut as string;
        } catch (error) {
          const fields = (error as AppError).details?.fields as Record<string, string> | undefined;
          for (const [k, msg] of Object.entries(fields ?? {})) v.fail(k, msg);
        }
      }
      v.done();
      let mailHotel: { recipients: { name: string; email: string }[]; payload: Omit<MailPayload, "name"> } | null = null;
      const result = await run(h, async (repos) => {
        let roomId: string | null = null;
        if (input.roomSlug) {
          const room = (await repos.siteRooms.list()).find((r) => r.slug === input.roomSlug && r.available);
          if (!room) throw new AppError("VALIDATION_FAILED", "Please choose a room from the list.", { fields: { roomSlug: "Please choose a room from the list." } });
          roomId = room.id;
        }
        const serial = await repos.references.next(fiscalYearOf(today));
        const reference = referenceText(REFERENCE_PREFIX, today, serial);
        await repos.siteEnquiries.create({
          name: name as string, phone, email, message: message as string, roomId, checkIn, checkOut, guests: input.adults + input.children, children: input.children,
          reference, ipAddress: ip, createdAt: deps.now(),
        });
        const recipients = (await repos.siteSettings.get()).fields.recipients;
        const roomName = roomId ? ((await repos.siteRooms.get(roomId))?.name ?? null) : null;
        mailHotel = { recipients, payload: { guestName: name as string, guestPhone: phone, ...(email ? { guestEmail: email } : {}), message: message as string, ...(roomName ? { roomName } : {}), ...(checkIn && checkOut ? { checkIn, checkOut } : {}), guests: input.adults + input.children, reference, hotelName: h.site.name } };
        return { reference };
      });
      // the hotel's own recipients are told after the enquiry is saved; a mail that cannot be queued never fails the guest's enquiry (and nothing about it is logged)
      if (mailHotel !== null) {
        const sent = mailHotel as { recipients: { name: string; email: string }[]; payload: Omit<MailPayload, "name"> };
        const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const to = [...new Set(sent.recipients.map((r) => r.email.trim().toLowerCase()).filter((e) => e !== "" && e.length <= 254 && EMAIL_RE.test(e)))].slice(0, 5);
        try {
          await deps.platform.run(async (r) => {
            for (const email of to) await r.outbox.enqueue({ userId: null, hotelId: h.site.hotelId, kind: "enquiry_new", toEmail: email, template: "enquiry-new", payload: JSON.stringify({ ...sent.payload, name: sent.recipients.find((x) => x.email.trim().toLowerCase() === email)?.name || "team" }) }, deps.now());
          });
          mailWake.touch();
        } catch {
          // best effort: the enquiry is saved and shows under Guest Enquiries either way
        }
      }
      return result;
    },
  };
}

export type PublicSiteService = ReturnType<typeof createPublicSiteService>;