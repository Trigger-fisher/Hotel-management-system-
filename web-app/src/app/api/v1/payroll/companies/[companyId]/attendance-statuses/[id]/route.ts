import "server-only";
import { getPayrollSetup } from "@/server/compose/payrollCore";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { companyItemParams, statusBody } from "@/server/services/payrollCore/schemas";

export const dynamic = "force-dynamic";

export const PATCH = route({
  permission: { key: "payroll.attendance-status", level: "edit" },
  params: companyItemParams,
  body: statusBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPayrollSetup().updateStatus(session, params.companyId, params.id, body, requestMeta(request, traceId)) }),
});

// A hard delete (Pallav), refused while in use.
export const DELETE = route({
  permission: { key: "payroll.attendance-status", level: "full" },
  params: companyItemParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getPayrollSetup().deleteStatus(session, params.companyId, params.id, requestMeta(request, traceId)) }),
});
