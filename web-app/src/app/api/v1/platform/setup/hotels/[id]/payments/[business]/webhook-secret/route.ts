import "server-only";
import { getHotelSetup } from "@/server/compose/hotelSetup";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { hotelPayParams } from "@/server/services/platform/schemas";

// A new webhook secret for one of the hotel's payment accounts, shown once. Super Admin only.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: hotelPayParams,
  limits: [{ name: "setup-pay-webhook", max: 10, windowSeconds: 60, by: "session" }],
  handler: async ({ session, params, request, traceId }) => ({ data: await getHotelSetup().makeWebhookSecret(session, params.id, params.business, platformMeta(request, traceId)) }),
});
