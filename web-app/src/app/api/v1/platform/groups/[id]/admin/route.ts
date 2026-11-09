import "server-only";
import { getPlatformGroups } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { groupAdminBody, hotelIdParams } from "@/server/services/platform/schemas";

// Sets the Group Hotel Admin (an active Hotel Admin of a member hotel) or clears it (adminId: null).
export const dynamic = "force-dynamic";

export const PUT = route({
  permission: "session",
  params: hotelIdParams,
  body: groupAdminBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPlatformGroups().setAdmin(session, params.id, body.adminId, platformMeta(request, traceId)) }),
});