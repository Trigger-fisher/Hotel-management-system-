import "server-only";
import { getAdminRecycle } from "@/server/compose/admin";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { recycleParams } from "@/server/services/admin/schemas";

export const dynamic = "force-dynamic";

// Removes one record for good, by its own module's rules. SuperAdmin only.
export const DELETE = route({
  permission: "session",
  params: recycleParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getAdminRecycle().purge(session, params.key, params.id, requestMeta(request, traceId)) }),
});
