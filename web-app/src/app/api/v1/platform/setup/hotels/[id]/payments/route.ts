import "server-only";
import { getHotelSetup } from "@/server/compose/hotelSetup";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { hotelIdParams, hotelPayBody } from "@/server/services/platform/schemas";

// One hotel's online payments (hotel and food), from the Set-up centre. Super Admin only; a saved secret is never sent back.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  params: hotelIdParams,
  handler: async ({ session, params }) => ({ data: await getHotelSetup().payments(session, params.id) }),
});

export const PUT = route({
  permission: "session",
  params: hotelIdParams,
  body: hotelPayBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getHotelSetup().savePayments(session, params.id, body, platformMeta(request, traceId)) }),
});
