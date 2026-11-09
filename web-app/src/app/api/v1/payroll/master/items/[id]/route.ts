import "server-only";
import { getPayrollAdmin } from "@/server/compose/systemAdmin";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { masterItemBody, scopeQuery } from "@/server/services/systemAdmin/schemas";
import { idParams } from "@/server/validation/listQuery";

// Changes or removes a Payroll Master item, only from the scope it lives in (PayrollMasterController::update / destroy). SuperAdmin only.
export const dynamic = "force-dynamic";

export const PATCH = route({
  permission: "session",
  params: idParams,
  query: scopeQuery,
  body: masterItemBody,
  handler: async ({ session, params, query, body, request, traceId }) => ({ data: await getPayrollAdmin().update(session, query.scope, params.id, body, requestMeta(request, traceId)) }),
});

export const DELETE = route({
  permission: "session",
  params: idParams,
  query: scopeQuery,
  handler: async ({ session, params, query, request, traceId }) => ({ data: await getPayrollAdmin().remove(session, query.scope, params.id, requestMeta(request, traceId)) }),
});
