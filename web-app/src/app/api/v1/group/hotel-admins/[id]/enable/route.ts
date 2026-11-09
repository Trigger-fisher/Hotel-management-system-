import "server-only";
import { getGroupConsole } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { hotelIdParams } from "@/server/services/platform/schemas";

export const dynamic = "force-dynamic";

// enable for a Hotel Admin of one of my member hotels. 404 for any other account.
export const POST = route({
  permission: "session",
  params: hotelIdParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getGroupConsole().enable(session, params.id, platformMeta(request, traceId)) }),
});
