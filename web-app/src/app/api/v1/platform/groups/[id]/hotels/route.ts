import "server-only";
import { getPlatformGroups } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { groupHotelBody, hotelIdParams } from "@/server/services/platform/schemas";

// Adds a hotel to a group: the group must be active, the hotel live and in no other group.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: hotelIdParams,
  body: groupHotelBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPlatformGroups().addHotel(session, params.id, body.hotelId, platformMeta(request, traceId)) }),
});