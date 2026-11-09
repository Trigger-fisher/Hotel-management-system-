import "server-only";
import { getAdminSettings } from "@/server/compose/admin";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { testEmailBody } from "@/server/services/admin/schemas";

// "Send a test email" (Settings > Email): one mail sent NOW through the hotel's own mail server, to the given address or the hotel's from address. SuperAdmin only;
// a few a minute (each one opens a connection to the hotel's mail server).
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = route({
  permission: "session",
  body: testEmailBody,
  limits: [{ name: "settings-test-email", max: 5, windowSeconds: 60, by: "session" }],
  handler: async ({ session, body, request, traceId }) => ({ data: await getAdminSettings().testEmail(session, body, requestMeta(request, traceId)) }),
});
