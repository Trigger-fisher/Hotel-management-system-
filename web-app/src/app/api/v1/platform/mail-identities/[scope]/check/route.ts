import "server-only";
import { getPlatformIdentities } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { identityScopeParams } from "@/server/services/platform/schemas";

// "Check DNS": looks the records of a sender domain up in DNS and keeps the answer (ok / missing / wrong for each record). At most 30 checks an hour per person.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: identityScopeParams,
  idempotency: "off",
  limits: [{ name: "identity-check", max: 30, windowSeconds: 3600, by: "user" }],
  handler: async ({ session, params, request, traceId }) => ({ data: await getPlatformIdentities().check(session, params.scope, platformMeta(request, traceId)) }),
});