import "server-only";
import { getWebsiteSettings } from "@/server/compose/website";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";

// Google Business Profile (disconnect): behind the GoogleReviews port; not set up yet answers a plain 409. For those who may handle the secrets.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: { key: "website.settings", level: "edit" },
  handler: async ({ session, request, traceId }) => ({ data: await getWebsiteSettings().googleDisconnect(session, requestMeta(request, traceId)) }),
});