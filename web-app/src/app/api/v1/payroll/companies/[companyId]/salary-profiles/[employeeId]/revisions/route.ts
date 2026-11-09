import "server-only";
import { getPayrollRevisions } from "@/server/compose/payrollCore";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { employeeParams, revisionBody } from "@/server/services/payrollPay/schemas";

export const dynamic = "force-dynamic";

// A revision: the changed tracked fields recorded with their effective date (one batch).
export const POST = route({
  permission: { key: "payroll.salary-update", level: "edit" },
  params: employeeParams,
  body: revisionBody,
  idempotency: "optional",
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPayrollRevisions().revise(session, params.companyId, params.employeeId, body, requestMeta(request, traceId)), status: 201 }),
});
