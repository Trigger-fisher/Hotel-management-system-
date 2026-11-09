import "server-only";
import { getGuestPortal } from "@/server/compose/portal";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

// Decision 48: the hotels this guest login is linked to (active ones): [{ hotelId, name }].
export const GET = route({
  permission: "session",
  handler: async ({ session }) => ({ data: await getGuestPortal().hotels(session) }),
});