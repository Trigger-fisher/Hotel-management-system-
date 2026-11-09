import "server-only";
import { z } from "zod";
import { getIdPhotos } from "@/server/compose/frontOffice";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";

// The main guest's ID photo: see it (Front Office view), add or replace it (edit; a colour JPG or PNG, base64 in JSON, up to 8 MB), remove it
// (edit). Kept in the private ID-photo store, never on a public address.
export const dynamic = "force-dynamic";

const putBody = z.strictObject({ fileName: z.string().max(300), dataBase64: z.string().max(12_000_000), version: z.number().int().min(1) });
const deleteBody = z.strictObject({ version: z.number().int().min(1) });

export const GET = route({
  permission: { key: "pms.stays", level: "view" },
  params: idParams,
  handler: async ({ session, params }) => {
    const file = await getIdPhotos().get(session, params.id);
    return { data: null, binary: { bytes: file.bytes, contentType: file.contentType, filename: `id-photo.${file.contentType === "image/png" ? "png" : "jpg"}`, disposition: "inline" as const } };
  },
});

export const PUT = route({
  permission: { key: "pms.stays", level: "edit" },
  params: idParams,
  body: putBody,
  maxBodyBytes: 12 * 1024 * 1024,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getIdPhotos().put(session, params.id, body, requestMeta(request, traceId)) }),
});

export const DELETE = route({
  permission: { key: "pms.stays", level: "edit" },
  params: idParams,
  body: deleteBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getIdPhotos().remove(session, params.id, body.version, requestMeta(request, traceId)) }),
});