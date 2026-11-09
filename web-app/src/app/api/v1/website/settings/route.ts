import "server-only";
import { getWebsiteSettings } from "@/server/compose/website";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { settingsBody } from "@/server/services/website/schemas";

// Website Settings. The mail and Google secrets are only for the SuperAdmin or the ability website.secrets, and are never returned (only "set" flags).
export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "website.settings", level: "view" },
  handler: async ({ session }) => ({ data: await getWebsiteSettings().get(session) }),
});

export const PUT = route({
  permission: { key: "website.settings", level: "edit" },
  body: settingsBody,
  maxBodyBytes: 8 * 1024 * 1024,
  handler: async ({ session, body, request, traceId }) => ({ data: await getWebsiteSettings().update(session, body, requestMeta(request, traceId)) }),
});