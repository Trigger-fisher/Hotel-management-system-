import "server-only";
import { getPayrollPayments } from "@/server/compose/payrollCore";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

// The pay screens' company list (fixed order); any payroll part's view (checked by the service).
export const GET = route({
  permission: "session",
  handler: async ({ session }) => ({ data: await getPayrollPayments().companies(session) }),
});
