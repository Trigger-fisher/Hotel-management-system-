import "server-only";
import { getPayrollEmployees } from "@/server/compose/payrollCore";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { companyItemParams, employeeBody } from "@/server/services/payrollCore/schemas";

export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "payroll.staff", level: "view" },
  params: companyItemParams,
  handler: async ({ session, params }) => ({ data: await getPayrollEmployees().get(session, params.companyId, params.id) }),
});

export const PATCH = route({
  permission: { key: "payroll.staff", level: "edit" },
  params: companyItemParams,
  body: employeeBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPayrollEmployees().update(session, params.companyId, params.id, body, requestMeta(request, traceId)) }),
});

// To the recycle bin: an Admin or the SuperAdmin, nothing depending on the person.
export const DELETE = route({
  permission: { key: "payroll.staff", level: "full" },
  params: companyItemParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getPayrollEmployees().remove(session, params.companyId, params.id, requestMeta(request, traceId)) }),
});
