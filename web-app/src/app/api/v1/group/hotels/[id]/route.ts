import "server-only";
import { getGroupConsole } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { hotelIdParams } from "@/server/services/platform/schemas";

export const dynamic = "force-dynamic";

// One member hotel with its admins, settings and activity. 404 for a hotel outside the group.
export const GET = route({
  permission: "session",
  params: hotelIdParams,
  handler: async ({ session, params }) => ({ data: await getGroupConsole().getMyHotel(session, params.id) }),
});
