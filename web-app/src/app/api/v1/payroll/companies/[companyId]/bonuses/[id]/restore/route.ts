import "server-only";
import { getPayrollAdjustments } from "@/server/compose/payrollCore";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { companyItemParams } from "@/server/services/payrollPay/schemas";

export const dynamic = "force-dynamic";

// Recycle bin: recycle-bin users only (checked by the service).
export const POST = route({
  permission: "session",
  params: companyItemParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getPayrollAdjustments().restoreBonus(session, params.companyId, params.id, requestMeta(request, traceId)) }),
});
