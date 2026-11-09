import "server-only";
import { getWebsitePublic } from "@/server/compose/website";
import { CACHE_MEDIA, siteCors } from "@/server/http/publicSite";
import { publicRoute } from "@/server/http/route";
import { publicMediaParams } from "@/server/services/website/schemas";

// Decision 55: one photo, icon or logo of the hotel. Only a file name the public pages list is served; anything else is the same 404 as an unknown hotel.
export const dynamic = "force-dynamic";

export const GET = publicRoute({
  params: publicMediaParams,
  limits: [{ name: "public-site", max: 120, windowSeconds: 60, by: "ip" }],
  cors: siteCors,
  cache: CACHE_MEDIA,
  handler: async ({ params }) => {
    const f = await getWebsitePublic().media(params.slug, params.file);
    return { data: null, binary: { bytes: f.bytes, contentType: f.contentType, filename: params.file } };
  },
});