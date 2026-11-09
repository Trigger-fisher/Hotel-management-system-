import "server-only";
import { requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { HotelSiteRecord, PlatformUnit } from "../../repos/auth";
import type { WebsiteDeps } from "./context";

// Decision 55 (R25/R34): the hotel's public website switch ("Website live") and the host names its website runs on. Stored on the platform (hotel_sites and
// hotel_site_domains, migration 0116) because the public API reads them before it opens the hotel's own schema. Needs the website settings part.

const PART = "website.settings";
export const MAX_DOMAINS = 5;
/** A host name as the database CHECK accepts it: lower-case labels of letters, digits and dashes, at least two labels. */
const HOST = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

export interface SiteAccessDto {
  live: boolean;
  domains: string[];
  slug: string;
  /** What the website's Sign in button must link to. */
  signInUrl: string;
}

const fail = (message: string): AppError => new AppError("VALIDATION_FAILED", message, { fields: { domains: message } });

/** The domains as typed -> the clean list, or a plain sentence for the first thing wrong. */
export function cleanDomains(input: readonly string[]): string[] {
  if (input.length > MAX_DOMAINS) throw fail(`A hotel website may have at most ${MAX_DOMAINS} addresses.`);
  const out: string[] = [];
  for (const raw of input) {
    const d = raw.trim().toLowerCase();
    if (d === "") throw fail("Remove the empty address.");
    if (/^[a-z][a-z0-9+.-]*:\/\//.test(d) || d.includes("/") || d.includes("?") || d.includes("#")) throw fail(`Write only the address, like www.thehotel.in, without http:// or a path: ${raw.trim().slice(0, 60)}`);
    if (d.includes(":")) throw fail(`Leave out the port number: ${raw.trim().slice(0, 60)}`);
    if (!HOST.test(d) || d.length > 253) throw fail(`That is not a valid website address: ${raw.trim().slice(0, 60)}`);
    if (out.includes(d)) throw fail(`The address ${d} is written twice.`);
    out.push(d);
  }
  return out;
}

export function createSiteAccessService(deps: WebsiteDeps) {
  const platform = (): PlatformUnit => {
    if (!deps.platform) throw new AppError("SERVER_ERROR", "The website switch is not available on this server.");
    return deps.platform;
  };
  const base = deps.publicUrl.replace(/\/+$/, "");
  const dto = (s: HotelSiteRecord): SiteAccessDto => ({ live: s.live, domains: [...s.domains], slug: s.slug, signInUrl: `${base}/?hotel=${s.slug}` });

  return {
    async get(session: VerifiedSession): Promise<SiteAccessDto> {
      requirePermission(session, deps.catalog, PART, "view");
      const site = await platform().run((r) => r.sites.byHotel(session.hotelId));
      if (!site) throw new AppError("NOT_FOUND");
      return dto(site);
    },

    async update(session: VerifiedSession, input: { live: boolean; domains: readonly string[] }): Promise<SiteAccessDto> {
      requirePermission(session, deps.catalog, PART, "edit");
      const domains = cleanDomains(input.domains);
      const saved = await platform().run(async (r) => {
        const site = await r.sites.byHotel(session.hotelId);
        if (!site) throw new AppError("NOT_FOUND");
        const result = await r.sites.save(session.hotelId, { live: input.live, domains }, session.userId);
        if (result.taken.length > 0) throw fail("That address is already used by another hotel.");
        return { before: site, after: await r.sites.byHotel(session.hotelId) };
      });
      const after = saved.after as HotelSiteRecord;
      const added = after.domains.filter((d) => !saved.before.domains.includes(d));
      const removed = saved.before.domains.filter((d) => !after.domains.includes(d));
      if (saved.before.live !== after.live || added.length > 0 || removed.length > 0) {
        await deps.audit.record({ action: "website.site_changed", userId: session.userId, hotelId: session.hotelId, details: { live: after.live, wasLive: saved.before.live, added, removed } });
      }
      return dto(after);
    },
  };
}

export type SiteAccessService = ReturnType<typeof createSiteAccessService>;