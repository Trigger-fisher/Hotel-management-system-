import "server-only";
import { getMarketing } from "@/server/compose/companies";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// Sending -> paused: the mail worker moves nothing more of this campaign into the queue until it is resumed.
export const POST = route({
  permission: { key: "companies", level: "edit" },
  params: idParams,
  idempotency: "optional",
  handler: async ({ session, params, request, traceId }) => ({ data: await getMarketing().pause(session, params.id, requestMeta(request, traceId)) }),
});
