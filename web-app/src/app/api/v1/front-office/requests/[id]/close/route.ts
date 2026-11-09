import "server-only";
import { getFrontOfficeRequests } from "@/server/compose/frontOffice";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { closeRequestBody } from "@/server/services/frontOffice/schemas";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// Closes a guest request as done or not possible, with an optional word back to the guest. In House edit; logged.
export const POST = route({
  permission: { key: "pms.stays", level: "edit" },
  params: idParams,
  body: closeRequestBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getFrontOfficeRequests().close(session, params.id, body, requestMeta(request, traceId)) }),
});
