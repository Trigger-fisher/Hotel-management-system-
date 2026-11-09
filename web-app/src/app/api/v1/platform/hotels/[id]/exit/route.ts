import "server-only";
import { getPlatformVisits } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { hotelIdParams } from "@/server/services/platform/schemas";

// Leave the hotel (the "Exit" on the banner). Ends the visit; doing it twice changes nothing.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: hotelIdParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getPlatformVisits().exit(session, params.id, platformMeta(request, traceId)) }),
});