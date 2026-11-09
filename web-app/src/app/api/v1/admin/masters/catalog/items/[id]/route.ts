import "server-only";
import { getAdminCatalog } from "@/server/compose/admin";
import { catalogItemBody, idParams, scopeQuery } from "@/server/services/admin/schemas";
import { route } from "@/server/http/route";

// Change or remove a priced item. The category comes from the item.
export const dynamic = "force-dynamic";

export const PATCH = route({
  permission: { key: "masters", level: "edit" },
  params: idParams,
  query: scopeQuery,
  body: catalogItemBody,
  handler: async ({ session, params, query, body }) => ({ data: await getAdminCatalog().updateItem(session, params.id, query.scope, body) }),
});

export const DELETE = route({
  permission: { key: "masters", level: "full" },
  params: idParams,
  query: scopeQuery,
  handler: async ({ session, params, query }) => ({ data: await getAdminCatalog().removeItem(session, params.id, query.scope) }),
});