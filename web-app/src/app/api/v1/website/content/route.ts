import "server-only";
import { getWebsiteContent } from "@/server/compose/website";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { contentBody } from "@/server/services/website/schemas";

// The home page wording (hero, availability bar, about, enquiry section, form messages, footer).
export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "website.content", level: "view" },
  handler: async ({ session }) => ({ data: await getWebsiteContent().get(session) }),
});

export const PUT = route({
  permission: { key: "website.content", level: "edit" },
  body: contentBody,
  handler: async ({ session, body, request, traceId }) => ({ data: await getWebsiteContent().update(session, body, requestMeta(request, traceId)) }),
});