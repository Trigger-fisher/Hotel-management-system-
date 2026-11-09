import "server-only";
import { getPlatformGroups } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { groupMaxHotelsBody, hotelIdParams } from "@/server/services/platform/schemas";

// The most hotels a group may have (Super Admin and Platform Admin): a whole number, or null for no limit; never below what the group has now (422 maxHotels). Audited.
export const dynamic = "force-dynamic";

export const PUT = route({
  permission: "session",
  params: hotelIdParams,
  body: groupMaxHotelsBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPlatformGroups().setMaxHotels(session, params.id, body.maxHotels, platformMeta(request, traceId)) }),
});