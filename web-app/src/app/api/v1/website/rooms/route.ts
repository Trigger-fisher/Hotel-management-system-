import "server-only";
import { getWebsiteRooms } from "@/server/compose/website";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { roomBody, siteListQuery } from "@/server/services/website/schemas";

export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "website.rooms", level: "view" },
  cache: "private, no-cache",
  query: siteListQuery,
  handler: async ({ session, query }) => ({ data: await getWebsiteRooms().list(session, query.search) }),
});

export const POST = route({
  permission: { key: "website.rooms", level: "create" },
  body: roomBody,
  idempotency: "optional",
  handler: async ({ session, body, request, traceId }) => ({ data: await getWebsiteRooms().create(session, body, requestMeta(request, traceId)), status: 201 }),
});
