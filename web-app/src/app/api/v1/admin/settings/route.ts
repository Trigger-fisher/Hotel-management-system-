import "server-only";
import { getAdminSettings } from "@/server/compose/admin";
import { route } from "@/server/http/route";
import { settingsTabQuery } from "@/server/services/admin/schemas";

export const dynamic = "force-dynamic";

// The SuperAdmin's settings: the groups, and the open one with its values (a secret is never returned: only whether it is set).
export const GET = route({
  permission: "session",
  query: settingsTabQuery,
  handler: async ({ session, query }) => ({ data: await getAdminSettings().overview(session, query.tab) }),
});
