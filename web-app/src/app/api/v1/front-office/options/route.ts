import "server-only";
import { getFrontOfficeReservations } from "@/server/compose/frontOffice";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

// The forms' lists: categories with their plans, companies, ID types, payment modes.
export const GET = route({ permission: { key: "pms.reservations", level: "view" }, handler: async ({ session }) => ({ data: await getFrontOfficeReservations().options(session) }) });
