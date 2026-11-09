import "server-only";
import { getPlatformInvitations } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { hotelIdParams, reasonBody } from "@/server/services/platform/schemas";

// Rejects a hotel that waits for approval; the reason is required and is e-mailed to the person.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: hotelIdParams,
  body: reasonBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPlatformInvitations().rejectHotel(session, params.id, body.reason, platformMeta(request, traceId)) }),
});
