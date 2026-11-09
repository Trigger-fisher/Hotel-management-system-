import "server-only";
import { getAdminBackup } from "@/server/compose/admin";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";

// Forgets the Google Drive link (token and folder). SuperAdmin only.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  handler: async ({ session, request, traceId }) => ({ data: await getAdminBackup().disconnect(session, requestMeta(request, traceId)) }),
});