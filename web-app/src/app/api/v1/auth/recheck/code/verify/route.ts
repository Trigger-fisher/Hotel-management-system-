import "server-only";
import { getAuthService, getSessionResolver } from "@/server/compose/auth";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { recheckCodeBody } from "@/server/services/auth/schemas";

export const dynamic = "force-dynamic";

// The emailed re-check code: five wrong ones cancel it. The right one opens the vaults for 5 minutes in this session.
export const POST = route({
  permission: "session",
  body: recheckCodeBody,
  idempotency: "off",
  limits: [{ name: "recheck", max: 10, windowSeconds: 60, by: "session" }],
  handler: async ({ session, body, request, traceId }) => {
    const out = await getAuthService().recheckCode(session, body, requestMeta(request, traceId));
    getSessionResolver().forgetSession(session.sessionId);
    return { data: out.data };
  },
});
