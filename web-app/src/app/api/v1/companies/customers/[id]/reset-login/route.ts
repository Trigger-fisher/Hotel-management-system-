import "server-only";
import { getCustomers } from "@/server/compose/companies";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// A new temporary portal password, emailed through the platform.
export const POST = route({
  permission: { key: "companies", level: "edit" },
  params: idParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getCustomers().resetLogin(session, params.id, requestMeta(request, traceId)) }),
});
