import "server-only";
import { getCompanies } from "@/server/compose/companies";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// Recycle bin: recycle-bin users only.
export const POST = route({
  permission: "session",
  params: idParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getCompanies().restore(session, params.id, requestMeta(request, traceId)) }),
});
