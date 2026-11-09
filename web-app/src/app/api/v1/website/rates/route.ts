import "server-only";
import { getWebsiteRooms } from "@/server/compose/website";
import { route } from "@/server/http/route";
import { siteListQuery } from "@/server/services/website/schemas";

export const dynamic = "force-dynamic";

// Each room with its plans and what the first active plan costs tonight.
export const GET = route({
  permission: { key: "website.rates", level: "view" },
  cache: "private, no-cache",
  query: siteListQuery,
  handler: async ({ session, query }) => ({ data: await getWebsiteRooms().listRates(session, query.search) }),
});
