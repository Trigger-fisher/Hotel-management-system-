import "server-only";
import { getPayrollAdjustments } from "@/server/compose/payrollCore";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { advanceBody, companyItemParams } from "@/server/services/payrollPay/schemas";

export const dynamic = "force-dynamic";

// Admins only; never a carry-forward or one whose month is processed.
export const PATCH = route({
  permission: { key: "payroll.advance", level: "edit" },
  params: companyItemParams,
  body: advanceBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPayrollAdjustments().updateAdvance(session, params.companyId, params.id, body, requestMeta(request, traceId)) }),
});

// To the recycle bin; Admins only, same locks as an edit.
export const DELETE = route({
  permission: { key: "payroll.advance", level: "full" },
  params: companyItemParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getPayrollAdjustments().deleteAdvance(session, params.companyId, params.id, requestMeta(request, traceId)) }),
});
