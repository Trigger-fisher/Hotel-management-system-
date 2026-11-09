import "server-only";
import { getPlatformGroupMail } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { mailPauseBody } from "@/server/services/platform/schemas";
import { idParams } from "@/server/validation/listQuery";

// Pauses or resumes one group's mail: scope "all" stops its hotels too, "one" only skips the group's own accounts. Super Admin only.
export const dynamic = "force-dynamic";

export const PUT = route({
  permission: "session",
  params: idParams,
  body: mailPauseBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPlatformGroupMail().setPause(session, params.id, body, platformMeta(request, traceId)) }),
});
