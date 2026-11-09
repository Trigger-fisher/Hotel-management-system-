import "server-only";
import { getSystemHealth } from "@/server/compose/systemAdmin";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";

// Marks a fault as fixed (SystemHealthController::resolve): a SET, so doing it twice changes nothing. SuperAdmin only.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: idParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getSystemHealth().setResolved(session, params.id, true, requestMeta(request, traceId)) }),
});
