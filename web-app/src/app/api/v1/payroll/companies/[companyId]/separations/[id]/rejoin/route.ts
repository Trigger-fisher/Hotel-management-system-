import "server-only";
import { getPayrollSeparations } from "@/server/compose/payrollCore";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { companyItemParams, rejoinBody } from "@/server/services/payrollPay/schemas";

export const dynamic = "force-dynamic";

// Takes a former employee back on, keeping their payroll history.
export const POST = route({
  permission: { key: "payroll.separation", level: "edit" },
  params: companyItemParams,
  body: rejoinBody,
  idempotency: "optional",
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPayrollSeparations().rejoin(session, params.companyId, params.id, body, requestMeta(request, traceId)) }),
});
