import "server-only";
import { getPlatformHotels } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { hotelIdParams, reasonBody } from "@/server/services/platform/schemas";

// Only an active hotel can be suspended; its people are signed out at once (docs/BACKEND.md 14.1).
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: hotelIdParams,
  body: reasonBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPlatformHotels().suspend(session, params.id, body.reason, platformMeta(request, traceId)) }),
});
