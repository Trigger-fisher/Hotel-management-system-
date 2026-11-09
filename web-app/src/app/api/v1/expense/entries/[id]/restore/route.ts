import "server-only";
import { getCashExpenses } from "@/server/compose/cash";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { versionBody } from "@/server/services/cash/schemas";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// Recycle bin: the hotel's SuperAdmin role only (Pallav RecycleBinController).
export const POST = route({
  permission: "session",
  params: idParams,
  body: versionBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getCashExpenses().restore(session, params.id, body.version, requestMeta(request, traceId)) }),
});
