import "server-only";
import { getPayrollSetup } from "@/server/compose/payrollCore";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { companyParams, deductionBody, setupListQuery } from "@/server/services/payrollCore/schemas";

export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "payroll.deduction", level: "view" },
  cache: "private, no-cache",
  params: companyParams,
  query: setupListQuery,
  handler: async ({ session, params, query }) => ({ data: await getPayrollSetup().listDeductions(session, params.companyId, query.search) }),
});

export const POST = route({
  permission: { key: "payroll.deduction", level: "create" },
  params: companyParams,
  body: deductionBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPayrollSetup().createDeduction(session, params.companyId, body, requestMeta(request, traceId)), status: 201 }),
});
