import "server-only";
import { getWebsiteGallery } from "@/server/compose/website";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { idParams, moveBody } from "@/server/services/website/schemas";

export const dynamic = "force-dynamic";

export const POST = route({
  permission: { key: "website.gallery", level: "edit" },
  params: idParams,
  body: moveBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getWebsiteGallery().move(session, params.id, body.direction, requestMeta(request, traceId)) }),
});