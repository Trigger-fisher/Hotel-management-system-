import "server-only";
import { getPayrollAttendance } from "@/server/compose/payrollCore";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { attendanceQuery, monthParams } from "@/server/services/payrollCore/schemas";

export const dynamic = "force-dynamic";

// Salary generation: the month over, not locked, everyone complete (422 with a reason until Payroll Pay, task B6).
export const POST = route({
  permission: { key: "payroll.attendance", level: "edit" },
  params: monthParams,
  query: attendanceQuery,
  handler: async ({ session, params, query, request, traceId }) => ({ data: await getPayrollAttendance().generate(session, params.companyId, params.month, query, requestMeta(request, traceId)) }),
});
