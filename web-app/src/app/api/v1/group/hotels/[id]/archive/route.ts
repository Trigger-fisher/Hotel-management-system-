import "server-only";
import { getGroupConsole } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { hotelIdParams, reasonBody } from "@/server/services/platform/schemas";

export const dynamic = "force-dynamic";

// "Delete" a member hotel = archive it (sign-in blocked, data kept; only the platform restores it). Optional reason.
export const POST = route({
  permission: "session",
  params: hotelIdParams,
  body: reasonBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getGroupConsole().archive(session, params.id, body.reason, platformMeta(request, traceId)) }),
});
