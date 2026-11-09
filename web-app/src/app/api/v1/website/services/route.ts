import "server-only";
import { getWebsiteLists } from "@/server/compose/website";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { serviceBody, siteListQuery } from "@/server/services/website/schemas";

// The services and facilities of the website: the list, and a new card (an icon file comes as base64 inside the JSON, 2 MB at most).
export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "website.content", level: "view" },
  cache: "private, no-cache",
  query: siteListQuery,
  handler: async ({ session, query }) => ({ data: await getWebsiteLists().services(session, query.search) }),
});

export const POST = route({
  permission: { key: "website.content", level: "create" },
  body: serviceBody,
  maxBodyBytes: 4 * 1024 * 1024,
  handler: async ({ session, body, request, traceId }) => ({ data: await getWebsiteLists().saveService(session, null, body, requestMeta(request, traceId)), status: 201 }),
});