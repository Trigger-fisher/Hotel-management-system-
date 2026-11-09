import "server-only";
import { getAdminMasters } from "@/server/compose/admin";
import { idParams, optionBody, scopeQuery } from "@/server/services/admin/schemas";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

export const PATCH = route({
  permission: { key: "masters", level: "edit" },
  params: idParams,
  query: scopeQuery,
  body: optionBody,
  handler: async ({ session, params, query, body }) => ({ data: await getAdminMasters().updateItem(session, params.id, query.scope, body) }),
});

export const DELETE = route({
  permission: { key: "masters", level: "full" },
  params: idParams,
  query: scopeQuery,
  handler: async ({ session, params, query }) => ({ data: await getAdminMasters().removeItem(session, params.id, query.scope) }),
});
