import "server-only";
import { getWebsitePublic } from "@/server/compose/website";
import { CACHE_AVAILABILITY, siteCors } from "@/server/http/publicSite";
import { publicRoute } from "@/server/http/route";
import { publicAvailabilityQuery, publicSlugParams } from "@/server/services/website/schemas";

// Decision 55: rooms free for the dates (the 3-month window and the 60-night cap apply); per room only whether it is free and a capped count.
export const dynamic = "force-dynamic";

export const GET = publicRoute({
  params: publicSlugParams,
  query: publicAvailabilityQuery,
  limits: [{ name: "public-site-availability", max: 30, windowSeconds: 60, by: "ip" }],
  cors: siteCors,
  cache: CACHE_AVAILABILITY,
  handler: async ({ params, query }) => ({ data: await getWebsitePublic().availability(params.slug, query) }),
});