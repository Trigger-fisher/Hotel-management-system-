import "server-only";
import { getPlatformApiTokens } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { apiFullAccessBody } from "@/server/services/platform/apiTokenService";

// The Super Admin's switch for FULL access keys (off by default). Turning it on needs a reason and a confirmation; while it is off no full key works. Audited either way.
export const dynamic = "force-dynamic";

export const PUT = route({
  permission: "session",
  body: apiFullAccessBody,
  handler: async ({ session, body, request, traceId }) => ({ data: await getPlatformApiTokens().setFullAccess(session, body, platformMeta(request, traceId)) }),
});