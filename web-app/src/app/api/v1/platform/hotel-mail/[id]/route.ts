import "server-only";
import { getPlatformHotelMail } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { hotelMailBody } from "@/server/services/platform/schemas";
import { idParams } from "@/server/validation/listQuery";

// One hotel's own mail accounts, Super Admin only: read (never a password) and save (audited). Only the parts sent change.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  params: idParams,
  handler: async ({ session, params }) => ({ data: await getPlatformHotelMail().get(session, params.id) }),
});

export const PUT = route({
  permission: "session",
  params: idParams,
  body: hotelMailBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPlatformHotelMail().save(session, params.id, body, platformMeta(request, traceId)) }),
});
