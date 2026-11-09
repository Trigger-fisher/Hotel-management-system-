import "server-only";
import { getPlatformVisits } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { enterBody, hotelIdParams } from "@/server/services/platform/schemas";

// Enter hotel (docs/BACKEND.md 14.1, 14.7): a written reason (5 to 500 characters), 60 minutes, READ ONLY. Audited; answers the visit and the audit row.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: hotelIdParams,
  body: enterBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPlatformVisits().enter(session, params.id, body.reason, platformMeta(request, traceId)) }),
});