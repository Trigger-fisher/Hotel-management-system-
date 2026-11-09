import "server-only";
import { getGroupConsole } from "@/server/compose/platform";
import { route } from "@/server/http/route";
export const dynamic = "force-dynamic";

// The group console home: tiles, the five newest member hotels and activity. The group is the signed-in Group Hotel Admin's own (docs/BACKEND.md 14c).
export const GET = route({
  permission: "session",
  handler: async ({ session }) => ({ data: await getGroupConsole().overview(session) }),
});
