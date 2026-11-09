import "server-only";
import { getAuthService } from "@/server/compose/auth";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

// Emails a fresh 6-digit code for the vault re-check (at most 5 an hour per person).
export const POST = route({
  permission: "session",
  idempotency: "off",
  limits: [{ name: "recheck-code", max: 5, windowSeconds: 60, by: "session" }],
  handler: async ({ session }) => ({ data: (await getAuthService().sendRecheckCode(session)).data }),
});
