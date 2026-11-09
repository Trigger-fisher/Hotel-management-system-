import "server-only";
import { getAuthService, getSessionResolver } from "@/server/compose/auth";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

// The session as it stands. It must NOT extend the idle window: otherwise a screen that polls it would keep a session alive for ever.
// The access record the resolver built the session from is handed on, so the answer costs no second load of it.
export const GET = route({
  permission: "session",
  touch: false,
  whileLocked: true,
  handler: async ({ session }) => ({ data: (await getAuthService().getSession(session, getSessionResolver().accessOf(session))).data }),
});
