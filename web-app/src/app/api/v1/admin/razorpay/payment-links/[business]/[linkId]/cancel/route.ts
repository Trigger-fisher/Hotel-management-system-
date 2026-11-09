import "server-only";
import { getAdminRazorpay } from "@/server/compose/admin";
import { razorpayLinkParams } from "@/server/services/admin/schemas";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";

// Cancel a payment link that has not been paid: the guest can no longer pay with it. SuperAdmin only.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: razorpayLinkParams,
  idempotency: "optional",
  handler: async ({ session, params, request, traceId }) => ({ data: await getAdminRazorpay().cancelPaymentLink(session, requestMeta(request, traceId), params.business, params.linkId) }),
});
