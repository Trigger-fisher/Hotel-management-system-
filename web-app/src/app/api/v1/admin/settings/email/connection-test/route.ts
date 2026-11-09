import "server-only";
import { getAdminSettings } from "@/server/compose/admin";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { emptyBody } from "@/server/services/conversations/schemas";

// "Test connection" (Settings > Email, Conversations decision 66): signs in to the hotel's mailbox for reading (IMAP) and for sending (SMTP) with the SAVED settings, at the
// same time, and says what failed in fixed sentences with a plain hint (never the server's own words, the login or the password). SuperAdmin only, as "Send test email"; a
// few in five minutes (each one signs in to the mail server). Nothing of it is kept in the idempotency store.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = route({
  permission: "session",
  body: emptyBody,
  idempotency: "off",
  limits: [{ name: "settings-mail-connection-test", max: 5, windowSeconds: 300, by: "session" }],
  handler: async ({ session, request, traceId }) => ({ data: await getAdminSettings().testMailConnection(session, requestMeta(request, traceId)) }),
});
