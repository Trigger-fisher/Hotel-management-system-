import "server-only";
import { getPlatformHotels } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { hotelIdParams } from "@/server/services/platform/schemas";

// Clears the wrong-try counters and the timed lock. (docs/BACKEND.md 14.2)
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: hotelIdParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getPlatformHotels().unlockAdmin(session, params.id, platformMeta(request, traceId)) }),
});
