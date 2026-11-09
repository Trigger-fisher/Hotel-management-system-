import "server-only";
import { getGroupConsole } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { hotelIdParams } from "@/server/services/platform/schemas";

export const dynamic = "force-dynamic";

// Remove the hotel from my group; it keeps its data and becomes an individual hotel. 404 outside the group, 409 when my own account belongs to it.
export const POST = route({
  permission: "session",
  params: hotelIdParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getGroupConsole().unlink(session, params.id, platformMeta(request, traceId)) }),
});
