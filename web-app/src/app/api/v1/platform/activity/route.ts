import "server-only";
import { getPlatformHotels } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { activityQuery } from "@/server/services/platform/schemas";

// The successful platform actions about a hotel or a group, newest first (a hotel's Activity tab).
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  query: activityQuery,
  handler: async ({ session, query }) => ({ data: await getPlatformHotels().activity(session, query) }),
});