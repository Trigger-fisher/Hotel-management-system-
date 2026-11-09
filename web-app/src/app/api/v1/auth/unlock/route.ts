import "server-only";
import { getAuthService, getSessionResolver } from "@/server/compose/auth";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { unlockBody } from "@/server/services/auth/schemas";

export const dynamic = "force-dynamic";

// The screen-lock password check (new in HMS): rate limited per session, and a wrong password counts toward the account's lock like a wrong sign-in.
// The right password lifts the session's lock (sessions.locked_at), so the other routes answer again.
export const POST = route({
  permission: "session",
  body: unlockBody,
  idempotency: "off",
  whileLocked: true,
  limits: [{ name: "unlock", max: 10, windowSeconds: 60, by: "session" }],
  handler: async ({ session, body, request, traceId, failAfterCommit }) => {
    const out = await getAuthService().unlockScreen(session, body, requestMeta(request, traceId), failAfterCommit);
    getSessionResolver().forgetSession(session.sessionId);
    return { data: out.data };
  },
});
