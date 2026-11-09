import "server-only";
import { getWebsiteSiteAccess } from "@/server/compose/website";
import { route } from "@/server/http/route";
import { siteAccessBody } from "@/server/services/website/schemas";

// Decision 55: the hotel's public website switch and registered domains (docs/deploy/WEBSITE-CONNECT.md section 2.3).
export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "website.settings", level: "view" },
  handler: async ({ session }) => ({ data: await getWebsiteSiteAccess().get(session) }),
});

export const PUT = route({
  permission: { key: "website.settings", level: "edit" },
  body: siteAccessBody,
  handler: async ({ session, body }) => ({ data: await getWebsiteSiteAccess().update(session, body) }),
});