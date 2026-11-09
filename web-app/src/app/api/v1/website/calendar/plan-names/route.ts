import "server-only";
import { getWebsiteCalendar } from "@/server/compose/website";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

// Distinct plan names across rooms, for the bulk form.
export const GET = route({
  permission: { key: "website.calendar", level: "view" },
  handler: async ({ session }) => ({ data: await getWebsiteCalendar().planNames(session) }),
});
