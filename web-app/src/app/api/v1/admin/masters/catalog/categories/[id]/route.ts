import "server-only";
import { getAdminCatalog } from "@/server/compose/admin";
import { catalogCategoryBody, idParams, scopeQuery } from "@/server/services/admin/schemas";
import { route } from "@/server/http/route";

// Rename or remove a category (its items go with it).
export const dynamic = "force-dynamic";

export const PATCH = route({
  permission: { key: "masters", level: "edit" },
  params: idParams,
  query: scopeQuery,
  body: catalogCategoryBody,
  handler: async ({ session, params, query, body }) => ({ data: await getAdminCatalog().renameCategory(session, params.id, query.scope, body.name) }),
});

export const DELETE = route({
  permission: { key: "masters", level: "full" },
  params: idParams,
  query: scopeQuery,
  handler: async ({ session, params, query }) => ({ data: await getAdminCatalog().removeCategory(session, params.id, query.scope) }),
});