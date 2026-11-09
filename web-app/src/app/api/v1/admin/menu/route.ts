import "server-only";
import { getAdminMenu } from "@/server/compose/admin";
import { route } from "@/server/http/route";
import { listSearchQuery } from "@/server/services/admin/schemas";

// The room-service menu the guest portal shows: three fixed groups with the hotel's items. Master Data (module masters): view.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "masters", level: "view" },
  cache: "private, no-cache",
  query: listSearchQuery,
  handler: async ({ session, query }) => ({ data: await getAdminMenu().list(session, query.search) }),
});
