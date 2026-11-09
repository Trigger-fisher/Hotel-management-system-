import "server-only";
import { getPayrollAttendance } from "@/server/compose/payrollCore";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { attendanceQuery, attendanceSaveBody, monthParams } from "@/server/services/payrollCore/schemas";

export const dynamic = "force-dynamic";

// The sheet: one page of people by name, their days in ONE query, progress and who blocks salary.
export const GET = route({
  permission: { key: "payroll.attendance", level: "view" },
  cache: "private, no-cache",
  params: monthParams,
  query: attendanceQuery,
  handler: async ({ session, params, query }) => ({ data: await getPayrollAttendance().sheet(session, params.companyId, params.month, query) }),
});

// Shortcut keys as typed; an unknown key fails the whole save (Pallav).
export const PUT = route({
  permission: { key: "payroll.attendance", level: "edit" },
  params: monthParams,
  query: attendanceQuery,
  body: attendanceSaveBody,
  handler: async ({ session, params, query, body, request, traceId }) => ({ data: await getPayrollAttendance().save(session, params.companyId, params.month, body, query, requestMeta(request, traceId)) }),
});
