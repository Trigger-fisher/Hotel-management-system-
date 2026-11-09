import "server-only";
import { getPayrollSeparations } from "@/server/compose/payrollCore";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { companyItemParams } from "@/server/services/payrollPay/schemas";

export const dynamic = "force-dynamic";

// Recycle bin: removed for good (recycle-bin users only).
export const DELETE = route({
  permission: "session",
  params: companyItemParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getPayrollSeparations().purge(session, params.companyId, params.id, requestMeta(request, traceId)) }),
});
