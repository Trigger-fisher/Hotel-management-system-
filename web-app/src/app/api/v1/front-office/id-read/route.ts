import "server-only";
import { z } from "zod";
import { getIdReader } from "@/server/compose/idReader";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";

// The check-in's ID reading: 1 to 8 pictures (JPG or PNG, base64 in JSON) go to the reader worker as one request and the form fields come back. Needs Front Office edit;
// the pictures are not kept here and nothing about them (name, number) is logged. Not connected or busy answers 409 with details.reason reader_not_connected / reader_busy.
export const dynamic = "force-dynamic";
export const maxDuration = 40;

const file = z.strictObject({ fileName: z.string().max(300), dataBase64: z.string().max(11_500_000) });
const body = z.strictObject({ files: z.array(file).min(1).max(8) });

export const POST = route({
  permission: { key: "pms.stays", level: "edit" },
  body,
  maxBodyBytes: 24 * 1024 * 1024,
  limits: [{ name: "id-read", by: "user", max: 40, windowSeconds: 600, message: "Too many ID readings. Wait a few minutes or type the details in." }],
  handler: async ({ session, body: input, request, traceId }) => ({ data: await getIdReader().read(session, input, requestMeta(request, traceId)) }),
});
