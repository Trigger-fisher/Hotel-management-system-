import "server-only";
import { getHandovers } from "@/server/compose/handover";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// Removes a handover from the recycle bin for good: the hotel's SuperAdmin only (checked by the service).
export const DELETE = route({
  permission: "session",
  params: idParams,
  handler: async ({ session, params }) => ({ data: await getHandovers().purge(session, params.id) }),
});
