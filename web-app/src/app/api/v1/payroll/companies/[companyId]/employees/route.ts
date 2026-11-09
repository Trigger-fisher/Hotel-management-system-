import "server-only";
import { getPayrollEmployees } from "@/server/compose/payrollCore";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { companyParams, employeeBody, employeeListQuery } from "@/server/services/payrollCore/schemas";

export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "payroll.staff", level: "view" },
  cache: "private, no-cache",
  params: companyParams,
  query: employeeListQuery,
  handler: async ({ session, params, query }) => ({ data: await getPayrollEmployees().list(session, params.companyId, query) }),
});

export const POST = route({
  permission: { key: "payroll.staff", level: "create" },
  params: companyParams,
  body: employeeBody,
  idempotency: "optional",
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPayrollEmployees().create(session, params.companyId, body, requestMeta(request, traceId)), status: 201 }),
});
