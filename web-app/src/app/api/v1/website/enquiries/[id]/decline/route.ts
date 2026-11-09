import "server-only";
import { getWebsiteEnquiries } from "@/server/compose/website";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { declineBody, idParams } from "@/server/services/website/schemas";

export const dynamic = "force-dynamic";

// Declines a pending enquiry or cancels a confirmed booking, with a reason; the reservation goes too.
export const POST = route({
  permission: { key: "website.enquiries", level: "edit" },
  params: idParams,
  body: declineBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getWebsiteEnquiries().decline(session, params.id, body, requestMeta(request, traceId)) }),
});
