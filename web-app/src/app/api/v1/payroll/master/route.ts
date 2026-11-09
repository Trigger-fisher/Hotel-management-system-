import "server-only";
import { getPayrollAdmin } from "@/server/compose/systemAdmin";
import { route } from "@/server/http/route";
import { masterQuery } from "@/server/services/systemAdmin/schemas";

// Payroll Master (Pallav PayrollMasterController::index): one list in a scope ("all" or a payroll company). SuperAdmin only, checked by the service.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  query: masterQuery,
  handler: async ({ session, query }) => ({ data: await getPayrollAdmin().master(session, query.scope, query.list, query.search) }),
});
