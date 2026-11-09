import "server-only";
import { getWebsitePublic } from "@/server/compose/website";
import { clientAddress } from "@/server/http/clientAddress";
import { siteCors } from "@/server/http/publicSite";
import { publicRoute } from "@/server/http/route";
import { publicEnquiryBody, publicSlugParams } from "@/server/services/website/schemas";

// Decision 55: a guest's enquiry from the hotel's website. JSON only (16 KB); a browser on one of the hotel's registered domains may call it; a filled honeypot
// is answered as success and dropped. The answer is the reference the guest is shown. Also the preflight for browsers.
export const dynamic = "force-dynamic";

export const OPTIONS = publicRoute({
  params: publicSlugParams,
  limits: [{ name: "public-site", max: 120, windowSeconds: 60, by: "ip" }],
  cors: siteCors,
  handler: async () => ({ data: null }),
});

export const POST = publicRoute({
  params: publicSlugParams,
  body: publicEnquiryBody,
  maxBodyBytes: 16 * 1024,
  idempotency: "off",
  limits: [{ name: "public-site-enquiry", max: 5, windowSeconds: 60, by: "ip" }, { name: "public-site-enquiry-hour", max: 20, windowSeconds: 3600, by: "ip" }],
  cors: siteCors,
  handler: async ({ params, body, request }) => ({ data: await getWebsitePublic().enquire(params.slug, body, clientAddress(request)), status: 201 }),
});