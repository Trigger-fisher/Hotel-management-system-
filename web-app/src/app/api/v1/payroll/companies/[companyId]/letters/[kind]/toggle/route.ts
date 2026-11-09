import "server-only";
import { getPayrollLetters } from "@/server/compose/payrollCore";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { letterParams } from "@/server/services/payrollPay/schemas";

export const dynamic = "force-dynamic";

// Switches the template on or off (edit on its part, checked by the service).
export const POST = route({
  permission: "session",
  params: letterParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getPayrollLetters().toggle(session, params.companyId, params.kind, requestMeta(request, traceId)) }),
});
