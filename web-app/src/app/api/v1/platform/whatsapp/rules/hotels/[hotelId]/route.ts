import "server-only";
import { getWhatsAppRules } from "@/server/compose/whatsappRules";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { hotelClearQuery, hotelOverrideBody, hotelParams } from "@/server/services/whatsapp/rulesSchemas";

// One hotel's WhatsApp rules: each switch with what it inherits, its override and where the value comes from. PUT sets overrides (null clears one); DELETE ?key= resets one switch.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  params: hotelParams,
  handler: async ({ session, params }) => ({ data: await getWhatsAppRules().getHotel(session, params.hotelId) }),
});

export const PUT = route({
  permission: "session",
  params: hotelParams,
  body: hotelOverrideBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getWhatsAppRules().setHotelOverride(session, params.hotelId, body.overrides as Record<string, boolean | number | null>, body.confirm, platformMeta(request, traceId)) }),
});

export const DELETE = route({
  permission: "session",
  params: hotelParams,
  query: hotelClearQuery,
  handler: async ({ session, params, query, request, traceId }) => ({ data: await getWhatsAppRules().clearHotelOverride(session, params.hotelId, query.key, query.confirm === "true", platformMeta(request, traceId)) }),
});
