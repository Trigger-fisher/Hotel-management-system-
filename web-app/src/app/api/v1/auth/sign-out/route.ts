import "server-only";
import { clearedSessionCookie, clearedSignedOutCookie } from "@/server/auth/tokens";
import { getAuthService, getSessionResolver } from "@/server/compose/auth";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  idempotency: "off",
  whileLocked: true,
  handler: async ({ session, request, traceId }) => {
    const out = await getAuthService().signOut(session, requestMeta(request, traceId));
    // the cached copy of this session (this process) goes with it: the cookie is cleared too, so a replayed token is refused everywhere within the cache window
    getSessionResolver().forgetSession(session.sessionId);
    return { data: out.data, headers: session.client === "web" ? [["set-cookie", clearedSessionCookie()], ["set-cookie", clearedSignedOutCookie()]] : [] };
  },
});
