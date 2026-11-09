import "server-only";
import { getWebsiteCalendar } from "@/server/compose/website";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { blockBody } from "@/server/services/website/schemas";

export const dynamic = "force-dynamic";

// Close a stretch of dates for some rooms; a date with real bookings is skipped.
export const POST = route({
  permission: { key: "website.calendar", level: "edit" },
  body: blockBody,
  handler: async ({ session, body, request, traceId }) => ({ data: await getWebsiteCalendar().blockRange(session, body, requestMeta(request, traceId)) }),
});
