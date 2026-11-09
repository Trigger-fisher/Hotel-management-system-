import "server-only";
import { getPayrollAdmin } from "@/server/compose/systemAdmin";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { scopeQuery, toggleBody } from "@/server/services/systemAdmin/schemas";
import { idParams } from "@/server/validation/listQuery";

// Switches a Payroll Master item on or off (PayrollMasterController::toggle); `{isActive}` makes it a SET. SuperAdmin only.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: idParams,
  query: scopeQuery,
  body: toggleBody,
  handler: async ({ session, params, query, body, request, traceId }) => ({ data: await getPayrollAdmin().toggle(session, query.scope, params.id, body.isActive, requestMeta(request, traceId)) }),
});
