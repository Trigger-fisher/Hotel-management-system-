import "server-only";
import { getPlatformHotels } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { hotelIdParams, reasonBody } from "@/server/services/platform/schemas";

// Archive = the only delete: data kept, sign-in blocked, restorable for 90 days.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: hotelIdParams,
  body: reasonBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPlatformHotels().archive(session, params.id, body.reason, platformMeta(request, traceId)) }),
});
