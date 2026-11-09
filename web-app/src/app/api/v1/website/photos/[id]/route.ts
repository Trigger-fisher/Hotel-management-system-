import "server-only";
import { getWebsiteGallery } from "@/server/compose/website";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { idParams, photoBody } from "@/server/services/website/schemas";

export const dynamic = "force-dynamic";

export const PATCH = route({
  permission: { key: "website.gallery", level: "edit" },
  params: idParams,
  body: photoBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getWebsiteGallery().update(session, params.id, body, requestMeta(request, traceId)) }),
});

export const DELETE = route({
  permission: { key: "website.gallery", level: "full" },
  params: idParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getWebsiteGallery().remove(session, params.id, requestMeta(request, traceId)) }),
});