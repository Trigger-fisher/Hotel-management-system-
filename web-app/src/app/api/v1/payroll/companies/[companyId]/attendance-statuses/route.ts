import "server-only";
import { getPayrollSetup } from "@/server/compose/payrollCore";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { companyParams, statusBody, setupListQuery } from "@/server/services/payrollCore/schemas";

export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "payroll.attendance-status", level: "view" },
  cache: "private, no-cache",
  params: companyParams,
  query: setupListQuery,
  handler: async ({ session, params, query }) => ({ data: await getPayrollSetup().listStatuses(session, params.companyId, query.search) }),
});

export const POST = route({
  permission: { key: "payroll.attendance-status", level: "create" },
  params: companyParams,
  body: statusBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPayrollSetup().createStatus(session, params.companyId, body, requestMeta(request, traceId)), status: 201 }),
});
