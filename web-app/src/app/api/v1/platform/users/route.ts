import "server-only";
import { getPlatformUsers } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { userListQuery } from "@/server/services/platform/schemas";

// Every account on the platform, read only, with counts by level and status (docs/BACKEND.md 14.5). Platform Admin and Super Admin; a Platform Admin
// never sees (or counts) Super Admin and Platform Admin accounts.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  query: userListQuery,
  handler: async ({ session, query }) => ({ data: await getPlatformUsers().list(session, query) }),
});