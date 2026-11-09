import "server-only";
import { getAdminBooks } from "@/server/compose/admin";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

// Starts the next accounting year (an Admin, after 31 March); the current year is closed in the same step.
export const POST = route({
  permission: "session",
  idempotency: "optional",
  handler: async ({ session, request, traceId }) => ({ data: await getAdminBooks().start(session, requestMeta(request, traceId)) }),
});
