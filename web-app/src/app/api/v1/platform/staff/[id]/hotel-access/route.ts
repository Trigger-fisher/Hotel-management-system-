import "server-only";
import { getPlatformStaff } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { hotelAccessBody, hotelIdParams } from "@/server/services/platform/schemas";

// What a platform admin may do when entering hotels (platform 0135): none / view / full, all hotels or chosen ones. Super Admin only; the change is audited.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  params: hotelIdParams,
  handler: async ({ session, params }) => ({ data: await getPlatformStaff().getHotelAccess(session, params.id) }),
});

export const PUT = route({
  permission: "session",
  params: hotelIdParams,
  body: hotelAccessBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPlatformStaff().setHotelAccess(session, params.id, body, platformMeta(request, traceId)) }),
});
