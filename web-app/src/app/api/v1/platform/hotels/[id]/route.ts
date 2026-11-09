import "server-only";
import { getPlatformHotels } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { hotelIdParams } from "@/server/services/platform/schemas";

// One hotel: facts, admins, read-only settings, activity, the onboarding form as sent (never a password).
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  params: hotelIdParams,
  handler: async ({ session, params }) => ({ data: await getPlatformHotels().getHotel(session, params.id) }),
});