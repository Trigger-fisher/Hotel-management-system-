import "server-only";
import { getAdminCatalog } from "@/server/compose/admin";
import { keyParams, scopeSearchQuery } from "@/server/services/admin/schemas";
import { route } from "@/server/http/route";

// The expense catalogue of one business: categories with their priced items (docs/BACKEND.md section 14b).
export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "masters", level: "view" },
  cache: "private, no-cache",
  params: keyParams,
  query: scopeSearchQuery,
  handler: async ({ session, params, query }) => ({ data: await getAdminCatalog().get(session, params.key, query.scope, query.search) }),
});