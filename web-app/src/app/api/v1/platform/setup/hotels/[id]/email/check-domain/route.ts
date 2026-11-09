import "server-only";
import { getHotelSetup } from "@/server/compose/hotelSetup";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { hotelIdParams } from "@/server/services/platform/schemas";

// Looks up the DNS records of the hotel's own sending domain (Set-up centre). Super Admin only.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: hotelIdParams,
  limits: [{ name: "setup-check-domain", max: 10, windowSeconds: 60, by: "session" }],
  handler: async ({ session, params, request, traceId }) => ({ data: await getHotelSetup().checkDomain(session, params.id, platformMeta(request, traceId)) }),
});