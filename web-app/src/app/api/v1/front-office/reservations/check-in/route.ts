import "server-only";
import { getFrontOfficeReservations } from "@/server/compose/frontOffice";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

// Reservations that can be checked in (the check-in picker).
export const GET = route({
  permission: { key: "pms.stays", level: "view" },
  handler: async ({ session }) => ({ data: await getFrontOfficeReservations().forCheckIn(session) }),
});
