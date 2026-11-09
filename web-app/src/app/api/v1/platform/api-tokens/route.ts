import "server-only";
import { getPlatformApiTokens } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { apiKeyCreateBody } from "@/server/services/platform/apiTokenService";

// API access keys (Platform settings > API access; platform migration 0129). Super Admin only, from the browser only: a call made with a key is refused (the wrapper's deny list
// and the service). GET: the keys (never the key itself), the full-access switch and the active count. POST: a new key, returned ONCE in the answer.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  handler: async ({ session }) => ({ data: await getPlatformApiTokens().view(session) }),
});

export const POST = route({
  permission: "session",
  body: apiKeyCreateBody,
  limits: [{ name: "api-token-create", max: 20, windowSeconds: 3600, by: "user" }],
  handler: async ({ session, body, request, traceId }) => ({ data: await getPlatformApiTokens().create(session, body, platformMeta(request, traceId)), status: 201 }),
});