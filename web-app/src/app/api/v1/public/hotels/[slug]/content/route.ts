import "server-only";
import { getWebsitePublic } from "@/server/compose/website";
import { CACHE_CONTENT, siteCors } from "@/server/http/publicSite";
import { publicRoute } from "@/server/http/route";
import { publicSlugParams } from "@/server/services/website/schemas";

// Decision 55: public, read only, one hotel by its slug (404 when it does not exist or its website is not live). docs/deploy/WEBSITE-CONNECT.md section 2.1.
export const dynamic = "force-dynamic";
export const GET = publicRoute({
  params: publicSlugParams,
  limits: [{ name: "public-site", max: 120, windowSeconds: 60, by: "ip" }],
  cors: siteCors,
  cache: CACHE_CONTENT,
  handler: async ({ params }) => ({ data: await getWebsitePublic().content(params.slug) }),
});
