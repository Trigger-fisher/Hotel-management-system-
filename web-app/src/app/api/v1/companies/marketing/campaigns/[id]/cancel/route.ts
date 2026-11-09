import "server-only";
import { getMarketing } from "@/server/compose/companies";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// Sending or paused -> cancelled: the rest is never sent; its mails still waiting in the queue are closed as CANCELLED. Cannot be undone.
export const POST = route({
  permission: { key: "companies", level: "edit" },
  params: idParams,
  idempotency: "optional",
  handler: async ({ session, params, request, traceId }) => ({ data: await getMarketing().cancel(session, params.id, requestMeta(request, traceId)) }),
});
