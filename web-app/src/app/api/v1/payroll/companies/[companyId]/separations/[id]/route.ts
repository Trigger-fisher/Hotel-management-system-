import "server-only";
import { getPayrollSeparations } from "@/server/compose/payrollCore";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { companyItemParams, separationBody } from "@/server/services/payrollPay/schemas";

export const dynamic = "force-dynamic";

// An Admin or whoever recorded it; never moves the record to another person.
export const PATCH = route({
  permission: { key: "payroll.separation", level: "edit" },
  params: companyItemParams,
  body: separationBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPayrollSeparations().update(session, params.companyId, params.id, body, requestMeta(request, traceId)) }),
});

// To the recycle bin; Admins only; the person goes back into active payroll.
export const DELETE = route({
  permission: { key: "payroll.separation", level: "full" },
  params: companyItemParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getPayrollSeparations().remove(session, params.companyId, params.id, requestMeta(request, traceId)) }),
});
