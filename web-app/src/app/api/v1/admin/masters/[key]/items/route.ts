import "server-only";
import { getAdminMasters } from "@/server/compose/admin";
import { keyParams, optionBody, scopeQuery } from "@/server/services/admin/schemas";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

// Added last; on "both businesses" the name goes on the other business's list too.
export const POST = route({
  permission: { key: "masters", level: "edit" },
  params: keyParams,
  query: scopeQuery,
  body: optionBody,
  idempotency: "optional",
  handler: async ({ session, params, query, body }) => ({ data: await getAdminMasters().createItem(session, params.key, query.scope, body), status: 201 }),
});
