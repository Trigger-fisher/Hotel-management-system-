import "server-only";
import { getWebsiteRooms } from "@/server/compose/website";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { idParams, planBody } from "@/server/services/website/schemas";

export const dynamic = "force-dynamic";

export const PATCH = route({
  permission: { key: "website.rates", level: "edit" },
  params: idParams,
  body: planBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getWebsiteRooms().updatePlan(session, params.id, body, requestMeta(request, traceId)) }),
});

export const DELETE = route({
  permission: { key: "website.rates", level: "full" },
  params: idParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getWebsiteRooms().deletePlan(session, params.id, requestMeta(request, traceId)) }),
});
