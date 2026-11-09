import "server-only";
import { getSupportDesk } from "@/server/compose/supportDesk";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { supportRespondBody } from "@/server/services/support/schemas";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// Answers a guest message (status answered, a reply needed) or closes it (a reply optional); a closed message is final (409). In House edit; logged.
export const POST = route({
  permission: { key: "pms.stays", level: "edit" },
  params: idParams,
  body: supportRespondBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getSupportDesk().respond(session, params.id, body, requestMeta(request, traceId)) }),
});