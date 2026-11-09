import "server-only";
import { getPayrollSetup } from "@/server/compose/payrollCore";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { companyItemParams } from "@/server/services/payrollCore/schemas";

export const dynamic = "force-dynamic";

export const POST = route({
  permission: { key: "payroll.deduction", level: "edit" },
  params: companyItemParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getPayrollSetup().toggleDeduction(session, params.companyId, params.id, requestMeta(request, traceId)) }),
});
