import "server-only";
import { getAdminRazorpay } from "@/server/compose/admin";
import { razorpayLinkParams, razorpayResendBody } from "@/server/services/admin/schemas";
import { route } from "@/server/http/route";

// Ask Razorpay to send a payment link again, by SMS or email. SuperAdmin only.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: razorpayLinkParams,
  body: razorpayResendBody,
  idempotency: "optional",
  handler: async ({ session, params, body }) => ({ data: await getAdminRazorpay().resendPaymentLink(session, params.business, params.linkId, body.medium) }),
});
