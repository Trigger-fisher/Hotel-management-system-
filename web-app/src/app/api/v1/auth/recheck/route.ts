import "server-only";
import { getAuthService, getSessionResolver } from "@/server/compose/auth";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { recheckBody } from "@/server/services/auth/schemas";

export const dynamic = "force-dynamic";

// The vault re-check with the password (MJ, 5 Nov 2026): the vaults show a secret only for 5 minutes after it. A wrong password counts toward the account's lock.
export const POST = route({
  permission: "session",
  body: recheckBody,
  idempotency: "off",
  limits: [{ name: "recheck", max: 10, windowSeconds: 60, by: "session" }],
  handler: async ({ session, body, request, traceId, failAfterCommit }) => {
    const out = await getAuthService().recheckPassword(session, body, requestMeta(request, traceId), failAfterCommit);
    getSessionResolver().forgetSession(session.sessionId);
    return { data: out.data };
  },
});
