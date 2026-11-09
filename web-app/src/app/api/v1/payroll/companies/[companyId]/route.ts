import "server-only";
import { getPayrollCompanies } from "@/server/compose/payrollCore";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { companyBody, companyParams } from "@/server/services/payrollCore/schemas";

export const dynamic = "force-dynamic";

// Any payroll part's view (checked by the service).
export const GET = route({
  permission: "session",
  params: companyParams,
  handler: async ({ session, params }) => ({ data: await getPayrollCompanies().get(session, params.companyId) }),
});

// The details only: name and code are fixed, a company is never deactivated.
export const PATCH = route({
  permission: { key: "payroll", level: "edit" },
  params: companyParams,
  body: companyBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPayrollCompanies().update(session, params.companyId, body, requestMeta(request, traceId)) }),
});
