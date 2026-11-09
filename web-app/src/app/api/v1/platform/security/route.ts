import "server-only";
import { getPlatformSecurity } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { securityBody } from "@/server/services/platform/securityService";

// Platform settings > Security: how long each user kind stays signed in and how long a temporary password works. Super Admin only; every change audited.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  handler: async ({ session }) => ({ data: await getPlatformSecurity().get(session) }),
});

export const PUT = route({
  permission: "session",
  body: securityBody,
  handler: async ({ session, body, request, traceId }) => ({ data: await getPlatformSecurity().update(session, body, platformMeta(request, traceId)) }),
});
