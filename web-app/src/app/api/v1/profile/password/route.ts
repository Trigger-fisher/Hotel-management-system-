import "server-only";
import { getAdminAccount } from "@/server/compose/admin";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { passwordChangeBody } from "@/server/services/admin/userSchemas";

export const dynamic = "force-dynamic";

// The signed-in person changes their OWN password (ProfileController::changePassword): the current one is checked, the new one follows the password
// rule and differs from the current one; the person's other sessions end and they are mailed. No Idempotency-Key: nothing about a password is stored.
// Throttled per person (Pallav has none; MJ's judgement): every try costs an argon2 verify of the current password.
export const PUT = route({
  permission: "session",
  body: passwordChangeBody,
  idempotency: "off",
  limits: [{ name: "profile-password", max: 10, windowSeconds: 60, by: "user" }],
  handler: async ({ session, body, request, traceId }) => ({ data: await getAdminAccount().changePassword(session, body, requestMeta(request, traceId)) }),
});
