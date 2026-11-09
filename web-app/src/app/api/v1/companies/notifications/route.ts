import "server-only";
import { getNotifications } from "@/server/compose/notifications";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { notificationBody, notificationListQuery } from "@/server/services/notifications/schemas";

export const dynamic = "force-dynamic";

// The history of notifications the hotel sent to its companies, newest first (Companies > Notifications).
export const GET = route({
  permission: { key: "companies", level: "view" },
  query: notificationListQuery,
  handler: async ({ session, query }) => ({ data: await getNotifications().list(session, query) }),
});

// Sends one: the companies picked (or all), a title, a plain-text message, optional priority, expiry, link and "also email". 20 sends an hour per person.
export const POST = route({
  permission: { key: "companies", level: "create" },
  body: notificationBody,
  idempotency: "optional",
  limits: [{ name: "notification-send", max: 20, windowSeconds: 3600, by: "user", message: "You have sent 20 notifications in the last hour, which is the limit. Please try again a little later." }],
  handler: async ({ session, body, request, traceId }) => ({ data: await getNotifications().send(session, body, requestMeta(request, traceId)), status: 201 }),
});
