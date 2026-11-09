import "server-only";
import { getPayrollAdmin } from "@/server/compose/systemAdmin";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { listParams, masterItemBody, scopeQuery } from "@/server/services/systemAdmin/schemas";

// Adds an item to a Payroll Master list in the scope (PayrollMasterController::store). SuperAdmin only.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: listParams,
  query: scopeQuery,
  body: masterItemBody,
  handler: async ({ session, params, query, body, request, traceId }) => ({ data: await getPayrollAdmin().create(session, query.scope, params.list, body, requestMeta(request, traceId)), status: 201 }),
});
