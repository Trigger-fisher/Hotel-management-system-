import "server-only";
import { getBillingAdvances } from "@/server/compose/billing";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { emailBody } from "@/server/services/billing/schemas";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// "Email receipt": queues the advance receipt as a PDF mail from THIS hotel's own email. Same rules as emailing a bill. 30 an hour per person.
export const POST = route({
  permission: "session",
  params: idParams,
  body: emailBody,
  idempotency: "optional",
  limits: [{ name: "advance-email", max: 30, windowSeconds: 3600, by: "user" }],
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getBillingAdvances().emailReceipt(session, params.id, body, requestMeta(request, traceId)), status: 202 }),
});