import "server-only";
import { getAdminAccount } from "@/server/compose/admin";
import { route } from "@/server/http/route";
import { listSearchQuery } from "@/server/services/admin/schemas";

export const dynamic = "force-dynamic";

// The last ten things done to the signed-in person's account.
export const GET = route({
  permission: "session",
  query: listSearchQuery,
  handler: async ({ session, query }) => ({ data: await getAdminAccount().recentChanges(session, query.search) }),
});
