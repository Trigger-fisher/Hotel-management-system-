import "server-only";
import { getRazorpayDisputes } from "@/server/compose/razorpayDisputes";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { disputeRespondBody } from "@/server/services/razorpay/disputeSchemas";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// Answer (a reply is needed) or close a problem. A closed or withdrawn one is not changed again (409). Needs Bills (edit): the hotel's own staff, not only the Super Admin.
export const POST = route({
  permission: "session",
  params: idParams,
  body: disputeRespondBody,
  idempotency: "optional",
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getRazorpayDisputes().respond(session, requestMeta(request, traceId), params.id, body) }),
});