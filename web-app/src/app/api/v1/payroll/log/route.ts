import "server-only";
import { getPayrollAdmin } from "@/server/compose/systemAdmin";
import { route } from "@/server/http/route";
import { payrollLogQuery } from "@/server/services/systemAdmin/schemas";

// The Payroll Log (Pallav PayrollLogController::index): everything done in payroll, newest first, across every company or one. SuperAdmin only.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  query: payrollLogQuery,
  handler: async ({ session, query }) => {
    const { scope, ...q } = query;
    return { data: await getPayrollAdmin().log(session, scope, q) };
  },
});
