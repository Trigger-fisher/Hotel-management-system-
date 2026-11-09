import "server-only";
import { getAdminRazorpay } from "@/server/compose/admin";
import { razorpayStatusParams } from "@/server/services/admin/schemas";
import { route } from "@/server/http/route";

// The payment as HMS last kept it: a read that asks nothing of Razorpay and writes nothing (POST .../status/refresh checks with Razorpay now). Bills view.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  params: razorpayStatusParams,
  handler: async ({ session, params }) => ({ data: await getAdminRazorpay().storedStatus(session, params.business, params.paymentId) }),
});
