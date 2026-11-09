import "server-only";
import { getPlatformHotels } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { adminBody, hotelIdParams } from "@/server/services/platform/schemas";

// A new Hotel Admin for a live hotel; the temporary password is emailed and never returned (docs/BACKEND.md 14.2).
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: hotelIdParams,
  body: adminBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPlatformHotels().addAdmin(session, params.id, body, platformMeta(request, traceId)), status: 201 }),
});