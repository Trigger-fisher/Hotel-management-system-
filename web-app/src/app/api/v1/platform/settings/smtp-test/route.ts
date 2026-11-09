import "server-only";
import { getPlatformSettings } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { smtpTestBody } from "@/server/services/platform/schemas";

// "Send test email" (Platform settings > Mail): one mail with the SAVED mail server settings to the address typed, answered with the exact result { at, ok, message } (and kept
// as the last test). Super Admin only. At most 10 tests an hour per person. The password is never in the answer.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  body: smtpTestBody,
  idempotency: "off",
  limits: [{ name: "smtp-test", max: 10, windowSeconds: 3600, by: "user" }],
  handler: async ({ session, body, request, traceId }) => ({ data: await getPlatformSettings().sendTest(session, body.to, platformMeta(request, traceId), body.which ?? "primary") }),
});