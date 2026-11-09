import "server-only";
import { getAdminPlanRates } from "@/server/compose/admin";
import { idParams } from "@/server/services/admin/schemas";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

// A bill already made keeps the amount it was saved with.
export const DELETE = route({
  permission: { key: "masters", level: "full" },
  params: idParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getAdminPlanRates().remove(session, params.id, requestMeta(request, traceId)) }),
});
