import "server-only";
import { getRazorpayDisputes } from "@/server/compose/razorpayDisputes";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { disputeRaiseBody, myProblemsQuery } from "@/server/services/razorpay/disputeSchemas";

export const dynamic = "force-dynamic";

// The login's own problems with its online payments (a charge it does not know, a payment taken twice, a refund it wants, a question), newest first; and raising a new one about its OWN payment
// (404 when the payment is not its own, 409 when it was not taken yet or three problems are already open on it).
export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  query: myProblemsQuery,
  handler: async ({ session, query }) => ({ data: await getRazorpayDisputes().mine(session, query) }),
});

export const POST = route({
  permission: "session",
  body: disputeRaiseBody,
  idempotency: "optional",
  handler: async ({ session, body, request, traceId }) => ({ data: await getRazorpayDisputes().raise(session, requestMeta(request, traceId), body) }),
});
