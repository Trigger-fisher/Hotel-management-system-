import "server-only";
import { getGroupConsole } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { enterBody, hotelIdParams } from "@/server/services/platform/schemas";

export const dynamic = "force-dynamic";

// Enter a member hotel: a written reason (5 to 500 characters), 60 minutes, READ ONLY (the same guard as the platform's visit).
export const POST = route({
  permission: "session",
  params: hotelIdParams,
  body: enterBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getGroupConsole().enter(session, params.id, body.reason, platformMeta(request, traceId)) }),
});
