import "server-only";
import { getAdminRecycle } from "@/server/compose/admin";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { recycleParams } from "@/server/services/admin/schemas";

export const dynamic = "force-dynamic";

// Brings one record back, by its own module's rules (a closed year or a number taken in the meantime refuses). SuperAdmin only.
export const POST = route({
  permission: "session",
  params: recycleParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getAdminRecycle().restore(session, params.key, params.id, requestMeta(request, traceId)) }),
});
