import "server-only";
import { getAdminCatalog } from "@/server/compose/admin";
import { catalogItemBody, idParams, scopeQuery } from "@/server/services/admin/schemas";
import { route } from "@/server/http/route";

// A new priced item in a category.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: { key: "masters", level: "edit" },
  params: idParams,
  query: scopeQuery,
  body: catalogItemBody,
  handler: async ({ session, params, query, body }) => ({ data: await getAdminCatalog().saveItem(session, params.id, null, query.scope, body), status: 201 }),
});