import "server-only";
import { getGuestPortal } from "@/server/compose/portal";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { guestPasswordBody } from "@/server/services/guest/schemas";

export const dynamic = "force-dynamic";

// The guest changes their own password while signed in: the current one is checked by the credential side; the other sessions end and a mail goes out.
// No Idempotency-Key (nothing about a password is stored); throttled per person like /profile/password: every try costs an argon2 verify.
export const PUT = route({
  permission: "session",
  body: guestPasswordBody,
  idempotency: "off",
  limits: [{ name: "guest-password", max: 10, windowSeconds: 60, by: "user" }],
  handler: async ({ session, body, request, traceId }) => ({ data: await getGuestPortal().changePassword(session, body, requestMeta(request, traceId)) }),
});
