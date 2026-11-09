import "server-only";
import { getWebsiteCalendar } from "@/server/compose/website";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { toggleBlockBody } from "@/server/services/website/schemas";

export const dynamic = "force-dynamic";

// Close one date to booking, or open it again.
export const POST = route({
  permission: { key: "website.calendar", level: "edit" },
  body: toggleBlockBody,
  handler: async ({ session, body, request, traceId }) => ({ data: await getWebsiteCalendar().toggleBlock(session, body.roomId, body.date, requestMeta(request, traceId)) }),
});
