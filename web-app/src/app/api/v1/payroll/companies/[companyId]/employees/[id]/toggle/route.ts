import "server-only";
import { getPayrollEmployees } from "@/server/compose/payrollCore";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { companyItemParams } from "@/server/services/payrollCore/schemas";

export const dynamic = "force-dynamic";

export const POST = route({
  permission: { key: "payroll.staff", level: "edit" },
  params: companyItemParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getPayrollEmployees().toggle(session, params.companyId, params.id, requestMeta(request, traceId)) }),
});
