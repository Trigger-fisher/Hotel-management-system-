import "server-only";
import { getCashRevenue } from "@/server/compose/cash";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// Removes a recycle-bin deposit for good. SuperAdmin only; a live deposit is never purged.
export const DELETE = route({
  permission: "session",
  params: idParams,
  handler: async ({ session, params }) => ({ data: await getCashRevenue().purge(session, params.id) }),
});
