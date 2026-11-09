import "server-only";
import { getWebsiteEnquiries } from "@/server/compose/website";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { enquiryBody, idParams } from "@/server/services/website/schemas";

export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "website.enquiries", level: "view" },
  params: idParams,
  handler: async ({ session, params }) => ({ data: await getWebsiteEnquiries().get(session, params.id) }),
});

// Correct who, which room, which dates.
export const PATCH = route({
  permission: { key: "website.enquiries", level: "edit" },
  params: idParams,
  body: enquiryBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getWebsiteEnquiries().update(session, params.id, body, requestMeta(request, traceId)) }),
});

export const DELETE = route({
  permission: { key: "website.enquiries", level: "full" },
  params: idParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getWebsiteEnquiries().remove(session, params.id, requestMeta(request, traceId)) }),
});
