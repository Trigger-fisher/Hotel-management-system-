import "server-only";
import { getMarketing } from "@/server/compose/companies";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { campaignSendBody } from "@/server/services/companies/schemas";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// Starts sending a draft to its audience through the hotel's own mail server (hotel migration 0044): `expected` is the number of addresses the hotel confirmed after the
// estimate; a different number now is a CONFLICT naming the new one. The mails are fed to the queue a little at a time by the mail worker. Once.
export const POST = route({
  permission: { key: "companies", level: "edit" },
  params: idParams,
  body: campaignSendBody,
  idempotency: "optional",
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getMarketing().send(session, params.id, body.expected, requestMeta(request, traceId)) }),
});
