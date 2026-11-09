import "server-only";
import { getPlatformInvitations } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { hotelIdParams } from "@/server/services/platform/schemas";

// Approving a group lets its Group Hotel Admin sign in.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: hotelIdParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getPlatformInvitations().approveGroup(session, params.id, platformMeta(request, traceId)) }),
});
