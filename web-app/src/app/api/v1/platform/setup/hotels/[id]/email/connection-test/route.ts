import "server-only";
import { getHotelSetup } from "@/server/compose/hotelSetup";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { hotelIdParams } from "@/server/services/platform/schemas";

// Signs in to the hotel's saved mailbox for reading and sending, nothing sent (Set-up centre). Super Admin only.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = route({
  permission: "session",
  params: hotelIdParams,
  limits: [{ name: "setup-mail-connection-test", max: 5, windowSeconds: 60, by: "session" }],
  handler: async ({ session, params, request, traceId }) => ({ data: await getHotelSetup().testMailConnection(session, params.id, platformMeta(request, traceId)) }),
});