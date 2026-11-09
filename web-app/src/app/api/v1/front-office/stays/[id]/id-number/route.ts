import "server-only";
import { getFrontOfficeStays } from "@/server/compose/frontOffice";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";

// Show (decision 74): the whole ID numbers of one stay. A POST, never cached; every call is written to the Activity log. Not for API keys and not during a visit.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: { key: "pms.stays", level: "edit" },
  params: idParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getFrontOfficeStays().revealIdNumbers(session, params.id, requestMeta(request, traceId)) }),
});
