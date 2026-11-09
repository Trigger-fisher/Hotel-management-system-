import "server-only";
import { getPlatformHotels } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { adminListQuery } from "@/server/services/platform/schemas";

// Every Hotel Admin across hotels with status counts (docs/BACKEND.md 14.2).
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  query: adminListQuery,
  handler: async ({ session, query }) => ({ data: await getPlatformHotels().listAdmins(session, query) }),
});