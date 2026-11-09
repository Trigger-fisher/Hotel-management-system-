import "server-only";
import { getMarketing } from "@/server/compose/companies";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

// Email Marketing, the page: the campaigns, the audience sizes, the opt-outs, whether the hotel's mail server is set up, where a test goes.
export const GET = route({
  permission: { key: "companies", level: "view" },
  handler: async ({ session }) => ({ data: await getMarketing().overview(session) }),
});
