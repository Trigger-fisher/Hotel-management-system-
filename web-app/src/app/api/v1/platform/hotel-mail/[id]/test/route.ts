import "server-only";
import { getPlatformHotelMail } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { hotelMailTestBody } from "@/server/services/platform/schemas";
import { idParams } from "@/server/validation/listQuery";

// Sends one test mail with a hotel's SAVED Amazon SES or Google login. Super Admin only.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: idParams,
  body: hotelMailTestBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPlatformHotelMail().test(session, params.id, body.which, body.to, platformMeta(request, traceId)) }),
});
