import "server-only";
import { getHotelSetup } from "@/server/compose/hotelSetup";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { hotelIdParams, websiteGoogleKeysBody } from "@/server/services/platform/schemas";

// The hotel website's Google keys (Maps key, Business Profile sign-in client), from the Set-up centre. Super Admin only; secrets never sent back.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  params: hotelIdParams,
  handler: async ({ session, params }) => ({ data: await getHotelSetup().website(session, params.id) }),
});

export const PATCH = route({
  permission: "session",
  params: hotelIdParams,
  body: websiteGoogleKeysBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getHotelSetup().saveWebsite(session, params.id, body, platformMeta(request, traceId)) }),
});