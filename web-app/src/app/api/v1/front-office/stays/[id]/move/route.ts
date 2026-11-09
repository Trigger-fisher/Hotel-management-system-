import "server-only";
import { getFrontOfficeStays } from "@/server/compose/frontOffice";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { moveBody } from "@/server/services/frontOffice/schemas";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

export const POST = route({
  permission: { key: "pms.stays", level: "edit" },
  params: idParams,
  body: moveBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getFrontOfficeStays().move(session, params.id, body, requestMeta(request, traceId)) }),
});
