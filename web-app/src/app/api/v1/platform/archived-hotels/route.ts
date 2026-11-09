import "server-only";
import { getPlatformArchive } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { archivedQuery } from "@/server/services/platform/schemas";

// Archived hotels, newest archive first, with the grace period and the export state. Super Admin only. (docs/BACKEND.md 14.6)
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  query: archivedQuery,
  handler: async ({ session, query }) => ({ data: await getPlatformArchive().list(session, query) }),
});