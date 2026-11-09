import "server-only";
import { getPayrollStaffEmails } from "@/server/compose/payrollCore";
import { route } from "@/server/http/route";
import { companyParams, staffEmailFeedQuery } from "@/server/services/payrollCore/schemas";

export const dynamic = "force-dynamic";

// New cards since `after` (at most 50) and the watched ids (at most 200).
export const GET = route({
  permission: { key: "payroll.staff", level: "view" },
  cache: "private, no-cache",
  params: companyParams,
  query: staffEmailFeedQuery,
  handler: async ({ session, params, query }) => ({ data: await getPayrollStaffEmails().feed(session, params.companyId, query) }),
});
