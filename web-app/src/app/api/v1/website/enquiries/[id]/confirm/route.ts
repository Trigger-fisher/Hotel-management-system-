import "server-only";
import { getWebsiteEnquiries } from "@/server/compose/website";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { idParams } from "@/server/services/website/schemas";

export const dynamic = "force-dynamic";

// Becomes a booking and holds its room: availability is checked again under the room lock; the front-office reservation is made in the same unit.
export const POST = route({
  permission: { key: "website.enquiries", level: "edit" },
  params: idParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getWebsiteEnquiries().confirm(session, params.id, requestMeta(request, traceId)) }),
});
