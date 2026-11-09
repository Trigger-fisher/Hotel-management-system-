import "server-only";
import { getPlatformUsers } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { hotelIdParams } from "@/server/services/platform/schemas";

// Clears the lock. Any level; a Platform Admin is refused on Super Admin / Platform Admin accounts. (docs/BACKEND.md 14.5)
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: hotelIdParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getPlatformUsers().unlock(session, params.id, platformMeta(request, traceId)) }),
});