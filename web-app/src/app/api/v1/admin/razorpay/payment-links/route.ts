import "server-only";
import { getAdminRazorpay } from "@/server/compose/admin";
import { razorpayLinkBody, razorpayListQuery } from "@/server/services/admin/schemas";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";

// The payment links of one business (newest first), and a new one. 409 "Razorpay is not set up yet." until the business's keys are saved and switched on. SuperAdmin only.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  query: razorpayListQuery,
  handler: async ({ session, query }) => ({ data: await getAdminRazorpay().paymentLinks(session, query.business, query.page) }),
});

export const POST = route({
  permission: "session",
  body: razorpayLinkBody,
  idempotency: "optional",
  handler: async ({ session, body, request, traceId }) => ({ data: await getAdminRazorpay().createPaymentLink(session, requestMeta(request, traceId), body) }),
});
