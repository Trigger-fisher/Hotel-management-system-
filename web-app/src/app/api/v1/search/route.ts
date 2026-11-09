import "server-only";
import { getAdminSearch } from "@/server/compose/admin";
import { route } from "@/server/http/route";
import { searchQuery } from "@/server/services/admin/schemas";

export const dynamic = "force-dynamic";

// The global search: only what the person may read, at most 50 hits, about 20 searches a minute.
export const GET = route({
  permission: "session",
  query: searchQuery,
  limits: [{ name: "search", max: 20, windowSeconds: 60, by: "user" }],
  handler: async ({ session, query }) => ({ data: await getAdminSearch().search(session, query.q) }),
});
