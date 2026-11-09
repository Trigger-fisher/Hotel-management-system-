import "server-only";
import { getMarketing } from "@/server/compose/companies";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// What sending this draft takes now: the addresses it goes to (opt-outs and suppressed addresses left out), those left out, the mail service's pace and about how long, and whether the platform holds the hotel's campaign mail.
export const GET = route({
  permission: { key: "companies", level: "edit" },
  params: idParams,
  handler: async ({ session, params }) => ({ data: await getMarketing().estimate(session, params.id) }),
});
