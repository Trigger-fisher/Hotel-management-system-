import "server-only";
import { getPlatformMailSafety } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { mailHoldBody } from "@/server/services/platform/mailSafetyService";
import { idParams } from "@/server/validation/listQuery";

// Releases a held hotel's campaign mail, with a reason (Super Admin). Its bounce and complaint rates are counted again from the next day.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: idParams,
  body: mailHoldBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPlatformMailSafety().release(session, params.id, body.reason, platformMeta(request, traceId)) }),
});
