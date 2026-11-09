import "server-only";
import { z } from "zod";
import { getIdPhotos } from "@/server/compose/frontOffice";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";

// All of the stay's ID images, in order (the main guest's first). GET: the list (Front Office view). POST: add one at the end (edit; a colour JPG
// or PNG, base64 in JSON, up to 8 MB). PUT: a new order of the same images (edit; the first becomes the main photo). Kept in the private ID-photo store, never on a public address.
export const dynamic = "force-dynamic";

const addBody = z.strictObject({ fileName: z.string().max(300), dataBase64: z.string().max(12_000_000), version: z.number().int().min(1) });
const orderBody = z.strictObject({ order: z.array(z.string().regex(/^id-[A-Za-z0-9._-]{1,150}$/)).max(12), version: z.number().int().min(1) });

export const GET = route({
  permission: { key: "pms.stays", level: "view" },
  params: idParams,
  handler: async ({ session, params }) => ({ data: await getIdPhotos().list(session, params.id) }),
});

export const POST = route({
  permission: { key: "pms.stays", level: "edit" },
  params: idParams,
  body: addBody,
  maxBodyBytes: 12 * 1024 * 1024,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getIdPhotos().add(session, params.id, body, requestMeta(request, traceId)), status: 201 }),
});

export const PUT = route({
  permission: { key: "pms.stays", level: "edit" },
  params: idParams,
  body: orderBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getIdPhotos().reorder(session, params.id, body.order, body.version, requestMeta(request, traceId)) }),
});