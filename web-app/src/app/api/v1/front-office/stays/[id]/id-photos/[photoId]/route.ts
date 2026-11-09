import "server-only";
import { z } from "zod";
import { getIdPhotos } from "@/server/compose/frontOffice";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";

// One of the stay's ID images. GET: the image (Front Office view; a name the stay does not hold is 404). DELETE: remove it (edit; the next one moves up).
export const dynamic = "force-dynamic";

const params = z.strictObject({ id: z.uuid(), photoId: z.string().regex(/^id-[A-Za-z0-9._-]{1,150}$/) });
const deleteBody = z.strictObject({ version: z.number().int().min(1) });

export const GET = route({
  permission: { key: "pms.stays", level: "view" },
  params,
  handler: async ({ session, params: p }) => {
    const file = await getIdPhotos().getOne(session, p.id, p.photoId);
    return { data: null, binary: { bytes: file.bytes, contentType: file.contentType, filename: `id-image.${file.contentType === "image/png" ? "png" : "jpg"}`, disposition: "inline" as const } };
  },
});

export const DELETE = route({
  permission: { key: "pms.stays", level: "edit" },
  params,
  body: deleteBody,
  handler: async ({ session, params: p, body, request, traceId }) => ({ data: await getIdPhotos().removeOne(session, p.id, p.photoId, body.version, requestMeta(request, traceId)) }),
});