import "server-only";
import { getFrontOfficeStays } from "@/server/compose/frontOffice";
import { route } from "@/server/http/route";
import { checkoutDefaultsQuery } from "@/server/services/frontOffice/schemas";

export const dynamic = "force-dynamic";

// The check-out form's defaults: the next bill number and the hotel's GST percents (settings; MJ #19). With ?stayId= and no typed
// hotel percent, the hotel side follows the room GST slab of that stay's rate.
export const GET = route({
  permission: { key: "pms.stays", level: "view" },
  query: checkoutDefaultsQuery,
  handler: async ({ session, query }) => ({ data: await getFrontOfficeStays().checkoutDefaults(session, query.stayId) }),
});
