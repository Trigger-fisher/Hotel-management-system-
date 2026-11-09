import "server-only";
import { getWebsiteSiteTemplates } from "@/server/compose/website";
import { route } from "@/server/http/route";
import { siteTemplateBody } from "@/server/services/website/schemas";

// The hotel's website design (website-templates/docs/BACKEND.md): the ten templates, the one the site runs, a build in progress and the recent builds. PUT picks a
// design and starts the "Create hotel site" job; the job reports back to POST /api/v1/public/site-builds/<id>. Part website.settings, like the website switch.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "website.settings", level: "view" },
  handler: async ({ session }) => ({ data: await getWebsiteSiteTemplates().get(session) }),
});

export const PUT = route({
  permission: { key: "website.settings", level: "edit" },
  body: siteTemplateBody,
  handler: async ({ session, body }) => ({ data: await getWebsiteSiteTemplates().choose(session, body) }),
});
