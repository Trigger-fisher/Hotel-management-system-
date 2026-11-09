import "server-only";
import { getFrontOfficeRooms } from "@/server/compose/frontOffice";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

// The front desk's home (Pallav BoardController).
export const GET = route({
  permission: { key: "pms.board", level: "view" },
  cache: "private, no-cache",
  handler: async ({ session }) => {
    const data = await getFrontOfficeRooms().board(session);
    return { data };
  },
});
