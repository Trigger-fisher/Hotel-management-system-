import "server-only";
import { getBillingAdvances } from "@/server/compose/billing";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { refundBody, versionBody } from "@/server/services/billing/schemas";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// Recording a refund changes the advance: Pallav's "refund" route is an edit (Permissions.php:649).
export const POST = route({
  permission: { key: "bills.advances", level: "edit" },
  params: idParams,
  body: refundBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getBillingAdvances().refund(session, params.id, body, requestMeta(request, traceId)) }),
});

// Reversing a refund is a DELETE in Pallav: Full Access.
export const DELETE = route({
  permission: { key: "bills.advances", level: "full" },
  params: idParams,
  body: versionBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getBillingAdvances().undoRefund(session, params.id, body.version, requestMeta(request, traceId)) }),
});
