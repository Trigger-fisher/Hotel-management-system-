import "server-only";
import { getWebsiteCalendar } from "@/server/compose/website";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { bulkRatesBody } from "@/server/services/website/schemas";

export const dynamic = "force-dynamic";

// Prices across a range for the plan of that name in each room picked.
export const POST = route({
  permission: { key: "website.calendar", level: "edit" },
  body: bulkRatesBody,
  idempotency: "optional",
  handler: async ({ session, body, request, traceId }) => ({ data: await getWebsiteCalendar().bulk(session, body, requestMeta(request, traceId)) }),
});
