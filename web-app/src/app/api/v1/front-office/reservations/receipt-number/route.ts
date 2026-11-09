import "server-only";
import { getFrontOfficeReservations } from "@/server/compose/frontOffice";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

// The next receipt number, to fill the advance form (Billing::suggest).
export const GET = route({
  permission: { key: "pms.reservations", level: "view" },
  handler: async ({ session }) => ({ data: await getFrontOfficeReservations().suggestReceipt(session) }),
});
