import "server-only";
import { z } from "zod";
import { getMenuPhotos } from "@/server/compose/menuPhotos";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";

// A room-service menu item's photo (Master Data): see it (masters view), add or replace it (edit; a JPG, PNG or WebP, base64 in JSON, up to 10 MB, kept as WebP of at most
// 1 MB), remove it (edit). Kept in the private menu-photo store, never on a public address.
export const dynamic = "force-dynamic";

const putBody = z.strictObject({ fileName: z.string().max(300), dataBase64: z.string().max(15_000_000) });

export const GET = route({
  permission: { key: "masters", level: "view" },
  params: idParams,
  cache: "private, max-age=300",
  handler: async ({ session, params }) => {
    const file = await getMenuPhotos().forStaff(session, params.id);
    return { data: null, binary: { bytes: file.bytes, contentType: file.contentType, filename: "menu-photo", disposition: "inline" as const } };
  },
});

export const PUT = route({
  permission: { key: "masters", level: "edit" },
  params: idParams,
  body: putBody,
  maxBodyBytes: 15 * 1024 * 1024,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getMenuPhotos().put(session, params.id, body, requestMeta(request, traceId)) }),
});

export const DELETE = route({
  permission: { key: "masters", level: "edit" },
  params: idParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getMenuPhotos().remove(session, params.id, requestMeta(request, traceId)) }),
});