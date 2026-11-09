import "server-only";
import { getWebsiteLists } from "@/server/compose/website";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { idParams, nearbyBody } from "@/server/services/website/schemas";

export const dynamic = "force-dynamic";

export const PATCH = route({
  permission: { key: "website.content", level: "edit" },
  params: idParams,
  body: nearbyBody,
  maxBodyBytes: 4 * 1024 * 1024,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getWebsiteLists().saveNearby(session, params.id, body, requestMeta(request, traceId)) }),
});

export const DELETE = route({
  permission: { key: "website.content", level: "full" },
  params: idParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getWebsiteLists().remove(session, "nearby", params.id, requestMeta(request, traceId)) }),
});