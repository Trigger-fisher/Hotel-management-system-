import "server-only";
import { getAdminRazorpay } from "@/server/compose/admin";
import { razorpayRefundBody, razorpayStatusParams } from "@/server/services/admin/schemas";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";

// Refund all or part of a paid payment, through Razorpay, with a reason. The same idempotency key never refunds twice. SuperAdmin only.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: razorpayStatusParams,
  body: razorpayRefundBody,
  idempotency: "required",
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getAdminRazorpay().refund(session, requestMeta(request, traceId), params.business, params.paymentId, body) }),
});
