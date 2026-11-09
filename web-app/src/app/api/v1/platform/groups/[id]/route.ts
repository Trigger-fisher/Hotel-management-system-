import "server-only";
import { getPlatformGroups } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { hotelIdParams } from "@/server/services/platform/schemas";

// One group: its hotels, the hotels it can still take, the admins it can choose from, its activity.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  params: hotelIdParams,
  handler: async ({ session, params }) => ({ data: await getPlatformGroups().get(session, params.id) }),
});