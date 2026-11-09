import "server-only";
import { getCompanies } from "@/server/compose/companies";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// Removes a recycle-bin company for good; never one that bills or advances still name.
export const DELETE = route({
  permission: "session",
  params: idParams,
  handler: async ({ session, params }) => ({ data: await getCompanies().purge(session, params.id) }),
});
