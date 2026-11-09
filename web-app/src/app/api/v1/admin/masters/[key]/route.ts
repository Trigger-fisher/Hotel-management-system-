import "server-only";
import { getAdminMasters } from "@/server/compose/admin";
import { keyParams, scopeSearchQuery } from "@/server/services/admin/schemas";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

// One list with its entries; a grouped list reads the business the scope names ("both" keeps only the entries both businesses have).
export const GET = route({
  permission: { key: "masters", level: "view" },
  cache: "private, no-cache",
  params: keyParams,
  query: scopeSearchQuery,
  handler: async ({ session, params, query }) => ({ data: await getAdminMasters().list(session, params.key, query.scope, query.search) }),
});

// A list the app itself uses cannot be removed (its entries can still change).
export const DELETE = route({
  permission: { key: "masters", level: "full" },
  params: keyParams,
  handler: async ({ session, params }) => ({ data: await getAdminMasters().removeSet(session, params.key) }),
});
