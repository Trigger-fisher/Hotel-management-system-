import "server-only";
import { getPlatformSettings } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { settingsBody } from "@/server/services/platform/schemas";

// Platform settings: defaults for new hotels and the mail sender. Only the keys sent change. Super Admin only. (docs/BACKEND.md 14.6)
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  handler: async ({ session }) => ({ data: await getPlatformSettings().get(session) }),
});

export const PUT = route({
  permission: "session",
  body: settingsBody,
  handler: async ({ session, body, request, traceId }) => ({ data: await getPlatformSettings().update(session, body, platformMeta(request, traceId)) }),
});