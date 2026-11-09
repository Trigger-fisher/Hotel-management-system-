import "server-only";
import { getPlatformMailSafety } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { mailHoldBody } from "@/server/services/platform/mailSafetyService";
import { idParams } from "@/server/validation/listQuery";

// Holds a hotel's campaign mail by hand, with a reason (Super Admin). System mail (codes, invoices) still goes.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: idParams,
  body: mailHoldBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPlatformMailSafety().hold(session, params.id, body.reason, platformMeta(request, traceId)) }),
});
