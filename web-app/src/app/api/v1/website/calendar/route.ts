import "server-only";
import { getWebsiteCalendar } from "@/server/compose/website";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { calendarSaveBody, weekQuery } from "@/server/services/website/schemas";

export const dynamic = "force-dynamic";

// Seven days from the date asked for (today by default).
export const GET = route({
  permission: { key: "website.calendar", level: "view" },
  cache: "private, no-cache",
  query: weekQuery,
  handler: async ({ session, query }) => ({ data: await getWebsiteCalendar().week(session, query.start) }),
});

// The cells edited, each checked on its own: the answer says how many went through and why the first refusal was refused.
export const PUT = route({
  permission: { key: "website.calendar", level: "edit" },
  body: calendarSaveBody,
  handler: async ({ session, body, request, traceId }) => ({ data: await getWebsiteCalendar().save(session, body, requestMeta(request, traceId)) }),
});
