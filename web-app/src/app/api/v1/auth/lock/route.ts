import "server-only";
import { getAuthService, getSessionResolver } from "@/server/compose/auth";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

// Locks the screen ON THE SERVER (the user menu's Lock, or 30 idle minutes): from now on only the session check, unlock and sign-out answer for this
// session, so a reload, a new tab or a script at an unattended desk gets nothing until the password is given. Locking twice is the same as once.
export const POST = route({
  permission: "session",
  idempotency: "off",
  touch: false,
  whileLocked: true,
  limits: [{ name: "lock", max: 30, windowSeconds: 60, by: "session" }],
  handler: async ({ session }) => {
    const out = await getAuthService().lockScreen(session);
    getSessionResolver().forgetSession(session.sessionId);
    return { data: out.data };
  },
});
