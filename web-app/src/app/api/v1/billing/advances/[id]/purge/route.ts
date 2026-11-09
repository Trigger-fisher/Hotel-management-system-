import "server-only";
import { getBillingAdvances } from "@/server/compose/billing";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// Removes a recycle-bin advance for good. SuperAdmin only; a live advance is never purged.
export const DELETE = route({
  permission: "session",
  params: idParams,
  handler: async ({ session, params }) => ({ data: await getBillingAdvances().purge(session, params.id) }),
});
