import "server-only";
import { getRoomServiceDesk } from "@/server/compose/roomServiceDesk";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

// What staff need to take an order: the menu that can be ordered now, the tables and the in-house guests' rooms. In House view.
export const GET = route({
  permission: { key: "pms.stays", level: "view" },
  cache: "private, no-cache",
  handler: async ({ session }) => ({ data: await getRoomServiceDesk().pos(session) }),
});
