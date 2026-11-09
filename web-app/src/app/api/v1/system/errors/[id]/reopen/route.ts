import "server-only";
import { getSystemHealth } from "@/server/compose/systemAdmin";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";

// Opens a fixed fault again (SystemHealthController::reopen): a SET. SuperAdmin only.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: idParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getSystemHealth().setResolved(session, params.id, false, requestMeta(request, traceId)) }),
});
