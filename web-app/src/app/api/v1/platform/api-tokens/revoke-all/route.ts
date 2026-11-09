import "server-only";
import { getPlatformApiTokens } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { apiKeyRevokeAllBody } from "@/server/services/platform/apiTokenService";

// "Revoke all keys": every active API access key stops working at once (Super Admin, browser only, with a reason; audited).
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  body: apiKeyRevokeAllBody,
  handler: async ({ session, body, request, traceId }) => ({ data: await getPlatformApiTokens().revokeAll(session, body.reason, platformMeta(request, traceId)) }),
});