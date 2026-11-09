import "server-only";
import { getHotelSetup } from "@/server/compose/hotelSetup";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { hotelWebsiteGoogleParams } from "@/server/services/platform/schemas";

// Connects or disconnects the website's Google Business Profile (reviews), from the Set-up centre. Super Admin only.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: hotelWebsiteGoogleParams,
  limits: [{ name: "setup-website-google", max: 10, windowSeconds: 60, by: "session" }],
  handler: async ({ session, params, request, traceId }) => ({ data: await getHotelSetup().websiteGoogle(session, params.id, params.step, platformMeta(request, traceId)) }),
});