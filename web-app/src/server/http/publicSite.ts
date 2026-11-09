import "server-only";
import { getWebsitePublic } from "../compose/website";

// Decision 55 (docs/deploy/WEBSITE-CONNECT.md 2.2 and 2.3): the shared rules of the public website routes. The caching and the CORS decision live here (the per-address limits are written in each route file: tests/server/security.headers.test.ts reads them there) so every
// route says the same thing.
/** content routes: the edge keeps a copy for 5 minutes, the browser for one. */
export const CACHE_CONTENT = "public, max-age=60, s-maxage=300, stale-while-revalidate=600";
export const CACHE_AVAILABILITY = "public, max-age=30, s-maxage=30";
export const CACHE_MEDIA = "public, max-age=86400, s-maxage=604800";

/** A request Origin is allowed when its host is one of the hotel's registered domains (the www. pair counts as the same site). */
export function originAllowed(origin: string, domains: readonly string[]): boolean {
  let host: string;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const bare = (h: string): string => h.replace(/^www\./, "");
  return domains.some((d) => d === host || bare(d) === bare(host));
}

/** The `cors` rule of every public hotel route: the slug is in the params. */
export async function siteCors(origin: string, params: Record<string, string | string[]>): Promise<boolean> {
  const slug = params.slug;
  return typeof slug === "string" && originAllowed(origin, await getWebsitePublic().domainsOf(slug));
}
