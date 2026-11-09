import "server-only";
import { getAdminCatalog } from "@/server/compose/admin";
import { catalogCategoryBody, keyParams, scopeQuery } from "@/server/services/admin/schemas";
import { route } from "@/server/http/route";

// A new category in the catalogue of the business that list belongs to.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: { key: "masters", level: "edit" },
  params: keyParams,
  query: scopeQuery,
  body: catalogCategoryBody,
  handler: async ({ session, params, query, body }) => ({ data: await getAdminCatalog().createCategory(session, params.key, query.scope, body.name), status: 201 }),
});