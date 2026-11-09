import "server-only";
import { getGroupConsole } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { hotelIdParams } from "@/server/services/platform/schemas";

export const dynamic = "force-dynamic";

// "Extend 60 minutes" inside a member hotel (platform 0135): a new 60-minute visit, still read only for a group admin; audited.
export const POST = route({
  permission: "session",
  params: hotelIdParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getGroupConsole().extend(session, params.id, platformMeta(request, traceId)) }),
});
