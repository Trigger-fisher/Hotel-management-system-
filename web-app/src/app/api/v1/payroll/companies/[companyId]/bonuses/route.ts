import "server-only";
import { getPayrollAdjustments } from "@/server/compose/payrollCore";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { bonusBody, bonusQuery, companyParams } from "@/server/services/payrollPay/schemas";

export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "payroll.bonus-incentive", level: "view" },
  cache: "private, no-cache",
  params: companyParams,
  query: bonusQuery,
  handler: async ({ session, params, query }) => ({ data: await getPayrollAdjustments().listBonus(session, params.companyId, query) }),
});

export const POST = route({
  permission: { key: "payroll.bonus-incentive", level: "create" },
  params: companyParams,
  body: bonusBody,
  idempotency: "optional",
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPayrollAdjustments().createBonus(session, params.companyId, body, requestMeta(request, traceId)), status: 201 }),
});
