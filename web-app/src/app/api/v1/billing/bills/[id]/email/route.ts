import "server-only";
import { getBillingBills } from "@/server/compose/billing";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { emailBody } from "@/server/services/billing/schemas";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// "Email bill": queues the bill as a PDF mail from THIS hotel's own email (MJ's mail rule: invoices come from the hotel). Permission as for looking at the bill. `to` left out =
// the guest's email kept in the hotel's customers; none = 422 on `to`. 30 an hour per person. The PDF is made when the mail is sent.
export const POST = route({
  permission: "session",
  params: idParams,
  body: emailBody,
  idempotency: "optional",
  limits: [{ name: "bill-email", max: 30, windowSeconds: 3600, by: "user" }],
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getBillingBills().emailInvoice(session, params.id, body, requestMeta(request, traceId)), status: 202 }),
});