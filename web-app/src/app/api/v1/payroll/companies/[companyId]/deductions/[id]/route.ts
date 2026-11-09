import "server-only";
import { getPayrollSetup } from "@/server/compose/payrollCore";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { companyItemParams, deductionBody } from "@/server/services/payrollCore/schemas";

export const dynamic = "force-dynamic";

export const PATCH = route({
  permission: { key: "payroll.deduction", level: "edit" },
  params: companyItemParams,
  body: deductionBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPayrollSetup().updateDeduction(session, params.companyId, params.id, body, requestMeta(request, traceId)) }),
});

// A hard delete (Pallav), refused while in use.
export const DELETE = route({
  permission: { key: "payroll.deduction", level: "full" },
  params: companyItemParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getPayrollSetup().deleteDeduction(session, params.companyId, params.id, requestMeta(request, traceId)) }),
});
