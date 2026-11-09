import "server-only";
import { getWebsiteRooms } from "@/server/compose/website";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { idParams, planBody } from "@/server/services/website/schemas";

export const dynamic = "force-dynamic";

export const POST = route({
  permission: { key: "website.rates", level: "create" },
  params: idParams,
  body: planBody,
  idempotency: "optional",
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getWebsiteRooms().createPlan(session, params.id, body, requestMeta(request, traceId)), status: 201 }),
});
