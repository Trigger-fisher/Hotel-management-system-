import "server-only";
import { getHandovers } from "@/server/compose/handover";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { versionBody } from "@/server/services/cash/schemas";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// Recycle bin: the hotel's SuperAdmin only (checked by the service).
export const POST = route({
  permission: "session",
  params: idParams,
  body: versionBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getHandovers().restore(session, params.id, body.version, requestMeta(request, traceId)) }),
});
