import "server-only";
import { getNotifications } from "@/server/compose/notifications";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// Withdraws a notification: hidden from the companies at once, kept in the history. Doing it twice changes nothing.
export const POST = route({
  permission: { key: "companies", level: "edit" },
  params: idParams,
  idempotency: "optional",
  handler: async ({ session, params, request, traceId }) => ({ data: await getNotifications().withdraw(session, params.id, requestMeta(request, traceId)) }),
});
