import "server-only";
import { getAdminMasters } from "@/server/compose/admin";
import { idParams, scopeQuery } from "@/server/services/admin/schemas";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

// Hidden from forms (records that already use it keep it), or offered again.
export const POST = route({
  permission: { key: "masters", level: "edit" },
  params: idParams,
  query: scopeQuery,
  handler: async ({ session, params, query }) => ({ data: await getAdminMasters().toggleItem(session, params.id, query.scope) }),
});
