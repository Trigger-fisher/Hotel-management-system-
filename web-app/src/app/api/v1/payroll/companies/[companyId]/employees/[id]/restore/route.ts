import "server-only";
import { getPayrollEmployees } from "@/server/compose/payrollCore";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { companyItemParams } from "@/server/services/payrollCore/schemas";

export const dynamic = "force-dynamic";

// Recycle bin: recycle-bin users only (checked by the service).
export const POST = route({
  permission: "session",
  params: companyItemParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getPayrollEmployees().restore(session, params.companyId, params.id, requestMeta(request, traceId)) }),
});
