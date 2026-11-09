import "server-only";
import { getPlatformVisits } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { hotelIdParams } from "@/server/services/platform/schemas";

// "Extend 60 minutes" on the banner (platform 0135): the live visit ends as extended and a new 60-minute one starts with the same reason and access; audited.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: hotelIdParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getPlatformVisits().extend(session, params.id, platformMeta(request, traceId)) }),
});
