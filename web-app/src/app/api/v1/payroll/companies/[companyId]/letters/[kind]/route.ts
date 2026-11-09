import "server-only";
import { getPayrollLetters } from "@/server/compose/payrollCore";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { letterBody, letterParams } from "@/server/services/payrollPay/schemas";

export const dynamic = "force-dynamic";

// This company's template of one kind, or null. The joining or experience letter part's view (checked by the service).
export const GET = route({
  permission: "session",
  params: letterParams,
  handler: async ({ session, params }) => ({ data: await getPayrollLetters().get(session, params.companyId, params.kind) }),
});

// Saves the one template of this kind (edit on its part, checked by the service).
export const PUT = route({
  permission: "session",
  params: letterParams,
  body: letterBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPayrollLetters().save(session, params.companyId, params.kind, body, requestMeta(request, traceId)) }),
});

// Deletes the template (full on its part, checked by the service).
export const DELETE = route({
  permission: "session",
  params: letterParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getPayrollLetters().remove(session, params.companyId, params.kind, requestMeta(request, traceId)) }),
});
