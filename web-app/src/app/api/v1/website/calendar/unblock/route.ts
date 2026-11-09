import "server-only";
import { getWebsiteCalendar } from "@/server/compose/website";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { unblockBody } from "@/server/services/website/schemas";

export const dynamic = "force-dynamic";

// Open the stretches picked.
export const POST = route({
  permission: { key: "website.calendar", level: "edit" },
  body: unblockBody,
  handler: async ({ session, body, request, traceId }) => ({ data: await getWebsiteCalendar().unblock(session, body.ranges, requestMeta(request, traceId)) }),
});
