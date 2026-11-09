import "server-only";
import { getPayrollAdjustments } from "@/server/compose/payrollCore";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { advanceBody, advancesQuery, companyParams } from "@/server/services/payrollPay/schemas";

export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "payroll.advance", level: "view" },
  cache: "private, no-cache",
  params: companyParams,
  query: advancesQuery,
  handler: async ({ session, params, query }) => ({ data: await getPayrollAdjustments().listAdvances(session, params.companyId, query) }),
});

export const POST = route({
  permission: { key: "payroll.advance", level: "create" },
  params: companyParams,
  body: advanceBody,
  idempotency: "optional",
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPayrollAdjustments().createAdvance(session, params.companyId, body, requestMeta(request, traceId)), status: 201 }),
});
