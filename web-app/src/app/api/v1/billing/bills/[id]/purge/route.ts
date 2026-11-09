import "server-only";
import { getBillingBills } from "@/server/compose/billing";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// Removes a recycle-bin bill for good. SuperAdmin only; a live bill is never purged.
export const DELETE = route({
  permission: "session",
  params: idParams,
  handler: async ({ session, params }) => ({ data: await getBillingBills().purge(session, params.id) }),
});
