import "server-only";
import { getWebsiteRooms } from "@/server/compose/website";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { idParams } from "@/server/services/website/schemas";

export const dynamic = "force-dynamic";

// Pause a plan (it leaves the website and the calendar) or bring it back.
export const POST = route({
  permission: { key: "website.rates", level: "edit" },
  params: idParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getWebsiteRooms().togglePlan(session, params.id, requestMeta(request, traceId)) }),
});
