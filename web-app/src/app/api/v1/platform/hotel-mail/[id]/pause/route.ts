import "server-only";
import { getPlatformHotelMail } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { mailPauseBody } from "@/server/services/platform/schemas";
import { idParams } from "@/server/validation/listQuery";

// Pauses or resumes one hotel's mail (a reason is kept and audited). Mail already queued waits and goes out after the pause ends. Super Admin only.
export const dynamic = "force-dynamic";

export const PUT = route({
  permission: "session",
  params: idParams,
  body: mailPauseBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPlatformHotelMail().setPause(session, params.id, body, platformMeta(request, traceId)) }),
});
