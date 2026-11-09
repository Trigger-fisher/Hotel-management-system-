import "server-only";
import { getPlatformGroups } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { groupHotelParams } from "@/server/services/platform/schemas";

// Unlinks a hotel from a group (nothing is deleted; the hotel becomes individual).
export const dynamic = "force-dynamic";

export const DELETE = route({
  permission: "session",
  params: groupHotelParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getPlatformGroups().removeHotel(session, params.id, params.hotelId, platformMeta(request, traceId)) }),
});