import "server-only";
import { getPayrollAdjustments } from "@/server/compose/payrollCore";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { bonusBody, companyItemParams } from "@/server/services/payrollPay/schemas";

export const dynamic = "force-dynamic";

// Admins only; never a carry-forward or one whose month is processed.
export const PATCH = route({
  permission: { key: "payroll.bonus-incentive", level: "edit" },
  params: companyItemParams,
  body: bonusBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPayrollAdjustments().updateBonus(session, params.companyId, params.id, body, requestMeta(request, traceId)) }),
});

// To the recycle bin; Admins only, same locks as an edit.
export const DELETE = route({
  permission: { key: "payroll.bonus-incentive", level: "full" },
  params: companyItemParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getPayrollAdjustments().deleteBonus(session, params.companyId, params.id, requestMeta(request, traceId)) }),
});
