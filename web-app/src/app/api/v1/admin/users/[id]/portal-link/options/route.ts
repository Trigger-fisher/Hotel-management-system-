import "server-only";
import { route } from "@/server/http/route";
import { getAdminUsers } from "@/server/compose/admin";
import { idParams } from "@/server/services/admin/schemas";
import { portalOptionsQuery } from "@/server/services/admin/userSchemas";

export const dynamic = "force-dynamic";

// Decision 47: the active guest or company records the "Linked to" picker offers for this portal account (up to 25; `q` filters by name, mobile, city or email).
export const GET = route({
  permission: { key: "users", level: "edit" },
  cache: "private, no-cache",
  params: idParams,
  query: portalOptionsQuery,
  handler: async ({ session, params, query }) => ({ data: await getAdminUsers().portalOptions(session, params.id, query.q) }),
});