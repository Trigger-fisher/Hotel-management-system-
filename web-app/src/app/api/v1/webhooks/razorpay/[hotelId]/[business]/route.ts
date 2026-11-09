import "server-only";
import { z } from "zod";
import { getAdminRazorpay } from "@/server/compose/admin";
import { AppError } from "@/server/errors";
import { requestMeta } from "@/server/http/meta";
import { publicRoute } from "@/server/http/route";

// Razorpay calls this when a payment, refund or payment link changes (no session). The address carries the hotel and the business; the raw body is checked against the
// business's webhook secret (X-Razorpay-Signature). A wrong signature is kept as "rejected" and answers 403; a repeated event is accepted and ignored.
export const dynamic = "force-dynamic";

const params = z.strictObject({ hotelId: z.uuid(), business: z.enum(["hotel", "food"]) });

export const POST = publicRoute({
  params,
  maxBodyBytes: 512 * 1024,
  limits: [{ name: "razorpay-webhook", max: 600, windowSeconds: 60, by: "ip" }],
  handler: async ({ params: p, request, traceId }) => {
    const rawBody = await request.text();
    const answer = await getAdminRazorpay().receiveWebhook({
      hotelId: p.hotelId,
      business: p.business,
      rawBody,
      signature: request.headers.get("x-razorpay-signature"),
      eventId: request.headers.get("x-razorpay-event-id"),
      ip: requestMeta(request, traceId).ip,
    });
    if (!answer.accepted) throw new AppError("FORBIDDEN", answer.reason ?? "The signature did not match.");
    return { data: { received: true } };
  },
});
