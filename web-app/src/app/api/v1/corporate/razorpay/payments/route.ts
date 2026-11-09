import "server-only";
import { getRazorpayDisputes } from "@/server/compose/razorpayDisputes";
import { route } from "@/server/http/route";
import { myPaymentsQuery } from "@/server/services/razorpay/disputeSchemas";

export const dynamic = "force-dynamic";

// The signed-in login's own online payments (Razorpay), newest first: what was paid, how, and whether it was refunded. Only the login's own; never the raw Razorpay body or the fee.
export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  query: myPaymentsQuery,
  handler: async ({ session, query }) => ({ data: await getRazorpayDisputes().myPayments(session, query) }),
});
