import "server-only";
import { getRazorpayDisputes } from "@/server/compose/razorpayDisputes";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { withdrawQuery } from "@/server/services/razorpay/disputeSchemas";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// The login takes back its own problem while it is still waiting (409 once the hotel has answered). Another login's problem is 404.
export const POST = route({
  permission: "session",
  params: idParams,
  query: withdrawQuery,
  idempotency: "optional",
  handler: async ({ session, params, query, request, traceId }) => ({ data: await getRazorpayDisputes().withdraw(session, requestMeta(request, traceId), params.id, query.hotel) }),
});