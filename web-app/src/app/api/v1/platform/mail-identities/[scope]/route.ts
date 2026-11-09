import "server-only";
import { getPlatformIdentities } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { identityBody, identityScopeParams } from "@/server/services/platform/schemas";

// Saves what only the Super Admin knows about a sender domain: the three DKIM names Amazon SES showed for it, and that the domain exists in SES. Audited.
export const dynamic = "force-dynamic";

export const PUT = route({
  permission: "session",
  params: identityScopeParams,
  body: identityBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPlatformIdentities().save(session, params.scope, body, platformMeta(request, traceId)) }),
});