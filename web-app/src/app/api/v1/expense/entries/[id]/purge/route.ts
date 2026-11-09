import "server-only";
import { getCashExpenses } from "@/server/compose/cash";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// Removes a recycle-bin entry (and its lines) for good. SuperAdmin only; a live entry is never purged.
export const DELETE = route({
  permission: "session",
  params: idParams,
  handler: async ({ session, params }) => ({ data: await getCashExpenses().purge(session, params.id) }),
});
