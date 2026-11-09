import "server-only";
import { getCustomers } from "@/server/compose/companies";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// Show (decision 74): the whole ID number of one customer. A POST, never cached, and every call is written to the Activity log. Not for API keys and not during a visit.
export const POST = route({
  permission: { key: "companies", level: "edit" },
  params: idParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getCustomers().revealIdNumber(session, params.id, requestMeta(request, traceId)) }),
});
