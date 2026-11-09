import "server-only";
import { getWebsiteRooms } from "@/server/compose/website";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { idParams, roomBody } from "@/server/services/website/schemas";

export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "website.rooms", level: "view" },
  params: idParams,
  handler: async ({ session, params }) => ({ data: await getWebsiteRooms().get(session, params.id) }),
});

export const PATCH = route({
  permission: { key: "website.rooms", level: "edit" },
  params: idParams,
  body: roomBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getWebsiteRooms().update(session, params.id, body, requestMeta(request, traceId)) }),
});

// Never a room with enquiries on record (mark it unavailable instead).
export const DELETE = route({
  permission: { key: "website.rooms", level: "full" },
  params: idParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getWebsiteRooms().remove(session, params.id, requestMeta(request, traceId)) }),
});
