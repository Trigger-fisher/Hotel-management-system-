import "server-only";
import { getPayrollSeparations } from "@/server/compose/payrollCore";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { companyParams, separationBody, separationsQuery } from "@/server/services/payrollPay/schemas";

export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "payroll.separation", level: "view" },
  cache: "private, no-cache",
  params: companyParams,
  query: separationsQuery,
  handler: async ({ session, params, query }) => ({ data: await getPayrollSeparations().list(session, params.companyId, query) }),
});

export const POST = route({
  permission: { key: "payroll.separation", level: "create" },
  params: companyParams,
  body: separationBody,
  idempotency: "optional",
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPayrollSeparations().create(session, params.companyId, body, requestMeta(request, traceId)), status: 201 }),
});
